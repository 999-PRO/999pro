import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { requireAuth, requireAdmin, type AuthedRequest } from '../lib/auth.js'
import { asyncHandler } from '../lib/asyncHandler.js'
import { auditLog } from '../lib/audit.js'
import { broadcastChanged } from '../lib/broadcast.js'
import {
  getModerationSettings,
  invalidateSettingsCache,
  invalidateStopWordsCache,
  logModerationAction,
  type ModerationSettings,
} from '../lib/moderation.js'

const router = Router()

// ============================================================================
// Moderation API — all endpoints under /api/moderation
//
// PUBLIC (requireAuth only):
//   POST /report                   — submit a report from chat context menu
//   GET  /me/status                — current user's moderation status (banned/restricted/warnings)
//   POST /me/warnings/:id/ack      — acknowledge a warning
//
// ADMIN (requireAuth + requireAdmin):
//   GET  /stats                    — dashboard counts
//   GET  /reports                  — list reports (filterable by status)
//   GET  /reports/:id              — single report
//   PATCH /reports/:id             — review a report (status, decision)
//   GET  /ai-flags                 — list AI-flagged content
//   PATCH /ai-flags/:id            — review an AI flag
//   GET  /banned-users             — list banned/restricted users
//   PATCH /users/:id/ban           — ban a user
//   PATCH /users/:id/unban         — unban a user
//   PATCH /users/:id/restrict      — restrict chat/reviews (with duration)
//   PATCH /users/:id/unrestrict    — remove restrictions
//   GET  /users/:id/history        — user violation history
//   POST /users/:id/warn           — issue a warning
//   GET  /warnings                 — list all warnings
//   GET  /log                      — moderation action log
//
//   GET  /stop-words               — list all stop-words
//   POST /stop-words               — create
//   POST /stop-words/bulk          — bulk import
//   PATCH /stop-words/:id          — update
//   DELETE /stop-words/:id         — delete
//   POST /stop-words/reorder       — (not used, no order field)
//   POST /stop-words/reset         — reset to defaults
//   GET  /stop-words/export        — export as JSON/CSV/TXT
//
//   GET  /settings                 — read moderation settings
//   PUT  /settings                 — update moderation settings
// ============================================================================

// ============================================================================
// PUBLIC ENDPOINTS
// ============================================================================

const reportSchema = z.object({
  targetType: z.enum(['message', 'review', 'profile', 'user']),
  targetId: z.string().min(1).max(100),
  reason: z.enum(['spam', 'insult', 'threat', 'fraud', 'forbidden', 'other']),
  comment: z.string().max(1000).optional(),
})

