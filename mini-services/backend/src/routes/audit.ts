import { Router } from 'express'
import { z } from 'zod'
import rateLimit from 'express-rate-limit'
import { prisma } from '../lib/prisma.js'
import { requireAuth, requireAdmin, optionalAuth, type AuthedRequest } from '../lib/auth.js'
import { asyncHandler } from '../lib/asyncHandler.js'
import { verifyAuditChain, auditLog } from '../lib/audit.js'
import { logger } from '../lib/logger.js'

const router: Router = Router()

// ============================================================================
// /api/audit — read-only access to audit log (admin only)
// ============================================================================

// GET /api/audit — list audit log entries with pagination + filters
// Query: ?entity=product&action=update&userId=...&limit=50&offset=0
router.get(
  '/',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: AuthedRequest, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit ?? 50) || 50, 1), 200)
    const offset = Math.max(Number(req.query.offset ?? 0) || 0, 0)

    const where: any = {}
    if (req.query.entity) where.entity = String(req.query.entity)
    if (req.query.action) where.action = String(req.query.action)
    if (req.query.userId) where.userId = String(req.query.userId)
    if (req.query.entityId) where.entityId = String(req.query.entityId)

    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        include: {
          user: {
            select: { id: true, username: true, displayName: true, role: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.auditLog.count({ where }),
    ])

    res.json({
      items: items.map((a) => ({
        id: a.id,
        userId: a.userId,
        user: a.user,
        entity: a.entity,
        entityId: a.entityId,
        action: a.action,
        snapshot: (() => {
          try { return JSON.parse(a.snapshot) } catch { return {} }
        })(),
        ip: a.ip,
        userAgent: a.userAgent,
        createdAt: a.createdAt,
      })),
      total,
      limit,
      offset,
    })
  }),
)

// GET /api/audit/stats — summary for the Studio analytics dashboard
// Returns counts by entity, action, and last-24h activity.
router.get(
  '/stats',
  requireAuth,
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const [byEntity, byAction, last24h, total] = await Promise.all([
      prisma.auditLog.groupBy({
        by: ['entity'],
        _count: true,
      }),
      prisma.auditLog.groupBy({
        by: ['action'],
        _count: true,
      }),
      prisma.auditLog.count({ where: { createdAt: { gte: since } } }),
      prisma.auditLog.count(),
    ])

    // Sort in JS (descending by count) since Prisma's orderBy on _count
    // requires a different syntax that varies between Prisma versions.
    const byEntitySorted = byEntity
      .map((e) => ({ entity: e.entity, count: e._count }))
      .sort((a, b) => b.count - a.count)
    const byActionSorted = byAction
      .map((a) => ({ action: a.action, count: a._count }))
      .sort((a, b) => b.count - a.count)

    res.json({
      byEntity: byEntitySorted,
      byAction: byActionSorted,
      last24h,
      total,
    })
  }),
)

// GET /api/audit/verify — verify audit log hash chain integrity
// v9-audit-fix: exposes verifyAuditChain() so admins can check tamper-evidence.
router.get(
  '/verify',
  requireAuth,
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const result = await verifyAuditChain()
    res.json(result)
  }),
)

// ============================================================================
// POST /api/audit/client-error
// Wave 3 (S-BUG-009): receive client-side error reports from Studio
// ErrorBoundary. Uses optionalAuth so unauthenticated errors (e.g. during
// login) can still be reported. Rate-limited via auth limiter on /api/auth
// route prefix — this endpoint is under /api/audit so we add a local limiter.
// ============================================================================
const clientErrorSchema = z.object({
  name: z.string().max(200),
  message: z.string().max(2000),
  stack: z.string().max(5000).optional(),
  componentStack: z.string().max(5000).optional(),
  url: z.string().max(500).optional(),
  view: z.string().max(200).optional(),
  ts: z.string().max(50).optional(),
  userAgent: z.string().max(500).optional(),
})

const clientErrorLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,  // 30 errors per minute per IP — enough for burst errors, blocks spam
  standardHeaders: true,
  legacyHeaders: false,
})

router.post(
  '/client-error',
  clientErrorLimiter,
  optionalAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = clientErrorSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid payload', issues: parsed.error.issues })
    }
    const { name, message, stack, componentStack, url, view, ts, userAgent } = parsed.data

    // Log as structured error — forwarded to Sentry if SENTRY_DSN is set
    logger.error(`Client error: ${name}`, {
      module: 'client-error',
      error: new Error(message),
      clientErrorName: name,
      clientErrorMessage: message,
      stack: stack?.slice(0, 1000),
      componentStack: componentStack?.slice(0, 500),
      url,
      view,
      clientTs: ts,
      userAgent: userAgent?.slice(0, 200),
      userId: req.user?.id,
    })

    // v13.0 (audit P0-1 fix): persist to audit log via the hash-chain helper
    // for ALL authenticated users (not just admins). Previously this called
    // prisma.auditLog.create() directly, bypassing the chain — which left
    // prevHash=null and hash=null, permanently breaking verifyAuditChain().
    // Now uses auditLog() which serialises through the process mutex and
    // computes the chain hash correctly.
    if (req.user?.id) {
      try {
        await auditLog(req, 'client', url?.slice(0, 100) || 'unknown', 'error', {
          name,
          message,
          view,
          ts,
        })
      } catch {
        // audit log failure shouldn't fail the error report
      }
    }

    res.status(204).end()
  }),
)

export default router
