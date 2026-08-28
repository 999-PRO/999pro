import { Router } from 'express'
import { z } from 'zod'
import { LRUCache } from 'lru-cache'
import { prisma } from '../lib/prisma.js'
import { requireAuth, optionalAuth, requireAdmin, type AuthedRequest } from '../lib/auth.js'
import { asyncHandler } from '../lib/asyncHandler.js'
import { auditLog } from '../lib/audit.js'
import { createProductSchema } from '../lib/schemas.js'
import { safeParseJsonArray } from '../lib/serialisers.js'
import { broadcastChanged } from '../lib/broadcast.js'
// v25.15: авто-push «Новый товар» всем подписчикам push-уведомлений
import { broadcastPushToAll } from './push.js'

const router = Router()

// ----------------------------------------------------------------------------
//  Smart ranking helpers
// ----------------------------------------------------------------------------

/**
 * Compute a single "smart score" for a product, used by the home page's
 * smart-blocks endpoint to rank products across multiple signals.
 *
 * Formula (weighted, normalized to roughly 0–100):
 *   rating * 8        — max 40 (5 stars * 8)
 *   reviewsCount * 0.4 — max ~20 (50 reviews * 0.4)
 *   purchases * 0.3    — capped at 15
 *   views * 0.01       — capped at 10 (1000 views * 0.01)
 *   favoriteAdds * 0.5 — capped at 10 (20 favs * 0.5)
 *   cartAdds * 0.2     — capped at 5 (25 adds * 0.2)
 * + manual boosts:    isTrending +5, isPopular +3, isRecommended +3, isPremium +2, isNew +2, isAction +2
 * + freshness boost:  products created in last 7 days +5, last 30 days +2
 */
function smartScore(p: any): number {
  const rating = (p.rating || 0) * 8
  const reviews = Math.min((p.reviewsCount || 0) * 0.4, 20)
  const purchases = Math.min((p.purchases || 0) * 0.3, 15)
  const views = Math.min((p.views || 0) * 0.01, 10)
  const favs = Math.min((p.favoriteAdds || 0) * 0.5, 10)
  const carts = Math.min((p.cartAdds || 0) * 0.2, 5)
  let manual = 0
  if (p.isTrending) manual += 5
  if (p.isPopular) manual += 3
  if (p.isRecommended) manual += 3
  if (p.isPremium) manual += 2
  if (p.isNew) manual += 2
  if (p.isAction) manual += 2
  let freshness = 0
  if (p.createdAt) {
    const ageDays = (Date.now() - new Date(p.createdAt).getTime()) / 86400000
    if (ageDays <= 7) freshness = 5
    else if (ageDays <= 30) freshness = 2
  }
  return rating + reviews + purchases + views + favs + carts + manual + freshness
}

/** Sort products by smart score (desc), with a small random jitter to break
 * ties so the home page feels alive. */
function sortBySmartScore<T extends { id: string }>(items: T[], scoreOf: (item: T) => number, jitter = 0.5): T[] {
  return items
    .map((item) => ({ item, score: scoreOf(item) + (Math.random() - 0.5) * jitter }))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.item)
}

/** Fetch the authenticated user's top categories (by recent views).
 * Returns categories in descending order of weight. */
async function getUserTopCategories(userId: string | undefined, take = 3): Promise<Array<{ category: string; weight: number }>> {
  if (!userId) return []
  // Aggregate product views per category over the last 30 days.
  const since = new Date(Date.now() - 30 * 86400000)
  const rows = await prisma.productView.findMany({
    where: { userId, createdAt: { gte: since } },
    select: { productId: true },
    take: 200,
    orderBy: { createdAt: 'desc' },
  })
  if (rows.length === 0) return []
  const productIds = rows.map((r) => r.productId)
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, category: true },
  })
  const catMap = new Map<string, number>()
  for (const r of rows) {
    const p = products.find((p) => p.id === r.productId)
    if (!p?.category) continue
    catMap.set(p.category, (catMap.get(p.category) || 0) + 1)
  }
  return Array.from(catMap.entries())
    .map(([category, weight]) => ({ category, weight }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, take)
}

// Helper: parse limit/offset query params safely
function parsePagination(query: any) {
  const limit = Math.min(Math.max(Number(query.limit ?? 30) || 30, 1), 100)
  const offset = Math.max(Number(query.offset ?? 0) || 0, 0)
  return { limit, offset }
}

// Helper: serialise product (parse images + colors JSON safely)
function serialiseProduct(p: any) {
  // Wave 4 (B-DB-001): convert Prisma Decimal fields to JS number for JSON
  // serialisation. Frontend expects number (not string) for price/oldPrice.
  // Decimal precision is preserved up to 15 significant digits (safe integer
  // range for prices up to ~999 trillion).
  const result = { ...p, images: safeParseJsonArray(p.images) }
  if (result.price != null) result.price = Number(result.price)
  if (result.oldPrice != null) result.oldPrice = Number(result.oldPrice)
  // v25.8: parse colors JSON array. Each entry: { name, image }.
  if (typeof result.colors === 'string') {
    try {
      const parsed = JSON.parse(result.colors)
      result.colors = Array.isArray(parsed) ? parsed : []
    } catch {
      result.colors = []
    }
  } else if (result.colors == null) {
    result.colors = []
  }
  // v25.20: parse фоновую музыку товара { id, title, artist, url } | null.
  if (typeof result.music === 'string' && result.music) {
    try {
      const m = JSON.parse(result.music)
      result.music = m && typeof m === 'object' && m.url ? m : null
    } catch {
      result.music = null
    }
  } else if (result.music == null) {
    result.music = null
  }
  return result
}

