import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { prisma } from '../lib/prisma.js'
import { requireAuth, requireAdmin, requireAdminOnly, optionalAuth, type AuthedRequest } from '../lib/auth.js'
import { asyncHandler } from '../lib/asyncHandler.js'
import { auditLog, auditLogBulk } from '../lib/audit.js'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { getIo, sendLeadStatusPush } from '../socket/handlers.js'
import { logger } from '../lib/logger.js'

const router: Router = Router()

// Dedicated limiter for the public POST /api/leads endpoint. The global
// apiLimiter (120/min/IP) is too permissive for an unauthenticated lead
// submission form — bots could flood the admin queue. 5/min/IP is enough
// for real customers and stops casual spam.
const publicLeadLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Слишком много заявок, попробуйте позже' },
})

// ============================================================================
//  Lead status workflow
// ============================================================================
//  new         — freshly submitted, not yet reviewed
//  processing  — admin reviewing the lead
//  working     — admin actively working on the request
//  done        — completed successfully
//  cancelled   — cancelled by admin or customer
//
//  The order above reflects the typical lifecycle. The admin can jump from
//  any status to any other status (e.g. new → cancelled if the lead is spam).
// ============================================================================
const LEAD_STATUSES = ['new', 'processing', 'working', 'done', 'cancelled'] as const
type LeadStatus = (typeof LEAD_STATUSES)[number]

const createLeadSchema = z.object({
  name: z.string().min(1).max(200), phone: z.string().min(3).max(30),
  comment: z.string().max(2000).optional(), productId: z.string().max(64).optional(),
  productTitle: z.string().max(500).optional(),
  // Int — DB column is `Int?`, not Float. Without `.int()` a client could
  // send 4990.99 and trigger a Prisma TypeError on insert.
  productPrice: z.number().int().optional(),
  productImage: z.string().max(2048).optional(), quantity: z.number().int().min(1).max(100).default(1),
  deliveryMethod: z.enum(['pickup', 'delivery']).optional(), address: z.string().max(1000).optional(),
  contactMethod: z.enum(['whatsapp', 'telegram', 'phone', 'email']).optional(), receiptUrl: z.string().max(2048).optional(),
})

// POST /api/leads — public (no auth): a visitor can submit a lead without logging in.
// If the caller IS authenticated, we link the lead to their userId so they
// receive real-time status updates and push notifications.
//
// SECURITY FIX (was): manual `verifyToken` call bypassed tokenVersion check,
// so revoked tokens (after password change) were accepted and the lead was
// linked to a "ghost" user. Now we use `optionalAuth` which runs the same
// requireAuth logic (tokenVersion check, role refresh, AUTH_CACHE) but
// tolerates missing/invalid tokens.
router.post('/', publicLeadLimiter, optionalAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const data = createLeadSchema.parse(req.body)
  if (data.deliveryMethod === 'delivery' && !data.address) {
    return res.status(400).json({ error: 'Адрес доставки обязателен' })
  }

  // S-HIGH-010 fix: if productId is provided, fetch the real product from DB
  // and use its title/price/image — ignore client-supplied values. Previously
  // an attacker could submit a lead with productId="real-id", productTitle="Fake",
  // productPrice=1 — admin would see a fake price in the lead queue.
  let productTitle: string | null | undefined = data.productTitle
  let productPrice: number | null | undefined = data.productPrice
  let productImage: string | null | undefined = data.productImage
  if (data.productId) {
    const product = await prisma.product.findFirst({
      where: { id: data.productId, deletedAt: null },
      select: { title: true, price: true, images: true },
    })
    if (product) {
      productTitle = product.title
      productPrice = Math.round(Number(product.price)) // Wave 4 (B-DB-001): Decimal → Int (kopecks rounding)
      try {
        const imgs = JSON.parse(product.images || '[]')
        if (Array.isArray(imgs) && imgs.length > 0) productImage = String(imgs[0])
      } catch { /* keep client-supplied image as fallback */ }
    } else {
      // Product not found — store as anonymous lead without product info
      productTitle = null
      productPrice = null
      productImage = null
    }
  }

  // optionalAuth already attached `req.user` if a valid Bearer token was
  // present (and its tokenVersion matches the DB). Invalid tokens are
  // silently ignored — the lead is created as anonymous.
  const userId = req.user?.id ?? null

  const lead = await prisma.lead.create({
    data: {
      name: data.name, phone: data.phone, comment: data.comment,
      productId: data.productId, productTitle,
      productPrice, productImage,
      quantity: data.quantity, deliveryMethod: data.deliveryMethod,
      address: data.address, contactMethod: data.contactMethod, receiptUrl: data.receiptUrl,
      userId,
    },
  })

  // v12.8: Push notification to ALL admins about the new lead.
  // Previously admins got ZERO notification when a lead was created.
  try {
    const { sendPushToUser } = await import('./push.js')
    // v25.7 (TZ ЭТАП 2.4): emit a socket event to the admins room so Studio
    // shows an instant in-app toast (push alone only reaches the OS
    // notification tray — admins with the browser in the foreground would
    // miss it without a socket event).
    try {
      const { getIo } = await import('../socket/handlers.js')
      const io = getIo()
      if (io) {
        io.to('admins').emit('lead:created', {
          leadId: lead.id,
          name: lead.name,
          productTitle: lead.productTitle || null,
          createdAt: lead.createdAt,
        })
      }
    } catch {
      // Socket init may fail if the server hasn't started IO yet — non-critical.
    }
    const admins = await prisma.user.findMany({
      where: { role: 'admin', deletedAt: null },
      select: { id: true },
    })
    for (const admin of admins) {
      sendPushToUser(admin.id, {
        title: '🔔 Новая заявка!',
        body: `${lead.name}: ${lead.productTitle || 'Без товара'}`,
        tag: `admin-lead-${lead.id}`,
        url: '/studio/?view=leads',
      }).catch(() => {})
    }
  } catch (e) {
    logger.error('Admin push failed:', { module: 'leads', error: e })
  }

  // Return the created entity (REST convention) — most other POST endpoints
  // do the same. The old `{ id, ok: true }` shape was inconsistent.
  res.status(201).json(lead)
}))

