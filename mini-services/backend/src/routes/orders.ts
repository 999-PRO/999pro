import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { requireAuth, requireAdmin, type AuthedRequest } from '../lib/auth.js'
import { asyncHandler } from '../lib/asyncHandler.js'
import { auditLog } from '../lib/audit.js'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { safeParseJsonArray } from '../lib/serialisers.js'
import { logger } from '../lib/logger.js'

const router: Router = Router()

// Valid order statuses (single source of truth — used by create, update, and UI).
// The DB column is a free-text String for SQLite portability; this array
// enforces the contract at the API layer.
export const ORDER_STATUSES = ['new', 'in_work', 'production', 'ready', 'in_delivery', 'done', 'cancelled'] as const
type OrderStatus = (typeof ORDER_STATUSES)[number]

// v16.5: new status workflow — Новые → В работе → Производство → Готов →
// Передан в доставку → Завершён (или Отменён на любом этапе).
export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  new: 'Новые',
  in_work: 'В работе',
  production: 'Производство',
  ready: 'Готов',
  in_delivery: 'Передан в доставку',
  done: 'Завершён',
  cancelled: 'Отменён',
}

// Helper: serialise an order with items + product images parsed from JSON.
function serialiseOrder(o: any) {
  return {
    id: o.id,
    userId: o.userId,
    // Wave 4 (B-DB-001): convert Prisma Decimal → number for JSON
    total: o.total != null ? Number(o.total) : 0,
    status: o.status,
    createdAt: o.createdAt,
    // v12.7: checkout fields
    name: o.name ?? null,
    phone: o.phone ?? null,
    address: o.address ?? null,
    deliveryMethod: o.deliveryMethod ?? null,
    contactMethod: o.contactMethod ?? null,
    comment: o.comment ?? null,
    receiptUrl: o.receiptUrl ?? null,
    couponCode: o.couponCode ?? null,
    discount: o.discount != null ? Number(o.discount) : 0,
    // v19.0: promo + bonus points
    promoCode: o.promoCode ?? null,
    promoDiscount: o.promoDiscount != null ? Number(o.promoDiscount) : 0,
    pointsSpent: o.pointsSpent ?? 0,
    pointsDiscount: o.pointsDiscount != null ? Number(o.pointsDiscount) : 0,
    pointsEarned: o.pointsEarned ?? 0,
    // v16: delivery system fields
    lat: o.lat ?? null,
    lng: o.lng ?? null,
    mapUrl: o.mapUrl ?? null,
    deliveryZoneId: o.deliveryZoneId ?? null,
    deliveryFee: o.deliveryFee != null ? Number(o.deliveryFee) : 0,
    deliveryZone: o.deliveryZone
      ? {
          id: o.deliveryZone.id,
          name: o.deliveryZone.name,
          cost: o.deliveryZone.cost != null ? Number(o.deliveryZone.cost) : 0,
        }
      : null,
    // v16.5: category + updatedAt
    category: o.category ?? null,
    updatedAt: o.updatedAt ?? null,
    items: (o.items || []).map((it: any) => ({
      id: it.id,
      orderId: it.orderId,
      productId: it.productId,
      quantity: it.quantity,
      price: it.price != null ? Number(it.price) : 0,
      product: it.product
        ? { ...it.product, images: safeParseJsonArray(it.product.images), price: it.product.price != null ? Number(it.product.price) : 0, oldPrice: it.product.oldPrice != null ? Number(it.product.oldPrice) : null }
        : null,
    })),
  }
}

const createOrderSchema = z.object({
  items: z.array(z.object({
    productId: z.string().min(1),
    quantity: z.number().int().min(1).max(100),
  })).min(1, 'Cart must have at least one item'),
  total: z.number().nonnegative().optional(),
  // v12.7: checkout fields
  name: z.string().min(1).max(200).optional(),
  phone: z.string().min(6).max(20).optional(),
  address: z.string().max(500).nullable().optional(),
  deliveryMethod: z.enum(['pickup', 'delivery']).optional(),
  contactMethod: z.enum(['whatsapp', 'telegram', 'phone', 'email']).optional(),
  comment: z.string().max(2000).optional(),
  receiptUrl: z.string().max(2048).optional(),
  couponCode: z.string().max(100).optional(),
  // v19.0: promo code + bonus points
  promoCode: z.string().max(100).optional(),
  pointsToSpend: z.number().int().min(0).optional(),
  // v16: delivery system fields
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  mapUrl: z.string().max(2048).optional(),
  deliveryZoneId: z.string().max(64).optional(),
  // v16.5: category (optional — derived from first product's category if not provided)
  category: z.string().max(100).optional(),
})