// GET /api/products?category=&popular=&q=&limit=&offset=&shuffle=&seed=&
//          minPrice=&maxPrice=&hasDiscount=&inStockOnly=&sort=
// v25.11: added server-side filtering by price range + discount + sort options.
//         Replaces the client-side filtering in ProductsGrid (which only
//         filtered on a 100-item page — limited the catalog to ~100 items).
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { category, popular, q, shuffle, seed, minPrice, maxPrice, hasDiscount, inStockOnly, sort } = req.query
    const { limit, offset } = parsePagination(req.query)

    const where: any = { deletedAt: null } // D-CRIT-001 fix: filter soft-deleted products
    // v25.14 (categories fix): custom categories created in Studio are linked
    // to products through the Category relation (`categoryId`). Previously the
    // catalog filtered ONLY by the legacy `category` string, so clicking a
    // custom category chip returned nothing. Now we match BOTH the legacy
    // string field AND the related Category row (by name or slug).
    if (category) {
      const catName = String(category)
      const categoryMatch = {
        OR: [
          { category: catName },
          { categoryRow: { is: { OR: [{ name: catName }, { slug: catName }] } } },
        ],
      }
      where.AND = [...(where.AND || []), categoryMatch]
    }
    if (popular === 'true' || popular === '1') where.isPopular = true
    // v25.11: server-side filters
    if (inStockOnly === 'true' || inStockOnly === '1') where.inStock = true
    if (hasDiscount === 'true' || hasDiscount === '1') {
      where.NOT = { AND: [{ oldPrice: null }, { oldPrice: { lte: 0 } }] }
      // discount only exists when oldPrice > price
      // Prisma doesn't support cross-field comparison directly, so we over-fetch
      // and JS-filter below. For now, just require oldPrice to be set.
      where.oldPrice = { not: null }
    }
    // Price range filters
    if (minPrice || maxPrice) {
      where.price = {}
      if (minPrice) where.price.gte = Number(minPrice)
      if (maxPrice) where.price.lte = Number(maxPrice)
    }

    // Case-insensitive search across title / description / category.
    // v25.15: PLUS поиск по АРТИКУЛУ (product.id) — клиент присылает владельцу
    // артикул вида «F1E2D3C4» (последние 8 символов id, UPPER-case), а владелец
    // находит товар мгновенно. Совпадаем и по полному id, и по хвосту.
    let needle: string | null = null
    if (q && typeof q === 'string' && q.trim()) {
      needle = String(q).toLowerCase().trim()
      where.OR = [
        { title: { contains: String(q) } },
        { description: { contains: String(q) } },
        { category: { contains: String(q) } },
        // v25.15: article search at DB level (ids stored lowercase)
        { id: { contains: needle } },
      ]
    }

    // v25.11: server-side sort
    let orderBy: any = { createdAt: 'desc' } // default: newest
    if (sort === 'price-asc') orderBy = { price: 'asc' }
    else if (sort === 'price-desc') orderBy = { price: 'desc' }
    else if (sort === 'popular') orderBy = [{ isPopular: 'desc' }, { views: 'desc' }]
    else if (sort === 'rating') orderBy = [{ rating: 'desc' }, { reviewsCount: 'desc' }]

    const dbLimit = needle ? Math.min(limit * 5, 500) : limit
    const dbSkip = needle ? 0 : offset

    const [items, total] = await Promise.all([
      prisma.product.findMany({
        where,
        orderBy,
        take: dbLimit,
        skip: dbSkip,
      }),
      prisma.product.count({ where }),
    ])

    // Optional JS-side re-filter for true case-insensitive matching.
    let finalItems = items
    if (needle) {
      finalItems = items.filter(
        (p) =>
          p.title.toLowerCase().includes(needle!) ||
          (p.description || '').toLowerCase().includes(needle!) ||
          (p.category || '').toLowerCase().includes(needle!) ||
          // v25.15: ARTICLE MATCH — последние 8 символов id как «артикул»,
          // регистронезависимо; короткий хвост тоже ловим через includes.
          p.id.toLowerCase().includes(needle!) ||
          p.id.slice(-8).toLowerCase() === needle! ||
          p.id.slice(-8).toUpperCase().startsWith(needle!.toUpperCase()) && needle!.length >= 3,
      )
      // v25.11: also filter by hasDiscount (cross-field: oldPrice > price)
      if (hasDiscount === 'true' || hasDiscount === '1') {
        finalItems = finalItems.filter((p) => {
          const op = p.oldPrice != null ? Number(p.oldPrice) : null
          return op != null && op > Number(p.price)
        })
      }
      finalItems = finalItems.slice(offset, offset + limit)
    } else if (hasDiscount === 'true' || hasDiscount === '1') {
      // Even without needle, filter discount cross-field
      finalItems = items.filter((p) => {
        const op = p.oldPrice != null ? Number(p.oldPrice) : null
        return op != null && op > Number(p.price)
      })
      finalItems = finalItems.slice(offset, offset + limit)
    }

    if (shuffle === 'true' || shuffle === '1') {
      const seedNum = typeof seed === 'string' ? parseInt(seed, 10) || Date.now() : Date.now()
      finalItems = deterministicShuffle(finalItems, seedNum)
    }

    let finalTotal = total
    if (needle || hasDiscount === 'true' || hasDiscount === '1') {
      const filteredCount = finalItems.length + offset
      finalTotal = items.length === dbLimit && finalItems.length === limit
        ? filteredCount + limit
        : filteredCount
    }

    res.json({
      items: finalItems.map(serialiseProduct),
      total: finalTotal,
      limit,
      offset,
    })
  }),
)

// Mulberry32 — small, fast, deterministic PRNG. Good enough for shuffling
// product lists (NOT for crypto). Seeded by the client so the same session
// sees the same order.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function deterministicShuffle<T>(arr: T[], seed: number): T[] {
  const out = arr.slice()
  const rand = mulberry32(seed)
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

