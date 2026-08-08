import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { requireAuth, requireAdmin, optionalAuth, type AuthedRequest } from '../lib/auth.js'
import { asyncHandler } from '../lib/asyncHandler.js'
import { auditLog } from '../lib/audit.js'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { safeParseJsonArray, USER_PUBLIC_SELECT } from '../lib/serialisers.js'
import { moderateContent } from '../lib/moderation.js'

const router: Router = Router()

// v13.3 (audit dedup): use shared USER_PUBLIC_SELECT. Note: reviews only
// needs {id, username, displayName, avatar} but using the shared constant
// is harmless (extra fields are just ignored by the serialiser) and keeps
// all call sites in sync.
const userSelect = USER_PUBLIC_SELECT

// Helper: serialise a review with parsed photos + user info.
// v25.7 (TZ ЭТАП 2.3): include `parentId` and nested `replies` (if loaded).
// Replies are serialised the same way as top-level reviews, just without
// their own nested replies (one level of nesting is enough for the admin
// reply UI).
function serialiseReview(r: any) {
  return {
    id: r.id,
    productId: r.productId,
    userId: r.userId,
    parentId: r.parentId ?? null,
    rating: r.rating,
    title: r.title,
    content: r.content,
    photos: safeParseJsonArray(r.photos),
    isHidden: r.isHidden,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    user: r.user
      ? {
          id: r.user.id,
          username: r.user.username,
          displayName: r.user.displayName,
          avatar: r.user.avatar,
          role: r.user.role,
        }
      : null,
    // v25.7: nested admin replies. Only populated when the Prisma query
    // included `replies` — otherwise undefined (omitted from JSON).
    replies: Array.isArray(r.replies)
      ? r.replies.map((reply: any) => ({
          id: reply.id,
          productId: reply.productId,
          userId: reply.userId,
          parentId: reply.parentId ?? null,
          rating: reply.rating,
          title: reply.title,
          content: reply.content,
          photos: safeParseJsonArray(reply.photos),
          isHidden: reply.isHidden,
          createdAt: reply.createdAt,
          updatedAt: reply.updatedAt,
          user: reply.user
            ? {
                id: reply.user.id,
                username: reply.user.username,
                displayName: reply.user.displayName,
                avatar: reply.user.avatar,
                role: reply.user.role,
              }
            : null,
        }))
      : undefined,
  }
}

const createReviewSchema = z.object({
  productId: z.string().min(1),
  rating: z.number().int().min(1).max(5),
  title: z.string().max(200).optional(),
  content: z.string().max(5000).optional(),
  // Accept both full URLs (https://...) and relative paths (/uploads/...).
  // The frontend's upload endpoint returns relative paths like
  // "/uploads/12345-photo.jpg" — these are NOT valid URLs per Zod's .url()
  // validator, so we use a custom regex that accepts both formats.
  photos: z.array(
    z.string().max(2048).regex(
      /^(https?:\/\/|\/).+/,
      'Must be a URL (http://...) or a relative path (/uploads/...)'
    )
  ).max(5).optional(),
})

// v25.7 (TZ ЭТАП 2.3): schema for admin replies. Replies have NO rating
// (rating=0) and NO photos — they are text-only admin responses shown
// under the parent review.
const createReplySchema = z.object({
  content: z.string().min(1, 'Текст ответа обязателен').max(5000),
})