// POST /api/orders — create an order from the current cart.
// The cart contents are sent in the body (not read from the DB) so the
// client can show a final "review order" step before commit.
router.post(
  '/',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = createOrderSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid payload', issues: parsed.error.issues })
    }
    const { items, total: clientTotal, name, phone, address, deliveryMethod, contactMethod, comment, receiptUrl, couponCode, promoCode: promoCodeInput, pointsToSpend: pointsToSpendInput, lat, lng, mapUrl, deliveryZoneId, category } = parsed.data

    // Fetch all products in one query to validate IDs + compute the total
    // server-side. We NEVER trust the client's total for billing — it's
    // only accepted as a sanity check.
    // v9-audit-fix: exclude soft-deleted products — archived products cannot be ordered.
    const products = await prisma.product.findMany({
      where: { id: { in: items.map((i) => i.productId) }, deletedAt: null },
      select: { id: true, price: true, inStock: true, title: true, category: true, quantity: true },
    })

    const productMap = new Map(products.map((p) => [p.id, p]))
    const orderItems: { productId: string; quantity: number; price: number }[] = []
    let serverTotal = 0

    for (const item of items) {
      const product = productMap.get(item.productId)
      if (!product) {
        return res.status(400).json({ error: `Product ${item.productId} not found` })
      }
      if (!product.inStock) {
        return res.status(400).json({ error: `«${product.title}» нет в наличии` })
      }
      // AUDIT-2 C1 fix (v16.8): check atomic stock availability.
      // `quantity` column already exists on Product (Prisma schema line 132).
      // We check here for fast-fail (user-facing error), but the authoritative
      // atomic check happens INSIDE the transaction below (see comment at
      // the stock decrement block). This pre-check is best-effort UX.
      if (product.quantity < item.quantity) {
        return res.status(400).json({
          error: `«${product.title}» — недостаточно в наличии (осталось ${product.quantity} шт.)`,
        })
      }
      // Wave 4 (B-DB-001): product.price is Prisma Decimal — convert to number
      const unitPrice = Number(product.price)
      orderItems.push({
        productId: product.id,
        quantity: item.quantity,
        price: unitPrice,
      })
      serverTotal += unitPrice * item.quantity
    }

    // If the client sent a total, warn (but don't fail) on mismatch — could
    // be a stale cart. The server total always wins.
    if (clientTotal !== undefined && Math.abs(clientTotal - serverTotal) > 0.01) {
      logger.warn(`[ORDERS] Client total ${clientTotal} != server total ${serverTotal}`)
    }

    // v12.7: Server-side coupon validation. If a couponCode is provided,
    // look it up, check active/dates/quantity, and compute the discount.
    // The discount is subtracted from the total (floored at 0).
    let discount = 0
    let validatedCouponCode: string | null = null
    if (couponCode) {
      const coupon = await prisma.clubCoupon.findFirst({
        where: { code: couponCode, active: true },
      })
      if (coupon) {
        const now = new Date()
        const isValid =
          (!coupon.startsAt || coupon.startsAt <= now) &&
          (!coupon.endsAt || coupon.endsAt >= now) &&
          (coupon.quantity == null || coupon.usedCount < coupon.quantity)
        if (isValid) {
          if (coupon.discountType === 'percent') {
            discount = Math.round((serverTotal * coupon.discountValue) / 100)
          } else {
            discount = coupon.discountValue
          }
          discount = Math.min(discount, serverTotal) // can't exceed total
          validatedCouponCode = coupon.code
        }
      }
    }
    const finalTotal = serverTotal - discount

    // v19.0: Promo code validation (separate from club coupon).
    // Looks up PromoCode table, validates active/dates/usage/limits, computes discount.
    let promoDiscount = 0
    let validatedPromoCode: string | null = null
    if (promoCodeInput) {
      const promo = await prisma.promoCode.findFirst({
        where: { code: promoCodeInput, active: true },
      })
      if (promo) {
        const now = new Date()
        const isValid =
          (!promo.startsAt || promo.startsAt <= now) &&
          (!promo.endsAt || promo.endsAt >= now) &&
          (promo.maxUses == null || promo.usedCount < promo.maxUses) &&
          finalTotal >= Number(promo.minOrderTotal)
        if (isValid) {
          // Check per-user usage limit
          if (promo.maxUsesPerUser) {
            const userUsage = await prisma.promoCodeUsage.count({
              where: { promoCodeId: promo.id, userId: req.user!.id },
            })
            if (userUsage >= promo.maxUsesPerUser) {
              return res.status(400).json({ error: 'Промокод уже использован максимальное число раз' })
            }
          }
          let pDiscount = 0
          if (promo.discountType === 'percent') {
            pDiscount = Math.round((finalTotal * Number(promo.discountValue)) / 100)
            if (promo.maxDiscount) {
              pDiscount = Math.min(pDiscount, Number(promo.maxDiscount))
            }
          } else {
            pDiscount = Number(promo.discountValue)
          }
          pDiscount = Math.min(pDiscount, finalTotal)
          promoDiscount = pDiscount
          validatedPromoCode = promo.code
        }
      }
    }
    const totalAfterPromo = finalTotal - promoDiscount

    // v19.0: Bonus points redemption.
    // Reads BonusPointsSettings (or default 1 point = 1 RUB) and validates:
    //   - points system enabled
    //   - user has enough points
    //   - order meets min total
    //   - discount doesn't exceed maxPercentOfOrder
    let pointsSpent = 0
    let pointsDiscount = 0
    if (pointsToSpendInput && pointsToSpendInput > 0) {
      const bpSettings = await prisma.bonusPointsSettings.findUnique({ where: { id: 'default' } })
      if (bpSettings && bpSettings.enabled) {
        const user = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { points: true } })
        if (user && user.points >= pointsToSpendInput) {
          const pointValue = Number(bpSettings.pointValue)
          const computedDiscount = pointsToSpendInput * pointValue
          const maxPercent = bpSettings.maxPercentOfOrder
          const maxDiscount = (totalAfterPromo * maxPercent) / 100
          if (computedDiscount <= maxDiscount && totalAfterPromo >= Number(bpSettings.minOrderTotalToSpend)) {
            pointsSpent = pointsToSpendInput
            pointsDiscount = computedDiscount
          }
        }
      }
    }
    const totalAfterPoints = Math.max(0, totalAfterPromo - pointsDiscount)

    // v16: resolve delivery fee from the chosen zone (if any).
    // Future: support formula / radius / polygon. For now: flat zone cost.
    let deliveryFee = 0
    let validatedZoneId: string | null = null
    if (deliveryMethod === 'delivery' && deliveryZoneId) {
      const zone = await prisma.deliveryZone.findUnique({ where: { id: deliveryZoneId } })
      if (zone && zone.isActive) {
        deliveryFee = Number(zone.cost)
        validatedZoneId = zone.id
      }
    }
    const grandTotal = totalAfterPoints + deliveryFee

    // Create the order + items in a single transaction so we never have
    // an orphan order without items.
    // AUDIT-2 C1 fix (v16.8): transaction now also performs atomic stock
    // decrement. If any product goes out of stock mid-tx, the whole tx
    // rolls back (no orphan order, no orphan items, cart preserved).
    let order
    try {
      order = await prisma.$transaction(async (tx) => {
      const created = await tx.order.create({
        data: {
          userId: req.user!.id,
          total: grandTotal,
          status: 'new',
          // v12.7: checkout fields
          name: name || null,
          phone: phone || null,
          address: address || null,
          deliveryMethod: deliveryMethod || null,
          contactMethod: contactMethod || null,
          comment: comment || null,
          receiptUrl: receiptUrl || null,
          couponCode: validatedCouponCode,
          discount,
          // v19.0: promo code + bonus points
          promoCode: validatedPromoCode,
          promoDiscount,
          pointsSpent,
          pointsDiscount,
          // v16: delivery system fields
          lat: lat ?? null,
          lng: lng ?? null,
          mapUrl: mapUrl || null,
          deliveryZoneId: validatedZoneId,
          deliveryFee,
          // v16.5: category (use provided, or derive from first product)
          category: category || productMap.get(items[0]?.productId)?.category || null,
          items: {
            create: orderItems,
          },
        },
        include: {
          items: { include: { product: true } },
          deliveryZone: { select: { id: true, name: true, cost: true } },
        },
      })
      // Increment each product's lifetime `purchases` counter by the
      // quantity bought. This is the single most important signal for the
      // "📈 Сейчас покупают" and "⚡ Быстро раскупают" home-page blocks.
      // AUDIT-2 C1 fix (v16.8): ATOMIC stock decrement inside the same tx.
      // The `quantity` column on Product already exists in Prisma schema
      // (line 132) — earlier audit's "DEFERRED — requires schema change"
      // comment was based on a stale read of the schema. The actual column
      // has been there since v11.
      //
      // Atomic updateMany with `where: { id, quantity: { gte: N } }` ensures
      // that two parallel orders for the last item cannot both succeed:
      // the first commits and decrements quantity, the second's updateMany
      // matches 0 rows (because quantity is now below N), and we throw
      // OUT_OF_STOCK to roll back the entire transaction (order + items + cart clear).
      for (const item of orderItems) {
        // Increment purchases counter (lifetime metric, always grows).
        await tx.product.updateMany({
          where: { id: item.productId },
          data: { purchases: { increment: item.quantity } },
        })
        // Atomic stock decrement — fails the whole tx if stock insufficient.
        const result = await tx.product.updateMany({
          where: { id: item.productId, quantity: { gte: item.quantity } },
          data: { quantity: { decrement: item.quantity } },
        })
        if (result.count === 0) {
          // Trigger tx rollback — the order, items, and cart clear all abort.
          const product = productMap.get(item.productId)
          throw new Error(`OUT_OF_STOCK:${product?.title || item.productId}`)
        }
        // If quantity hits 0 after decrement, auto-flip inStock to false
        // so the catalog UI reflects "no stock" immediately. This is a
        // secondary effect inside the same atomic update — if the product
        // is later restocked (admin sets quantity > 0), the admin UI should
        // also flip inStock back to true. (See products.ts PATCH handler.)
        await tx.product.updateMany({
          where: { id: item.productId, quantity: 0 },
          data: { inStock: false },
        })
      }
      // D-CRIT-002 fix: clear the user's cart INSIDE the transaction.
      // Previously cartItem.deleteMany ran AFTER the transaction committed,
      // outside its boundary. If the delete failed (DB error, network blip),
      // the user had BOTH a created order AND a full cart — next checkout
      // would create a duplicate order. Now if any step fails, the entire
      // order + cart clear is rolled back atomically.
      await tx.cartItem.deleteMany({ where: { userId: req.user!.id } })

      // H9 fix: CLUB points начисление ВНУТРИ order transaction. Раньше
      // это был отдельный prisma.$transaction ПОСЛЕ основного — если сервер
      // упал между ними, заказ создан, но баллы не начислены. Теперь если
      // любая из операций упадёт (включая points), откатывается весь заказ.
      // v19.0: Use BonusPointsSettings if configured, otherwise fall back to
      // the legacy formula (1 point per 100 RUB).
      const bpSettings = await tx.bonusPointsSettings.findUnique({ where: { id: 'default' } })
      let pointsEarned: number
      if (bpSettings && bpSettings.enabled && Number(bpSettings.earnPerCurrencyUnit) > 0) {
        pointsEarned = Math.floor(
          (totalAfterPoints / Number(bpSettings.earnPerCurrencyUnit)) * Number(bpSettings.earnRate),
        )
      } else {
        pointsEarned = Math.floor(totalAfterPoints / 100)
      }
      // v19.0: Subtract points spent (already validated above)
      const netPointsDelta = pointsEarned - pointsSpent
      if (netPointsDelta > 0) {
        await tx.user.update({
          where: { id: req.user!.id },
          data: {
            points: { increment: netPointsDelta },
            pointsEarnedTotal: { increment: pointsEarned },
          },
        })
      } else if (netPointsDelta < 0) {
        await tx.user.update({
          where: { id: req.user!.id },
          data: { points: { increment: netPointsDelta } }, // decrement
        })
      }
      // Record points-earned transaction (if any)
      if (pointsEarned > 0) {
        await tx.pointsTransaction.create({
          data: {
            userId: req.user!.id,
            delta: pointsEarned,
            reason: 'purchase',
            entityId: created.id,
            entityType: 'order',
          },
        })
      }
      // Record points-spent transaction (if any)
      if (pointsSpent > 0) {
        await tx.pointsTransaction.create({
          data: {
            userId: req.user!.id,
            delta: -pointsSpent,
            reason: 'checkout_redeem',
            entityId: created.id,
            entityType: 'order',
          },
        })
      }
      // Update order with pointsEarned for the receipt record
      if (pointsEarned > 0) {
        await tx.order.update({ where: { id: created.id }, data: { pointsEarned } })
      }
      // v19.0: Record promo code usage
      if (validatedPromoCode) {
        const promoRec = await tx.promoCode.findFirst({ where: { code: validatedPromoCode } })
        if (promoRec) {
          await tx.promoCode.update({
            where: { id: promoRec.id },
            data: { usedCount: { increment: 1 } },
          })
          await tx.promoCodeUsage.create({
            data: {
              promoCodeId: promoRec.id,
              userId: req.user!.id,
              orderId: created.id,
            },
          })
        }
      }

      return created
    })
    } catch (e: any) {
      // AUDIT-2 C1 fix (v16.8): surface OUT_OF_STOCK as a user-friendly 400.
      if (e?.message?.startsWith('OUT_OF_STOCK:')) {
        const productName = e.message.slice('OUT_OF_STOCK:'.length)
        return res.status(400).json({
          error: `Товар «${productName}» только что закончился. Обновите корзину.`,
        })
      }
      throw e
    }

    // v9-audit-fix (AUDIT-NEW-1): audit-log order creation.
    await auditLog(req, 'order', order.id, 'order_create', {
      after: { total: order.total, itemsCount: order.items?.length || 0 },
    })

    // H9 fix: CLUB points уже начислены ВНУТРИ order transaction выше.
    // Здесь — только push-уведомление (fire-and-forget, не блокирует ответ).
    try {
      const bpSettings = await prisma.bonusPointsSettings.findUnique({ where: { id: 'default' } })
      let pointsEarned: number
      if (bpSettings && bpSettings.enabled && Number(bpSettings.earnPerCurrencyUnit) > 0) {
        pointsEarned = Math.floor(
          (totalAfterPoints / Number(bpSettings.earnPerCurrencyUnit)) * Number(bpSettings.earnRate),
        )
      } else {
        pointsEarned = Math.floor(totalAfterPoints / 100)
      }
      if (pointsEarned > 0) {
        const { sendPushToUser } = await import('./push.js')
        sendPushToUser(req.user!.id, {
          title: '⭐ Баллы за покупку!',
          body: `Начислено ${pointsEarned} баллов за заказ на ${totalAfterPoints}₽`,
          tag: `club-purchase-${order.id}`,
          url: '/?view=club',
        }).catch(() => {})
      }
    } catch (e) {
      logger.error('Points push notification failed:', { module: 'orders', error: e })
    }

    // v12.7: Push notification to ALL admins about the new order.
    try {
      const { sendPushToUser } = await import('./push.js')
      const admins = await prisma.user.findMany({
        where: { role: 'admin', deletedAt: null },
        select: { id: true },
      })
      const userName = name || req.user!.username
      const methodLabel = deliveryMethod === 'pickup' ? 'Самовывоз' : 'Доставка'
      for (const admin of admins) {
        sendPushToUser(admin.id, {
          title: '🛒 Новый заказ!',
          body: `#${order.id.slice(-6)} · ${userName} · ${grandTotal}₽ · ${methodLabel}`,
          tag: `admin-order-${order.id}`,
          url: '/studio/?view=orders',
        }).catch(() => {})
      }
    } catch (e) {
      logger.error('Admin push failed:', { module: 'orders', error: e })
    }

    res.status(201).json(serialiseOrder(order))
  }),
)