// GET /api/products/popular?shuffle=1&seed=N — most-rated products, optional
// deterministic shuffle so the home page feels alive (rotates every 5 min).
router.get(
  '/popular',
  asyncHandler(async (req, res) => {
    const { shuffle, seed } = req.query
    let items = await prisma.product.findMany({
      where: { isPopular: true, deletedAt: null }, // D-CRIT-001
      orderBy: { rating: 'desc' },
      take: 12,
    })
    if (shuffle === 'true' || shuffle === '1') {
      const seedNum = typeof seed === 'string' ? parseInt(seed, 10) || Date.now() : Date.now()
      items = deterministicShuffle(items, seedNum)
    }
    res.json({ items: items.map(serialiseProduct) })
  }),
)

// GET /api/products/categories — distinct categories used in DB (for the
// catalog filter chips on the client).
router.get(
  '/categories',
  asyncHandler(async (_req, res) => {
    const rows = await prisma.product.findMany({
      where: { category: { not: null }, deletedAt: null }, // D-CRIT-001
      distinct: ['category'],
      select: { category: true },
    })
    const items = rows
      .map((r) => r.category)
      .filter((c): c is string => Boolean(c))
      .sort((a, b) => a.localeCompare(b, 'ru'))
    res.json({ items })
  }),
)

// v12.3: GET /api/products/:id/linked removed with the Feed module.
// The endpoint depended on the ProductLink model (deleted) and had no
// frontend caller (dead code).

// GET /api/products/curated/action — "Акция" (with optional shuffle for live home)
router.get(
  '/curated/action',
  asyncHandler(async (req, res) => {
    const { shuffle, seed } = req.query
    let items = await prisma.product.findMany({
      where: { isAction: true, inStock: true, deletedAt: null }, // D-CRIT-001
      orderBy: { createdAt: 'desc' },
      take: 12,
    })
    if (shuffle === 'true' || shuffle === '1') {
      const seedNum = typeof seed === 'string' ? parseInt(seed, 10) || Date.now() : Date.now()
      items = deterministicShuffle(items, seedNum)
    }
    res.json({ items: items.map(serialiseProduct) })
  }),
)

// GET /api/products/curated/new — "Новинка" (with optional shuffle for live home)
router.get(
  '/curated/new',
  asyncHandler(async (req, res) => {
    const { shuffle, seed } = req.query
    let items = await prisma.product.findMany({
      where: { isNew: true, inStock: true, deletedAt: null }, // D-CRIT-001
      orderBy: { createdAt: 'desc' },
      take: 12,
    })
    if (shuffle === 'true' || shuffle === '1') {
      const seedNum = typeof seed === 'string' ? parseInt(seed, 10) || Date.now() : Date.now()
      items = deterministicShuffle(items, seedNum)
    }
    res.json({ items: items.map(serialiseProduct) })
  }),
)

// GET /api/products/curated/recommended — "Рекомендуем" (with optional shuffle for live home)
router.get(
  '/curated/recommended',
  asyncHandler(async (req, res) => {
    const { shuffle, seed } = req.query
    let items = await prisma.product.findMany({
      where: { isRecommended: true, inStock: true, deletedAt: null }, // D-CRIT-001
      orderBy: { createdAt: 'desc' },
      take: 12,
    })
    if (shuffle === 'true' || shuffle === '1') {
      const seedNum = typeof seed === 'string' ? parseInt(seed, 10) || Date.now() : Date.now()
      items = deterministicShuffle(items, seedNum)
    }
    res.json({ items: items.map(serialiseProduct) })
  }),
)

// GET /api/products/trending?shuffle=1&seed=N — "Trending now" section.
// Combines popular + new + recommended + high-rated into one mixed bag,
// then shuffles deterministically. The frontend rotates the seed every
// 5 minutes so the section feels alive without breaking pagination.
router.get(
  '/trending',
  asyncHandler(async (req, res) => {
    const { shuffle, seed } = req.query
    const limit = Math.min(Math.max(Number(req.query.limit ?? 12) || 12, 1), 24)
    // Pull from multiple pools so trending isn't just "popular" rebranded.
    const [popular, fresh, recommended, highlyRated] = await Promise.all([
      prisma.product.findMany({
        where: { isPopular: true, inStock: true, deletedAt: null }, // D-CRIT-001
        orderBy: { rating: 'desc' },
        take: 6,
      }),
      prisma.product.findMany({
        where: { isNew: true, inStock: true, deletedAt: null }, // D-CRIT-001
        orderBy: { createdAt: 'desc' },
        take: 6,
      }),
      prisma.product.findMany({
        where: { isRecommended: true, inStock: true, deletedAt: null }, // D-CRIT-001
        orderBy: { createdAt: 'desc' },
        take: 6,
      }),
      prisma.product.findMany({
        where: { inStock: true, rating: { gte: 4.5 }, deletedAt: null }, // D-CRIT-001
        orderBy: { reviewsCount: 'desc' },
        take: 6,
      }),
    ])
    // Merge + dedupe by id (a product can be popular AND new AND recommended).
    const seen = new Set<string>()
    const merged: typeof popular = []
    for (const p of [...popular, ...fresh, ...recommended, ...highlyRated]) {
      if (!seen.has(p.id)) {
        seen.add(p.id)
        merged.push(p)
      }
    }
    let items = merged
    if (shuffle === 'true' || shuffle === '1') {
      const seedNum = typeof seed === 'string' ? parseInt(seed, 10) || Date.now() : Date.now()
      items = deterministicShuffle(items, seedNum)
    }
    res.json({ items: items.slice(0, limit).map(serialiseProduct) })
  }),
)

// GET /api/products/batch?ids=id1,id2,id3 — fetch multiple products in one
// request. Used by the cart & favorites sheets to avoid N+1 requests when
// the user has many items. Returns { items: Product[] } in arbitrary order;
// missing IDs are silently omitted.
router.get(
  '/batch',
  asyncHandler(async (req, res) => {
    const idsRaw = String(req.query.ids || '')
    const ids = idsRaw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s.length <= 64)
      .slice(0, 100)
    if (ids.length === 0) return res.json({ items: [] })
    // v9-audit-fix: exclude soft-deleted products from batch endpoint
    const items = await prisma.product.findMany({
      where: { id: { in: ids }, deletedAt: null },
    })
    res.json({ items: items.map(serialiseProduct) })
  }),
)

