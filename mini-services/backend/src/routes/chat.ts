import { Router } from 'express'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { requireAuth, requireAdmin, type AuthedRequest } from '../lib/auth.js'
import { asyncHandler } from '../lib/asyncHandler.js'
import { moderateContent } from '../lib/moderation.js'
import {
  startConversationSchema,
  sendMessageSchema,
  forwardMessageSchema,
} from '../lib/schemas.js'
import { serialiseMessage, USER_PUBLIC_SELECT } from '../lib/serialisers.js'
import { getIo, notifyOfflineParticipants } from '../socket/handlers.js'
import { auditLogRaw } from '../lib/audit.js'

const router = Router()

// v13.3 (audit dedup): use shared USER_PUBLIC_SELECT from lib/serialisers.
const userSelect = USER_PUBLIC_SELECT

// POST /api/chat/conversations  { participantId }
router.post(
  '/conversations',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const { participantId } = startConversationSchema.parse(req.body)
    const meId = req.user!.id
    if (participantId === meId) {
      return res.status(400).json({ error: 'Cannot start conversation with yourself' })
    }

    // Phase 8.1: cannot start conversation with a soft-deleted user.
    const participant = await prisma.user.findUnique({ where: { id: participantId } })
    if (!participant || participant.deletedAt) {
      return res.status(404).json({ error: 'User not found' })
    }

    const existingConversations = await prisma.conversation.findMany({
      where: { participants: { some: { userId: meId } } },
      include: { participants: { select: { userId: true } } },
      take: 200,
    })

    const existing = existingConversations.find(
      (c) =>
        c.participants.length === 2 &&
        c.participants.some((p) => p.userId === meId) &&
        c.participants.some((p) => p.userId === participantId),
    )

    if (existing) {
      const fullConv = await prisma.conversation.findUnique({
        where: { id: existing.id },
        include: {
          participants: { include: { user: { select: userSelect } } },
          messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
      })
      return res.json({ conversation: formatConversation(fullConv, meId) })
    }

    const conv = await prisma.conversation.create({
      data: {
        participants: { create: [{ userId: meId }, { userId: participantId }] },
      },
      include: {
        participants: { include: { user: { select: userSelect } } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    })
    res.status(201).json({ conversation: formatConversation(conv, meId) })
  }),
)

// ============================================================================
//  GET /api/chat/users — list of users available for chatting.
//
//  PRIVACY POLICY (revised for marketplace use case):
//    A marketplace chat requires users to be able to find any other
//    registered user by username and start a conversation with them
//    (buyer ↔ seller, support ↔ customer, user ↔ user). The previous
//    policy (regular users see ONLY admins + existing conversation
//    partners) broke this core flow — users could never find a
//    newly-registered contact by nickname.
//
//    New policy:
//      - ALL authenticated callers can see ALL registered users
//        (excluding themselves) by PUBLIC fields only:
//          username, displayName, avatar, isOnline, lastSeen, role
//      - Email and phone are NEVER returned to non-admin callers
//        (sensitive PII — only admins see them, and only when searching).
//      - When a search query is provided, search is performed across
//        username + displayName (public fields). Admins additionally
//        can search by email and phone.
//      - The admin is ALWAYS pinned to the top of the list with
//        `isSupport: true` so the UI can render them with a distinct
//        card / colour.
//
//  The list is ordered by:
//    1. Admins (pinned, isSupport: true)
//    2. Users with an existing 1-on-1 conversation with the caller
//       (most recent message first)
//    3. Online users
//    4. Most recently active users (lastSeen desc)
router.get(
  '/users',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const meId = req.user!.id
    const isAdmin = req.user!.role === 'admin'
    const limit = Math.min(Math.max(Number(req.query.limit ?? 100) || 100, 1), 500)
    const offset = Math.max(Number(req.query.offset ?? 0) || 0, 0)
    const search = (req.query.q as string | undefined)?.trim()

    // ----------------------------------------------------------------
    // Build WHERE clause.
    // NEW BEHAVIOUR: users see ONLY:
    //   - Admins (always visible — they're the support channel)
    //   - Users they already have a conversation with
    // When searching, also include ALL users matching the search query
    // (so the user can discover and start a new conversation).
    // ----------------------------------------------------------------
    // Phase 8.1: exclude soft-deleted users from chat candidates.
    const where: any = { id: { not: meId }, deletedAt: null }

    // Fetch the caller's existing conversation partners FIRST.
    const myConvPartners = await prisma.conversationParticipant.findMany({
      where: { userId: meId },
      select: {
        conversationId: true,
        conversation: {
          select: {
            type: true,
            participants: { select: { userId: true } },
            messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { createdAt: true } },
          },
        },
      },
    })
    // Build a map: partnerUserId -> { lastMessageAt, type }
    const partnerInfo = new Map<string, { lastMessageAt: Date; type: string }>()
    const partnerIds = new Set<string>()
    for (const cp of myConvPartners) {
      const conv = cp.conversation
      const otherUserId = conv.participants.find((p) => p.userId !== meId)?.userId
      if (!otherUserId) continue
      const lastAt = conv.messages[0]?.createdAt || new Date(0)
      partnerInfo.set(otherUserId, { lastMessageAt: lastAt as Date, type: conv.type })
      partnerIds.add(otherUserId)
    }

    if (search && search.length >= 1) {
      // SEARCH MODE: search across ALL users (username + displayName).
      // This allows discovering new users to start a conversation.
      const searchOR: any[] = [
        { username: { contains: search } },
        { displayName: { contains: search } },
      ]
      if (isAdmin) {
        searchOR.push({ email: { contains: search } })
        if (search.startsWith('+') || /^\d/.test(search)) {
          searchOR.push({ phone: { contains: search } })
        }
      }
      where.OR = searchOR
    } else {
      // v11-fix: NO SEARCH — show ONLY existing conversation partners.
      // Previously this also included `{ role: 'admin' }` which caused new
      // users to see ALL admins in the system (even ones they never talked
      // to). Now we show only users the current user has an actual
      // conversation with. The admin support chat (auto-created at
      // registration) will be in partnerIds, so the user still sees their
      // admin — but only THAT admin, not every admin in the system.
      //
      // Edge case: if the user has no conversations at all (brand new
      // account, registration just completed), partnerIds is empty and the
      // result is empty. The frontend ChatView handles this by showing the
      // "start new chat" search, which uses the search branch above.
      if (partnerIds.size === 0) {
        return res.json({ users: [], total: 0, limit, offset })
      }
      where.id = { in: [...partnerIds] }
    }

    // Fetch candidate users
    const candidates = await prisma.user.findMany({
      where,
      select: {
        id: true, username: true, displayName: true, avatar: true,
        isOnline: true, lastSeen: true, role: true,
        ...(isAdmin && search ? { email: true, phone: true } : {}),
      },
      take: search ? 200 : limit + offset,
      orderBy: [{ isOnline: 'desc' }, { lastSeen: 'desc' }],
    })

    // If searching with Cyrillic or mixed case, do a case-insensitive filter
    let filtered = candidates
    if (search) {
      const needle = search.toLowerCase()
      filtered = candidates.filter((u) => {
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
    }

    // partnerInfo already fetched above — reuse it.

    // Build the final list — publicUser shape + hasConversation flag.
    // v9-audit-fix: privacy — for users the caller has NO conversation with
    // (strangers discovered via search), strip isOnline/lastSeen to prevent
    // activity surveillance. Admins and existing partners keep full fields.
    const shaped = filtered.map((u) => {
      const info = partnerInfo.get(u.id)
      const isPartner = !!info
      const isAdminUser = u.role === 'admin'
      const isStranger = !isPartner && !isAdminUser
      return {
        id: u.id,
        username: u.username,
        displayName: u.displayName,
        avatar: u.avatar,
        // v9-audit-fix: hide online status + last seen from strangers
        isOnline: isStranger ? null : u.isOnline,
        lastSeen: isStranger ? null : u.lastSeen,
        role: u.role,
        isSupport: isAdminUser, // UI hint: render with admin styling
        hasConversation: isPartner,
        conversationType: info?.type || null,
        lastMessageAt: info?.lastMessageAt || null,
      }
    })

    // Sort: admins first (pinned support), then users with existing
    // conversations (by lastMessageAt desc), then online, then by lastSeen.
    shaped.sort((a, b) => {
      // Admins always first
      if (a.isSupport && !b.isSupport) return -1
      if (!a.isSupport && b.isSupport) return 1
      // Both have conversations → most recent message first
      if (a.hasConversation && b.hasConversation) {
        const aTime = a.lastMessageAt?.getTime() || 0
        const bTime = b.lastMessageAt?.getTime() || 0
        return bTime - aTime
      }
      // One has a conversation → that one comes first
      if (a.hasConversation && !b.hasConversation) return -1
      if (!a.hasConversation && b.hasConversation) return 1
      // Neither has a conversation → online first, then by lastSeen
      if (a.isOnline !== b.isOnline) return a.isOnline ? -1 : 1
      const aSeen = a.lastSeen?.getTime() || 0
      const bSeen = b.lastSeen?.getTime() || 0
      return bSeen - aSeen
    })

    const paged = shaped.slice(offset, offset + limit)
    res.json({ users: paged, total: shaped.length, limit, offset })
  }),
)