// GET /api/orders — list the current user's orders, newest first.
// Admins can pass ?userId=... to view any user's orders, or ?all=true to
// view all orders (used by Studio).
router.get(
  '/',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const where: Prisma.OrderWhereInput = {}
    if (req.user!.role === 'admin' && req.query.all === 'true') {
      // Admin viewing all orders
    } else if (req.user!.role === 'admin' && req.query.userId) {
      where.userId = String(req.query.userId)
    } else {
      where.userId = req.user!.id
    }

    const limit = Math.min(Math.max(Number(req.query.limit ?? 50) || 50, 1), 200)
    const offset = Math.max(Number(req.query.offset ?? 0) || 0, 0)
    const status = req.query.status as OrderStatus | undefined
    if (status && ORDER_STATUSES.includes(status)) {
      where.status = status
    }
    // v16.5: category filter (Studio)
    const category = req.query.category as string | undefined
    if (category) where.category = category
    // v16.6: universal text search — name, phone, id, comment, address,
    // category, + product title (via items relation).
    const q = req.query.q as string | undefined
    if (q && q.trim()) {
      const term = q.trim()
      where.OR = [
        { name: { contains: term } },
        { phone: { contains: term } },
        { id: { contains: term } },
        { comment: { contains: term } },
        { address: { contains: term } },
        { category: { contains: term } },
        { items: { some: { product: { title: { contains: term } } } } },
      ]
    }

    const [items, total] = await Promise.all([
      prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        include: {
          items: { include: { product: true } },
          deliveryZone: { select: { id: true, name: true, cost: true } },
        },
      }),
      prisma.order.count({ where }),
    ])

    res.json({
      items: items.map(serialiseOrder),
      total,
      limit,
      offset,
      statuses: ORDER_STATUSES,
      statusLabels: ORDER_STATUS_LABELS,
    })
  }),
)