// ============================================================================
//  POST /api/products/:id/view
//  Increment a product's view counter and record a per-user ProductView
//  event (for personalization). Optional auth — anonymous views still count
//  toward the global `views` counter but don't create a per-user row.
//
//  This endpoint is fire-and-forget from the client's perspective: the
//  product page calls it once on mount, and the response status is ignored.
//  To prevent abuse, we rate-limit to one increment per (user OR IP) per
//  product per 60 seconds using an in-memory LRU.
//
//  B-HIGH-002: bounded LRU cache (was: unbounded Map + manual trim when
//  size > 10_000). The manual trim iterated the whole Map on every request
//  once the threshold was crossed, turning dedup into O(n) hot path; and
//  between threshold crossings the Map still grew unbounded under burst
//  traffic from a long-tail of unique IPs.
// ============================================================================
const VIEW_DEDUP_TTL = 60_000 // 60s
const VIEW_DEDUP = new LRUCache<string, number>({ max: 100_000, ttl: VIEW_DEDUP_TTL }) // key: `${userId||ip}|${productId}` → lastTs

router.post(
  '/:id/view',
  optionalAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const productId = req.params.id
    const userId = req.user?.id
    // v9-audit-fix (S-CRIT-NEW-2): use req.ip (respects `trust proxy`) instead
    // of parsing X-Forwarded-For directly — closes view-counter-inflation hole.
    const ip = req.ip || req.socket?.remoteAddress || 'unknown'
    const dedupKey = `${userId || ip}|${productId}`
    const last = VIEW_DEDUP.get(dedupKey) || 0
    if (Date.now() - last < VIEW_DEDUP_TTL) {
      // Already counted recently — skip to prevent inflation.
      return res.json({ ok: true, deduplicated: true })
    }
    VIEW_DEDUP.set(dedupKey, Date.now())

    // Update the product's view counter (atomic increment) — non-blocking.
    prisma.product
      .update({ where: { id: productId }, data: { views: { increment: 1 } } })
      .catch(() => {/* product may have been deleted — ignore */})

    // Record a per-user view event ONLY for authenticated users.
    // Anonymous events would balloon the table without personalization value.
    if (userId) {
      prisma.productView
        .create({ data: { productId, userId } })
        .catch(() => {/* ignore FK violations (deleted product) */})
    }

    res.json({ ok: true })
  }),
)

