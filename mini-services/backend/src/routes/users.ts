import { Router } from 'express'
import crypto from 'node:crypto'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import {
  requireAuth,
  requireAdmin,
  requireAdminOnly,
  safeComparePassword,
  hashPassword,
  invalidateAuthCache,
  type AuthedRequest,
} from '../lib/auth.js'
import { asyncHandler } from '../lib/asyncHandler.js'
import { kickUserSockets } from '../socket/handlers.js'
import { auditLogRaw } from '../lib/audit.js'
// v13.3 (audit dedup): use shared publicUser from lib/serialisers.
import { publicUser } from '../lib/serialisers.js'

const router = Router()

// ============================================================================
// v22 audit: Manager management endpoints.
// ----------------------------------------------------------------------------
// IMPORTANT: These routes (/managers, /managers) MUST be declared BEFORE
// /:id — otherwise Express matches /managers as id="managers".
// ============================================================================

const FAR_FUTURE = new Date('2099-12-31T23:59:59Z')

// POST /api/users/managers — admin creates a new manager account.
const createManagerSchema = z.object({
  username: z.string().min(3).max(30).regex(/^[a-zA-Z0-9_]+$/, 'Username must be alphanumeric + underscore'),
  email: z.string().email().max(200),
  password: z.string().min(8).max(128),
  displayName: z.string().max(100).optional(),
  phone: z.string().max(30).optional(),
})

router.post(
  '/managers',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = createManagerSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid_request', details: parsed.error.flatten() })
    }
    const { username, email, password, displayName, phone } = parsed.data

    // Check for existing username/email
    const existing = await prisma.user.findFirst({
      where: { OR: [{ username }, { email }] },
      select: { id: true, username: true, email: true },
    })
    if (existing) {
      return res.status(409).json({
        error: 'Пользователь с таким именем или email уже существует',
        field: existing.username === username ? 'username' : 'email',
      })
    }

    const hashedPassword = await hashPassword(password)
    const manager = await prisma.user.create({
      data: {
        username,
        email,
        password: hashedPassword,
        displayName: displayName || null,
        phone: phone || null,
        role: 'manager',
      },
      select: { id: true, username: true, email: true, displayName: true, role: true, createdAt: true },
    })

    await auditLogRaw(req.user!.id, req, 'user', manager.id, 'admin_create_manager', {
      after: { username, email, role: 'manager' },
    })

    res.status(201).json({ user: manager })
  }),
)