// POST /api/moderation/report — submit a report
router.post(
  '/report',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const data = reportSchema.parse(req.body)
    const report = await prisma.moderationReport.create({
      data: {
        reporterId: req.user!.id,
        targetType: data.targetType,
        targetId: data.targetId,
        reason: data.reason,
        comment: data.comment || null,
      },
    })

    // Increment the reported user's reportsCount (if we can determine the user)
    // For messages, we'd need to fetch the message to find the sender.
    // We do this lazily here to avoid an extra query on every report.
    if (data.targetType === 'message') {
      try {
        const msg = await prisma.message.findUnique({
          where: { id: data.targetId },
          select: { senderId: true },
        })
        if (msg) {
          const stats = await prisma.userModerationStats.upsert({
            where: { userId: msg.senderId },
            update: { reportsCount: { increment: 1 } },
            create: { userId: msg.senderId, reportsCount: 1 },
          })
          // Auto-flag if user has many reports
          if (stats.reportsCount >= 5) {
            await logModerationAction({
              actorType: 'system',
              action: 'auto_flag_user',
              targetType: 'user',
              targetId: msg.senderId,
              reason: `High report count: ${stats.reportsCount}`,
            })
          }
        }
      } catch {
        // Non-critical
      }
    }

    await logModerationAction({
      actorType: 'admin',
      actorId: req.user!.id,
      action: 'report_create',
      targetType: data.targetType,
      targetId: data.targetId,
      reason: data.reason,
      details: { reportId: report.id, comment: data.comment },
    })

    broadcastChanged('moderation:changed')

    // v25.7 (TZ ЭТАП 2.4): emit a targeted admin-only socket event + push
    // notification. The previous `broadcastChanged('moderation:changed')`
    // went to ALL connected clients (including non-admin users), which is
    // wasteful AND doesn't trigger any in-app toast because the frontend
    // doesn't subscribe to it. We now ALSO emit `moderation:report-created`
    // to the `admins` room — the Studio socket subscribes to this event
    // globally (in providers.tsx) and shows a toast.
    try {
      const { getIo } = await import('../socket/handlers.js')
      const { sendPushToUser } = await import('./push.js')
      const io = getIo()
      if (io) {
        io.to('admins').emit('moderation:report-created', {
          reportId: report.id,
          targetType: data.targetType,
          targetId: data.targetId,
          reason: data.reason,
          comment: data.comment || null,
          createdAt: report.createdAt,
        })
      }
      const admins = await prisma.user.findMany({
        where: { role: 'admin', deletedAt: null },
        select: { id: true },
      })
      for (const admin of admins) {
        void sendPushToUser(admin.id, {
          title: '🚩 Новая жалоба',
          body: `${data.targetType}: ${data.reason}`,
          tag: `admin-report-${report.id}`,
          url: '/studio/?view=moderation',
        })
      }
    } catch {
      // Non-critical — the report is already saved.
    }

    res.status(201).json({ ok: true, id: report.id })
  }),
)

// GET /api/moderation/me/status — current user's moderation status
router.get(
  '/me/status',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const userId = req.user!.id
    const [stats, warnings] = await Promise.all([
      prisma.userModerationStats.findUnique({ where: { userId } }),
      prisma.moderationWarning.findMany({
        where: { userId, acknowledgedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
    ])
    const now = new Date()
    res.json({
      isBanned: stats?.isBanned ?? false,
      banReason: stats?.banReason ?? null,
      bannedUntil: stats?.bannedUntil ?? null,
      chatRestrictedUntil: stats?.chatRestrictedUntil ?? null,
      reviewsRestrictedUntil: stats?.reviewsRestrictedUntil ?? null,
      violationsCount: stats?.violationsCount ?? 0,
      warningsCount: stats?.warningsCount ?? 0,
      pendingWarnings: warnings.map((w) => ({
        id: w.id,
        reason: w.reason,
        message: w.message,
        severity: w.severity,
        createdAt: w.createdAt,
        expiresAt: w.expiresAt,
      })),
    })
  }),
)

// POST /api/moderation/me/warnings/:id/ack — acknowledge a warning
router.post(
  '/me/warnings/:id/ack',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const warning = await prisma.moderationWarning.findUnique({
      where: { id: req.params.id },
    })
    if (!warning) return res.status(404).json({ error: 'Warning not found' })
    if (warning.userId !== req.user!.id) return res.status(403).json({ error: 'Forbidden' })
    if (warning.acknowledgedAt) return res.json({ ok: true, alreadyAcknowledged: true })

    await prisma.moderationWarning.update({
      where: { id: warning.id },
      data: { acknowledgedAt: new Date() },
    })
    res.json({ ok: true })
  }),
)

// ============================================================================
// ADMIN — DASHBOARD STATS
// ============================================================================

router.get(
  '/stats',
  requireAuth,
  requireAdmin,
  asyncHandler(async (_req: AuthedRequest, res) => {
    const [pendingReports, unreviewedAIFlags, bannedUsers, activeWarnings, totalStopWords, activeStopWords, todayActions] = await Promise.all([
      prisma.moderationReport.count({ where: { status: 'pending' } }),
      prisma.aIFlag.count({ where: { reviewed: false } }),
      prisma.userModerationStats.count({ where: { isBanned: true } }),
      prisma.moderationWarning.count({ where: { acknowledgedAt: null } }),
      prisma.stopWord.count(),
      prisma.stopWord.count({ where: { isActive: true } }),
      prisma.moderationLog.count({ where: { createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } } }),
    ])
    res.json({
      pendingReports,
      unreviewedAIFlags,
      bannedUsers,
      activeWarnings,
      totalStopWords,
      activeStopWords,
      todayActions,
    })
  }),
)