// ============================================================================
//  GET /api/products/smart/blocks
//  Returns all 10 home-page smart blocks in a single response, so the
//  frontend can render the entire home page with ONE API call instead of 10.
//
//  Each block has: { id, title, icon, items: Product[] }
//  The blocks are computed server-side using the smartScore() helper and
//  per-block-specific logic (trending = manual flag + recent views;
//  premium = high price + high rating; etc.).
//
//  For authenticated users, the "recommended" block is personalized using
//  the user's recent product views (top categories get a boost).
//
//  Query params:
//    seed  — deterministic shuffle seed (so the same session sees the same
//            order; rotate per session/per few minutes for "aliveness")
//    limit — items per block (default 12, max 24)
// ============================================================================
router.get(
  '/smart/blocks',
  optionalAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const seedNum = typeof req.query.seed === 'string' ? parseInt(req.query.seed, 10) || Date.now() : Date.now()
    const blockLimit = Math.min(Math.max(Number(req.query.limit ?? 12) || 12, 4), 24)
    const userId = req.user?.id

    // Fetch the user's top categories for personalization (parallel with everything else).
    const userTopCatsPromise = getUserTopCategories(userId, 3)

    // Fetch a generous pool of in-stock products ONCE — we'll slice & dice it
    // for each block instead of issuing 10 separate queries. This is the
    // single biggest performance win of the smart-blocks endpoint.
    // v9-audit-fix: exclude soft-deleted products from smart-blocks (home page)
    const allProducts = await prisma.product.findMany({
      where: { inStock: true, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 200, // cap at 200 — enough for all blocks even after filtering
    })

    const userTopCats = await userTopCatsPromise

    // Helper: deterministic shuffle using the session seed (so the order
    // is stable per-session but rotates when the seed changes).
    const shuffle = <T,>(arr: T[]): T[] => deterministicShuffle(arr, seedNum)

    // Helper: dedupe across blocks — track which product IDs have been used
    // in earlier blocks so each block shows FRESH products when possible.
    // We only dedupe within the same "tier" — popular products may legitimately
    // appear in both "popular" and "best rating".
    const usedIds = new Set<string>()
    const takeFresh = (items: any[], n: number) => {
      const fresh = items.filter((p) => !usedIds.has(p.id))
      const result = fresh.slice(0, n)
      result.forEach((p) => usedIds.add(p.id))
      return result
    }

    // --- Block 1: 🔥 Сейчас в тренде ---
    // Manual `isTrending` flag OR (high recent views + decent rating).
    // For "recent views", we use the `views` counter as a proxy (no time
    // window on the counter itself, but the freshness boost in smartScore
    // ensures newer popular items surface).
    const trendingPool = allProducts.filter(
      (p) => p.isTrending || (p.views > 0 && p.rating >= 4.0),
    )
    const trending = sortBySmartScore(trendingPool, (p) => smartScore(p)).slice(0, blockLimit)

    // --- Block 2: ⭐ Самые популярные ---
    // Sort by smartScore (rating + reviews + engagement).
    const popular = sortBySmartScore(allProducts.slice(), (p) => smartScore(p)).slice(0, blockLimit)

    // --- Block 3: ❤️ Рекомендуем вам ---
    // Personalized: if user has top categories, boost products in those cats.
    // Otherwise, fall back to "isRecommended" flag + smart score.
    let recommendedPool: any[]
    if (userTopCats.length > 0) {
      // Boost: +weight*5 for each category match (top cat gets +15, 2nd +10, 3rd +5).
      const catBoost = new Map<string, number>()
      userTopCats.forEach((c, i) => catBoost.set(c.category, (3 - i) * 5))
      recommendedPool = sortBySmartScore(
        allProducts.slice(),
        (p) => smartScore(p) + (p.category ? (catBoost.get(p.category) || 0) : 0),
      )
    } else {
      // Anonymous: prefer isRecommended flag, then smart score.
      recommendedPool = sortBySmartScore(
        allProducts.slice(),
        (p) => smartScore(p) + (p.isRecommended ? 10 : 0),
      )
    }
    const recommended = recommendedPool.slice(0, blockLimit)

    // --- Block 4: 🆕 Новинки ---
    // Products created in the last 30 days, sorted by createdAt desc.
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000)
    const newPool = allProducts
      .filter((p) => p.createdAt >= thirtyDaysAgo || p.isNew)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    const newItems = newPool.slice(0, blockLimit)

    // --- Block 5: 📈 Сейчас покупают ---
    // Sort by purchases desc. If all are 0 (fresh DB), fall back to smartScore.
    const buyingPool = allProducts.slice().sort((a, b) => (b.purchases || 0) - (a.purchases || 0))
    const buyingNow = buyingPool.slice(0, blockLimit)

    // --- Block 6: 💬 Самые обсуждаемые ---
    // Sort by reviewsCount desc.
    const discussedPool = allProducts.slice().sort((a, b) => (b.reviewsCount || 0) - (a.reviewsCount || 0))
    const discussed = discussedPool.slice(0, blockLimit)

    // --- Block 7: 🏆 Лучший рейтинг ---
    // Sort by rating desc, then reviewsCount desc (to break ties).
    const bestRatingPool = allProducts
      .slice()
      .sort((a, b) => (b.rating || 0) - (a.rating || 0) || (b.reviewsCount || 0) - (a.reviewsCount || 0))
    const bestRating = bestRatingPool.slice(0, blockLimit)

    // --- Block 8: 🎁 Выгодные предложения ---
    // Products with oldPrice (discount) — sort by discount %.
    // Wave 4 (B-DB-001): convert Decimal → number for arithmetic
    const dealsPool = allProducts
      .filter((p) => { const op = p.oldPrice != null ? Number(p.oldPrice) : null; const pr = Number(p.price); return op != null && op > pr })
      .map((p) => { const op = Number(p.oldPrice!); const pr = Number(p.price); return { p, discount: (op - pr) / op } })
      .sort((a, b) => b.discount - a.discount)
      .map((x) => x.p)
    const deals = dealsPool.slice(0, blockLimit)

    // --- Block 9: 💎 Премиум ---
    // Manual `isPremium` flag OR (price in top 25% + rating >= 4.0).
    const prices = allProducts.map((p) => Number(p.price)).sort((a, b) => a - b)
    const p75 = prices.length > 0 ? prices[Math.floor(prices.length * 0.75)] : Infinity
    const premiumPool = allProducts.filter(
      (p) => p.isPremium || (Number(p.price) >= p75 && p.rating >= 4.0),
    )
    const premium = sortBySmartScore(premiumPool, (p) => smartScore(p)).slice(0, blockLimit)

    // --- Block 10: ⚡ Быстро раскупают ---
    // Conversion: purchases / views (high purchase rate relative to views).
    // Filter out products with very few views (statistical noise).
    const fastPool = allProducts
      .filter((p) => p.views >= 5)
      .map((p) => ({ p, rate: (p.purchases || 0) / Math.max(p.views, 1) }))
      .sort((a, b) => b.rate - a.rate)
      .map((x) => x.p)
    // If not enough products with views >= 5, fall back to purchases > 0.
    const fastSelling = (fastPool.length >= 4 ? fastPool : allProducts.filter((p) => p.purchases > 0)).slice(0, blockLimit)

    const blocks = [
      { id: 'trending', title: 'Сейчас в тренде', icon: '🔥', items: trending.map(serialiseProduct) },
      { id: 'popular', title: 'Самые популярные', icon: '⭐', items: popular.map(serialiseProduct) },
      { id: 'recommended', title: userTopCats.length > 0 ? 'Рекомендуем вам' : 'Рекомендуем', icon: '❤️', items: recommended.map(serialiseProduct) },
      { id: 'new', title: 'Новинки', icon: '🆕', items: newItems.map(serialiseProduct) },
      { id: 'buying-now', title: 'Сейчас покупают', icon: '📈', items: buyingNow.map(serialiseProduct) },
      { id: 'discussed', title: 'Самые обсуждаемые', icon: '💬', items: discussed.map(serialiseProduct) },
      { id: 'best-rating', title: 'Лучший рейтинг', icon: '🏆', items: bestRating.map(serialiseProduct) },
      { id: 'deals', title: 'Выгодные предложения', icon: '🎁', items: deals.map(serialiseProduct) },
      { id: 'premium', title: 'Премиум', icon: '💎', items: premium.map(serialiseProduct) },
      { id: 'fast-selling', title: 'Быстро раскупают', icon: '⚡', items: fastSelling.map(serialiseProduct) },
    ].filter((b) => b.items.length > 0) // hide empty blocks

    res.json({ blocks, personalized: userTopCats.length > 0 })
  }),
)