// GET /api/orders/:id — view a single order's details.
router.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
      include: {
        items: { include: { product: true } },
        deliveryZone: { select: { id: true, name: true, cost: true } },
      },
    })
    if (!order) return res.status(404).json({ error: 'Order not found' })

    // Owners can view their own orders; admins can view any.
    if (order.userId !== req.user!.id && req.user!.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' })
    }
    res.json(serialiseOrder(order))
  }),
)

// PATCH /api/orders/:id — update order status (admin only).
// Used by Studio to mark orders as paid/shipped/delivered/cancelled.
// AUDIT-4 Y3 fix (v16.8): admin can now also edit name, phone, address,
// comment, deliveryMethod, contactMethod, deliveryZoneId, lat, lng —
// previously only `status` was editable. Admins needed this to correct
// mistakes (wrong address, wrong phone, etc.) without cancelling the order.
router.patch(
  '/:id',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = req.body || {}

    // Build the update payload from any provided fields.
    // Status is validated against the enum; other fields are type-coerced.
    const updateData: Record<string, unknown> = {}

    if (body.status !== undefined) {
      if (!ORDER_STATUSES.includes(body.status)) {
        return res.status(400).json({
          error: `Invalid status. Must be one of: ${ORDER_STATUSES.join(', ')}`,
        })
      }
      updateData.status = body.status
    }

    // Editable string fields (admin can correct mistakes).
    // Empty string is treated as null (clear the field).
    for (const field of ['name', 'phone', 'address', 'comment', 'deliveryMethod', 'contactMethod']) {
      if (body[field] !== undefined) {
        const v = body[field]
        if (v === null || v === '') {
          updateData[field] = null
        } else if (typeof v === 'string') {
          updateData[field] = v.slice(0, 500) // sanity cap
        }
      }
    }

    // Delivery zone — validate that it exists if provided.
    if (body.deliveryZoneId !== undefined) {
      if (body.deliveryZoneId === null || body.deliveryZoneId === '') {
        updateData.deliveryZoneId = null
        updateData.deliveryFee = 0
      } else {
        const zone = await prisma.deliveryZone.findUnique({ where: { id: body.deliveryZoneId } })
        if (!zone) return res.status(400).json({ error: 'Зона доставки не найдена' })
        updateData.deliveryZoneId = zone.id
        updateData.deliveryFee = Number(zone.cost)
      }
    }

    // Geolocation — lat/lng + mapUrl.
    if (body.lat !== undefined) {
      const lat = Number(body.lat)
      if (Number.isFinite(lat) && lat >= -90 && lat <= 90) updateData.lat = lat
      else if (body.lat === null) updateData.lat = null
    }
    if (body.lng !== undefined) {
      const lng = Number(body.lng)
      if (Number.isFinite(lng) && lng >= -180 && lng <= 180) updateData.lng = lng
      else if (body.lng === null) updateData.lng = null
    }
    if (body.mapUrl !== undefined) {
      updateData.mapUrl = typeof body.mapUrl === 'string' ? body.mapUrl.slice(0, 2000) : null
    }

    // Sanity check: at least one field must be updated.
    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: 'No fields to update' })
    }

    try {
      const existing = await prisma.order.findUnique({
        where: { id: req.params.id },
        select: {
          id: true, status: true, userId: true, total: true,
          name: true, phone: true, address: true, comment: true,
          deliveryMethod: true, contactMethod: true, deliveryZoneId: true,
          lat: true, lng: true, mapUrl: true,
        },
      })
      if (!existing) return res.status(404).json({ error: 'Order not found' })

      // P1-4 fix: wrap order update + status history in a single transaction
      // so the history row is guaranteed to exist if the status change commits
      // (previously fire-and-forget after tx, breaking the revert feature on
      // silent history-write failure).
      const order = await prisma.$transaction(async (tx) => {
        const updated = await tx.order.update({
          where: { id: req.params.id },
          data: updateData,
          include: {
            items: { include: { product: true } },
            deliveryZone: { select: { id: true, name: true, cost: true } },
          },
        })
        // Record status change in history INSIDE the tx (if status changed).
        if (updateData.status && existing.status !== updated.status) {
          await tx.orderStatusHistory.create({
            data: {
              orderId: updated.id,
              fromStatus: existing.status as string,
              toStatus: updated.status as string,
              changedById: req.user!.id,
            },
          })
        }
        return updated
      })

      // Audit which fields actually changed.
      const changes: Record<string, { before: unknown; after: unknown }> = {}
      for (const key of Object.keys(updateData)) {
        const before = (existing as Record<string, unknown>)[key]
        const after = (order as Record<string, unknown>)[key]
        if (JSON.stringify(before) !== JSON.stringify(after)) {
          changes[key] = { before, after }
        }
      }
      // Always audit status_change for backward compat with AuditView filters.
      if (changes.status) {
        await auditLog(req, 'order', order.id, 'status_change', changes)
      }
      // Audit field edits as a separate action.
      const fieldChanges = { ...changes }
      delete fieldChanges.status
      if (Object.keys(fieldChanges).length > 0) {
        await auditLog(req, 'order', order.id, 'admin_edit', fieldChanges)
      }

      // v16.2: Real-time notification — emit socket event to the order
      // owner + all admins, and send a Web Push to the owner (in case the
      // app is closed or the socket is disconnected). Mirrors the lead
      // status-change pattern in routes/leads.ts.
      try {
        const { getIo } = await import('../socket/handlers.js')
        const io = getIo()
        if (io) {
          const payload = {
            orderId: order.id,
            status: order.status,
            total: Number(order.total),
            updatedAt: new Date().toISOString(),
          }
          // Notify the order owner (personal room)
          if (existing.userId) {
            io.to(`user:${existing.userId}`).emit('order:status-changed', payload)
          }
          // Notify all admin studios
          io.to('admins').emit('order:status-changed', payload)
        }
      } catch (e) {
        logger.error('Order status socket emit failed:', { module: 'orders', error: e })
      }

      // Web Push to the owner — only if status changed (not for field edits).
      if (changes.status) {
        try {
          const { sendPushToUser } = await import('./push.js')
          const label = ORDER_STATUS_LABELS[order.status as OrderStatus]
          const emoji =
            order.status === 'in_work' ? '⚙️' :
            order.status === 'production' ? '🏭' :
            order.status === 'ready' ? '✅' :
            order.status === 'in_delivery' ? '🚚' :
            order.status === 'done' ? '📦' :
            order.status === 'cancelled' ? '❌' : '📋'
          sendPushToUser(existing.userId, {
            title: `${emoji} Статус заказа обновлён`,
            body: `Заказ #${order.id.slice(-6)} — ${label}`,
            tag: `order-status-${order.id}`,
            url: '/?view=orders',
          }).catch(() => {})
        } catch (e) {
          logger.error('Order status push failed:', { module: 'orders', error: e })
        }
      }

      res.json(serialiseOrder(order))
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
        return res.status(404).json({ error: 'Order not found' })
      }
      throw e
    }
  }),
)

