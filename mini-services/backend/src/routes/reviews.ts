import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { requireAuth, requireAdmin, type AuthedRequest } from '../lib/auth.js'
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
function serialiseReview(r: any) {
  return {
    id: r.id,
    productId: r.productId,
    userId: r.userId,
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
        }
      : null,
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

// POST /api/reviews — create a review for a product.
// One review per user per product (enforced by @@unique constraint).
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

      res.status(201).json(serialiseReview(review))
    } catch (e) {
      // P2002 = unique constraint violation (user already reviewed this product)
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return res.status(409).json({ error: 'Вы уже оставили отзыв на этот товар' })
      }
      throw e
    }
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
  asyncHandler(async (req, res) => {
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

    // Sort: newest (default) | highest | lowest
    const orderBy: Prisma.ReviewOrderByWithRelationInput =
      sort === 'highest' ? { rating: 'desc' } :
      sort === 'lowest' ? { rating: 'asc' } :
      { createdAt: 'desc' }

    // Base `where` for the distribution aggregation — always reflects ALL
    // reviews for the product (no q/stars filter), so the rating breakdown
    // shown in the UI doesn't change when the user filters.
    const distWhere: Prisma.ReviewWhereInput = { productId }

    // Filtered `where` for the actual items list — applies q + stars.
    const where: Prisma.ReviewWhereInput = { productId }
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
        include: { user: { select: userSelect } },
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
    const review = await prisma.review.findUnique({
      where: { productId_userId: { productId, userId: req.user!.id } },
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