// ============================================================================
// ADMIN — REPORTS
// ============================================================================

router.get(
  '/reports',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: AuthedRequest, res) => {
    const status = req.query.status as string | undefined
    const items = await prisma.moderationReport.findMany({
      where: status ? { status } : undefined,
      include: {
        reporter: { select: { id: true, username: true, displayName: true, avatar: true } },
        reviewer: { select: { id: true, username: true, displayName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    })
    res.json({ items })
  }),
)

router.get(
  '/reports/:id',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: AuthedRequest, res) => {
    const report = await prisma.moderationReport.findUnique({
      where: { id: req.params.id },
      include: {
        reporter: { select: { id: true, username: true, displayName: true, avatar: true } },
        reviewer: { select: { id: true, username: true, displayName: true } },
      },
    })
    if (!report) return res.status(404).json({ error: 'Report not found' })
    res.json(report)
  }),
)

const reviewReportSchema = z.object({
  status: z.enum(['reviewed', 'dismissed', 'actioned']),
  decision: z.string().max(1000).optional(),
})

router.patch(
  '/reports/:id',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: AuthedRequest, res) => {
    const existing = await prisma.moderationReport.findUnique({ where: { id: req.params.id } })
    if (!existing) return res.status(404).json({ error: 'Report not found' })
    const data = reviewReportSchema.parse(req.body)
    const updated = await prisma.moderationReport.update({
      where: { id: req.params.id },
      data: {
        status: data.status,
        decision: data.decision || null,
        reviewedBy: req.user!.id,
        reviewedAt: new Date(),
      },
    })
    await logModerationAction({
      actorType: 'admin',
      actorId: req.user!.id,
      action: `report_${data.status}`,
      targetType: existing.targetType,
      targetId: existing.targetId,
      reason: data.decision || existing.reason,
      details: { reportId: updated.id },
    })
    await auditLog(req, 'moderation-report', updated.id, 'review', { before: existing.status, after: data.status })
    broadcastChanged('moderation:changed')
    res.json(updated)
  }),
)

// ============================================================================
// ADMIN — AI FLAGS
// ============================================================================

router.get(
  '/ai-flags',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: AuthedRequest, res) => {
    const reviewed = req.query.reviewed === 'true' ? true : req.query.reviewed === 'false' ? false : undefined
    const items = await prisma.aIFlag.findMany({
      where: reviewed !== undefined ? { reviewed } : undefined,
      include: {
        user: { select: { id: true, username: true, displayName: true, avatar: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    })
    res.json({ items })
  }),
)

const reviewAIFlagSchema = z.object({
  reviewed: z.boolean(),
  decision: z.string().max(1000).optional(),
})

router.patch(
  '/ai-flags/:id',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: AuthedRequest, res) => {
    const existing = await prisma.aIFlag.findUnique({ where: { id: req.params.id } })
    if (!existing) return res.status(404).json({ error: 'AI flag not found' })
    const data = reviewAIFlagSchema.parse(req.body)
    const updated = await prisma.aIFlag.update({
      where: { id: req.params.id },
      data: {
        reviewed: data.reviewed,
        reviewedBy: req.user!.id,
        reviewedAt: new Date(),
      },
    })
    await logModerationAction({
      actorType: 'admin',
      actorId: req.user!.id,
      action: data.reviewed ? 'ai_flag_reviewed' : 'ai_flag_dismissed',
      targetType: existing.targetType,
      targetId: existing.targetId,
      reason: data.decision || existing.reason,
      details: { flagId: updated.id },
    })
    broadcastChanged('moderation:changed')
    res.json(updated)
  }),
)

// ============================================================================
// ADMIN — BANNED USERS & USER MANAGEMENT
// ============================================================================