// GET /api/users/managers — list all managers (and admins).
router.get(
  '/managers',
  requireAuth,
  requireAdmin,
  asyncHandler(async (_req: AuthedRequest, res) => {
    const managers = await prisma.user.findMany({
      where: {
        deletedAt: null,
        OR: [{ role: 'manager' }, { role: 'admin' }],
      },
      orderBy: [{ role: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true, username: true, email: true, displayName: true, role: true,
        isOnline: true, lastSeen: true, createdAt: true,
        lockedUntil: true, failedLoginCount: true,
      },
    })
    res.json({ managers })
  }),
)

// GET /api/users/search?q=... — search by username, displayName, email or phone
//
// PRIVACY (was a bug): previously returned ALL matching users to ANY caller.
// Now applies the same privacy gate as /api/chat/users:
//   - Admins can search across ALL users.
//   - Regular users can only see admins + users they already have a 1-on-1
//     conversation with. Searching for "alex" returns matching admins and
//     matching existing contacts — NOT random users named "alex".
router.get(
  '/search',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const q = (req.query.q as string | undefined)?.trim()
    const limit = Math.min(Math.max(Number(req.query.limit ?? 20) || 20, 1), 50)
    const offset = Math.max(Number(req.query.offset ?? 0) || 0, 0)
    const isAdmin = req.user!.role === 'admin'

    // Build privacy-gated WHERE clause for non-admin callers.
    // Phase 8.1: exclude soft-deleted users from all listings.
    const privacyWhere: any = { id: { not: req.user!.id }, deletedAt: null }
    if (!isAdmin) {
      // Collect partner IDs first.
      const myConvPartners = await prisma.conversationParticipant.findMany({
        where: { userId: req.user!.id },
        select: { conversation: { select: { participants: { select: { userId: true } } } } },
      })
      const partnerIds = new Set<string>()
      for (const cp of myConvPartners) {
        for (const p of cp.conversation.participants) {
          if (p.userId !== req.user!.id) partnerIds.add(p.userId)
        }
      }
      privacyWhere.OR = [{ role: 'admin' }]
      if (partnerIds.size > 0) {
        privacyWhere.OR.push({ id: { in: Array.from(partnerIds) } })
      }
    }

    // If query is empty or too short, return the most recently active users
    // from the caller's visible set.
    if (!q || q.length < 2) {
      const recent = await prisma.user.findMany({
        where: privacyWhere,
        select: {
          id: true,
          username: true,
          displayName: true,
          avatar: true,
          isOnline: true,
          lastSeen: true,
        },
        orderBy: { lastSeen: 'desc' },
        take: limit,
        skip: offset,
      })
      const users = recent.map((u) => publicUser(u))
      res.json({ users, total: recent.length, limit, offset })
      return
    }

    // SQLite `contains` is case-sensitive for non-ASCII (Cyrillic).
    // Fetch candidates with a broad search, then filter in JS by
    // case-insensitive substring match.
    const needle = q.toLowerCase()
    const searchOR: any[] = [
      { username: { contains: q } },
      { displayName: { contains: q } },
      ...(q.startsWith('+') || /^\d/.test(q) ? [{ phone: { contains: q } }] : []),
    ]
    // Only admins can search by email — sensitive PII.
    if (isAdmin) {
      searchOR.push({ email: { contains: q } })
    }
    const candidates = await prisma.user.findMany({
      where: {
        AND: [privacyWhere, { OR: searchOR }],
      },
      select: {
        id: true,
        username: true,
        displayName: true,
        ...(isAdmin ? { phone: true, email: true } : {}),
        avatar: true,
        isOnline: true,
        lastSeen: true,
      },
      take: 100,
    })

    const filtered = candidates.filter((u) => {
      const username = (u.username || '').toLowerCase()
      const displayName = (u.displayName || '').toLowerCase()
      if (username.includes(needle) || displayName.includes(needle)) return true
      if (isAdmin) {
        const email = (u.email || '').toLowerCase()
        const phone = (u.phone || '').toLowerCase()
        if (email.includes(needle) || phone.includes(needle)) return true
      }
      return false
    })

    // Return public-safe shape (no email, no phone)
    const users = filtered.slice(offset, offset + limit).map((u) => publicUser(u))

    res.json({ users, total: filtered.length, limit, offset })
  }),
)

// GET /api/users/online/list
// IMPORTANT: This route MUST be registered BEFORE `/:id`, otherwise Express
// matches `:id = "online"` and treats `list` as an unused path segment.
//
// PRIVACY: applies the same gate as /search and /api/chat/users —
// non-admins see only admins + existing conversation partners.
router.get(
  '/online/list',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit ?? 50) || 50, 1), 200)
    const isAdmin = req.user!.role === 'admin'

    // Phase 8.1: exclude soft-deleted users from online list.
    const where: any = { isOnline: true, id: { not: req.user!.id }, deletedAt: null }
    if (!isAdmin) {
      const myConvPartners = await prisma.conversationParticipant.findMany({
        where: { userId: req.user!.id },
        select: { conversation: { select: { participants: { select: { userId: true } } } } },
      })
      const partnerIds = new Set<string>()
      for (const cp of myConvPartners) {
        for (const p of cp.conversation.participants) {
          if (p.userId !== req.user!.id) partnerIds.add(p.userId)
        }
      }
      where.OR = [{ role: 'admin' }]
      if (partnerIds.size > 0) {
        where.OR.push({ id: { in: Array.from(partnerIds) } })
      }
    }

    const users = await prisma.user.findMany({
      where,
      take: limit,
      orderBy: { lastSeen: 'desc' },
      select: {
        id: true,
        username: true,
        displayName: true,
        avatar: true,
        isOnline: true,
        lastSeen: true,
      },
    })
    res.json({ users })
  }),
)