// GET /api/leads — admin: list all leads (paginated)
// Query params:
//   status    — filter by status (new/processing/working/done/cancelled)
//   limit     — page size, default 50, max 200
//   offset    — page offset, default 0
//   q         — search query (matches name / phone / productTitle / comment)
//
// PAGINATION FIX (was): previously fetched up to 200 leads with no
// pagination. Studio managers with 10k+ leads saw a frozen browser tab.
// Now we return one page at a time + a `total` count for the UI.
router.get('/', requireAuth, requireAdmin, asyncHandler(async (req: AuthedRequest, res) => {
  const status = req.query.status as string | undefined
  const limit = Math.min(Math.max(Number(req.query.limit ?? 50) || 50, 1), 200)
  const offset = Math.max(Number(req.query.offset ?? 0) || 0, 0)
  const q = typeof req.query.q === 'string' && req.query.q.trim() ? req.query.q.trim() : undefined

  const where: Prisma.LeadWhereInput = {}
  if (status) where.status = status
  if (q) {
    where.OR = [
      { name: { contains: q } },
      { phone: { contains: q } },
      { productTitle: { contains: q } },
      { comment: { contains: q } },
    ]
  }

  const [items, total] = await Promise.all([
    prisma.lead.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    }),
    prisma.lead.count({ where }),
  ])
  res.json({ items, total, limit, offset })
}))

// GET /api/leads/mine — leads submitted by the current authenticated user.
// Used by the client's "Мои заявки" view.
router.get('/mine', requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const leads = await prisma.lead.findMany({
    where: { userId: req.user!.id },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })
  res.json({ items: leads })
}))

router.get('/:id', requireAuth, requireAdmin, asyncHandler(async (req: AuthedRequest, res) => {
  const lead = await prisma.lead.findUnique({ where: { id: req.params.id } })
  if (!lead) return res.status(404).json({ error: 'Lead not found' })
  res.json(lead)
}))

// PATCH /api/leads/:id — admin only, update status
// Emits a `lead:status-changed` Socket.IO event to the lead's owner (if any)
// and sends a Web Push notification when the owner is offline.
router.patch('/:id', requireAuth, requireAdmin, asyncHandler(async (req: AuthedRequest, res) => {
  const { status } = req.body
  if (!LEAD_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'Invalid status' })
  }
  try {
    // Capture the previous state for the audit log
    const before = await prisma.lead.findUnique({ where: { id: req.params.id } })
    if (!before) return res.status(404).json({ error: 'Lead not found' })

    const lead = await prisma.lead.update({
      where: { id: req.params.id },
      data: { status: status as LeadStatus },
    })

    // ---- Audit log ----
    await auditLog(req, 'lead', lead.id, 'status_change', {
      before: { status: before.status },
      after: { status: lead.status },
    })

    // ---- Real-time client notification ----
    // If the lead is linked to a user, emit a socket event to that user
    // (and to all admin studios) so the client's "Мои заявки" view updates
    // instantly without a page reload.
    if (lead.userId) {
      const io = getIo()
      if (io) {
        // Personal room — only the lead owner receives this.
        io.to(`user:${lead.userId}`).emit('lead:status-changed', {
          leadId: lead.id,
          status: lead.status,
          updatedAt: lead.updatedAt,
          productTitle: lead.productTitle,
        })
        // Admin room — all admin studios see the status change too.
        io.to('admins').emit('lead:status-changed', {
          leadId: lead.id,
          status: lead.status,
          updatedAt: lead.updatedAt,
        })
      }
      // Web Push to the owner if they have no active socket connection
      // (i.e. the app is closed or in the background).
      void sendLeadStatusPush(lead.userId, lead)
    }

    res.json(lead)
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
      return res.status(404).json({ error: 'Lead not found' })
    }
    throw e
  }
}))