// GET /api/chat/conversations
router.get(
  '/conversations',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const meId = req.user!.id
    const isAdmin = req.user!.role === 'admin'
    const limit = Math.min(Math.max(Number(req.query.limit ?? 50) || 50, 1), 200)
    const offset = Math.max(Number(req.query.offset ?? 0) || 0, 0)

    // v11-fix: for admins, hide "empty" support conversations — ones where
    // the only message is the welcome message sent by the admin themselves
    // (i.e. the user never replied). This keeps the admin's chat list clean:
    // they only see users who have actually engaged in conversation.
    // Regular users always see all their conversations (including the
    // welcome-only support chat with the admin).
    //
    // v13.0 (audit P0-2 fix): the previous version built a raw SQL string
    // via string interpolation with single-quote escaping. While cuid()
    // values are safe today, the pattern was a textbook SQL-injection
    // waiting to happen. Now uses Prisma's parameterised SQL fragment.
    const adminFilter = isAdmin
      ? Prisma.sql`AND NOT (
           SELECT COUNT(*) FROM Message m
           WHERE m.conversationId = c.id
             AND m.senderId <> ${meId}
         ) = 0
           OR c.type <> 'support'`
      : Prisma.empty

    // Build the query with the admin filter applied
    const conversations = isAdmin
      ? await prisma.$queryRaw`
          SELECT c.* FROM Conversation c
          WHERE c.id IN (
            SELECT conversationId FROM ConversationParticipant WHERE userId = ${meId}
          )
          ${adminFilter}
          ORDER BY c.type DESC, c.updatedAt DESC
          LIMIT ${limit} OFFSET ${offset}
        `
      : await prisma.conversation.findMany({
          where: { participants: { some: { userId: meId } } },
          include: {
            participants: { include: { user: { select: userSelect } } },
            messages: { orderBy: { createdAt: 'desc' }, take: 1 },
          },
          orderBy: [
            { type: 'desc' },
            { updatedAt: 'desc' },
          ],
          take: limit,
          skip: offset,
        })

    // For the admin raw query, we need to load participants + last message separately
    let formattedConversations: any[]
    let total: number
    if (isAdmin) {
      const rawConvIds = (conversations as Array<{ id: string }>).map((c) => c.id)
      if (rawConvIds.length === 0) {
        formattedConversations = []
        total = 0
      } else {
        const fullConvs = await prisma.conversation.findMany({
          where: { id: { in: rawConvIds } },
          include: {
            participants: { include: { user: { select: userSelect } } },
            messages: { orderBy: { createdAt: 'desc' }, take: 1 },
          },
          orderBy: [
            { type: 'desc' },
            { updatedAt: 'desc' },
          ],
        })
        // Preserve the order from the raw query (which already sorted by type DESC, updatedAt DESC)
        const orderMap = new Map(rawConvIds.map((id, i) => [id, i]))
        fullConvs.sort((a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0))
        formattedConversations = fullConvs.map((c) => formatConversation(c, meId))
        // Count total (with the same admin filter applied)
        const totalResult = await prisma.$queryRaw`
          SELECT COUNT(*) as cnt FROM Conversation c
          WHERE c.id IN (
            SELECT conversationId FROM ConversationParticipant WHERE userId = ${meId}
          )
          ${adminFilter}
        `
        total = Number((totalResult as Array<{ cnt: bigint }>)[0]?.cnt ?? 0)
      }
    } else {
      formattedConversations = (conversations as any[]).map((c) => formatConversation(c, meId))
      total = await prisma.conversation.count({
        where: { participants: { some: { userId: meId } } },
      })
    }

    res.json({
      items: formattedConversations,
      total,
      limit,
      offset,
    })
  }),
)