// ============================================================================
// DELETE /api/users/me — GDPR self-delete (soft delete)
// ============================================================================
// Phase 8.3: Allows a user to delete their own account.
// - Anonymizes PII (email, phone, username, displayName, avatar, bio)
// - Sets deletedAt = now()
// - Bumps tokenVersion (invalidates all JWTs immediately)
// - Kicks all socket connections
// - Does NOT hard-delete: orders, messages, reviews, audit logs stay for
//   referential integrity (other users' chat history, financial records)
//
// Body: { password: string } — requires password confirmation to prevent
// accidental deletion via stolen session.
// ============================================================================
router.delete(
  '/me',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    // B-MED-008: Validate the request body with Zod before any DB work.
    // Previously the route did `const { password } = req.body as { password?: string }`
    // — a type assertion that gives zero runtime validation. A malformed body
    // (e.g. `{"password": 123}` or `{"password": {"$gt": ""}}`) would slip
    // through to safeComparePassword, which expects a string. Zod here
    // enforces string + sane length bounds (1..128 chars).
    const deleteAccountSchema = z.object({
      password: z.string().min(1).max(128),
    })
    const parseResult = deleteAccountSchema.safeParse(req.body)
    if (!parseResult.success) {
      return res.status(400).json({
        error: 'Password confirmation required',
        details: parseResult.error.flatten(),
      })
    }
    const { password } = parseResult.data

    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { id: true, password: true, deletedAt: true },
    })
    if (!user || user.deletedAt) {
      return res.status(404).json({ error: 'Account not found' })
    }

    // Verify password
    const ok = await safeComparePassword(password, user)
    if (!ok) {
      return res.status(401).json({ error: 'Invalid password' })
    }

    // Soft-delete: anonymize PII + set deletedAt + bump tokenVersion
    await prisma.user.update({
      where: { id: user.id },
      data: {
        email: `deleted-${user.id}@deleted.local`,
        phone: null,
        username: `deleted-${user.id}`,
        displayName: 'Deleted user',
        avatar: null,
        bio: null,
        password: await hashPassword(crypto.randomUUID() + crypto.randomUUID()),
        deletedAt: new Date(),
        tokenVersion: { increment: 1 },
        isOnline: false,
      },
    })

    // Invalidate auth cache
    invalidateAuthCache(user.id)

    // Kick all socket connections for this user
    kickUserSockets(user.id)

    // Phase 32: audit log self-delete (GDPR compliance)
    await auditLogRaw(user.id, req, 'auth', user.id, 'self_delete', {
      after: { note: 'User deleted their own account (GDPR Right to Erasure)' },
    })

    res.json({ ok: true, message: 'Account deleted' })
  }),
)