router.delete('/:id', requireAuth, requireAdmin, asyncHandler(async (req: AuthedRequest, res) => {
  try {
    // Fetch the lead first so we can emit a socket event to its owner (if any)
    // BEFORE deleting. After deleteMany we'd lose the userId reference.
    const lead = await prisma.lead.findUnique({
      where: { id: req.params.id },
      select: { id: true, userId: true, productTitle: true },
    })
    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' })
    }

    await prisma.lead.delete({ where: { id: lead.id } })

    // ---- Audit log ----
    await auditLog(req, 'lead', lead.id, 'delete', {
      before: { id: lead.id, productTitle: lead.productTitle },
      after: null,
    })

    // ---- Real-time client notification ----
    // Notify the lead owner (if any) that the lead was deleted so their
    // "Мои заявки" view removes it from the list instantly — no reload.
    if (lead.userId) {
      const io = getIo()
      if (io) {
        io.to(`user:${lead.userId}`).emit('lead:deleted', {
          leadId: lead.id,
        })
        io.to('admins').emit('lead:deleted', { leadId: lead.id })
      }
    }

    res.json({ ok: true })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
      return res.status(404).json({ error: 'Lead not found' })
    }
    throw e
  }
}))

// ============================================================================
//  Bulk lead management (admin only)
// ============================================================================
//  POST /api/leads/bulk-delete
//    Body: { ids: string[] }                       — delete specific leads
//    Body: { clearStatus: 'done' | 'cancelled' }   — clear all leads with status
//    Body: { clearAll: true }                      — delete ALL leads (dangerous)
//
//  Emits `lead:deleted` socket events to each affected user (if any) so
//  their "Мои заявки" view updates in real-time. Admin studios also get
//  notified via the `admins` room.
//
//  v25.7 (TZ ЭТАП 2.6): requireAdminOnly — with `clearAll: true` this wipes
//  ALL leads in one call. Managers should not be able to destroy evidence
//  of misconduct (spam, fraud, abuse) by clearing the entire lead table.
//  Only a true admin (not a manager) can perform bulk lead destruction.
// ============================================================================
const bulkDeleteSchema = z.object({
  ids: z.array(z.string().min(1).max(64)).max(500).optional(),
  clearStatus: z.enum(['done', 'cancelled', 'new', 'processing', 'working']).optional(),
  clearAll: z.boolean().optional(),
}).refine(
  (v) => !!v.ids || !!v.clearStatus || !!v.clearAll,
  { message: 'One of `ids`, `clearStatus`, or `clearAll` must be provided' },
)

router.post('/bulk-delete', requireAuth, requireAdminOnly, asyncHandler(async (req: AuthedRequest, res) => {
  const data = bulkDeleteSchema.parse(req.body)

  // Build the WHERE clause for the deletion
  let where: Prisma.LeadWhereInput = {}
  if (data.clearAll) {
    // Delete everything — no filter
    where = {}
  } else if (data.clearStatus) {
    where = { status: data.clearStatus }
  } else if (data.ids && data.ids.length > 0) {
    where = { id: { in: data.ids } }
  } else {
    return res.status(400).json({ error: 'No deletion criteria provided' })
  }

  // Fetch the leads we're about to delete so we can notify their owners
  // (if any) via socket. We need userId + id before the delete runs.
  const leadsToDelete = await prisma.lead.findMany({
    where,
    select: { id: true, userId: true },
  })

  if (leadsToDelete.length === 0) {
    return res.json({ ok: true, deleted: 0 })
  }

  // Delete in a single query (much faster than per-id)
  const result = await prisma.lead.deleteMany({ where })

  // ---- Audit log (bulk) ----
  await auditLogBulk(req, 'lead', 'bulk_delete', {
    count: result.count,
    ids: leadsToDelete.map((l) => l.id),
    filter: data.clearAll ? 'all' : data.clearStatus ? `status:${data.clearStatus}` : 'by_ids',
  })

  // Emit socket events to each affected user. Group by userId so we send
  // one event per user with all their deleted lead IDs — the client then
  // removes all of them in one state update.
  const io = getIo()
  if (io) {
    const byUser = new Map<string, string[]>()
    for (const l of leadsToDelete) {
      if (!l.userId) continue
      const arr = byUser.get(l.userId) || []
      arr.push(l.id)
      byUser.set(l.userId, arr)
    }
    for (const [userId, leadIds] of byUser) {
      io.to(`user:${userId}`).emit('leads:bulk-deleted', { leadIds })
    }
    // Notify all admin studios so their UI updates too
    const allIds = leadsToDelete.map((l) => l.id)
    io.to('admins').emit('leads:bulk-deleted', { leadIds: allIds })
  }

  res.json({ ok: true, deleted: result.count })
}))

export default router