// GET /api/chat/unread-counts
// C-HIGH-005: aggregate unread message counts per-conversation (and total)
// for the current user. Used by clients to sync unread badges across
// multiple devices — when the user reads a conversation on desktop, mobile
// can poll this endpoint (or receive a socket event) and clear its badge.
//
// "Unread" here is intentionally simplified: a message is counted as unread
// if `isRead=false` AND `senderId != meId`. The `deletedFor` JSON array
// (per-user soft-delete) is NOT filtered here because SQLite can't index
// JSON arrays efficiently — if we filtered client-side we'd return an
// inflated count, so for now we accept a minor over-count for messages the
// user has deleted-for-me. A follow-up should migrate `deletedFor` to a
// join table for O(1) filtering.
//
// NOTE: route declared BEFORE `/conversations/:id/*` so Express matches
// `/unread-counts` literally and never tries to parse it as a conversation id.
router.get(
  '/unread-counts',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const meId = req.user!.id
    // v10-fix: filter by conversation membership — previously this query
    // returned unread counts for ALL conversations in the DB (privacy leak).
    // Now we only count messages in conversations the user is a participant of.
    const myConvIds = await prisma.conversationParticipant.findMany({
      where: { userId: meId },
      select: { conversationId: true },
    })
    const convIdList = myConvIds.map((cp) => cp.conversationId)
    if (convIdList.length === 0) {
      return res.json({ byConversation: {}, total: 0 })
    }
    const rows = await prisma.message.groupBy({
      by: ['conversationId'],
      where: {
        isRead: false,
        senderId: { not: meId },
        conversationId: { in: convIdList },
      },
      _count: { _all: true },
    })
    const byConversation: Record<string, number> = {}
    let total = 0
    for (const r of rows) {
      byConversation[r.conversationId] = r._count._all
      total += r._count._all
    }
    res.json({ byConversation, total })
  }),
)