router.get(
  '/banned-users',
  requireAuth,
  requireAdmin,
  asyncHandler(async (_req: AuthedRequest, res) => {
    const items = await prisma.userModerationStats.findMany({
      where: {
        OR: [
          { isBanned: true },
          { chatRestrictedUntil: { gt: new Date() } },
          { reviewsRestrictedUntil: { gt: new Date() } },
        ],
      },
      include: {
        user: { select: { id: true, username: true, displayName: true, avatar: true, email: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    })
    res.json({ items })
  }),
)

const banSchema = z.object({
  reason: z.string().min(1).max(500),
  durationHours: z.number().int().min(1).max(24 * 365).optional(), // null/undefined = permanent
})

router.patch(
  '/users/:id/ban',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: AuthedRequest, res) => {
    const data = banSchema.parse(req.body)
    const targetUser = await prisma.user.findUnique({ where: { id: req.params.id } })
    if (!targetUser) return res.status(404).json({ error: 'User not found' })
    if (targetUser.role === 'admin') return res.status(403).json({ error: 'Cannot ban admin' })

    const bannedUntil = data.durationHours ? new Date(Date.now() + data.durationHours * 60 * 60 * 1000) : null
    await prisma.userModerationStats.upsert({
      where: { userId: req.params.id },
      update: {
        isBanned: true,
        banReason: data.reason,
        bannedUntil,
        bannedBy: req.user!.id,
        bannedAt: new Date(),
        bansCount: { increment: 1 },
      },
      create: {
        userId: req.params.id,
        isBanned: true,
        banReason: data.reason,
        bannedUntil,
        bannedBy: req.user!.id,
        bannedAt: new Date(),
        bansCount: 1,
      },
    })
    await logModerationAction({
      actorType: 'admin',
      actorId: req.user!.id,
      action: 'ban_user',
      targetType: 'user',
      targetId: req.params.id,
      reason: data.reason,
      details: { durationHours: data.durationHours, bannedUntil },
    })
    await auditLog(req, 'moderation-user', req.params.id, 'ban', { reason: data.reason, durationHours: data.durationHours })
    broadcastChanged('moderation:changed')
    res.json({ ok: true })
  }),
)

router.patch(
  '/users/:id/unban',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: AuthedRequest, res) => {
    await prisma.userModerationStats.updateMany({
      where: { userId: req.params.id },
      data: {
        isBanned: false,
        bannedUntil: null,
        bannedBy: null,
        bannedAt: null,
        banReason: null,
        chatRestrictedUntil: null,
        reviewsRestrictedUntil: null,
      },
    })
    await logModerationAction({
      actorType: 'admin',
      actorId: req.user!.id,
      action: 'unban_user',
      targetType: 'user',
      targetId: req.params.id,
    })
    await auditLog(req, 'moderation-user', req.params.id, 'unban', {})
    broadcastChanged('moderation:changed')
    res.json({ ok: true })
  }),
)

const restrictSchema = z.object({
  restriction: z.enum(['chat', 'reviews', 'comments']),
  durationHours: z.number().int().min(1).max(24 * 30),
  reason: z.string().max(500).optional(),
})

router.patch(
  '/users/:id/restrict',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: AuthedRequest, res) => {
    const data = restrictSchema.parse(req.body)
    const until = new Date(Date.now() + data.durationHours * 60 * 60 * 1000)
    const field = data.restriction === 'chat' ? 'chatRestrictedUntil'
      : data.restriction === 'reviews' ? 'reviewsRestrictedUntil'
      : 'commentsRestrictedUntil'
    await prisma.userModerationStats.upsert({
      where: { userId: req.params.id },
      update: { [field]: until },
      create: { userId: req.params.id, [field]: until },
    })
    await logModerationAction({
      actorType: 'admin',
      actorId: req.user!.id,
      action: `restrict_${data.restriction}`,
      targetType: 'user',
      targetId: req.params.id,
      reason: data.reason,
      details: { until, durationHours: data.durationHours },
    })
    await auditLog(req, 'moderation-user', req.params.id, `restrict_${data.restriction}`, { until, reason: data.reason })
    broadcastChanged('moderation:changed')
    res.json({ ok: true })
  }),
)