// POST /api/reviews — create a review for a product.
// v25.7 (TZ ЭТАП 2.3): the previous DB-level @@unique([productId, userId])
// constraint was REMOVED to allow admins to post replies on products they
// may have already reviewed. The "one top-level review per user per product"
// rule is now enforced here in app code (only when parentId is null).
router.post(
  '/',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = createReviewSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid payload', issues: parsed.error.issues })
    }
    const { productId, rating, title, content, photos } = parsed.data

    // Verify the product exists.
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, title: true },
    })
    if (!product) {
      return res.status(404).json({ error: 'Product not found' })
    }

    // v25.7 (TZ ЭТАП 2.3): enforce one-top-level-review-per-user-per-product
    // in app code (the DB-level unique constraint was removed to allow
    // admin replies on the same product). Without this check, a user could
    // bypass the UI and POST multiple top-level reviews via the API.
    const existingTopLevel = await prisma.review.findFirst({
      where: { productId, userId: req.user!.id, parentId: null },
      select: { id: true },
    })
    if (existingTopLevel) {
      return res.status(409).json({ error: 'Вы уже оставили отзыв на этот товар' })
    }

    // v16.9 MODERATION — check review title + content before persisting.
    const reviewText = `${title || ''} ${content || ''}`.trim()
    if (reviewText) {
      const modDecision = await moderateContent(reviewText, {
        userId: req.user!.id,
        targetType: 'review',
      })
      if (!modDecision.allowed) {
        return res.status(422).json({
          error: modDecision.reason,
          moderationBlocked: true,
          severity: modDecision.severity,
          categories: modDecision.categories,
        })
      }
    }

    try {
      const review = await prisma.review.create({
        data: {
          productId,
          userId: req.user!.id,
          parentId: null,
          rating,
          title: title || null,
          content: content || null,
          photos: JSON.stringify(photos || []),
        },
        include: { user: { select: userSelect } },
      })

      // Update the product's aggregate rating + reviewsCount in the same
      // transaction so they stay in sync with the reviews table.
      await updateProductRating(productId)

      // v9-audit-fix (AUDIT-NEW-1): audit-log review creation.
      await auditLog(req, 'review', review.id, 'review_create', {
        after: { productId, rating, hasTitle: !!title, hasContent: !!content, photosCount: photos?.length || 0 },
      })

      // v25.7 (TZ ЭТАП 2.4): emit socket + push notification to admins so
      // they instantly learn about the new review without manual refresh.
      try {
        const { getIo } = await import('../socket/handlers.js')
        const { sendPushToUser } = await import('./push.js')
        const io = getIo()
        const authorName = review.user?.displayName || review.user?.username || 'Аноним'
        if (io) {
          io.to('admins').emit('review:created', {
            reviewId: review.id,
            productId,
            productTitle: product.title,
            rating,
            authorName,
            content: content?.slice(0, 200) || null,
            createdAt: review.createdAt,
          })
        }
        const admins = await prisma.user.findMany({
          where: { role: 'admin', deletedAt: null },
          select: { id: true },
        })
        for (const admin of admins) {
          void sendPushToUser(admin.id, {
            title: '★ Новый отзыв!',
            body: `${authorName}: ${rating}★ ${product.title}`,
            tag: `admin-review-${review.id}`,
            url: '/?view=reviews',
          })
        }
      } catch {
        // Notification failures are non-critical — the review is already saved.
      }

      res.status(201).json(serialiseReview(review))
    } catch (e) {
      // P2002 = unique constraint violation (legacy: user already reviewed
      // this product). With the constraint removed this shouldn't fire, but
      // we keep the handler as a safety net.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return res.status(409).json({ error: 'Вы уже оставили отзыв на этот товар' })
      }
      throw e
    }
  }),
)