// GET /api/chat/conversations/:id/messages
router.get(
  '/conversations/:id/messages',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const meId = req.user!.id
    const conv = await prisma.conversation.findUnique({
      where: { id: req.params.id },
      include: { participants: { select: { userId: true } } },
    })
    if (!conv) return res.status(404).json({ error: 'Conversation not found' })
    const isMember = conv.participants.some((p) => p.userId === meId)
    if (!isMember) return res.status(403).json({ error: 'Forbidden' })

    const limit = Math.min(Math.max(Number(req.query.limit ?? 100) || 100, 1), 500)
    const offset = Math.max(Number(req.query.offset ?? 0) || 0, 0)

    // C-HIGH-003 fix: cursor-based pagination (backward compatible with offset).
    // ?before=<messageId> — returns messages older than the given message.
    // ?limit=100 — page size (default 100, max 500).
    // When `before` is supplied, we use cursor pagination (keyset) which is
    // O(log N) and stable under concurrent inserts, unlike offset which is
    // O(offset+limit) and shifts when new messages arrive mid-pagination.
    // When `before` is absent, the original offset path is preserved so
    // existing clients keep working unchanged.
    const before = req.query.before as string | undefined
    if (before) {
      const cursorMsg = await prisma.message.findUnique({
        where: { id: before },
        select: { createdAt: true },
      })
      const cursorCreatedAt = cursorMsg?.createdAt
      const rawMessages = await prisma.message.findMany({
        where: {
          conversationId: conv.id,
          ...(cursorCreatedAt ? { createdAt: { lt: cursorCreatedAt } } : {}),
        },
        orderBy: { createdAt: 'desc' }, // newest first
        take: limit,
        include: {
          sender: { select: userSelect },
          replyTo: { include: { sender: { select: userSelect } } },
          forwardedFrom: { include: { sender: { select: userSelect } } },
        },
      })
      // Reverse to ascending order for client display
      rawMessages.reverse()
      // Filter out messages deleted for the viewer
      const visible = rawMessages.filter((m) => {
        const deletedFor: string[] = (() => {
          try { return JSON.parse(m.deletedFor || '[]') } catch { return [] }
        })()
        return !deletedFor.includes(meId)
      })
      res.json({
        items: visible.map((m) => serialiseMessage(m, meId)),
        total: visible.length,
        limit,
        offset: 0,
        hasMore: visible.length === limit,
      })
      return
    }

    // Fetch oldest-first (skip messages deleted for me)
    const messages = await prisma.message.findMany({
      where: { conversationId: conv.id },
      orderBy: { createdAt: 'asc' },
      take: limit,
      skip: offset,
      include: {
        sender: { select: userSelect },
        replyTo: { include: { sender: { select: userSelect } } },
        forwardedFrom: { include: { sender: { select: userSelect } } },
      },
    })
    // Filter out messages deleted for the viewer (they shouldn't see them at all)
    const visible = messages.filter((m) => {
      const deletedFor: string[] = (() => {
        try { return JSON.parse(m.deletedFor || '[]') } catch { return [] }
      })()
      return !deletedFor.includes(meId)
    })
    res.json({
      items: visible.map((m) => serialiseMessage(m, meId)),
      total: visible.length,
      limit,
      offset,
    })
  }),
)

