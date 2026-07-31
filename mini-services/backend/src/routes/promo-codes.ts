/**
 * v19.0 — Promo codes + Bonus points settings CRUD routes.
 *
 * Promo codes (admin):
 *   GET    /api/promo-codes                — list all
 *   POST   /api/promo-codes                — create
 *   PATCH  /api/promo-codes/:id            — update
 *   DELETE /api/promo-codes/:id            — delete
 *   POST   /api/promo-codes/validate       — public, validate a code (returns discount info)
 *
 * Bonus points settings (admin):
 *   GET    /api/promo-codes/bonus-settings — public, returns settings
 *   PUT    /api/promo-codes/bonus-settings — admin, update settings
 *   GET    /api/promo-codes/bonus-balance  — auth, returns user's points balance
 */
import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { requireAuth, requireAdmin, optionalAuth, type AuthedRequest } from '../lib/auth.js'
import { asyncHandler } from '../lib/asyncHandler.js'
import { auditLog } from '../lib/audit.js'

const router = Router()

// ---------- PROMO CODES ----------

const createPromoSchema = z.object({
  code: z.string().min(2).max(50).regex(/^[A-Z0-9_-]+$/i, 'Code must be alphanumeric, dashes, or underscores'),
  description: z.string().max(500).optional(),
  discountType: z.enum(['percent', 'fixed']).default('percent'),
  discountValue: z.number().min(0),
  minOrderTotal: z.number().min(0).default(0),
  maxDiscount: z.number().min(0).nullable().optional(),
  maxUses: z.number().int().min(1).nullable().optional(),
  maxUsesPerUser: z.number().int().min(1).nullable().optional(),
  startsAt: z.string().datetime().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional(),
  active: z.boolean().default(true),
  category: z.string().max(100).nullable().optional(),
})

const updatePromoSchema = createPromoSchema.partial()

function serialisePromo(p: any) {
  return {
    id: p.id,
    code: p.code,
    description: p.description ?? null,
    discountType: p.discountType,
    discountValue: Number(p.discountValue),
    minOrderTotal: Number(p.minOrderTotal),
    maxDiscount: p.maxDiscount != null ? Number(p.maxDiscount) : null,
    maxUses: p.maxUses,
    maxUsesPerUser: p.maxUsesPerUser,
    usedCount: p.usedCount,
    startsAt: p.startsAt,
    endsAt: p.endsAt,
    active: p.active,
    category: p.category ?? null,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  }
}

// GET /api/promo-codes — list all (admin only)
router.get(
  '/',
  requireAuth,
  requireAdmin,
  asyncHandler(async (_req: AuthedRequest, res) => {
    const promos = await prisma.promoCode.findMany({
      orderBy: { createdAt: 'desc' },
    })
    res.json({ promoCodes: promos.map(serialisePromo) })
  }),
)

// POST /api/promo-codes/validate — public, validate a code
router.post(
  '/validate',
  optionalAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const schema = z.object({
      code: z.string().min(1).max(50),
      orderTotal: z.number().min(0).default(0),
    })
    const parsed = schema.parse(req.body)
    const promo = await prisma.promoCode.findFirst({
      where: { code: parsed.code, active: true },
    })
    if (!promo) {
      return res.json({ valid: false, error: 'Промокод не найден или неактивен' })
    }
    const now = new Date()
    const isWithinWindow =
      (!promo.startsAt || promo.startsAt <= now) &&
      (!promo.endsAt || promo.endsAt >= now)
    if (!isWithinWindow) {
      return res.json({ valid: false, error: 'Срок действия промокода истёк' })
    }
    if (promo.maxUses != null && promo.usedCount >= promo.maxUses) {
      return res.json({ valid: false, error: 'Промокод исчерпан' })
    }
    if (parsed.orderTotal < Number(promo.minOrderTotal)) {
      return res.json({
        valid: false,
        error: `Минимальная сумма заказа для этого промокода — ${Number(promo.minOrderTotal)}₽`,
      })
    }
    if (promo.maxUsesPerUser && req.user) {
      const userUsage = await prisma.promoCodeUsage.count({
        where: { promoCodeId: promo.id, userId: req.user.id },
      })
      if (userUsage >= promo.maxUsesPerUser) {
        return res.json({ valid: false, error: 'Вы уже использовали этот промокод' })
      }
    }
    let discount = 0
    if (promo.discountType === 'percent') {
      discount = Math.round((parsed.orderTotal * Number(promo.discountValue)) / 100)
      if (promo.maxDiscount) {
        discount = Math.min(discount, Number(promo.maxDiscount))
      }
    } else {
      discount = Number(promo.discountValue)
    }
    discount = Math.min(discount, parsed.orderTotal)
    res.json({
      valid: true,
      code: promo.code,
      discountType: promo.discountType,
      discountValue: Number(promo.discountValue),
      discount,
    })
  }),
)