router.patch(
  '/users/:id/unrestrict',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: AuthedRequest, res) => {
    await prisma.userModerationStats.updateMany({
      where: { userId: req.params.id },
      data: {
        chatRestrictedUntil: null,
        reviewsRestrictedUntil: null,
        commentsRestrictedUntil: null,
      },
    })
    await logModerationAction({
      actorType: 'admin',
      actorId: req.user!.id,
      action: 'unrestrict_all',
      targetType: 'user',
      targetId: req.params.id,
    })
    await auditLog(req, 'moderation-user', req.params.id, 'unrestrict', {})
    broadcastChanged('moderation:changed')
    res.json({ ok: true })
  }),
)

// GET /api/moderation/users/:id/history — user violation history
router.get(
  '/users/:id/history',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: AuthedRequest, res) => {
    const userId = req.params.id
    const [stats, reports, warnings, aiFlags, actions] = await Promise.all([
      prisma.userModerationStats.findUnique({ where: { userId } }),
      prisma.moderationReport.findMany({
        where: { OR: [{ reporterId: userId }, { targetId: userId, targetType: 'user' }] },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      prisma.moderationWarning.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 50 }),
      prisma.aIFlag.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 50 }),
      prisma.moderationLog.findMany({
        where: { OR: [{ targetType: 'user', targetId: userId }, { actorId: userId }] },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    ])
    res.json({ stats, reports, warnings, aiFlags, actions })
  }),
)

// POST /api/moderation/users/:id/warn — issue a warning
const warnSchema = z.object({
  reason: z.string().min(1).max(500),
  message: z.string().max(1000).optional(),
  severity: z.enum(['low', 'medium', 'high']).default('medium'),
})

router.post(
  '/users/:id/warn',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: AuthedRequest, res) => {
    const data = warnSchema.parse(req.body)
    const warning = await prisma.moderationWarning.create({
      data: {
        userId: req.params.id,
        reason: data.reason,
        message: data.message,
        severity: data.severity,
        createdBy: req.user!.id,
      },
    })
    await prisma.userModerationStats.upsert({
      where: { userId: req.params.id },
      update: { warningsCount: { increment: 1 } },
      create: { userId: req.params.id, warningsCount: 1 },
    })
    await logModerationAction({
      actorType: 'admin',
      actorId: req.user!.id,
      action: 'warn_user',
      targetType: 'user',
      targetId: req.params.id,
      reason: data.reason,
      details: { warningId: warning.id, severity: data.severity },
    })
    await auditLog(req, 'moderation-user', req.params.id, 'warn', { reason: data.reason, severity: data.severity })
    broadcastChanged('moderation:changed')
    res.status(201).json(warning)
  }),
)

// ============================================================================
// ADMIN — WARNINGS LIST
// ============================================================================