// DELETE /api/chat/conversations/:id — удалить диалог полностью для текущего
// пользователя. Удаляет все сообщения в диалоге (для всех участников, если
// диалог 1-on-1), затем удаляет participant запись. Если участников не осталось
// — удаляет сам диалог.
//
// SUPPORT conversations cannot be deleted — they are the pinned admin ↔ user
// channel and must always remain accessible to the user.
router.delete(
  '/conversations/:id',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const meId = req.user!.id
    const conv = await prisma.conversation.findUnique({
      where: { id: req.params.id },
      include: { participants: { select: { id: true, userId: true } } },
    })
    if (!conv) return res.status(404).json({ error: 'Conversation not found' })

    const isMember = conv.participants.some((p) => p.userId === meId)
    if (!isMember) return res.status(403).json({ error: 'Forbidden' })

    // Block deletion of support conversations — they are the pinned admin
    // channel and must always be available to the user.
    if (conv.type === 'support') {
      return res.status(400).json({ error: 'Нельзя удалить чат с поддержкой — это основной канал связи с командой «Три девятки».' })
    }

    // SECURITY / DATA-LOSS FIX (was):
    // The previous implementation called `prisma.message.deleteMany({ where: { conversationId: conv.id } })`
    // — this DELETED EVERY MESSAGE IN THE CONVERSATION FOR ALL PARTICIPANTS,
    // including the other party's received messages. User A could unilaterally
    // destroy user B's chat history without consent or audit trail.
    //
    // New behaviour: "delete" = soft-delete for the caller only.
    //   1. Mark every message in the conversation as `deletedFor: [meId]`
    //      (the existing soft-delete mechanism used by `message:delete` socket event).
    //      The caller no longer sees these messages, but the other participant
    //      still has their full history.
    //   2. Remove the caller from `ConversationParticipant` so the conversation
    //      disappears from their chat list.
    //   3. If no participants remain (both users deleted), then we hard-delete
    //      the conversation AND its messages (no orphan data).
    //
    // This mirrors how WhatsApp / Telegram handle "delete conversation":
    // the action only affects the caller's view, not the other party's.
    //
    // v9-audit-fix: replaced N+1 per-message UPDATE loop with a single bulk
    // SQL UPDATE using SQLite json_insert. Wrapped the whole operation in a
    // $transaction so a crash between steps can't leave the conversation
    // visible but with all messages hidden.
    await prisma.$transaction(async (tx) => {
      // Bulk-update: add meId to every message's deletedFor JSON array (if not
      // already present) in a single SQL statement.
      await tx.$executeRaw`
        UPDATE "Message"
        SET "deletedFor" = CASE
          WHEN "deletedFor" IS NULL OR "deletedFor" = '' OR "deletedFor" = '[]' THEN json_array(${meId})
          WHEN EXISTS (SELECT 1 FROM json_each("deletedFor") WHERE value = ${meId}) THEN "deletedFor"
          ELSE json_insert("deletedFor", '$[#]', ${meId})
        END
        WHERE "conversationId" = ${conv.id}
      `

      // Remove the caller from the conversation's participant list.
      await tx.conversationParticipant.deleteMany({
        where: { conversationId: conv.id, userId: meId },
      })

      // If no participants remain, hard-delete the conversation + messages
      // (orphan cleanup — no one will ever see this data again).
      const remaining = await tx.conversationParticipant.count({
        where: { conversationId: conv.id },
      })
      if (remaining === 0) {
        await tx.message.deleteMany({ where: { conversationId: conv.id } })
        await tx.conversation.delete({ where: { id: conv.id } })
      }
    })

    res.json({ ok: true })
  }),
)

// ============================================================================
// DELETE /api/chat/admin/conversations/:id — admin-only HARD delete of any
// conversation (including support chats).
// ----------------------------------------------------------------------------
// Unlike the user-facing DELETE /api/chat/conversations/:id (which only
// soft-deletes for the caller), this endpoint:
//   - Hard-deletes the conversation AND all its messages
//   - Removes ALL participant records (both sides)
//   - Works on ANY conversation type (direct, support)
//   - Requires admin role
//   - Records an audit log entry
//
// Use case: admin needs to clean up abusive/spam conversations, or remove
// a support chat after resolving a user's issue.
// ============================================================================
router.delete(
  '/admin/conversations/:id',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: AuthedRequest, res) => {
    const convId = req.params.id
    const adminId = req.user!.id

    const conv = await prisma.conversation.findUnique({
      where: { id: convId },
      include: {
        participants: {
          select: { id: true, userId: true },
        },
        _count: { select: { messages: true } },
      },
    })
    if (!conv) {
      return res.status(404).json({ error: 'Чат не найден' })
    }

    // Snapshot for audit log
    const beforeSnapshot = {
      id: conv.id,
      type: conv.type,
      participantIds: conv.participants.map((p) => p.userId),
      messageCount: conv._count.messages,
      createdAt: conv.createdAt,
    }

    // Hard-delete: messages → participants → conversation
    // Order matters: delete children first to avoid FK constraint errors.
    await prisma.message.deleteMany({ where: { conversationId: convId } })
    await prisma.conversationParticipant.deleteMany({
      where: { conversationId: convId },
    })
    await prisma.conversation.delete({ where: { id: convId } })

    // Notify all participants via Socket.IO that the conversation was deleted
    // (so their chat list updates in real-time)
    const io = getIo()
    if (io) {
      for (const p of conv.participants) {
        io.to(`user:${p.userId}`).emit('conversation:deleted', { conversationId: convId })
      }
    }

    // Audit log
    await auditLogRaw(adminId, req, 'chat', convId, 'admin_delete_conversation', {
      before: beforeSnapshot,
      after: null,
    })

    res.json({ ok: true, message: 'Чат полностью удалён' })
  }),
)

