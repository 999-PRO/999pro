// 999 — Три девятки — AI Calculation Engine
// ----------------------------------------------------------------------------
// Reads product + services from the KB and computes a final price based on
// the product's pricingType and formulaSpec. This module is the SINGLE source
// of truth for prices — DeepSeek never computes numbers on its own.
//
// Supported pricingType values:
//   fixed            — basePrice is the final price
//   per_unit         — basePrice × quantity
//   per_sq_meter     — basePrice × (width × height)
//   per_linear_meter — basePrice × length
//   per_set          — basePrice × sets
//   range            — basePrice is min, maxPrice is max (returns a range)
//   quote            — "по запросу" — no number, AI should ask for details
//
// formulaSpec (JSON stored on the product) supports:
//   {
//     "dimensionUnit": "m",            // m | cm | mm — input unit
//     "round": "up" | "nearest" | "down" | "none", // rounding strategy
//     "roundStep": 100,                // round to nearest 100 RUB
//     "defaultServices": ["design"]    // services applied by default
//   }
//
// Services are added on top. Service pricingType:
//   fixed            — add `price` once
//   percent          — add `price`% of the running subtotal
//   per_unit         — add `price` × quantity (uses product quantity)
//   per_sq_meter     — add `price` × area
//   per_linear_meter — add `price` × length
//
// The result is a structured object that the chat endpoint passes to DeepSeek
// so the model can phrase it naturally in the final response.
// ----------------------------------------------------------------------------
import { getKBProductById, getKBProductBySlug } from './ai-kb.js'

export interface CalcInput {
  // Product identifier — slug preferred, falls back to name search.
  productSlug?: string
  productId?: string
  productName?: string
  // Dimensions (in meters unless overridden by formulaSpec.dimensionUnit).
  width?: number
  height?: number
  length?: number
  quantity?: number
  // Explicit list of services requested by name.
  services?: string[]
  // Override options.
  dimensionUnit?: 'm' | 'cm' | 'mm'
}

export interface CalcServiceLine {
  name: string
  pricingType: string
  amount: number
  isDefault: boolean
}

export interface CalcResult {
  ok: boolean
  product: {
    id: string
    name: string
    slug: string
    pricingType: string
    currency: string
  } | null
  matchedServices: CalcServiceLine[]
  baseCost: number
  servicesCost: number
  total: number
  // For "range" pricing — populated with [min, max]. Null otherwise.
  range: [number, number] | null
  // Human-readable summary the AI can use verbatim.
  breakdown: string[]
  // Missing parameters the AI should ask the user for.
  missing: string[]
  // Free-form note (e.g. "Цена по запросу").
  note?: string
}

const EMPTY: CalcResult = {
  ok: false,
  product: null,
  matchedServices: [],
  baseCost: 0,
  servicesCost: 0,
  total: 0,
  range: null,
  breakdown: [],
  missing: [],
}

function roundAmount(value: number, spec: any): number {
  if (!spec || spec.round === 'none' || !spec.round) return Math.round(value * 100) / 100
  const step = Number(spec.roundStep) || 100
  if (spec.round === 'up') return Math.ceil(value / step) * step
  if (spec.round === 'down') return Math.floor(value / step) * step
  return Math.round(value / step) * step
}

function toMeters(value: number, unit: string | undefined): number {
  if (unit === 'cm') return value / 100
  if (unit === 'mm') return value / 1000
  return value
}

function parseSpec(json: string | null | undefined): any {
  if (!json) return {}
  try { return JSON.parse(json) } catch { return {} }
}

function parseMaterials(json: string | null | undefined): string[] {
  if (!json) return []
  try {
    const v = JSON.parse(json)
    return Array.isArray(v) ? v.map(String) : []
  } catch { return [] }
}

function parseSpecs(json: string | null | undefined): Record<string, string> {
  if (!json) return {}
  try {
    const v = JSON.parse(json)
    return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, string> : {}
  } catch { return {} }
}

