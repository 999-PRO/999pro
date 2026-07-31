// 999 — Три девятки — AI Knowledge Base data access layer
// ----------------------------------------------------------------------------
// All reads from the KB go through this module so we can swap the data source
// later (e.g. add a Redis cache) without touching the route handlers.
//
// CRITICAL: DeepSeek NEVER reads the DB directly. The chat endpoint uses
// these helpers to fetch the relevant KB slice, then feeds it to the model
// as plain text in the system prompt.
// ----------------------------------------------------------------------------
import { prisma } from './prisma.js'
import { logger } from './logger.js'
import type { Prisma } from '@prisma/client'

// ---------------------------------------------------------------------------
//  PRODUCTS
// ---------------------------------------------------------------------------

export interface KBProductListItem {
  id: string
  name: string
  slug: string
  description: string | null
  shortSummary: string | null
  pricingType: string
  basePrice: number
  maxPrice: number | null
  currency: string
  leadTime: string | null
  warranty: string | null
  isActive: boolean
  category: { id: string; name: string } | null
}

export async function listKBProducts(opts?: { includeInactive?: boolean; q?: string }): Promise<KBProductListItem[]> {
  const where: Prisma.AIKB_ProductWhereInput = {}
  if (!opts?.includeInactive) where.isActive = true
  if (opts?.q) {
    where.OR = [
      { name: { contains: opts.q } },
      { description: { contains: opts.q } },
      { shortSummary: { contains: opts.q } },
      { slug: { contains: opts.q } },
    ]
  }
  const rows = await prisma.aIKB_Product.findMany({
    where,
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    include: { category: { select: { id: true, name: true } } },
  })
  return rows.map((p) => ({
    id: p.id,
    name: p.name,
    slug: p.slug,
    description: p.description,
    shortSummary: p.shortSummary,
    pricingType: p.pricingType,
    basePrice: typeof p.basePrice === 'number' ? p.basePrice : Number(p.basePrice as any),
    maxPrice: p.maxPrice == null ? null : typeof p.maxPrice === 'number' ? p.maxPrice : Number(p.maxPrice as any),
    currency: p.currency,
    leadTime: p.leadTime,
    warranty: p.warranty,
    isActive: p.isActive,
    category: p.category,
  }))
}

export async function getKBProductBySlug(slug: string) {
  return prisma.aIKB_Product.findUnique({
    where: { slug },
    include: {
      category: true,
      services: { orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] },
      faqs: { where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
    },
  })
}

export async function getKBProductById(id: string) {
  return prisma.aIKB_Product.findUnique({
    where: { id },
    include: {
      category: true,
      services: { orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] },
      faqs: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
    },
  })
}

// ---------------------------------------------------------------------------
//  CATEGORIES
// ---------------------------------------------------------------------------

export async function listKBCategories() {
  return prisma.aIKB_Category.findMany({
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    include: { _count: { select: { products: true } } },
  })
}

// ---------------------------------------------------------------------------
//  FAQ (global + per-product)
// ---------------------------------------------------------------------------

export async function listGlobalFAQs() {
  return prisma.aIKB_FAQ.findMany({
    where: { productId: null, isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  })
}

export async function listAllFAQs() {
  return prisma.aIKB_FAQ.findMany({
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    include: { product: { select: { id: true, name: true } } },
  })
}

// ---------------------------------------------------------------------------
//  SETTINGS
// ---------------------------------------------------------------------------

export async function getKBSettings() {
  let s = await prisma.aIKB_Settings.findUnique({ where: { id: 'default' } })
  if (!s) {
    s = await prisma.aIKB_Settings.create({ data: { id: 'default' } })
  }
  return s
}

export async function updateKBSettings(data: Partial<{
  systemPrompt: string
  fallbackMessage: string
  greeting: string
  assistantName: string
}>) {
  return prisma.aIKB_Settings.upsert({
    where: { id: 'default' },
    create: { id: 'default', ...data },
    update: data,
  })
}

// ---------------------------------------------------------------------------
//  CONVERSATION LOG
// ---------------------------------------------------------------------------

export async function logConversation(entry: {
  userId?: string | null
  context?: string | null
  userMessage: string
  assistantReply: string
  parameters?: any
  totalPrice?: number | null
  localHandled?: boolean
}) {
  try {
    return await prisma.aIKB_Conversation.create({
      data: {
        userId: entry.userId ?? null,
        context: entry.context ?? null,
        userMessage: entry.userMessage,
        assistantReply: entry.assistantReply,
        parameters: entry.parameters ? JSON.stringify(entry.parameters) : null,
        totalPrice: entry.totalPrice ?? null,
        localHandled: entry.localHandled ?? false,
      },
    })
  } catch (e) {
    // Logging is best-effort — never break the chat flow on log failure.
    logger.error('logConversation failed', { module: 'ai-kb', error: e instanceof Error ? e : new Error(String(e)) })
    return null
  }
}