// DELETE /api/orders/:id — cancel an order (user can cancel their own pending orders).
// This is a soft-cancel: sets status to 'cancelled' rather than deleting the row,
// so the order history is preserved.
router.delete(
  '/:id',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
      select: { id: true, userId: true, status: true, total: true, discount: true, items: { include: { product: { select: { id: true, title: true } } } } },
    })
    if (!order) return res.status(404).json({ error: 'Order not found' })

    const isOwner = order.userId === req.user!.id
    const isAdmin = req.user!.role === 'admin'
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ error: 'Forbidden' })
    }

    // v16.5: only orders not yet in delivery/done can be cancelled by user.
    if (order.status === 'in_delivery' || order.status === 'done') {
      return res.status(400).json({ error: 'Нельзя отменить заказ на этой стадии' })
    }
    if (order.status === 'cancelled') {
      return res.status(400).json({ error: 'Заказ уже отменён' })
    }

    // AUDIT-2 C1 fix (v16.8): restore stock atomically when cancelling.
    // AUDIT-4 loyalty exploit fix (v16.8): claw back CLUB points awarded
    // for the cancelled order. Both stock restore + points claw-back run
    // in a single tx with the status update so they all succeed or all
    // roll back together.
    const finalTotal = Number(order.total) - Number(order.discount || 0)
    const pointsToClawBack = Math.floor(finalTotal / 100)

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.order.update({
        where: { id: req.params.id, status: { not: 'cancelled' } },
        data: { status: 'cancelled' },
        include: {
          items: { include: { product: true } },
          deliveryZone: { select: { id: true, name: true, cost: true } },
        },
      })
      // Restore stock + re-flip inStock flag if applicable.
      for (const item of result.items) {
        await tx.product.updateMany({
          where: { id: item.productId },
          data: {
            quantity: { increment: item.quantity },
            // If quantity was 0 and now becomes >0, mark as in stock again.
            // We do this in a second updateMany to avoid race with concurrent
            // orders — but it's best-effort (admin can also flip it manually).
          },
        })
        await tx.product.updateMany({
          where: { id: item.productId, quantity: { gt: 0 }, inStock: false },
          data: { inStock: true },
        })
      }
      // Claw back CLUB points (1 pt per 100 RUB of finalTotal).
      if (pointsToClawBack > 0) {
        const user = await tx.user.findUnique({
          where: { id: order.userId! },
          select: { points: true },
        })
        if (user) {
          // Clamp to non-negative — never let points go below 0 from a cancel.
          const newPoints = Math.max(0, user.points - pointsToClawBack)
          const actuallyClawedBack = user.points - newPoints
          if (actuallyClawedBack > 0) {
            await tx.user.update({
              where: { id: order.userId! },
              data: { points: newPoints },
            })
            await tx.pointsTransaction.create({
              data: {
                userId: order.userId!,
                delta: -actuallyClawedBack,
                reason: 'order_cancel',
                entityId: order.id,
                entityType: 'order',
              },
            })
          }
        }
      }
      return result
    })

    // AUDIT-4 audit gap fix (v16.8): order cancel was NOT audited.
    // Now logged with both status change + points clawed back for traceability.
    await auditLog(req, 'order', order.id, 'cancel', {
      before: { status: order.status },
      after: { status: 'cancelled', pointsClawedBack: pointsToClawBack },
    })

    // Notify the order owner via socket + push (if admin cancelled it).
    if (isAdmin && order.userId) {
      try {
        const { getIo } = await import('../socket/handlers.js')
        const io = getIo()
        if (io) {
          io.to(`user:${order.userId}`).emit('order:status-changed', {
            orderId: updated.id,
            status: 'cancelled',
            updatedAt: new Date().toISOString(),
          })
        }
        const { sendPushToUser } = await import('./push.js')
        sendPushToUser(order.userId, {
          title: '❌ Заказ отменён',
          body: `Заказ #${updated.id.slice(-6)} отменён администратором`,
          tag: `order-cancel-${updated.id}`,
          url: '/?view=orders',
        }).catch(() => {})
      } catch { /* non-critical */ }
    }

    res.json(serialiseOrder(updated))
  }),
)