// POST /api/reviews/:id/replies — admin posts a reply under a review.
// v25.7 (TZ ЭТАП 2.3): the reply is stored as a Review row with parentId set.
// rating=0 (replies don't affect the product's aggregate rating). The reply
// is included in GET /api/reviews responses via Prisma `include: { replies }`.
router.post(
  '/:id/replies',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parentId = req.params.id
    const parsed = createReplySchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid payload', issues: parsed.error.issues })
    }
    const { content } = parsed.data

    // Verify the parent review exists.
    const parent = await prisma.review.findUnique({
      where: { id: parentId },
      select: { id: true, productId: true, userId: true, content: true },
    })
    if (!parent) {
      return res.status(404).json({ error: 'Родительский отзыв не найден' })
    }

    // v16.9 MODERATION — check reply content before persisting.
    const modDecision = await moderateContent(content, {
      userId: req.user!.id,
      targetType: 'review',
    })
    if (!modDecision.allowed) {
      return res.status(422).json({
        error: modDecision.reason,
        moderationBlocked: true,
        severity: modDecision.severity,
        categories: modDecision.categories,
      })
    }

    const reply = await prisma.review.create({
      data: {
        productId: parent.productId,
        userId: req.user!.id,
        parentId,
        rating: 0, // replies don't have a rating
        title: null,
        content,
        photos: JSON.stringify([]),
      },
      include: { user: { select: userSelect } },
    })

    await auditLog(req, 'review', reply.id, 'review_reply_create', {
      after: { parentId, productId: parent.productId, hasContent: !!content },
    })

    // v25.7 (TZ ЭТАП 2.4): notify the original review's author that their
    // review got a reply (in-app socket event; push is also sent so they
    // see it even if the app is in the background).
    try {
      const { getIo } = await import('../socket/handlers.js')
        const { sendPushToUser } = await import('./push.js')
      const io = getIo()
      const adminName = reply.user?.displayName || reply.user?.username || 'Администратор'
      if (io) {
        io.to(`user:${parent.userId}`).emit('review:reply-created', {
          replyId: reply.id,
          parentId,
          productId: parent.productId,
          authorName: adminName,
          content: content.slice(0, 200),
          createdAt: reply.createdAt,
        })
        // Also notify other admins (so multiple admins can see the reply).
        io.to('admins').emit('review:reply-created', {
          replyId: reply.id,
          parentId,
          productId: parent.productId,
          authorName: adminName,
          content: content.slice(0, 200),
          createdAt: reply.createdAt,
        })
      }
      // Push to the original review's author (if they're not the admin who
      // wrote the reply — avoids self-notification).
      if (parent.userId !== req.user!.id) {
        void sendPushToUser(parent.userId, {
          title: '↩ Ответ на ваш отзыв',
          body: `${adminName}: ${content.slice(0, 100)}`,
          tag: `review-reply-${reply.id}`,
          url: `/?view=reviews`,
        })
      }
    } catch {
      // Notification failures are non-critical.
    }

    res.status(201).json(serialiseReview(reply))
  }),
)

// PATCH /api/reviews/:id — edit own review (rating, content, photos).
// v9-audit-fix (S-MED-NEW-2): previously bypassed Zod, accepting arbitrary
// types for title/content/photos. Now uses the same schema (partial).
const updateReviewSchema = createReviewSchema.partial()
router.patch(
  '/:id',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const existing = await prisma.review.findUnique({
      where: { id: req.params.id },
      // v13.2 (audit P1-2 fix): fetch the fields we need for the audit
      // log "before" snapshot. Previously only {id, userId, productId}
      // were fetched, so the audit log stored `before: { rating: <productId> }`
      // — wrong field name, wrong value, misleading audit trail.
      select: { id: true, userId: true, productId: true, rating: true, title: true, content: true, photos: true },
    })
    if (!existing) return res.status(404).json({ error: 'Review not found' })
    if (existing.userId !== req.user!.id && req.user!.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' })
    }

    const parsed = updateReviewSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() })
    }
    const { rating, title, content, photos } = parsed.data
    const updateData: Prisma.ReviewUpdateInput = {}
    if (rating !== undefined) updateData.rating = rating
    if (title !== undefined) updateData.title = title || null
    if (content !== undefined) updateData.content = content || null
    if (photos !== undefined) updateData.photos = JSON.stringify(photos)

    const updated = await prisma.review.update({
      where: { id: req.params.id },
      data: updateData,
      include: { user: { select: userSelect } },
    })

    // Re-aggregate product rating if the rating changed.
    if (updateData.rating !== undefined) {
      await updateProductRating(existing.productId)
    }

    // v9-audit-fix (AUDIT-NEW-1): audit-log review edits.
    // v13.2 (audit P1-2 fix): before snapshot now has the actual fields.
    await auditLog(req, 'review', req.params.id, 'review_update', {
      before: { rating: existing.rating, title: existing.title, content: existing.content, hasPhotos: !!existing.photos },
      after: { rating, title, content, hasPhotos: !!photos },
    })

    res.json(serialiseReview(updated))
  }),
)