router.get(
  '/warnings',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: AuthedRequest, res) => {
    const onlyUnack = req.query.unack === 'true'
    const items = await prisma.moderationWarning.findMany({
      where: onlyUnack ? { acknowledgedAt: null } : undefined,
      include: {
        user: { select: { id: true, username: true, displayName: true, avatar: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    })
    res.json({ items })
  }),
)

// ============================================================================
// ADMIN — MODERATION LOG
// ============================================================================

router.get(
  '/log',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: AuthedRequest, res) => {
    const action = req.query.action as string | undefined
    const actorType = req.query.actorType as string | undefined
    const items = await prisma.moderationLog.findMany({
      where: {
        ...(action ? { action } : {}),
        ...(actorType ? { actorType } : {}),
      },
      include: {
        actor: { select: { id: true, username: true, displayName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 300,
    })
    res.json({ items })
  }),
)

// ============================================================================
// ADMIN — STOP WORDS
// ============================================================================

router.get(
  '/stop-words',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: AuthedRequest, res) => {
    const category = req.query.category as string | undefined
    const search = req.query.search as string | undefined
    const items = await prisma.stopWord.findMany({
      where: {
        ...(category ? { category } : {}),
        ...(search ? { word: { contains: search.toLowerCase() } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 1000,
    })
    res.json({ items })
  }),
)

const createStopWordSchema = z.object({
  word: z.string().min(1).max(100),
  category: z.string().max(50).default('custom'),
  isActive: z.boolean().default(true),
  severity: z.enum(['low', 'medium', 'high']).default('medium'),
})

router.post(
  '/stop-words',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: AuthedRequest, res) => {
    const data = createStopWordSchema.parse(req.body)
    const word = data.word.toLowerCase().trim()
    const existing = await prisma.stopWord.findFirst({ where: { word } })
    if (existing) return res.status(409).json({ error: 'Such word already exists' })
    const created = await prisma.stopWord.create({
      data: {
        word,
        category: data.category,
        isActive: data.isActive,
        severity: data.severity,
        createdBy: req.user!.id,
      },
    })
    await logModerationAction({
      actorType: 'admin',
      actorId: req.user!.id,
      action: 'stopword_add',
      targetType: 'stopword',
      targetId: created.id,
      details: { word, category: data.category, severity: data.severity },
    })
    invalidateStopWordsCache()
    broadcastChanged('moderation:changed')
    res.status(201).json(created)
  }),
)

// Bulk import
const bulkImportSchema = z.object({
  words: z.array(z.object({
    word: z.string().min(1).max(100),
    category: z.string().max(50).default('custom'),
    severity: z.enum(['low', 'medium', 'high']).default('medium'),
  })).max(5000),
  mode: z.enum(['append', 'replace']).default('append'),
})

router.post(
  '/stop-words/bulk',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: AuthedRequest, res) => {
    const data = bulkImportSchema.parse(req.body)
    const normalized = data.words.map((w) => ({
      word: w.word.toLowerCase().trim(),
      category: w.category,
      severity: w.severity,
      isActive: true,
      createdBy: req.user!.id,
    })).filter((w) => w.word.length > 0)

    if (data.mode === 'replace') {
      await prisma.stopWord.deleteMany({})
    }

    // Get existing words to skip duplicates (SQLite doesn't support skipDuplicates)
    const existingWords = new Set(
      (await prisma.stopWord.findMany({ select: { word: true } })).map((w) => w.word),
    )
    const toInsert = normalized.filter((w) => !existingWords.has(w.word))
    // Dedupe within the batch itself
    const seenInBatch = new Set<string>()
    const unique = toInsert.filter((w) => {
      if (seenInBatch.has(w.word)) return false
      seenInBatch.add(w.word)
      return true
    })

    let insertedCount = 0
    if (unique.length > 0) {
      const result = await prisma.stopWord.createMany({ data: unique })
      insertedCount = result.count
    }

    await logModerationAction({
      actorType: 'admin',
      actorId: req.user!.id,
      action: 'stopword_bulk_import',
      targetType: 'stopword',
      targetId: null,
      details: { count: insertedCount, mode: data.mode },
    })
    invalidateStopWordsCache()
    broadcastChanged('moderation:changed')
    res.json({ ok: true, imported: insertedCount })
  }),
)

const updateStopWordSchema = createStopWordSchema.partial()

router.patch(
  '/stop-words/:id',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: AuthedRequest, res) => {
    const existing = await prisma.stopWord.findUnique({ where: { id: req.params.id } })
    if (!existing) return res.status(404).json({ error: 'Stop word not found' })
    const data = updateStopWordSchema.parse(req.body)
    const patch: Record<string, unknown> = {}
    if (data.word !== undefined) patch.word = data.word.toLowerCase().trim()
    if (data.category !== undefined) patch.category = data.category
    if (data.isActive !== undefined) patch.isActive = data.isActive
    if (data.severity !== undefined) patch.severity = data.severity
    const updated = await prisma.stopWord.update({ where: { id: req.params.id }, data: patch })
    await logModerationAction({
      actorType: 'admin',
      actorId: req.user!.id,
      action: 'stopword_update',
      targetType: 'stopword',
      targetId: updated.id,
      details: { before: existing, after: updated },
    })
    invalidateStopWordsCache()
    broadcastChanged('moderation:changed')
    res.json(updated)
  }),
)

