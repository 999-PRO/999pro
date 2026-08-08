import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { requireAuth, requireAdmin, optionalAuth, type AuthedRequest } from '../lib/auth.js'
import { asyncHandler } from '../lib/asyncHandler.js'

const router: Router = Router()

// GET /api/analytics — admin only, returns real data from DB.
// v22: expanded with revenue, today's orders, status breakdown, recent orders.
router.get(
  '/',
  requireAuth,
  requireAdmin,
  asyncHandler(async (_req: AuthedRequest, res) => {
    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)

    const [
      products, stories, orders, messages, users, banners, storyViewsAgg,
      todayOrders, todayRevenue, totalRevenue,
      ordersByStatus, recentOrders, activeProducts,
    ] = await Promise.all([
      prisma.product.count({ where: { deletedAt: null } }),
      prisma.story.count(),
      prisma.order.count(),
      prisma.message.count(),
      prisma.user.count({ where: { deletedAt: null } }),
      prisma.banner.count(),
      prisma.story.aggregate({ _sum: { views: true } }),
      prisma.order.count({ where: { createdAt: { gte: todayStart, lt: todayEnd } } }),
      prisma.order.aggregate({
        where: { createdAt: { gte: todayStart, lt: todayEnd }, status: { not: 'cancelled' } },
        _sum: { total: true },
      }),
      prisma.order.aggregate({
        where: { status: { not: 'cancelled' } },
        _sum: { total: true },
      }),
      prisma.order.groupBy({ by: ['status'], _count: { status: true } }),
      prisma.order.findMany({
        take: 10,
        orderBy: { createdAt: 'desc' },
        include: { items: { include: { product: { select: { title: true, images: true } } } } },
      }),
      prisma.product.count({ where: { deletedAt: null, inStock: true } }),
    ])

    const statusBreakdown: Record<string, number> = {}
    for (const s of ordersByStatus) {
      statusBreakdown[s.status] = s._count.status
    }

    // v25.7 (TZ ЭТАП 2.5): also include online-now count (User.isOnline flag,
    // flipped by socket connect/disconnect). Saves the dashboard an extra
    // round-trip to /api/analytics/visits for the "online now" badge.
    const onlineNow = await prisma.user.count({
      where: { isOnline: true, deletedAt: null },
    })

    res.json({
      products, activeProducts, stories, storyViews: storyViewsAgg._sum.views || 0,
      orders, messages, users, banners,
      todayOrders,
      todayRevenue: todayRevenue._sum.total ? Number(todayRevenue._sum.total) : 0,
      totalRevenue: totalRevenue._sum.total ? Number(totalRevenue._sum.total) : 0,
      statusBreakdown,
      onlineNow,
      recentOrders: recentOrders.map((o) => ({
        id: o.id, total: Number(o.total), status: o.status, name: o.name,
        createdAt: o.createdAt, itemsCount: o.items?.length || 0,
        firstItemTitle: o.items?.[0]?.product?.title || null,
      })),
    })
  }),
)

// ============================================================================
// v25.7 (TZ ЭТАП 2.5) — detailed analytics endpoints.
// Each returns time-bucketed counts (today / yesterday / week / month / total)
// for a single metric category. All admin-only (managers may view).
// ============================================================================

// Helper: compute the 5 time boundaries used by every analytics endpoint.
function getTimeBuckets() {
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  const yesterdayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7)
  const monthStart = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate())
  // Use start-of-month for cleaner monthly buckets when the day < 28.
  const monthStartClean = new Date(now.getFullYear(), now.getMonth(), 1)
  return { now, todayStart, todayEnd, yesterdayStart, weekStart, monthStart: monthStartClean }
}