// POST /api/chat/conversations/:id/messages  — REST fallback (also via Socket.IO)
router.post(
  '/conversations/:id/messages',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const meId = req.user!.id
    const data = sendMessageSchema.parse(req.body)
    const conv = await prisma.conversation.findUnique({
      where: { id: req.params.id },
      include: { participants: { select: { userId: true } } },
    })
    if (!conv) return res.status(404).json({ error: 'Conversation not found' })
    const isMember = conv.participants.some((p) => p.userId === meId)
    if (!isMember) return res.status(403).json({ error: 'Forbidden' })

    // If replyToId is set, verify the referenced message is in the same conversation
    if (data.replyToId) {
      const replied = await prisma.message.findUnique({
        where: { id: data.replyToId },
        select: { conversationId: true },
      })
      if (!replied || replied.conversationId !== conv.id) {
        return res.status(400).json({ error: 'Reply target message not found in this conversation' })
      }
    }

    // C-CRIT-002 fix: idempotency via clientMessageId. The REST endpoint is
    // a fallback for when the socket is unavailable. If the client already
    // sent this message via socket (and the server created it), the REST
    // retry would create a duplicate. Accept optional `clientMessageId` in
    // the body and check for existing message before creating.
    const clientMessageId = (req.body as any)?.clientMessageId || (req.body as any)?.tempId || null
    if (clientMessageId) {
      const existing = await prisma.message.findFirst({
        where: { senderId: meId, clientMessageId },
        include: {
          sender: { select: userSelect },
          replyTo: { include: { sender: { select: userSelect } } },
          forwardedFrom: { include: { sender: { select: userSelect } } },
        },
      })
      if (existing) {
        // Idempotent response — return the existing message.
        return res.status(200).json(serialiseMessage(existing, meId))
      }
    }

    // v16.9 MODERATION — REST fallback path. Same check as the socket handler.
    if (data.content && data.content.trim()) {
      const modDecision = await moderateContent(data.content, {
        userId: meId,
        targetType: 'message',
        conversationId: conv.id,
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

    const message = await prisma.message.create({
      data: {
        conversationId: conv.id,
        senderId: meId,
        content: data.content,
        mediaUrl: data.mediaUrl,
        mediaType: data.mediaType,
        // v12: store attachments as JSON string if present
        attachments: data.attachments ? JSON.stringify(data.attachments) : null,
        duration: data.duration,
        replyToId: data.replyToId,
        forwardedFromId: data.forwardedFromId,
        clientMessageId, // C-CRIT-002: persist for future dedup
        // v16.8-final: self-destruct timer (voice messages).
        selfDestructAt:
          data.selfDestructMinutes && data.selfDestructMinutes > 0
            ? new Date(Date.now() + data.selfDestructMinutes * 60 * 1000)
            : null,
      },
      include: {
        sender: { select: userSelect },
        replyTo: { include: { sender: { select: userSelect } } },
        forwardedFrom: { include: { sender: { select: userSelect } } },
      },
    })

    await prisma.conversation.update({
      where: { id: conv.id },
      data: { updatedAt: new Date() },
    })

    // Broadcast via Socket.IO so all participants (including those on other
    // devices/tabs) receive the message in real-time. This mirrors what the
    // socket message:send handler does — without it, REST-sent messages
    // would never trigger the notification policy in other clients.
    const io = getIo()
    if (io) {
      const formatted = serialiseMessage(message, '')
      io.to(`conversation:${conv.id}`).emit('message:received', formatted)
    }

    // Send Web Push notifications to OFFLINE participants (those with no
    // active socket connections). This is what makes push work when the
    // recipient's app is fully closed — the push service wakes up their
    // service worker which displays a system notification.
    // v12: pass parsed attachments (the raw message has them as JSON string)
    const parsedAttachments = message.attachments
      ? (() => { try { return JSON.parse(message.attachments) as any[] } catch { return null } })()
      : null
    void notifyOfflineParticipants(conv.id, meId, {
      ...message,
      attachments: parsedAttachments,
    })

    res.status(201).json(serialiseMessage(message, meId))
  }),
)

// POST /api/chat/messages/:id/forward — forward a message to one or more conversations
router.post(
  '/messages/:id/forward',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const meId = req.user!.id
    const { targetConversationIds, sourceMessageId } = forwardMessageSchema.parse({
      ...req.body,
      sourceMessageId: req.params.id,
    })

    // Fetch the source message WITH its conversation's participants so we can
    // verify the caller is a participant of the source conversation too.
    // SECURITY FIX (was): the source was fetched without its participants,
    // and no ownership check was performed on source.conversationId. Any
    // authenticated user who knew (or brute-forced) a message cuid could
    // clone private content + media URLs from other people's conversations
    // into their own. Now we require the caller to be a participant of BOTH
    // the source conversation and every target conversation.
    const source = await prisma.message.findUnique({
      where: { id: sourceMessageId },
      include: {
        sender: { select: userSelect },
        conversation: { include: { participants: { select: { userId: true } } } },
      },
    })
    if (!source) return res.status(404).json({ error: 'Source message not found' })
    if (source.deletedForAll) {
      return res.status(400).json({ error: 'Cannot forward a deleted message' })
    }

    // Ownership check on source conversation — caller must be a participant.
    const isSourceMember = source.conversation.participants.some((p) => p.userId === meId)
    if (!isSourceMember) {
      // 403 (not 404) — we already know the message exists; we just refuse
      // to forward it to a non-participant. Use a generic message to avoid
      // confirming the message's existence to a non-member.
      return res.status(403).json({ error: 'Forbidden' })
    }

    const forwarded: any[] = []
    for (const targetId of targetConversationIds) {
      // Verify membership
      const conv = await prisma.conversation.findUnique({
        where: { id: targetId },
        include: { participants: { select: { userId: true } } },
      })
      if (!conv) continue
      const isMember = conv.participants.some((p) => p.userId === meId)
      if (!isMember) continue

      const msg = await prisma.message.create({
        data: {
          conversationId: targetId,
          senderId: meId,
          content: source.content,
          mediaUrl: source.mediaUrl,
          mediaType: source.mediaType,
          duration: source.duration,
          forwardedFromId: source.id,
        },
        include: {
          sender: { select: userSelect },
          forwardedFrom: { include: { sender: { select: userSelect } } },
        },
      })
      forwarded.push({ conversationId: targetId, message: serialiseMessage(msg, meId) })

      await prisma.conversation.update({
        where: { id: targetId },
        data: { updatedAt: new Date() },
      })
    }

    res.status(201).json({ forwarded })
  }),
)