// Find a product by slug, id, or name (case-insensitive partial match).
export async function resolveProduct(input: CalcInput): Promise<any | null> {
  if (input.productSlug) {
    const p = await getKBProductBySlug(input.productSlug)
    if (p) return p
  }
  if (input.productId) {
    const p = await getKBProductById(input.productId)
    if (p) return p
  }
  if (input.productName) {
    // Search by exact name first, then partial.
    const exact = await findProductByName(input.productName, true)
    if (exact) return exact
    const partial = await findProductByName(input.productName, false)
    if (partial) return partial
  }
  return null
}

async function findProductByName(name: string, exact: boolean): Promise<any | null> {
  const { prisma } = await import('./prisma.js')
  const product = await prisma.aIKB_Product.findFirst({
    where: exact
      ? { name: { equals: name } }
      : { name: { contains: name } },
    include: {
      category: true,
      services: { orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] },
      faqs: { where: { isActive: true } },
    },
  })
  return product
}

export async function calculatePrice(input: CalcInput): Promise<CalcResult> {
  const product = await resolveProduct(input)
  if (!product) {
    return { ...EMPTY, missing: ['product'] }
  }

  const spec = parseSpec(product.formulaSpec)
  const dimUnit = input.dimensionUnit || spec.dimensionUnit || 'm'
  const result: CalcResult = {
    ok: true,
    product: {
      id: product.id,
      name: product.name,
      slug: product.slug,
      pricingType: product.pricingType,
      currency: product.currency || 'RUB',
    },
    matchedServices: [],
    baseCost: 0,
    servicesCost: 0,
    total: 0,
    range: null,
    breakdown: [],
    missing: [],
  }

  // ---------------------------------------------------------------------------
  //  BASE COST
  // ---------------------------------------------------------------------------
  const basePrice = Number(product.basePrice as any) || 0
  const maxPrice = product.maxPrice == null ? null : Number(product.maxPrice as any)

  switch (product.pricingType) {
    case 'fixed':
      result.baseCost = basePrice
      result.breakdown.push(`Базовая стоимость: ${fmt(basePrice)} ₽`)
      break

    case 'per_unit': {
      const qty = input.quantity ?? 1
      result.baseCost = basePrice * qty
      result.breakdown.push(`Цена за штуку: ${fmt(basePrice)} ₽ × ${qty} = ${fmt(result.baseCost)} ₽`)
      break
    }

    case 'per_sq_meter': {
      if (input.width == null || input.height == null) {
        result.missing.push('width', 'height')
        result.breakdown.push('Для расчёта по площади нужны ширина и высота.')
        break
      }
      const w = toMeters(input.width, dimUnit)
      const h = toMeters(input.height, dimUnit)
      const area = w * h
      result.baseCost = basePrice * area
      result.breakdown.push(`Площадь: ${fmt(w)} × ${fmt(h)} = ${fmt(area)} м²`)
      result.breakdown.push(`Цена за м²: ${fmt(basePrice)} ₽ × ${fmt(area)} м² = ${fmt(result.baseCost)} ₽`)
      break
    }

    case 'per_linear_meter': {
      if (input.length == null && input.width != null) {
        // Allow width to act as "length" for one-dimensional products.
        const len = toMeters(input.width, dimUnit)
        result.baseCost = basePrice * len
        result.breakdown.push(`Длина: ${fmt(len)} м × ${fmt(basePrice)} ₽/м = ${fmt(result.baseCost)} ₽`)
      } else if (input.length != null) {
        const len = toMeters(input.length, dimUnit)
        result.baseCost = basePrice * len
        result.breakdown.push(`Длина: ${fmt(len)} м × ${fmt(basePrice)} ₽/м = ${fmt(result.baseCost)} ₽`)
      } else {
        result.missing.push('length')
        result.breakdown.push('Для расчёта по погонным метрам нужна длина.')
      }
      break
    }

    case 'per_set': {
      const sets = input.quantity ?? 1
      result.baseCost = basePrice * sets
      result.breakdown.push(`Цена за комплект: ${fmt(basePrice)} ₽ × ${sets} = ${fmt(result.baseCost)} ₽`)
      break
    }

    case 'range': {
      const min = basePrice
      const max = maxPrice ?? basePrice
      result.range = [min, max]
      result.baseCost = min
      result.breakdown.push(`Стоимость: от ${fmt(min)} до ${fmt(max)} ₽`)
      break
    }

    case 'quote': {
      result.note = 'Стоимость рассчитывается индивидуально — нужно уточнить детали.'
      result.breakdown.push(result.note)
      break
    }

    default:
      result.baseCost = basePrice
      result.breakdown.push(`Базовая стоимость: ${fmt(basePrice)} ₽`)
  }

  // ---------------------------------------------------------------------------
  //  SERVICES
  // ---------------------------------------------------------------------------
  const requestedServices = (input.services || []).map((s) => s.toLowerCase().trim()).filter(Boolean)
  const defaultServiceNames = Array.isArray(spec.defaultServices) ? spec.defaultServices.map(String) : []
  const services = (product.services || []) as any[]

  for (const svc of services) {
    const name = String(svc.name || '')
    const nameLower = name.toLowerCase()
    const isRequested = requestedServices.some((r) => nameLower.includes(r) || r.includes(nameLower))
    const isDefault = !!svc.isDefault
    if (!isRequested && !isDefault) continue

    // Also check explicit default list from formulaSpec.
    const inSpecDefault = defaultServiceNames.some((d: string) => nameLower.includes(d.toLowerCase()) || d.toLowerCase().includes(nameLower))
    if (!isRequested && !isDefault && !inSpecDefault) continue

    const svcPrice = Number(svc.price as any) || 0
    let amount = 0
    const breakdownLine = [name]

    switch (svc.pricingType) {
      case 'fixed':
        amount = svcPrice
        breakdownLine.push(`${fmt(svcPrice)} ₽`)
        break
      case 'percent':
        amount = (result.baseCost * svcPrice) / 100
        breakdownLine.push(`${svcPrice}% от ${fmt(result.baseCost)} ₽ = ${fmt(amount)} ₽`)
        break
      case 'per_unit': {
        const qty = input.quantity ?? 1
        amount = svcPrice * qty
        breakdownLine.push(`${fmt(svcPrice)} ₽ × ${qty} = ${fmt(amount)} ₽`)
        break
      }
      case 'per_sq_meter': {
        if (input.width != null && input.height != null) {
          const w = toMeters(input.width, dimUnit)
          const h = toMeters(input.height, dimUnit)
          amount = svcPrice * (w * h)
          breakdownLine.push(`${fmt(svcPrice)} ₽/м² × ${fmt(w * h)} м² = ${fmt(amount)} ₽`)
        }
        break
      }
      case 'per_linear_meter': {
        const len = input.length != null ? toMeters(input.length, dimUnit)
          : input.width != null ? toMeters(input.width, dimUnit) : null
        if (len != null) {
          amount = svcPrice * len
          breakdownLine.push(`${fmt(svcPrice)} ₽/м × ${fmt(len)} м = ${fmt(amount)} ₽`)
        }
        break
      }
      default:
        amount = svcPrice
        breakdownLine.push(`${fmt(svcPrice)} ₽`)
    }

    result.matchedServices.push({
      name,
      pricingType: svc.pricingType,
      amount,
      isDefault: isDefault || inSpecDefault,
    })
    result.servicesCost += amount
    result.breakdown.push(`${breakdownLine.join(' — ')}`)
  }

  // ---------------------------------------------------------------------------
  //  TOTAL
  // ---------------------------------------------------------------------------
  if (result.range) {
    const [min, max] = result.range
    const minTotal = min + result.servicesCost
    const maxTotal = max + result.servicesCost
    result.total = minTotal
    result.range = [roundAmount(minTotal, spec), roundAmount(maxTotal, spec)]
    result.breakdown.push(`Итоговая стоимость (диапазон): ${fmt(result.range[0])}–${fmt(result.range[1])} ₽`)
  } else if (product.pricingType === 'quote') {
    result.total = 0
  } else {
    const rawTotal = result.baseCost + result.servicesCost
    result.total = roundAmount(rawTotal, spec)
    result.breakdown.push(`Итого: ${fmt(result.total)} ₽`)
  }

  // Apply min order value if set.
  if (product.minOrderValue != null) {
    const minVal = Number(product.minOrderValue as any) || 0
    if (result.total > 0 && result.total < minVal) {
      result.breakdown.push(`Минимальная сумма заказа: ${fmt(minVal)} ₽ — применена.`)
      result.total = minVal
    }
  }

  return result
}