// GET /api/orders/:id/receipt — download a PDF receipt (owner or admin).
// AUDIT-4 Y2 fix (v16.8): generate a printable receipt for each order.
// Returns application/pdf. Currently generates an INTERNAL receipt (not a
// 54-ФЗ fiscal document) — for full fiscal compliance, connect an online
// kassa API (YooKassa, ATOL, etc.) and use their receipt PDFs.
router.get(
  '/:id/receipt',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
      include: {
        items: { include: { product: { select: { id: true, title: true } } } },
        deliveryZone: { select: { id: true, name: true, cost: true } },
        user: { select: { id: true, username: true, email: true } },
      },
    })
    if (!order) return res.status(404).json({ error: 'Order not found' })

    // Owners can view their own receipts; admins can view any.
    if (order.userId !== req.user!.id && req.user!.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' })
    }

    const { generateReceiptPdf } = await import('../lib/receipt.js')
    const pdfBuffer = await generateReceiptPdf(order as any)

    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `inline; filename="receipt-${order.id.slice(-8)}.pdf"`)
    res.setHeader('Cache-Control', 'private, max-age=3600')
    res.send(pdfBuffer)
  }),
)

// GET /api/orders/:id/history — list status change history (admin only).
// v16.5: returns all status transitions for audit + revert UI.
router.get(
  '/:id/history',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: AuthedRequest, res) => {
    const history = await prisma.orderStatusHistory.findMany({
      where: { orderId: req.params.id },
      orderBy: { createdAt: 'desc' },
      include: {
        changedBy: { select: { id: true, username: true, displayName: true } },
      },
    })
    res.json({
      items: history.map((h) => ({
        id: h.id,
        orderId: h.orderId,
        fromStatus: h.fromStatus,
        toStatus: h.toStatus,
        changedBy: h.changedBy,
        note: h.note,
        createdAt: h.createdAt,
      })),
    })
  }),
)