// DELETE /api/chat/messages/:id?forEveryone=true|false
router.delete(
  '/messages/:id',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const meId = req.user!.id
    const forEveryone = req.query.forEveryone === 'true' || req.query.forEveryone === '1'

    const msg = await prisma.message.findUnique({
      where: { id: req.params.id },
      include: { conversation: { include: { participants: { select: { userId: true } } } } },
    })
    if (!msg) return res.status(404).json({ error: 'Message not found' })

    // Verify caller is a participant of the conversation
    const isMember = msg.conversation.participants.some((p) => p.userId === meId)
    if (!isMember) return res.status(403).json({ error: 'Forbidden' })

    const isOwner = msg.senderId === meId

    if (forEveryone) {
      // Only the owner can delete for everyone
      if (!isOwner) {
        return res.status(403).json({ error: 'Only the sender can delete a message for everyone' })
      }
      await prisma.message.update({
        where: { id: msg.id },
        data: {
          deletedForAll: true,
          content: null,
          mediaUrl: null,
          mediaType: null,
          duration: null,
        },
      })
      res.json({ ok: true, deletedForAll: true, messageId: msg.id, conversationId: msg.conversationId })
    } else {
      // Delete for me only — add meId to the deletedFor JSON array
      const deletedFor: string[] = (() => {
        try { return JSON.parse(msg.deletedFor || '[]') } catch { return [] }
      })()
      if (!deletedFor.includes(meId)) {
        deletedFor.push(meId)
        await prisma.message.update({
          where: { id: msg.id },
          data: { deletedFor: JSON.stringify(deletedFor) },
        })
      }
      res.json({ ok: true, deletedForMe: true, messageId: msg.id })
    }
  }),
)

// PATCH /api/chat/messages/:id/read
router.patch(
  '/messages/:id/read',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const meId = req.user!.id
    const msg = await prisma.message.findUnique({
      where: { id: req.params.id },
      include: { conversation: { include: { participants: { select: { userId: true } } } } },
    })
    if (!msg) return res.status(404).json({ error: 'Message not found' })
    const isMember = msg.conversation.participants.some((p) => p.userId === meId)
    if (!isMember) return res.status(403).json({ error: 'Forbidden' })
    await prisma.message.update({ where: { id: msg.id }, data: { isRead: true } })
    res.json({ ok: true })
  }),
)

// GET /api/chat/conversations/:id/context/:messageId — fetch a single message
// (used by the UI to scroll to a reply target that may be outside the loaded window)
router.get(
  '/conversations/:id/context/:messageId',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const meId = req.user!.id
    const conv = await prisma.conversation.findUnique({
      where: { id: req.params.id },
      include: { participants: { select: { userId: true } } },
    })
    if (!conv) return res.status(404).json({ error: 'Conversation not found' })
    const isMember = conv.participants.some((p) => p.userId === meId)
    if (!isMember) return res.status(403).json({ error: 'Forbidden' })

    const msg = await prisma.message.findUnique({
      where: { id: req.params.messageId },
      include: {
        sender: { select: userSelect },
        replyTo: { include: { sender: { select: userSelect } } },
        forwardedFrom: { include: { sender: { select: userSelect } } },
      },
    })
    if (!msg || msg.conversationId !== conv.id) {
      return res.status(404).json({ error: 'Message not found in this conversation' })
    }
    res.json({ message: serialiseMessage(msg, meId) })
  }),
)