// ============================================================================
//  GET /api/products/recently-viewed — v25.11
//  Returns products the current user has viewed recently (max 12, last 30 days).
//  For anonymous users (no auth), returns [] — the client should use
//  localStorage as a fallback for anonymous sessions.
//
//  Reads from the ProductView table (created by POST /api/products/:id/view).
//  Groups by productId, takes the most recent view per product, sorts by
//  view time desc, excludes the current product if `?exclude=ID` is passed
//  (used on the product page to avoid self-reference).
// ============================================================================
router.get(
  '/recently-viewed',
  optionalAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const userId = req.user?.id
    if (!userId) {
      res.json({ items: [] })
      return
    }
    const excludeId = typeof req.query.exclude === 'string' ? req.query.exclude : undefined
    const limit = Math.min(Math.max(Number(req.query.limit ?? 12) || 12, 1), 24)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000)

    // Find the most recent ProductView per productId for this user.
    // SQLite doesn't support DISTINCT ON, so we use groupBy + a follow-up find.
    const recentViews = await prisma.productView.findMany({
      where: {
        userId,
        createdAt: { gte: thirtyDaysAgo },
        ...(excludeId ? { productId: { not: excludeId } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 100, // over-fetch, dedupe in JS
      select: { productId: true, createdAt: true },
    })

    // Dedupe by productId (keep first = most recent)
    const seen = new Set<string>()
    const orderedIds: string[] = []
    for (const v of recentViews) {
      if (!seen.has(v.productId)) {
        seen.add(v.productId)
        orderedIds.push(v.productId)
      }
      if (orderedIds.length >= limit) break
    }

    if (orderedIds.length === 0) {
      res.json({ items: [] })
      return
    }

    // Fetch products in one query, then preserve the order from orderedIds
    const products = await prisma.product.findMany({
      where: { id: { in: orderedIds }, deletedAt: null },
    })
    const byId = new Map(products.map((p) => [p.id, p]))
    const items = orderedIds
      .map((id) => byId.get(id))
      .filter((p): p is NonNullable<typeof p> => !!p)
      .map(serialiseProduct)

    res.json({ items })
  }),
)

// GET /api/products/:id
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    // D-CRIT-001 fix: filter soft-deleted products. Previously this returned
    // deleted products (deletedAt column existed but no read path filtered it).
    // v21: allow ?includeDeleted=true so users can view their past orders'
    // products even after the product was removed from the catalog.
    const includeDeleted = req.query.includeDeleted === 'true'
    // v24.4: include department so product page can show the right contacts
    const product = await prisma.product.findFirst({
      where: includeDeleted
        ? { id: req.params.id }
        : { id: req.params.id, deletedAt: null },
      include: { department: true },
    })
    if (!product) return res.status(404).json({ error: 'Product not found' })
    res.json(serialiseProduct(product))
  }),
)

// v25.14 (categories fix): resolve a free-text category string against the
// Category table. Returns the matching row (case-insensitive by name/slug)
// so we can keep BOTH stores in sync:
//   - Product.category (legacy string shown in UI badges)
//   - Product.categoryId (relation used for counts + catalog filtering)
// Without this sync, custom categories created in Studio never appeared in
// the catalog ("added a category but it doesn't show up" bug).
async function resolveCategoryRow(input?: string | null): Promise<{ id: string; name: string } | null> {
  const trimmed = (input || '').trim()
  if (!trimmed) return null
  const cats = await prisma.category.findMany({ select: { id: true, name: true, slug: true } })
  const lower = trimmed.toLowerCase()
  return (
    cats.find((c) => c.name.toLowerCase() === lower || c.slug.toLowerCase() === lower) || null
  )
}

// POST /api/products — admin only
router.post(
  '/',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: AuthedRequest, res) => {
    const data = createProductSchema.parse(req.body)
    // v25.14: normalise the category string to the canonical Category name
    // and link categoryId, so the product immediately counts towards the
    // custom category created in Studio.
    const catRow = await resolveCategoryRow(data.category)
    const product = await prisma.product.create({
      data: {
        title: data.title,
        description: data.description,
        price: data.price,
        oldPrice: data.oldPrice,
        currency: data.currency ?? 'RUB',
        category: catRow ? catRow.name : data.category,
        categoryId: catRow?.id ?? null,
        images: JSON.stringify(data.images),
        inStock: data.inStock ?? true,
        // v11: physical stock quantity — default to 0 (out of stock) if not provided.
        // Studio form sets this explicitly; legacy API callers default to 0.
        quantity: data.quantity ?? 0,
        isPopular: data.isPopular ?? false,
        isAction: data.isAction ?? false,
        isNew: data.isNew ?? false,
        isRecommended: data.isRecommended ?? false,
        isTrending: data.isTrending ?? false, // B-LOW-006 fix: schema now includes this field
        isPremium: data.isPremium ?? false, // B-LOW-006 fix: schema now includes this field
        // v24.5: department link
        departmentId: data.departmentId || null,
        // v25.8 (TRI999 launch): colors array
        colors: JSON.stringify(data.colors ?? []),
        // v25.20: фоновая музыка товара (null = нет)
        music: data.music ? JSON.stringify(data.music) : null,
        // v25.10 (Task #6): vertical product video
        videoUrl: data.videoUrl ?? null,
        videoPoster: data.videoPoster ?? null,
        // v25.12: video position in carousel (0 = first, 1 = after 1st image, etc.)
        videoPosition: data.videoPosition ?? null,
      },
    })
    await auditLog(req, 'product', product.id, 'create', {
      before: null,
      after: { title: product.title, price: product.price, category: product.category },
    })
    res.status(201).json(serialiseProduct(product))
    broadcastChanged('products:changed')

    // v25.15: авто-push всем подписчикам при новом товаре.
    // Переключатель notifyNewProduct (Студия → Рассылка) по умолчанию ВКЛ
    // (setting отсутствует = включено; 'false' = выключено).
    try {
      const flag = await prisma.appSetting.findUnique({ where: { id: 'notifyNewProduct' } })
      const enabled = !flag || flag.value !== 'false'
      if (enabled) {
        void broadcastPushToAll(
          {
            title: 'Новый товар в каталоге',
            body: `${product.title} — уже в каталоге! Загляните и оставьте заявку.`,
            url: `/?product=${product.id}`,
            icon: product.images ? safeFirstImage(product.images) : undefined,
            tag: `product-${product.id}`,
          },
          [req.user!.id], // автору не нужно уведомление о своём товаре
        )
      }
    } catch {
      // Push — best-effort: создание товара не должно падать из-за него
    }
  }),
)