// DELETE /api/reviews/:id — delete own review (or any if admin).
router.delete(
  '/:id',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const existing = await prisma.review.findUnique({
      where: { id: req.params.id },
      select: { id: true, userId: true, productId: true },
    })
    if (!existing) return res.status(404).json({ error: 'Review not found' })
    if (existing.userId !== req.user!.id && req.user!.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' })
    }

    await prisma.review.delete({ where: { id: req.params.id } })
    await updateProductRating(existing.productId)
    // v9-audit-fix (AUDIT-NEW-1): audit-log review deletion.
    await auditLog(req, 'review', req.params.id, 'review_delete', {
      before: { productId: existing.productId, wasOwn: existing.userId === req.user!.id },
    })
    res.json({ ok: true })
  }),
)

// GET /api/reviews?productId=...&sort=newest|highest|lowest&limit=&offset=&q=&stars=
// Returns reviews for a product. Hidden reviews are only visible to admins.
//
// Query params:
//   sort   — newest (default) | highest | lowest
//   q      — search query (case-insensitive Cyrillic via JS post-filter)
//   stars  — filter by exact star count (1–5). When present, items are
//            filtered but `distribution` + `total` still reflect ALL reviews
//            (so the UI can show the full rating breakdown even while the
//            user filters by a specific star).
router.get(
  '/',
  optionalAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const productId = req.query.productId as string | undefined
    if (!productId) {
      return res.status(400).json({ error: 'productId query param required' })
    }
    const sort = (req.query.sort as string) || 'newest'
    const limit = Math.min(Math.max(Number(req.query.limit ?? 20) || 20, 1), 100)
    const offset = Math.max(Number(req.query.offset ?? 0) || 0, 0)
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : ''
    const starsRaw = req.query.stars
    const stars =
      starsRaw !== undefined && starsRaw !== ''
        ? Math.min(Math.max(Number(starsRaw) || 0, 1), 5)
        : null

    // v25.7 (TZ ЭТАП 2.3): hidden reviews must NOT leak to public callers.
    // The route is `optionalAuth` (was anonymous), so we may or may not have
    // a logged-in admin/manager. Only admins/managers see hidden reviews.
    const includeHidden = req.user?.role === 'admin' || req.user?.role === 'manager'
    const hiddenFilter = includeHidden ? {} : { isHidden: false }

    // Sort: newest (default) | highest | lowest
    const orderBy: Prisma.ReviewOrderByWithRelationInput =
      sort === 'highest' ? { rating: 'desc' } :
      sort === 'lowest' ? { rating: 'asc' } :
      { createdAt: 'desc' }

    // Base `where` for the distribution aggregation — always reflects ALL
    // non-hidden reviews for the product (no q/stars filter), so the rating
    // breakdown shown in the UI doesn't change when the user filters.
    // v25.7: top-level reviews only (parentId=null) — replies have rating=0
    // and would skew the aggregate.
    const distWhere: Prisma.ReviewWhereInput = {
      productId,
      parentId: null,
      ...hiddenFilter,
    }

    // Filtered `where` for the actual items list — applies q + stars.
    // v25.7: top-level reviews only — replies are loaded via `include` so
    // they appear nested under their parent, not as separate items.
    const where: Prisma.ReviewWhereInput = {
      productId,
      parentId: null,
      ...hiddenFilter,
    }
    if (stars !== null) where.rating = stars
    if (q) {
      // SQLite Prisma `contains` is case-sensitive for Cyrillic, so we
      // additionally JS-filter below. Use the same over-fetch pattern as
      // products.ts to ensure we have enough matches after the JS filter.
      where.OR = [
        { title: { contains: q } },
        { content: { contains: q } },
      ]
    }

    // When searching, over-fetch so JS-side case-insensitive filter still
    // has enough rows to fill the page (mirrors products.ts approach).
    const dbLimit = q ? Math.min(limit * 5, 500) : limit
    const dbSkip = q ? 0 : offset

    const [items, total, ratingStats] = await Promise.all([
      prisma.review.findMany({
        where,
        orderBy,
        take: dbLimit,
        skip: dbSkip,
        // v25.7 (TZ ЭТАП 2.3): include nested admin replies so they appear
        // under their parent review in the UI. Replies are ordered oldest-first
        // (chronological conversation order).
        include: {
          user: { select: userSelect },
          replies: {
            include: { user: { select: userSelect } },
            orderBy: { createdAt: 'asc' },
            // v25.7: hidden replies are also filtered for non-admins.
            where: includeHidden ? undefined : { isHidden: false },
          },
        },
      }),
      prisma.review.count({ where }),
      // Aggregate rating distribution: { 1: 3, 2: 1, 3: 0, 4: 5, 5: 12 }
      prisma.review.groupBy({
        by: ['rating'],
        where: distWhere,
        _count: { rating: true },
      }),
    ])

    // Optional JS-side re-filter for true case-insensitive Cyrillic search.
    let finalItems = items
    if (q) {
      const needle = q.toLowerCase()
      finalItems = items.filter(
        (r) =>
          (r.title || '').toLowerCase().includes(needle) ||
          (r.content || '').toLowerCase().includes(needle),
      )
      finalItems = finalItems.slice(offset, offset + limit)
    }

    // Build rating distribution object
    const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
    for (const row of ratingStats) {
      distribution[row.rating] = row._count.rating
    }
    const totalRatings = Object.values(distribution).reduce((a, b) => a + b, 0)
    const avgRating = totalRatings > 0
      ? Object.entries(distribution).reduce((sum, [r, c]) => sum + Number(r) * c, 0) / totalRatings
      : 0

    res.json({
      items: finalItems.map(serialiseReview),
      total: q ? finalItems.length === 0 && items.length > 0 ? items.length : total : total,
      limit,
      offset,
      distribution,
      avgRating: Math.round(avgRating * 10) / 10,
    })
  }),
)