// GET /api/users/:id
// v13.1 (audit P1-1 fix): apply the same privacy gate as /api/chat/users —
// strangers cannot see another user's isOnline / lastSeen (anti-stalking).
// Admins see full profile; existing conversation partners see full profile;
// everyone else sees isOnline=null + lastSeen=null.
router.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const meId = req.user!.id
    const targetId = req.params.id
    const isAdmin = req.user!.role === 'admin'

    const user = await prisma.user.findUnique({
      where: { id: targetId },
      select: {
        id: true,
        username: true,
        displayName: true,
        avatar: true,
        bio: true,
        isOnline: true,
        lastSeen: true,
        createdAt: true,
        deletedAt: true,
      },
    })
    if (!user || user.deletedAt) {
      return res.status(404).json({ error: 'User not found' })
    }

    // Determine if the requester is allowed to see presence info.
    let canSeePresence = isAdmin
    if (!canSeePresence) {
      // Check if requester has an existing conversation with the target
      const existingConv = await prisma.conversation.findFirst({
        where: {
          AND: [
            { participants: { some: { userId: meId } } },
            { participants: { some: { userId: targetId } } },
          ],
        },
        select: { id: true },
      })
      canSeePresence = !!existingConv
    }

    // Don't expose deletedAt to clients
    const { deletedAt, ...publicUser } = user
    // v13.1: type-safe null override — Prisma types isOnline as boolean,
    // lastSeen as Date. We cast to the public shape with nulls for strangers.
    const safeUser = canSeePresence
      ? publicUser
      : { ...publicUser, isOnline: null as boolean | null, lastSeen: null as Date | null }
    res.json({ user: safeUser })
  }),
)

// ============================================================================
// DELETE /api/users/:id — admin-only soft-delete of any user.
// ----------------------------------------------------------------------------
// Allows an admin to delete (soft-delete) any user account from Studio.
// Mirrors the self-delete behaviour of DELETE /api/users/me:
//   - Anonymizes PII (email, phone, username, displayName, avatar, bio)
//   - Sets deletedAt = now()
//   - Bumps tokenVersion (invalidates all JWTs immediately)
//   - Kicks all socket connections
//   - Does NOT hard-delete: orders, messages, reviews, audit logs stay for
//     referential integrity (other users' chat history, financial records)
//
// SAFEGUARDS:
//   - Admin role required (requireAdmin middleware)
//   - Admin cannot delete themselves via this endpoint (use /me instead)
//   - Already-deleted users return 404 (idempotent)
//   - Audit log entry records the admin who performed the deletion
// ============================================================================
router.delete(
  '/:id',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: AuthedRequest, res) => {
    const targetId = req.params.id
    const adminId = req.user!.id

    // Prevent admin from deleting themselves via this endpoint — they must
    // use /me with password confirmation instead. This prevents accidental
    // self-lockout (the last admin deleting themselves = no admins left).
    if (targetId === adminId) {
      return res.status(400).json({
        error: 'Нельзя удалить свой аккаунт через этот эндпоинт. Используйте «Удалить аккаунт» в настройках профиля.',
      })
    }

    const user = await prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true, username: true, email: true, role: true, deletedAt: true },
    })
    if (!user || user.deletedAt) {
      return res.status(404).json({ error: 'Пользователь не найден или уже удалён' })
    }

    // Snapshot for audit log (before state)
    const beforeSnapshot = {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
    }

    // Soft-delete: anonymize PII + set deletedAt + bump tokenVersion
    await prisma.user.update({
      where: { id: user.id },
      data: {
        email: `deleted-${user.id}@deleted.local`,
        phone: null,
        username: `deleted-${user.id}`,
        displayName: 'Deleted user',
        avatar: null,
        bio: null,
        password: await hashPassword(crypto.randomUUID() + crypto.randomUUID()),
        deletedAt: new Date(),
        tokenVersion: { increment: 1 },
        isOnline: false,
      },
    })

    // Invalidate auth cache
    invalidateAuthCache(user.id)

    // Kick all socket connections for this user
    kickUserSockets(user.id)

    // Audit log — records which admin deleted which user
    await auditLogRaw(adminId, req, 'user', user.id, 'admin_delete', {
      before: beforeSnapshot,
      after: { note: `Admin ${adminId} deleted user ${user.id}` },
    })

    res.json({ ok: true, message: 'Пользователь удалён' })
  }),
)

// ============================================================================
// v22 audit: Role change + block / unblock endpoints.
// (POST /managers + GET /managers are declared at the TOP of this file,
//  BEFORE /:id, to avoid Express matching /managers as id="managers".)
// ============================================================================