// GET /api/analytics/users — user stats + new users list.
// Returns time-bucketed registration counts + paginated list of newest users.
router.get(
  '/users',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: AuthedRequest, res) => {
    const { todayStart, todayEnd, yesterdayStart, weekStart, monthStart } = getTimeBuckets()
    const limit = Math.min(Math.max(Number(req.query.limit ?? 20) || 20, 1), 100)
    const offset = Math.max(Number(req.query.offset ?? 0) || 0, 0)

    const [today, yesterday, week, month, total, newUsers, totalAll] = await Promise.all([
      prisma.user.count({ where: { deletedAt: null, createdAt: { gte: todayStart, lt: todayEnd } } }),
      prisma.user.count({ where: { deletedAt: null, createdAt: { gte: yesterdayStart, lt: todayStart } } }),
      prisma.user.count({ where: { deletedAt: null, createdAt: { gte: weekStart } } }),
      prisma.user.count({ where: { deletedAt: null, createdAt: { gte: monthStart } } }),
      prisma.user.count({ where: { deletedAt: null } }),
      prisma.user.findMany({
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: limit + offset,
        select: {
          id: true, username: true, displayName: true, phone: true, email: true,
          avatar: true, role: true, isOnline: true, lastSeen: true, createdAt: true,
        },
      }),
      prisma.user.count({ where: { deletedAt: null } }),
    ])

    res.json({
      counts: { today, yesterday, week, month, total },
      newUsers: newUsers.slice(offset, offset + limit).map((u) => ({
        id: u.id,
        username: u.username,
        displayName: u.displayName,
        phone: u.phone,
        email: u.email,
        avatar: u.avatar,
        role: u.role,
        isOnline: u.isOnline,
        lastSeen: u.lastSeen,
        createdAt: u.createdAt,
      })),
      total: totalAll,
      limit,
      offset,
    })
  }),
)

// GET /api/analytics/visits — visit stats + online-now count.
// Visit counts come from the Visit table (POST /api/visits records them).
// Online-now comes from User.isOnline (socket-managed).
router.get(
  '/visits',
  requireAuth,
  requireAdmin,
  asyncHandler(async (_req: AuthedRequest, res) => {
    const { todayStart, todayEnd, yesterdayStart, weekStart, monthStart } = getTimeBuckets()

    const [today, yesterday, week, month, total, onlineNow, onlineUsers] = await Promise.all([
      prisma.visit.count({ where: { createdAt: { gte: todayStart, lt: todayEnd } } }),
      prisma.visit.count({ where: { createdAt: { gte: yesterdayStart, lt: todayStart } } }),
      prisma.visit.count({ where: { createdAt: { gte: weekStart } } }),
      prisma.visit.count({ where: { createdAt: { gte: monthStart } } }),
      prisma.visit.count(),
      prisma.user.count({ where: { isOnline: true, deletedAt: null } }),
      // Top 50 online users — useful for the "who's online" panel.
      prisma.user.findMany({
        where: { isOnline: true, deletedAt: null },
        take: 50,
        orderBy: { lastSeen: 'desc' },
        select: {
          id: true, username: true, displayName: true, avatar: true,
          role: true, lastSeen: true,
        },
      }),
    ])

    res.json({
      counts: { today, yesterday, week, month, total },
      onlineNow,
      onlineUsers,
    })
  }),
)

// GET /api/analytics/comments — review/comment stats.
// Counts both top-level reviews AND admin replies (everything in the Review
// table). The user spec's "comments" maps to reviews on products.
router.get(
  '/comments',
  requireAuth,
  requireAdmin,
  asyncHandler(async (_req: AuthedRequest, res) => {
    const { todayStart, todayEnd, yesterdayStart, weekStart, monthStart } = getTimeBuckets()

    const [today, yesterday, week, month, total] = await Promise.all([
      prisma.review.count({ where: { createdAt: { gte: todayStart, lt: todayEnd } } }),
      prisma.review.count({ where: { createdAt: { gte: yesterdayStart, lt: todayStart } } }),
      prisma.review.count({ where: { createdAt: { gte: weekStart } } }),
      prisma.review.count({ where: { createdAt: { gte: monthStart } } }),
      prisma.review.count(),
    ])

    res.json({
      counts: { today, yesterday, week, month, total },
    })
  }),
)