function formatConversation(c: any, meId: string) {
  const others = c.participants
    .filter((p: any) => p.userId !== meId)
    .map((p: any) => p.user)
  const other = others[0]
  const lastMessage = c.messages?.[0]
  return {
    id: c.id,
    // 'direct' | 'support' — support conversations are pinned to the top
    // of the chat list and cannot be deleted by the user.
    type: c.type || 'direct',
    participant: other
      ? {
          id: other.id,
          username: other.username,
          displayName: other.displayName,
          avatar: other.avatar,
          isOnline: other.isOnline,
          lastSeen: other.lastSeen,
        }
      : null,
    participants: others.map((u: any) => ({
      id: u.id,
      username: u.username,
      displayName: u.displayName,
      avatar: u.avatar,
      isOnline: u.isOnline,
      lastSeen: u.lastSeen,
    })),
    lastMessage: lastMessage
      ? {
          id: lastMessage.id,
          content: lastMessage.deletedForAll ? null : lastMessage.content,
          mediaUrl: lastMessage.deletedForAll ? null : lastMessage.mediaUrl,
          mediaType: lastMessage.deletedForAll ? null : lastMessage.mediaType,
          createdAt: lastMessage.createdAt,
          senderId: lastMessage.senderId,
          deletedForAll: lastMessage.deletedForAll,
        }
      : null,
    updatedAt: c.updatedAt,
    createdAt: c.createdAt,
  }
}

// ============================================================================
// POST /api/chat/support — get-or-create a support conversation with the
// «Три девятки» team. This is a special endpoint that automatically picks an
// available admin (or a dedicated support account) and starts a 1-on-1
// conversation with them. The user does not need to know the admin's ID.
//
// Flow:
// 1. Find any admin (role='admin'). If multiple, pick the one with the
//    fewest active support conversations (load balancing).
// 2. Check if a conversation already exists between this user and that
//    admin — if so, return it.
// 3. Otherwise create a new conversation.
// 4. The conversation is marked as "support" via a special metadata flag
//    stored in the conversation's `updatedAt`? No — we'd need a new column.
//    Instead, we identify support conversations by the fact that one
//    participant is an admin. The frontend's SupportView filters by this.
// ============================================================================
router.post(
  '/support',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const meId = req.user!.id

    // If the user IS an admin, they don't get a support chat — they ARE
    // support. Return a 400 with a helpful message.
    if (req.user!.role === 'admin') {
      return res.status(400).json({ error: 'Администраторы не могут создавать тикеты поддержки. Используйте чат для общения с пользователями.' })
    }

    // Find an admin to assign as the support agent. Pick the one with the
    // fewest existing conversations (load balancing).
    // Phase 8.1: only assign active (non-deleted) admins.
    const admins = await prisma.user.findMany({
      where: { role: 'admin', deletedAt: null },
      select: {
        id: true,
        username: true,
        displayName: true,
        avatar: true,
        isOnline: true,
        _count: { select: { conversations: true } },
      },
    })

    if (admins.length === 0) {
      // No admin exists yet — return a friendly error. The first-run
      // admin wizard in Studio will create one.
      return res.status(503).json({
        error: 'Команда поддержки сейчас недоступна. Попробуйте позже или напишите на support@999.pro',
      })
    }

    // Pick the admin with the fewest conversations (load balancing).
    // Sort by _count.conversations ascending, then by isOnline (online first).
    admins.sort((a, b) => {
      const aCount = a._count.conversations
      const bCount = b._count.conversations
      if (aCount !== bCount) return aCount - bCount
      // Prefer online admins
      return (b.isOnline ? 1 : 0) - (a.isOnline ? 1 : 0)
    })
    const supportAdmin = admins[0]

    // Check if a conversation already exists between this user and the admin.
    const existingConversations = await prisma.conversation.findMany({
      where: { participants: { some: { userId: meId } } },
      include: { participants: { select: { userId: true } } },
      take: 200,
    })

    const existing = existingConversations.find(
      (c) =>
        c.participants.length === 2 &&
        c.participants.some((p) => p.userId === meId) &&
        c.participants.some((p) => p.userId === supportAdmin.id),
    )

    if (existing) {
      const fullConv = await prisma.conversation.findUnique({
        where: { id: existing.id },
        include: {
          participants: { include: { user: { select: userSelect } } },
          messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
      })
      return res.json({ conversation: formatConversation(fullConv, meId) })
    }

    // Create a new support conversation. The `type: 'support'` flag makes
    // this conversation pinned to the top of the user's chat list and
    // prevents the user from deleting it.
    const conv = await prisma.conversation.create({
      data: {
        type: 'support',
        participants: { create: [{ userId: meId }, { userId: supportAdmin.id }] },
      },
      include: {
        participants: { include: { user: { select: userSelect } } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    })

    // v25.3 (TZ task #3): automatic welcome message removed.
    //
    // Previously the backend created a "Здравствуйте! Я из команды поддержки…"
    // message on every new support conversation, which counted as a test /
    // demo message polluting the chat list. Per the technical spec, the chat
    // must open empty after launch — no demo / sample / placeholder messages
    // of any kind.
    //
    // The empty support conversation is returned as-is; the support view's
    // placeholder input ("Напишите сообщение…") makes the next step obvious
    // to the user.

    res.status(201).json({ conversation: formatConversation(conv, meId) })
  }),
)

export default router