// v25.15: первая картинка товара как иконка пуша (JSON-массив строк)
function safeFirstImage(imagesJson: string): string | undefined {
  try {
    const arr = JSON.parse(imagesJson)
    return Array.isArray(arr) && typeof arr[0] === 'string' && arr[0].startsWith('/')
      ? arr[0]
      : undefined
  } catch {
    return undefined
  }
}

// Zod schema for partial update
const updateProductSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(4000).optional(),
  price: z.number().min(0).optional(),
  oldPrice: z.number().min(0).nullable().optional(),
  currency: z.string().max(8).optional(),
  category: z.string().max(64).nullable().optional(),
  images: z.array(z.string().max(2048)).min(1).optional(),
  inStock: z.boolean().optional(),
  // v11: physical stock quantity
  quantity: z.number().int().min(0).max(1_000_000_000).optional(),
  isPopular: z.boolean().optional(),
  isAction: z.boolean().optional(),
  isNew: z.boolean().optional(),
  isRecommended: z.boolean().optional(),
  isTrending: z.boolean().optional(),
  isPremium: z.boolean().optional(),
  // v24.5: department link for contacts by direction
  departmentId: z.string().nullable().optional(),
  // v25.8: colors array (each entry: { name, image })
  colors: z.array(
    z.object({
      name: z.string().min(1).max(64),
      image: z.string().min(1).max(2048),
    })
  ).max(50).optional(),
  // v25.10 (Task #6): vertical product video — admin can set/clear.
  // NULL clears the video.
  videoUrl: z.string().max(2048).nullable().optional(),
  videoPoster: z.string().max(2048).nullable().optional(),
  // v25.12: video position in carousel (0 = first, 1 = after 1st image, etc.)
  videoPosition: z.number().int().min(0).max(50).nullable().optional(),
  // v25.20: фоновая музыка товара (null = убрана)
  music: z.object({
    id: z.string().min(1).max(160),
    title: z.string().min(1).max(300),
    artist: z.string().max(300).nullable().optional(),
    url: z.string().min(1).max(2048),
  }).nullable().optional(),
})

// PATCH /api/products/:id — admin only
router.patch(
  '/:id',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: AuthedRequest, res) => {
    const existing = await prisma.product.findUnique({ where: { id: req.params.id } })
    if (!existing) return res.status(404).json({ error: 'Product not found' })

    const data = updateProductSchema.parse(req.body ?? {})

    // v25.14: same category normalisation as POST — when the admin renames
    // the category string (or the Category row exists with different case),
    // keep both the legacy string and the relation in sync.
    let patchCategoryId: string | null | undefined
    let patchCategoryName: string | null | undefined
    if (data.category !== undefined) {
      const catRow = await resolveCategoryRow(data.category)
      patchCategoryId = catRow?.id ?? null
      patchCategoryName = catRow ? catRow.name : data.category
    }

    const updated = await prisma.product.update({
      where: { id: req.params.id },
      data: {
        ...(data.title !== undefined && { title: data.title }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.price !== undefined && { price: data.price }),
        ...(data.oldPrice !== undefined && { oldPrice: data.oldPrice }),
        ...(data.currency !== undefined && { currency: data.currency }),
        ...(patchCategoryName !== undefined && { category: patchCategoryName }),
        ...(patchCategoryId !== undefined && { categoryId: patchCategoryId }),
        ...(data.images !== undefined && { images: JSON.stringify(data.images) }),
        ...(data.inStock !== undefined && { inStock: data.inStock }),
        ...(data.quantity !== undefined && { quantity: data.quantity }),
        ...(data.isPopular !== undefined && { isPopular: data.isPopular }),
        ...(data.isAction !== undefined && { isAction: data.isAction }),
        ...(data.isNew !== undefined && { isNew: data.isNew }),
        ...(data.isRecommended !== undefined && { isRecommended: data.isRecommended }),
        ...(data.isTrending !== undefined && { isTrending: data.isTrending }),
        ...(data.isPremium !== undefined && { isPremium: data.isPremium }),
        // v24.5: department link
        ...(data.departmentId !== undefined && { departmentId: data.departmentId || null }),
        // v25.8: colors array
        ...(data.colors !== undefined && { colors: JSON.stringify(data.colors) }),
        // v25.20: фоновая музыка товара (null = убрана)
        ...(data.music !== undefined && { music: data.music ? JSON.stringify(data.music) : null }),
        // v25.10 (Task #6): vertical product video
        ...(data.videoUrl !== undefined && { videoUrl: data.videoUrl }),
        ...(data.videoPoster !== undefined && { videoPoster: data.videoPoster }),
        // v25.12: video position
        ...(data.videoPosition !== undefined && { videoPosition: data.videoPosition }),
      },
    })
    await auditLog(req, 'product', updated.id, 'update', {
      before: { title: existing.title, price: existing.price, category: existing.category },
      after: { title: updated.title, price: updated.price, category: updated.category },
    })
    res.json(serialiseProduct(updated))
    broadcastChanged('products:changed')
  }),
)