// GET /api/analytics/orders — order stats by status + by period.
// Returns:
//   byStatus: { new, in_work, production, ready, in_delivery, done, cancelled }
//   byPeriod: { today, yesterday, week, month, total }
//   pending  = new + in_work (the spec's "pending" maps to these two statuses)
router.get(
  '/orders',
  requireAuth,
  requireAdmin,
  asyncHandler(async (_req: AuthedRequest, res) => {
    const { todayStart, todayEnd, yesterdayStart, weekStart, monthStart } = getTimeBuckets()

    const [byStatusRows, today, yesterday, week, month, total] = await Promise.all([
      prisma.order.groupBy({ by: ['status'], _count: { status: true } }),
      prisma.order.count({ where: { createdAt: { gte: todayStart, lt: todayEnd } } }),
      prisma.order.count({ where: { createdAt: { gte: yesterdayStart, lt: todayStart } } }),
      prisma.order.count({ where: { createdAt: { gte: weekStart } } }),
      prisma.order.count({ where: { createdAt: { gte: monthStart } } }),
      prisma.order.count(),
    ])

    const byStatus: Record<string, number> = {}
    for (const s of byStatusRows) {
      byStatus[s.status] = s._count.status
    }

    res.json({
      byStatus,
      byPeriod: { today, yesterday, week, month, total },
      // Spec terms → actual order statuses (the order workflow uses
      // new/in_work/production/ready/in_delivery/done/cancelled).
      // "pending" = orders awaiting the operator's next action.
      summary: {
        new: byStatus['new'] || 0,
        completed: byStatus['done'] || 0,
        cancelled: byStatus['cancelled'] || 0,
        pending: (byStatus['new'] || 0) + (byStatus['in_work'] || 0),
      },
    })
  }),
)

// ============================================================================
// POST /api/visits — record a page view (called by the frontend VisitTracker).
// `optionalAuth` so anonymous visits are still tracked. Rate-limited to 1
// request / 10s / IP via a simple in-memory LRU to avoid flooding.
// ============================================================================
const visitRateLimit = new Map<string, number>() // ip → lastVisitTimestamp
const VISIT_RATE_LIMIT_MS = 10_000

router.post(
  '/visits',
  optionalAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    // v25.7 (TZ ЭТАП 2.5): record a page view. The body carries the path
    // (e.g. "/", "/?view=catalog") and optional referrer / sessionId.
    const { path, referrer, sessionId } = (req.body || {}) as {
      path?: string
      referrer?: string
      sessionId?: string
    }
    if (!path || typeof path !== 'string' || path.length > 2048) {
      return res.status(400).json({ error: 'Invalid path' })
    }

    // Rate limit per IP (10s window). Prevents a misbehaving client from
    // flooding the Visit table. The Map grows unboundedly in theory — in
    // practice, entries are stale and get GC'd when the Map size exceeds
    // 10k entries (we evict the oldest 1k in that case).
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
               req.socket.remoteAddress || 'unknown'
    const now = Date.now()
    const lastVisit = visitRateLimit.get(ip) || 0
    if (now - lastVisit < VISIT_RATE_LIMIT_MS) {
      // Rate-limited — return 204 so the client doesn't log an error.
      return res.status(204).end()
    }
    visitRateLimit.set(ip, now)
    if (visitRateLimit.size > 10_000) {
      // Evict oldest 1000 entries (Map preserves insertion order).
      const keys = [...visitRateLimit.keys()].slice(0, 1000)
      for (const k of keys) visitRateLimit.delete(k)
    }

    const userAgent = req.headers['user-agent'] || null

    await prisma.visit.create({
      data: {
        userId: req.user?.id || null,
        sessionId: sessionId || null,
        path,
        userAgent: userAgent ? String(userAgent).slice(0, 512) : null,
        ip: ip !== 'unknown' ? ip : null,
        referrer: referrer || null,
      },
    }).catch(() => {
      // Visit recording is non-critical — swallow errors so the frontend
      // request doesn't fail visibly. The most common error is the Visit
      // table not existing yet (pre-migration) — in that case we just skip.
    })

    res.status(201).json({ ok: true })
  }),
)

export default router
