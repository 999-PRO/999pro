import fs from 'node:fs'
import path from 'node:path'
import { logger } from './logger.js'
import type { Order } from '@prisma/client'
import PDFDocument from 'pdfkit'

// ============================================================================
// Invoice / receipt PDF generator.
//
// H8 fix (final): ранее PDF генерировался hand-rolled кодом с base Helvetica,
// которая НЕ поддерживает Cyrillic — текст транслитерировался в ASCII
// (Listovki A5 вместо «Листовки А5»). Теперь используем pdfkit + DejaVu Sans
// TTF (полная поддержка Cyrillic + Latin). Текст чека локализован на русский.
//
// Endpoint: GET /api/orders/:id/receipt (auth: owner or admin)
// Returns: application/pdf
//
// Это внутренний чек для покупателя и админ-записей — НЕ фискальный документ.
// Для 54-ФЗ-compliance подключите онлайн-кассу (YooKassa, ATOL, etc.).
// ============================================================================

// DejaVu Sans поддерживает Cyrillic + Latin. Шрифты лежат в системе.
const DEJAVU_REGULAR = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
const DEJAVU_BOLD = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'

// Fallback пути, если системные шрифты недоступны (например, в Docker без
// установленного fontconfig). В таком случае используем встроенный Helvetica
// с транслитом — это лучше чем ничего.
function fontAvailable(p: string): boolean {
  try {
    return fs.existsSync(p)
  } catch {
    return false
  }
}

const HAS_CYRILLIC_FONTS = fontAvailable(DEJAVU_REGULAR) && fontAvailable(DEJAVU_BOLD)

// Fallback translit (используется ТОЛЬКО если TTF-шрифты недоступны).
function translitToAscii(s: string): string {
  if (!s) return ''
  const map: Record<string, string> = {
    'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'e','ж':'zh','з':'z','и':'i','й':'y',
    'к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f',
    'х':'h','ц':'ts','ч':'ch','ш':'sh','щ':'sch','ъ':'','ы':'y','ь':'','э':'e','ю':'yu','я':'ya',
    'А':'A','Б':'B','В':'V','Г':'G','Д':'D','Е':'E','Ё':'E','Ж':'Zh','З':'Z','И':'I','Й':'Y',
    'К':'K','Л':'L','М':'M','Н':'N','О':'O','П':'P','Р':'R','С':'S','Т':'T','У':'U','Ф':'F',
    'Х':'H','Ц':'Ts','Ч':'Ch','Ш':'Sh','Щ':'Sch','Ъ':'','Ы':'Y','Ь':'','Э':'E','Ю':'Yu','Я':'Ya',
    '№':'#','«':'"','»':'"','—':'-','–':'-',
  }
  let out = ''
  for (const ch of s) out += map[ch] ?? ch
  return out
}

interface ReceiptLine {
  text: string
  size?: number
  bold?: boolean
  gap?: number
}

export async function generateReceiptPdf(
  order: Order & { items?: any[]; deliveryZone?: any; user?: any },
): Promise<Buffer> {
  const lines: ReceiptLine[] = []

  // Header (Russian)
  lines.push({ text: '999 — Три девятки — Чек заказа', size: 16, bold: true, gap: 4 })
  lines.push({ text: `Заказ №${order.id.slice(-8).toUpperCase()}`, size: 12, gap: 2 })
  lines.push({
    text: `Дата: ${order.createdAt.toLocaleString('ru-RU', { timeZone: 'UTC' })} UTC`,
    size: 10,
    gap: 12,
  })

  // Customer
  if (order.name) lines.push({ text: `Покупатель: ${order.name}`, size: 10 })
  if (order.phone) lines.push({ text: `Телефон: ${order.phone}`, size: 10 })
  if (order.address) lines.push({ text: `Адрес: ${order.address}`, size: 10, gap: 10 })

  // Items
  lines.push({ text: 'Состав заказа:', size: 11, bold: true, gap: 4 })
  if (order.items && order.items.length > 0) {
    for (const item of order.items) {
      const title = item.product?.title || 'Товар'
      const qty = item.quantity
      const price = Number(item.price)
      const sum = qty * price
      lines.push({
        text: `  ${title.slice(0, 50)}  ×${qty}  ${price.toFixed(2)} ₽  =  ${sum.toFixed(2)} ₽`,
        size: 10,
      })
    }
  }

  // Totals
  lines.push({ text: '', gap: 8 })
  const subtotal = Number(order.total) - Number(order.deliveryFee || 0) + Number(order.discount || 0)
  if (Number(order.discount) > 0) {
    lines.push({ text: `Сумма:        ${subtotal.toFixed(2)} ₽`, size: 10 })
    lines.push({ text: `Скидка:       −${Number(order.discount).toFixed(2)} ₽`, size: 10 })
  }
  if (Number(order.deliveryFee) > 0) {
    lines.push({ text: `Доставка:     ${Number(order.deliveryFee).toFixed(2)} ₽`, size: 10 })
  }
  lines.push({ text: `ИТОГО:        ${Number(order.total).toFixed(2)} ₽`, size: 12, bold: true, gap: 4 })

  // Status
  const statusLabels: Record<string, string> = {
    new: 'Новый',
    in_work: 'В работе',
    production: 'В производстве',
    ready: 'Готов',
    in_delivery: 'Передан в доставку',
    done: 'Завершён',
    cancelled: 'Отменён',
  }
  lines.push({ text: `Статус: ${statusLabels[order.status] || order.status}`, size: 10, gap: 12 })

  // Payment method
  lines.push({ text: 'Оплата: наличными при получении', size: 10, gap: 12 })

  // Footer
  lines.push({ text: 'Это внутренний чек. Не является фискальным документом.', size: 8 })
  lines.push({ text: '999 — Три девятки — Маркетплейс нового поколения', size: 8 })

  // Build PDF with pdfkit
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 })
    const chunks: Buffer[] = []

    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    // Register fonts (если доступны — Cyrillic; иначе fallback на Helvetica
    // с транслитом).
    if (HAS_CYRILLIC_FONTS) {
      try {
        doc.registerFont('DejaVu', DEJAVU_REGULAR)
        doc.registerFont('DejaVu-Bold', DEJAVU_BOLD)
      } catch (e) {
        logger.error('[receipt] Failed to register DejaVu fonts, falling back to Helvetica+translit', {
          module: 'receipt',
          error: e,
        })
      }
    }

    const pageWidth = 595
    let y = 842 - 50

    for (const line of lines) {
      y -= line.gap ?? 6
      const size = line.size ?? 10
      const useBold = !!line.bold
      const fontName = HAS_CYRILLIC_FONTS
        ? (useBold ? 'DejaVu-Bold' : 'DejaVu')
        : (useBold ? 'Helvetica-Bold' : 'Helvetica')

      doc.font(fontName)
      doc.fontSize(size)
      // Если Cyrillic-шрифты недоступны — транслитерируем.
      const text = HAS_CYRILLIC_FONTS ? line.text : translitToAscii(line.text)
      doc.text(text, 50, y, { width: pageWidth - 100, align: 'left' })
    }

    doc.end()
  })
}