// GET /api/reviews/mine?productId=... — get the current user's review for a product.
// Used by the UI to show "your review" + allow editing.
router.get(
  '/mine',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const productId = req.query.productId as string | undefined
    if (!productId) {
      return res.status(400).json({ error: 'productId query param required' })
    }
    // v25.7 (TZ ЭТАП 2.3): @@unique([productId, userId]) was removed, so we
    // can't use findUnique with the composite key. Use findFirst filtered
    // to top-level reviews (parentId=null) — a user can have replies too,
    // but /mine is for THEIR review on the product, not their replies.
    const review = await prisma.review.findFirst({
      where: { productId, userId: req.user!.id, parentId: null },
      include: { user: { select: userSelect } },
    })
    res.json({ review: review ? serialiseReview(review) : null })
  }),
)

// PATCH /api/reviews/:id/hide — admin moderation (hide/show).
router.patch(
  '/:id/hide',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: AuthedRequest, res) => {
    const { hidden } = req.body || {}
    try {
      const existing = await prisma.review.findUnique({
        where: { id: req.params.id },
        select: { id: true, isHidden: true, productId: true, rating: true },
      })
      if (!existing) return res.status(404).json({ error: 'Review not found' })

      const updated = await prisma.review.update({
        where: { id: req.params.id },
        data: { isHidden: !!hidden },
        include: { user: { select: userSelect } },
      })
      await updateProductRating(updated.productId)
      await auditLog(req, 'review', updated.id, 'update', {
        before: { isHidden: existing.isHidden },
        after: { isHidden: updated.isHidden },
      })
      res.json(serialiseReview(updated))
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
        return res.status(404).json({ error: 'Review not found' })
      }
      throw e
    }
  }),
)

// ============================================================================
// Helper: recompute the product's aggregate rating + reviewsCount.
// Called after every create/update/delete to keep Product.rating and
// Product.reviewsCount in sync with the actual reviews table.
// ============================================================================
async function updateProductRating(productId: string): Promise<void> {
  const result = await prisma.review.aggregate({
    where: { productId, isHidden: false },
    _avg: { rating: true },
    _count: { rating: true },
  })
  await prisma.product.update({
    where: { id: productId },
    data: {
      rating: result._avg.rating ? Math.round(result._avg.rating * 10) / 10 : 0,
      reviewsCount: result._count.rating,
    },
  }).catch(() => {
    // Product may have been deleted — ignore.
  })
}

export default router