// PATCH /api/users/:id/role — change user role.
// v24.6-audit (C-AI-3 fix): admin-only (requireAdminOnly). Managers must NOT
// be able to change roles — they could promote themselves or each other to admin.
// (The previous check inside the handler was belt-and-braces; this enforces it
// at the middleware level so all routes can be audited at a glance.)
const changeRoleSchema = z.object({
  role: z.enum(['user', 'manager', 'admin']),
})

router.patch(
  '/:id/role',
  requireAuth,
  requireAdminOnly,
  asyncHandler(async (req: AuthedRequest, res) => {
    const targetId = req.params.id
    const parsed = changeRoleSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid_request', details: parsed.error.flatten() })
    }
    const { role } = parsed.data
    const requesterRole = req.user!.role

    // v24.6-audit: managers cannot promote to admin (privilege escalation guard)
    if (role === 'admin' && requesterRole !== 'admin') {
      return res.status(403).json({ error: 'Только администратор может назначить роль admin' })
    }

    // v24.6-audit: managers cannot demote an existing admin (only admins can)
    const target = await prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true, role: true, deletedAt: true },
    })
    if (!target || target.deletedAt) {
      return res.status(404).json({ error: 'Пользователь не найден' })
    }
    if (target.role === 'admin' && requesterRole !== 'admin') {
      return res.status(403).json({ error: 'Только администратор может изменить роль другого администратора' })
    }

    if (targetId === req.user!.id) {
      return res.status(400).json({ error: 'Нельзя изменить свою собственную роль' })
    }

    const before = { role: target.role }
    await prisma.user.update({
      where: { id: targetId },
      data: { role },
    })
    invalidateAuthCache(targetId)
    kickUserSockets(targetId)

    await auditLogRaw(req.user!.id, req, 'user', targetId, 'admin_change_role', {
      before,
      after: { role },
    })

    res.json({ ok: true, user: { id: targetId, role } })
  }),
)

// POST /api/users/:id/block — block a user (set lockedUntil to far future).
router.post(
  '/:id/block',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: AuthedRequest, res) => {
    const targetId = req.params.id

    if (targetId === req.user!.id) {
      return res.status(400).json({ error: 'Нельзя заблокировать самого себя' })
    }

    const target = await prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true, role: true, deletedAt: true, lockedUntil: true },
    })
    if (!target || target.deletedAt) {
      return res.status(404).json({ error: 'Пользователь не найден' })
    }

    const before = { role: target.role, lockedUntil: target.lockedUntil }
    await prisma.user.update({
      where: { id: targetId },
      data: { lockedUntil: FAR_FUTURE, failedLoginCount: 999 },
    })
    invalidateAuthCache(targetId)
    kickUserSockets(targetId)

    await auditLogRaw(req.user!.id, req, 'user', targetId, 'admin_block_user', {
      before,
      after: { lockedUntil: FAR_FUTURE, note: 'User blocked by admin' },
    })

    res.json({ ok: true, message: 'Пользователь заблокирован' })
  }),
)

// POST /api/users/:id/unblock — unblock a user (clear lockedUntil).
router.post(
  '/:id/unblock',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: AuthedRequest, res) => {
    const targetId = req.params.id

    const target = await prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true, deletedAt: true, lockedUntil: true },
    })
    if (!target || target.deletedAt) {
      return res.status(404).json({ error: 'Пользователь не найден' })
    }

    const before = { lockedUntil: target.lockedUntil }
    await prisma.user.update({
      where: { id: targetId },
      data: { lockedUntil: null, failedLoginCount: 0 },
    })
    invalidateAuthCache(targetId)

    await auditLogRaw(req.user!.id, req, 'user', targetId, 'admin_unblock_user', {
      before,
      after: { lockedUntil: null, note: 'User unblocked by admin' },
    })

    res.json({ ok: true, message: 'Пользователь разблокирован' })
  }),
)

export default router
