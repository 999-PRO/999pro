import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { requireAuth, requireAdmin, type AuthedRequest } from '../lib/auth.js'
import { asyncHandler } from '../lib/asyncHandler.js'

const router = Router()

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

    res.json({
      products, activeProducts, stories, storyViews: storyViewsAgg._sum.views || 0,
      orders, messages, users, banners,
      todayOrders,
      todayRevenue: todayRevenue._sum.total ? Number(todayRevenue._sum.total) : 0,
      totalRevenue: totalRevenue._sum.total ? Number(totalRevenue._sum.total) : 0,
      statusBreakdown,
      recentOrders: recentOrders.map((o) => ({
        id: o.id, total: Number(o.total), status: o.status, name: o.name,
        createdAt: o.createdAt, itemsCount: o.items?.length || 0,
        firstItemTitle: o.items?.[0]?.product?.title || null,
      })),
    })
  }),
)

export default router