// POST /api/promo-codes — create (admin)
router.post(
  '/',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = createPromoSchema.parse(req.body)
    const code = parsed.code.toUpperCase()
    // Check for duplicates
    const existing = await prisma.promoCode.findFirst({ where: { code } })
    if (existing) {
      return res.status(400).json({ error: 'Промокод с таким кодом уже существует' })
    }
    const promo = await prisma.promoCode.create({
      data: {
        code,
        description: parsed.description ?? null,
        discountType: parsed.discountType,
        discountValue: parsed.discountValue,
        minOrderTotal: parsed.minOrderTotal,
        maxDiscount: parsed.maxDiscount ?? null,
        maxUses: parsed.maxUses ?? null,
        maxUsesPerUser: parsed.maxUsesPerUser ?? null,
        startsAt: parsed.startsAt ? new Date(parsed.startsAt) : null,
        endsAt: parsed.endsAt ? new Date(parsed.endsAt) : null,
        active: parsed.active,
        category: parsed.category ?? null,
      },
    })
    await auditLog(req, 'promo-code', promo.id, 'create', { ...parsed, code: promo.code })
    res.json({ promoCode: serialisePromo(promo) })
  }),
)

// PATCH /api/promo-codes/:id — update (admin)
router.patch(
  '/:id',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = req.params.id
    const parsed = updatePromoSchema.parse(req.body)
    const existing = await prisma.promoCode.findUnique({ where: { id } })
    if (!existing) return res.status(404).json({ error: 'Промокод не найден' })
    const update: Record<string, unknown> = {}
    if (parsed.code !== undefined) update.code = String(parsed.code).toUpperCase()
    if (parsed.description !== undefined) update.description = parsed.description ?? null
    if (parsed.discountType !== undefined) update.discountType = parsed.discountType
    if (parsed.discountValue !== undefined) update.discountValue = parsed.discountValue
    if (parsed.minOrderTotal !== undefined) update.minOrderTotal = parsed.minOrderTotal
    if (parsed.maxDiscount !== undefined) update.maxDiscount = parsed.maxDiscount ?? null
    if (parsed.maxUses !== undefined) update.maxUses = parsed.maxUses ?? null
    if (parsed.maxUsesPerUser !== undefined) update.maxUsesPerUser = parsed.maxUsesPerUser ?? null
    if (parsed.startsAt !== undefined) update.startsAt = parsed.startsAt ? new Date(parsed.startsAt) : null
    if (parsed.endsAt !== undefined) update.endsAt = parsed.endsAt ? new Date(parsed.endsAt) : null
    if (parsed.active !== undefined) update.active = parsed.active
    if (parsed.category !== undefined) update.category = parsed.category ?? null
    const promo = await prisma.promoCode.update({ where: { id }, data: update })
    await auditLog(req, 'promo-code', id, 'update', parsed)
    res.json({ promoCode: serialisePromo(promo) })
  }),
)

// DELETE /api/promo-codes/:id — delete (admin)
router.delete(
  '/:id',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = req.params.id
    const existing = await prisma.promoCode.findUnique({ where: { id } })
    if (!existing) return res.status(404).json({ error: 'Промокод не найден' })
    await prisma.promoCode.delete({ where: { id } })
    await auditLog(req, 'promo-code', id, 'delete', { code: existing.code })
    res.json({ ok: true })
  }),
)

// ---------- BONUS POINTS SETTINGS ----------