function fmt(n: number): string {
  if (!isFinite(n)) return '0'
  // Russian number format: thousands separator is space, decimals comma.
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 2 })
}

// ---------------------------------------------------------------------------
//  SERIALIZE KB PRODUCT FOR THE AI PROMPT
// ---------------------------------------------------------------------------
// Builds a compact text card for a product that can be injected into the
// system prompt. This is the ONLY channel through which DeepSeek sees KB
// data — the model never sees the DB.
export function serializeProductForAI(product: any): string {
  const lines: string[] = []
  lines.push(`### ${product.name}`)
  if (product.shortSummary) lines.push(`Кратко: ${product.shortSummary}`)
  if (product.description) lines.push(`Описание: ${product.description}`)
  lines.push(`Тип цены: ${pricingLabel(product.pricingType)}`)
  lines.push(`Базовая цена: ${fmt(Number(product.basePrice as any) || 0)} ${product.currency || 'RUB'}`)
  if (product.maxPrice != null) lines.push(`Макс. цена: ${fmt(Number(product.maxPrice as any) || 0)} ${product.currency || 'RUB'}`)
  if (product.formula) lines.push(`Формула: ${product.formula}`)
  if (product.leadTime) lines.push(`Срок изготовления: ${product.leadTime}`)
  if (product.warranty) lines.push(`Гарантия: ${product.warranty}`)

  const materials = parseMaterials(product.materials)
  if (materials.length) lines.push(`Материалы: ${materials.join(', ')}`)

  const specs = parseSpecs(product.specs)
  const specKeys = Object.keys(specs)
  if (specKeys.length) {
    const specText = specKeys.map((k) => `${k}: ${specs[k]}`).join('; ')
    lines.push(`Характеристики: ${specText}`)
  }

  if (Array.isArray(product.services) && product.services.length) {
    const svcLines = product.services.map((s: any) => {
      const p = Number(s.price as any) || 0
      const tag = s.pricingType === 'percent' ? `${p}%` : `${fmt(p)} ₽`
      const def = s.isDefault ? ' (включено по умолчанию)' : ''
      return `  - ${s.name} — ${pricingLabel(s.pricingType)}, ${tag}${def}`
    })
    lines.push(`Доп. услуги:`)
    lines.push(...svcLines)
  }

  if (Array.isArray(product.faqs) && product.faqs.length) {
    lines.push(`Частые вопросы:`)
    for (const f of product.faqs) {
      lines.push(`  Q: ${f.question}`)
      lines.push(`  A: ${f.answer}`)
    }
  }

  if (product.aiInstruction) {
    lines.push(`ИНСТРУКЦИЯ ДЛЯ AI: ${product.aiInstruction}`)
  }

  return lines.join('\n')
}

export function pricingLabel(t: string): string {
  switch (t) {
    case 'fixed': return 'Фиксированная'
    case 'per_unit': return 'За штуку'
    case 'per_sq_meter': return 'За м²'
    case 'per_linear_meter': return 'За погонный метр'
    case 'per_set': return 'За комплект'
    case 'range': return 'Диапазон'
    case 'quote': return 'По запросу'
    default: return t
  }
}