router.delete(
  '/stop-words/:id',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: AuthedRequest, res) => {
    const existing = await prisma.stopWord.findUnique({ where: { id: req.params.id } })
    if (!existing) return res.status(404).json({ error: 'Stop word not found' })
    await prisma.stopWord.delete({ where: { id: req.params.id } })
    await logModerationAction({
      actorType: 'admin',
      actorId: req.user!.id,
      action: 'stopword_delete',
      targetType: 'stopword',
      targetId: existing.id,
      details: { word: existing.word },
    })
    invalidateStopWordsCache()
    broadcastChanged('moderation:changed')
    res.json({ ok: true })
  }),
)

// Export stop-words
router.get(
  '/stop-words/export',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: AuthedRequest, res) => {
    const format = (req.query.format as string) || 'json'
    const items = await prisma.stopWord.findMany({ orderBy: { category: 'asc' } })

    if (format === 'txt') {
      const text = items.map((w) => w.word).join('\n')
      res.setHeader('Content-Type', 'text/plain; charset=utf-8')
      res.setHeader('Content-Disposition', 'attachment; filename="stopwords.txt"')
      return res.send(text)
    }
    if (format === 'csv') {
      const csv = ['word,category,severity,isActive']
      for (const w of items) {
        csv.push(`${w.word},${w.category},${w.severity},${w.isActive}`)
      }
      res.setHeader('Content-Type', 'text/csv; charset=utf-8')
      res.setHeader('Content-Disposition', 'attachment; filename="stopwords.csv"')
      return res.send(csv.join('\n'))
    }
    // default: JSON
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Content-Disposition', 'attachment; filename="stopwords.json"')
    res.json({ items })
  }),
)

// ============================================================================
// ADMIN — SETTINGS
// ============================================================================

const settingsSchema = z.object({
  enabled: z.boolean().default(true),
  aiEnabled: z.boolean().default(true),
  strictness: z.enum(['low', 'medium', 'high', 'very_strict']).default('high'),
  checkLinks: z.boolean().default(true),
  checkImages: z.boolean().default(true),
  checkDocuments: z.boolean().default(true),
  whitelist: z.array(z.string().max(100)).max(1000).default([]),
  localAction: z.enum(['block', 'censor', 'flag']).default('block'),
  aiAction: z.enum(['block', 'flag', 'hide']).default('flag'),
  autoWarnThreshold: z.number().int().min(1).max(100).default(3),
  autoMuteThreshold: z.number().int().min(1).max(100).default(5),
  autoBanThreshold: z.number().int().min(1).max(100).default(10),
})

router.get(
  '/settings',
  requireAuth,
  requireAdmin,
  asyncHandler(async (_req: AuthedRequest, res) => {
    const settings = await getModerationSettings()
    res.json(settings)
  }),
)

router.put(
  '/settings',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: AuthedRequest, res) => {
    const data = settingsSchema.parse(req.body)
    const before = await getModerationSettings()
    await prisma.appSetting.upsert({
      where: { id: 'moderationSettings' },
      update: { value: JSON.stringify(data) },
      create: { id: 'moderationSettings', value: JSON.stringify(data) },
    })
    invalidateSettingsCache()
    await logModerationAction({
      actorType: 'admin',
      actorId: req.user!.id,
      action: 'setting_change',
      targetType: 'setting',
      targetId: 'moderationSettings',
      details: { before, after: data },
    })
    await auditLog(req, 'settings', 'moderationSettings', 'update', { before, after: data })
    broadcastChanged('moderation:changed')
    res.json({ ok: true, value: data })
  }),
)

export default router