const DEFAULT_BONUS_SETTINGS = {
  earnRate: 1,
  earnPerCurrencyUnit: 100,
  pointValue: 1,
  minOrderTotalToSpend: 0,
  maxPercentOfOrder: 50,
  maxPointsBalance: null,
  expiryDays: null,
  welcomeBonus: 0,
  enabled: true,
}

const bonusSettingsSchema = z.object({
  earnRate: z.number().min(0).default(1),
  earnPerCurrencyUnit: z.number().min(1).default(100),
  pointValue: z.number().min(0).default(1),
  minOrderTotalToSpend: z.number().min(0).default(0),
  maxPercentOfOrder: z.number().int().min(0).max(100).default(50),
  maxPointsBalance: z.number().int().min(0).nullable().optional(),
  expiryDays: z.number().int().min(1).nullable().optional(),
  welcomeBonus: z.number().int().min(0).default(0),
  enabled: z.boolean().default(true),
})

// GET /api/promo-codes/bonus-settings — public
router.get(
  '/bonus-settings',
  asyncHandler(async (_req, res) => {
    const settings = await prisma.bonusPointsSettings.findUnique({ where: { id: 'default' } })
    if (!settings) {
      return res.json({ settings: DEFAULT_BONUS_SETTINGS })
    }
    res.json({
      settings: {
        earnRate: Number(settings.earnRate),
        earnPerCurrencyUnit: Number(settings.earnPerCurrencyUnit),
        pointValue: Number(settings.pointValue),
        minOrderTotalToSpend: Number(settings.minOrderTotalToSpend),
        maxPercentOfOrder: settings.maxPercentOfOrder,
        maxPointsBalance: settings.maxPointsBalance,
        expiryDays: settings.expiryDays,
        welcomeBonus: settings.welcomeBonus,
        enabled: settings.enabled,
      },
    })
  }),
)

// PUT /api/promo-codes/bonus-settings — admin
router.put(
  '/bonus-settings',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = bonusSettingsSchema.parse(req.body)
    const settings = await prisma.bonusPointsSettings.upsert({
      where: { id: 'default' },
      update: {
        earnRate: parsed.earnRate,
        earnPerCurrencyUnit: parsed.earnPerCurrencyUnit,
        pointValue: parsed.pointValue,
        minOrderTotalToSpend: parsed.minOrderTotalToSpend,
        maxPercentOfOrder: parsed.maxPercentOfOrder,
        maxPointsBalance: parsed.maxPointsBalance ?? null,
        expiryDays: parsed.expiryDays ?? null,
        welcomeBonus: parsed.welcomeBonus,
        enabled: parsed.enabled,
      },
      create: {
        id: 'default',
        earnRate: parsed.earnRate,
        earnPerCurrencyUnit: parsed.earnPerCurrencyUnit,
        pointValue: parsed.pointValue,
        minOrderTotalToSpend: parsed.minOrderTotalToSpend,
        maxPercentOfOrder: parsed.maxPercentOfOrder,
        maxPointsBalance: parsed.maxPointsBalance ?? null,
        expiryDays: parsed.expiryDays ?? null,
        welcomeBonus: parsed.welcomeBonus,
        enabled: parsed.enabled,
      },
    })
    await auditLog(req, 'bonus-points-settings', 'default', 'update', parsed)
    res.json({ settings: {
      earnRate: Number(settings.earnRate),
      earnPerCurrencyUnit: Number(settings.earnPerCurrencyUnit),
      pointValue: Number(settings.pointValue),
      minOrderTotalToSpend: Number(settings.minOrderTotalToSpend),
      maxPercentOfOrder: settings.maxPercentOfOrder,
      maxPointsBalance: settings.maxPointsBalance,
      expiryDays: settings.expiryDays,
      welcomeBonus: settings.welcomeBonus,
      enabled: settings.enabled,
    }})
  }),
)

// GET /api/promo-codes/bonus-balance — auth, returns user's points balance
router.get(
  '/bonus-balance',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { points: true, pointsEarnedTotal: true },
    })
    res.json({
      balance: user?.points ?? 0,
      earnedTotal: user?.pointsEarnedTotal ?? 0,
    })
  }),
)

export default router