// POST /api/orders/:id/revert — revert to previous status (admin only).
// v16.5: looks up the most recent history row, sets order.status back to
// fromStatus, and records a NEW history entry for the revert.
router.post(
  '/:id/revert',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: AuthedRequest, res) => {
    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
      select: { id: true, status: true, userId: true },
    })
    if (!order) return res.status(404).json({ error: 'Order not found' })

    // Find the most recent history entry (the last transition)
    const lastChange = await prisma.orderStatusHistory.findFirst({
      where: { orderId: order.id },
      orderBy: { createdAt: 'desc' },
    })
    if (!lastChange) {
      return res.status(400).json({ error: 'Нет истории изменений для отката' })
    }

    const previousStatus = lastChange.fromStatus
    if (previousStatus === order.status) {
      return res.status(400).json({ error: 'Уже в предыдущем статусе' })
    }

    const updated = await prisma.order.update({
      where: { id: order.id },
      data: { status: previousStatus },
      include: {
        items: { include: { product: true } },
        deliveryZone: { select: { id: true, name: true, cost: true } },
      },
    })

    // Record the revert as a new history entry
    await prisma.orderStatusHistory.create({
      data: {
        orderId: order.id,
        fromStatus: order.status,
        toStatus: previousStatus,
        changedById: req.user!.id,
        note: 'Откат статуса',
      },
    }).catch(() => {})

    await auditLog(req, 'order', order.id, 'status_revert', {
      before: { status: order.status },
      after: { status: previousStatus },
    })

    // Emit socket + push (same as PATCH)
    try {
      const { getIo } = await import('../socket/handlers.js')
      const io = getIo()
      if (io) {
        const payload = { orderId: updated.id, status: updated.status, updatedAt: new Date().toISOString() }
        if (order.userId) io.to(`user:${order.userId}`).emit('order:status-changed', payload)
        io.to('admins').emit('order:status-changed', payload)
      }
    } catch { /* non-critical */ }

    res.json(serialiseOrder(updated))
  }),
)

export default router