// DELETE /api/products/bulk — admin only. Body: { ids: string[] }.
// Deletes multiple products in a single transaction. Returns per-id status.
//
// Why this exists: deleting 50 products one-by-one is slow (50 round-trips),
// and the user can't undo a partial failure. Bulk delete + transaction gives
// atomicity AND speed.
router.delete(
  '/bulk',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: AuthedRequest, res) => {
    const ids = z.array(z.string().min(1).max(64)).min(1).max(500).parse(req.body?.ids)
    // Fetch existing products first (so we can return which IDs were not found).
    // v10-fix: filter deletedAt: null — don't try to soft-delete already-deleted products.
    const existing = await prisma.product.findMany({
      where: { id: { in: ids }, deletedAt: null },
      select: { id: true, title: true, price: true, category: true },
    })
    const existingIds = new Set(existing.map((p) => p.id))
    const notFound = ids.filter((id) => !existingIds.has(id))
    // v10-fix: use SOFT delete (deletedAt: new Date()) instead of hard delete.
    // Hard delete fails with P2003 when a product has OrderItems
    // (OrderItem.productId has onDelete: Restrict). Soft delete preserves
    // the audit trail and financial records while hiding the product
    // from the catalog. Matches the single DELETE /:id behavior.
    await prisma.$transaction(
      existing.map((p) =>
        prisma.product.update({
          where: { id: p.id },
          data: { deletedAt: new Date() },
        }),
      ),
    )
    // Audit log one entry per deleted product
    for (const p of existing) {
      await auditLog(req, 'product', p.id, 'delete', {
        before: { title: p.title, price: p.price, category: p.category },
        after: null,
      }).catch(() => {/* audit failure is non-critical */})
    }
    res.json({ ok: true, deleted: existing.length, notFound })
    broadcastChanged('products:changed')
  }),
)

// DELETE /api/products/all — admin only. Soft-deletes ALL products.
// Useful for resetting a demo environment. Returns count of soft-deleted rows.
router.delete(
  '/all',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: AuthedRequest, res) => {
    // v10-fix: use SOFT delete (deletedAt: new Date()) instead of hard delete.
    // Hard delete fails with P2003 when products have OrderItems. Soft delete
    // preserves financial records + audit trail. Only soft-deletes products
    // that are NOT already soft-deleted (deletedAt: null filter).
    const result = await prisma.product.updateMany({
      where: { deletedAt: null },
      data: { deletedAt: new Date() },
    })
    await auditLog(req, 'product', 'all', 'delete_all', {
      before: { count: result.count },
      after: null,
    }).catch(() => {/* audit failure is non-critical */})
    res.json({ ok: true, deleted: result.count })
    broadcastChanged('products:changed')
  }),
)

// DELETE /api/products/:id — admin only
//
// IMPORTANT: product IDs may contain slashes (e.g. "листовки-а5,-плотность-200-г/м²"
// — they're slugified from the title). Express decodes %2F to / BEFORE route
// matching, so a request to /api/products/foo%2Fbar becomes /api/products/foo/bar
// which doesn't match the /:id pattern. To work around this, we accept the
// REST of the URL as the id by using a wildcard pattern. The id is then
// reconstructed from req.params[0] (for *) or by joining req.params.id with
// any additional segments.
//
// We register BOTH patterns: /:id (no slash) and /:id/* (with slash) so the
// route handler can handle both cases.
const deleteProductHandler = asyncHandler(async (req: AuthedRequest, res) => {
  // Reconstruct the id — it may contain slashes that were split by the router
  const rawId = req.params.id
  const extraSegments = (req.params as any)[0] // for /:id/* wildcard
  const id = extraSegments ? `${rawId}/${extraSegments}` : rawId

  // B-MED-007: Validate reconstructed id to prevent path traversal / abuse.
  // The wildcard /:id/* route can capture arbitrary path segments — without
  // validation, a malicious URL like /api/products/foo%2F%3B%20DROP%20TABLE
  // would reach here with arbitrary payload. Even though prisma.product
  // .findUnique would just return null (Prisma uses parameterised queries,
  // so no SQL injection), validating up-front defends against any future
  // code path that might use the id for filesystem lookups, log filenames,
  // audit-log keys, etc. Allow letters (incl. Cyrillic), digits, dash,
  // underscore, slash, dot — covers legit product ids (cuids plus any
  // future slug-based ids). Reject everything else. Max 200 chars to bound
  // log noise. (Note: `.` and `/` are allowed, so `..` is technically valid
  // per this regex — but Prisma never uses the id as a filesystem path, so
  // the residual risk is zero. We rely on the read path to return 404 for
  // any non-existent id.)
  if (!/^[\wа-яА-ЯёЁ\-_/.]{1,200}$/.test(id)) {
    return res.status(400).json({ error: 'Invalid product id' })
  }

  try {
    const existing = await prisma.product.findUnique({
      where: { id },
      select: { id: true, title: true, price: true, category: true, deletedAt: true },
    })
    if (!existing) return res.status(404).json({ error: 'Product not found' })
    // D-CRIT-001 fix: soft-delete instead of hard-delete. Previously
    // prisma.product.delete() would CASCADE-fail if the product had OrderItems
    // (onDelete: Restrict) → cryptic P2003 FK error. Now we mark deletedAt
    // and the read paths (above) filter deletedAt: null. Hard-delete is
    // available via DELETE /api/products/:id/hard for GDPR erasure (only
    // allowed when product has 0 orders — not implemented here, manual SQL).
    await prisma.product.update({
      where: { id },
      data: { deletedAt: new Date() },
    })
    await auditLog(req, 'product', existing.id, 'delete', {
      before: { title: existing.title, price: existing.price, category: existing.category },
      after: { deletedAt: new Date().toISOString() },
    })
  } catch (e: any) {
    // P2025 = record not found
    if (e?.code === 'P2025') return res.status(404).json({ error: 'Product not found' })
    throw e
  }
  res.json({ ok: true })
  broadcastChanged('products:changed')
})

router.delete('/:id', requireAuth, requireAdmin, deleteProductHandler)
// Wildcard for IDs containing slashes — /:id/* captures everything after the
// first segment. We need this because Express decodes %2F before routing.
router.delete('/:id/*', requireAuth, requireAdmin, deleteProductHandler)

export default router
