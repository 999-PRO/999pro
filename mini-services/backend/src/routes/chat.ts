import { Router } from 'express'
import { z } from 'zod'
import crypto from 'node:crypto'
import { prisma } from '../lib/prisma.js'
import { requireAuth, requireAdmin, requireAdminOnly, type AuthedRequest } from '../lib/auth.js'
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

    // v25.6 (chat sync fix): broadcast the new conversation to the OTHER
    // participant so their chat list updates in real-time. Previously, the
    // other user's socket was never joined to the new conversation's room
    // (auto-join only runs on socket connect), so when the creator sent the
    // first message, the broadcast missed the other participant entirely —
    // they only saw the message after refreshing (which re-runs auto-join).
    // Now we both join both participants' sockets to the room AND emit
    // 'conversation:created' so the client can prepend the conversation.
    try {
      const io = getIo()
      if (io) {
        // Join both participants' currently-connected sockets to the new room.
        io.in(`user:${meId}`).socketsJoin(`conversation:${conv.id}`)
        io.in(`user:${participantId}`).socketsJoin(`conversation:${conv.id}`)
        // Notify the other participant so their client adds the conversation.
        io.to(`user:${participantId}`).emit('conversation:created', {
          conversation: formatConversation(conv, participantId),
        })
      }
    } catch {
      // Non-critical — the conversation was created successfully, the
      // broadcast is best-effort.
    }

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
      //
      // v25.7 (TZ ЭТАП 2.1): admin-specific branch. A freshly-created admin
      // has zero ConversationParticipant rows, so the old code returned an
      // empty list — making the chat screen look "broken" right after login.
      // Admins need to discover users to start chats, so we return the most
      // recently active non-admin users. Privacy: admins are trusted to see
      // isOnline / lastSeen for everyone (matches the existing search branch).
      //
      // v25.9 fix: previously the admin-only "recent users" fallback fired
      // ONLY when `partnerIds.size === 0`. As soon as the admin had a single
      // conversation, the list collapsed to just existing partners — making
      // it impossible to discover new users from the contact list. Now admins
      // ALWAYS get recent users merged in (deduplicated against existing
      // partners), so the contact list is a useful "start new chat" surface.
      if (partnerIds.size === 0 && !isAdmin) {
        return res.json({ users: [], total: 0, limit, offset })
      }
      if (isAdmin) {
        // Always include the most recently active non-admin users so the
        // admin can start new chats without typing a search query.
        const recent = await prisma.user.findMany({
          where: { id: { not: meId }, deletedAt: null, role: 'user' },
          select: {
            id: true, username: true, displayName: true, avatar: true,
            isOnline: true, lastSeen: true, role: true,
          },
          orderBy: [{ isOnline: 'desc' }, { lastSeen: 'desc' }],
          take: 50,
        })
        // Merge: existing partners first, then recent users (deduped).
        const partnerList = [...partnerIds]
        const seen = new Set(partnerList)
        for (const u of recent) {
          if (!seen.has(u.id)) {
            partnerList.push(u.id)
            seen.add(u.id)
          }
        }
        where.id = { in: partnerList }
      } else {
        where.id = { in: [...partnerIds] }
      }
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
//
// v25.8 (TRI999 launch fix): rewrote the admin branch to use pure Prisma
// instead of $queryRaw. The previous raw SQL used UNQUOTED identifiers
// (`Conversation`, `Message`, `conversationId`, etc.) which PostgreSQL
// folds to lowercase — but Prisma creates these tables/columns as
// double-quoted camelCase. Result: `relation "conversation" does not exist`
// 500 error → admin could not load the chat list at all. Same fix applies
// to the count query below.
//
// Admin filter logic (preserved): hide "empty" support conversations —
// ones where no other participant has sent any message. This keeps the
// admin's chat list clean: they only see users who have actually engaged.
router.get(
  '/conversations',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const meId = req.user!.id
    const isAdmin = req.user!.role === 'admin' || req.user!.role === 'manager'
    const limit = Math.min(Math.max(Number(req.query.limit ?? 50) || 50, 1), 200)
    const offset = Math.max(Number(req.query.offset ?? 0) || 0, 0)

    if (isAdmin) {
      // Step 1: load ALL conversation IDs the admin participates in.
      const myParticipations = await prisma.conversationParticipant.findMany({
        where: { userId: meId },
        select: { conversationId: true },
      })
      const allConvIds = myParticipations.map((p) => p.conversationId)

      if (allConvIds.length === 0) {
        return res.json({ items: [], total: 0, limit, offset })
      }

      // Step 2: load conversations WITH their last message + participants.
      const allConvs = await prisma.conversation.findMany({
        where: { id: { in: allConvIds } },
        include: {
          participants: { include: { user: { select: userSelect } } },
          messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
      })

      // Step 3: apply the admin filter in JS.
      // v25.9 fix: Previously the admin's chat list HID support conversations
      // where no non-admin had yet sent a message. This meant admins literally
      // could not see incoming support requests until the user sent a message,
      // which made admin feel like a "second-class user" in chat. Now we
      // ALWAYS show support conversations — they may be empty (no messages
      // yet), but the admin needs to see them to be able to write first.
      // Direct conversations are always shown.
      const filtered = allConvs

      // v25.9: removed the emptySupportIds filter entirely — admins now see
      // every support conversation regardless of message count, matching the
      // user's explicit requirement that "admin must be able to use chat
      // just like a regular user".
      const finalFiltered = filtered

      // Step 5: sort — support first, then by updatedAt desc.
      finalFiltered.sort((a, b) => {
        // type 'support' > 'direct' (support pinned to top)
        const aType = a.type === 'support' ? 1 : 0
        const bType = b.type === 'support' ? 1 : 0
        if (aType !== bType) return bType - aType
        return b.updatedAt.getTime() - a.updatedAt.getTime()
      })

      const total = finalFiltered.length
      const paged = finalFiltered.slice(offset, offset + limit)
      const formattedConversations = paged.map((c) => formatConversation(c, meId))

      return res.json({
        items: formattedConversations,
        total,
        limit,
        offset,
      })
    }

    // Regular user branch — no filtering, just list their conversations.
    const conversations = await prisma.conversation.findMany({
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

    const total = await prisma.conversation.count({
      where: { participants: { some: { userId: meId } } },
    })

    res.json({
      items: conversations.map((c) => formatConversation(c, meId)),
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
    // v25.8 (TRI999 launch fix): replaced SQLite-only `json_array`/`json_each`/
    // `json_insert` raw SQL with pure Prisma + JS. The previous raw SQL worked
    // on SQLite but failed on PostgreSQL (those functions don't exist there).
    // Behaviour is identical: add meId to each message's `deletedFor` JSON
    // array (if not already present), then remove the caller from participants.
    await prisma.$transaction(async (tx) => {
      // Fetch all messages in this conversation that don't yet have meId in
      // their deletedFor array. We only need the id + deletedFor columns.
      const messages = await tx.message.findMany({
        where: { conversationId: conv.id },
        select: { id: true, deletedFor: true },
      })
      for (const m of messages) {
        let arr: string[] = []
        try {
          const parsed = JSON.parse(m.deletedFor || '[]')
          if (Array.isArray(parsed)) arr = parsed.filter((x) => typeof x === 'string')
        } catch {
          arr = []
        }
        if (!arr.includes(meId)) {
          arr.push(meId)
          await tx.message.update({
            where: { id: m.id },
            data: { deletedFor: JSON.stringify(arr) },
          })
        }
      }

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
// DELETE /api/chat/admin/conversations/:id — admin-only (requireAdminOnly)
// HARD delete of any conversation (including support chats).
// ----------------------------------------------------------------------------
// Unlike the user-facing DELETE /api/chat/conversations/:id (which only
// soft-deletes for the caller), this endpoint:
//   - Hard-deletes the conversation AND all its messages
//   - Removes ALL participant records (both sides)
//   - Works on ANY conversation type (direct, support)
//   - Requires admin role (requireAdminOnly)
//   - Records an audit log entry
//
// Use case: admin needs to clean up abusive/spam conversations, or remove
// a support chat after resolving a user's issue.
//
// v25.7 (TZ ЭТАП 2.6): requireAdminOnly (was requireAdmin) — this permanently
// deletes entire chat history. Could destroy evidence of misconduct
// (harassment, fraud, abuse between users) that an auditor or law
// enforcement might need later. Managers should not be able to wipe
// conversations; only a true admin can.
// ============================================================================
router.delete(
  '/admin/conversations/:id',
  requireAuth,
  requireAdminOnly,
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

// PATCH /api/chat/messages/:id — edit message content (v25.9)
// Allows the sender to edit their own text message within a 48-hour window.
// Mirrors the socket `message:edit` handler so REST clients (curl, mobile
// fallback, etc.) have the same capability as socket clients.
router.patch(
  '/messages/:id',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const meId = req.user!.id
    const content = typeof req.body?.content === 'string' ? req.body.content.trim() : ''
    if (!content) return res.status(400).json({ error: 'Content required' })
    if (content.length > 4000) return res.status(400).json({ error: 'Message too long' })
    const msg = await prisma.message.findUnique({
      where: { id: req.params.id },
      select: { id: true, senderId: true, conversationId: true, createdAt: true, deletedForAll: true },
    })
    if (!msg) return res.status(404).json({ error: 'Message not found' })
    if (msg.deletedForAll) return res.status(400).json({ error: 'Message deleted' })
    if (msg.senderId !== meId) return res.status(403).json({ error: 'Only sender can edit' })
    const ageMs = Date.now() - msg.createdAt.getTime()
    if (ageMs > 48 * 60 * 60 * 1000) return res.status(400).json({ error: 'Edit window expired' })
    // Verify participant (defence in depth — sender should always be a participant).
    const participation = await prisma.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId: msg.conversationId, userId: meId } },
      select: { id: true },
    })
    if (!participation) return res.status(403).json({ error: 'Forbidden' })
    const updated = await prisma.message.update({
      where: { id: msg.id },
      data: { content, editedAt: new Date() },
      include: {
        sender: { select: userSelect },
        replyTo: { include: { sender: { select: userSelect } } },
        forwardedFrom: { include: { sender: { select: userSelect } } },
      },
    })
    // Broadcast `message:edited` to all participants via socket.
    try {
      const { getIo } = await import('../socket/handlers.js')
      const io = getIo()
      if (io) {
        const { serialiseMessage } = await import('../lib/serialisers.js')
        const formatted = serialiseMessage(updated, '')
        io.to(`conversation:${msg.conversationId}`).emit('message:edited', formatted)
      }
    } catch { /* non-critical */ }
    res.json({ ok: true, message: updated })
  }),
)

// DELETE /api/chat/conversations/:id/messages — clear history (v25.9)
// Soft-deletes all messages in the conversation for the caller only (adds
// the caller's userId to each message's `deletedFor` JSON array). Other
// participants still see the messages. This matches the per-message
// "delete for me" semantics applied at scale.
router.delete(
  '/conversations/:id/messages',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const meId = req.user!.id
    const convId = req.params.id
    // Verify the caller is a participant.
    const participation = await prisma.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId: convId, userId: meId } },
      select: { id: true },
    })
    if (!participation) return res.status(403).json({ error: 'Forbidden' })
    // Fetch all messages in this conversation.
    const messages = await prisma.message.findMany({
      where: { conversationId: convId },
      select: { id: true, deletedFor: true },
    })
    // For each message, add the caller to deletedFor if not already there.
    // This is O(N) but conversations are bounded (capped at 1000 messages
    // by the UI's pagination). For very large conversations a batch UPDATE
    // would be more efficient, but Prisma doesn't support JSON array append
    // in updateMany — we'd have to drop to raw SQL.
    for (const m of messages) {
      let arr: string[] = []
      try { arr = JSON.parse(m.deletedFor || '[]') } catch { arr = [] }
      if (!arr.includes(meId)) {
        arr.push(meId)
        await prisma.message.update({
          where: { id: m.id },
          data: { deletedFor: JSON.stringify(arr) },
        })
      }
    }
    res.json({ ok: true, cleared: messages.length })
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

    // If the user IS an admin or manager, they don't get a support chat —
    // they ARE support. Return a 400 with a helpful message.
    if (req.user!.role === 'admin' || req.user!.role === 'manager') {
      return res.status(400).json({ error: 'Администраторы и менеджеры не могут создавать тикеты поддержки. Используйте чат для общения с пользователями.' })
    }

    // v25.8 (TRI999 launch): respect the chat visibility setting.
    // If visibility is 'none', no support chat is created.
    const visibility = await getChatVisibility()
    if (visibility === 'none') {
      return res.status(403).json({
        error: 'Поддержка через чат сейчас отключена. Свяжитесь другим способом.',
      })
    }

    // Build role filter based on visibility.
    const roles: string[] = []
    if (visibility === 'admin') roles.push('admin')
    else if (visibility === 'manager') roles.push('manager')
    else if (visibility === 'both') roles.push('admin', 'manager')

    // Find a staff member to assign as the support agent. Pick the one with the
    // fewest existing conversations (load balancing).
    // Phase 8.1: only assign active (non-deleted) staff.
    const staff = await prisma.user.findMany({
      where: { role: { in: roles }, deletedAt: null },
      select: {
        id: true,
        username: true,
        displayName: true,
        avatar: true,
        isOnline: true,
        _count: { select: { conversations: true } },
      },
    })

    if (staff.length === 0) {
      // No matching staff exists — return a friendly error.
      return res.status(503).json({
        error: 'Команда поддержки сейчас недоступна. Попробуйте позже.',
      })
    }

    // Pick the staff with the fewest conversations (load balancing).
    // Sort by _count.conversations ascending, then by isOnline (online first).
    staff.sort((a, b) => {
      const aCount = a._count.conversations
      const bCount = b._count.conversations
      if (aCount !== bCount) return aCount - bCount
      // Prefer online staff
      return (b.isOnline ? 1 : 0) - (a.isOnline ? 1 : 0)
    })
    const supportStaff = staff[0]

    // Check if a conversation already exists between this user and the staff.
    // v25.8: deduplication — never create a duplicate support conversation
    // if one already exists with ANY staff member (not just the picked one).
    // This prevents the "duplicate chat on every page reload" bug.
    const existingConversations = await prisma.conversation.findMany({
      where: {
        type: 'support',
        participants: { some: { userId: meId } },
      },
      include: { participants: { select: { userId: true } } },
      take: 50,
    })

    // If a support conversation already exists with any staff member, return it.
    if (existingConversations.length > 0) {
      const existing = existingConversations[0]
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
        participants: { create: [{ userId: meId }, { userId: supportStaff.id }] },
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
// v25.8 (TRI999 launch): Chat visibility setting.
// ----------------------------------------------------------------------------
// The Studio operator can configure WHO is available to clients in the chat:
//   'admin'    — only admin support chats are visible to clients
//   'manager'  — only manager support chats are visible to clients
//   'both'     — both admin and manager are visible
//   'none'     — clients see no official support contacts (no auto-created chats)
//
// Stored as a single AppSetting row (id='chat:visibility'). Defaults to 'admin'.
// Used by:
//   - POST /api/chat/support — picks an admin and/or manager based on this setting
//   - GET /api/chat/contacts — returns the list of visible support contacts
//   - Frontend chat views — show only the configured contacts
// ============================================================================

const CHAT_VISIBILITY_DEFAULT = 'admin'
const CHAT_VISIBILITY_VALID = ['admin', 'manager', 'both', 'none'] as const
type ChatVisibility = (typeof CHAT_VISIBILITY_VALID)[number]

async function getChatVisibility(): Promise<ChatVisibility> {
  const row = await prisma.appSetting.findUnique({ where: { id: 'chat:visibility' } })
  if (!row) return CHAT_VISIBILITY_DEFAULT
  try {
    const parsed = JSON.parse(row.value)
    if (typeof parsed === 'string' && (CHAT_VISIBILITY_VALID as readonly string[]).includes(parsed)) {
      return parsed as ChatVisibility
    }
  } catch {
    // fall through to default
  }
  return CHAT_VISIBILITY_DEFAULT
}

async function setChatVisibility(v: ChatVisibility): Promise<void> {
  await prisma.appSetting.upsert({
    where: { id: 'chat:visibility' },
    update: { value: JSON.stringify(v) },
    create: { id: 'chat:visibility', value: JSON.stringify(v) },
  })
}

// GET /api/chat/visibility — public (any authenticated user).
// Returns the current chat visibility setting.
router.get(
  '/visibility',
  requireAuth,
  asyncHandler(async (_req: AuthedRequest, res) => {
    const visibility = await getChatVisibility()
    res.json({ visibility })
  }),
)

// PATCH /api/chat/visibility — admin only.
// Updates the chat visibility setting.
const visibilitySchema = z.object({
  visibility: z.enum(CHAT_VISIBILITY_VALID),
})
router.patch(
  '/visibility',
  requireAuth,
  requireAdminOnly,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = visibilitySchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid_request', details: parsed.error.flatten() })
    }
    await setChatVisibility(parsed.data.visibility)
    await auditLogRaw(req.user!.id, req, 'chat', 'chat:visibility', 'update', {
      after: { visibility: parsed.data.visibility },
    })
    res.json({ ok: true, visibility: parsed.data.visibility })
  }),
)

// GET /api/chat/contacts — returns the list of "official" support contacts
// visible to the current user based on the chat visibility setting.
// Used by the frontend to render the chat list's "pinned" contacts section.
//
// For admins/managers, returns an empty list (they ARE the support team).
// For regular users, returns admins and/or managers per the visibility setting.
router.get(
  '/contacts',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const meId = req.user!.id
    const myRole = req.user!.role

    // Admins and managers don't get a "contacts" list — they ARE the support.
    if (myRole === 'admin' || myRole === 'manager') {
      return res.json({ contacts: [] })
    }

    const visibility = await getChatVisibility()
    if (visibility === 'none') {
      return res.json({ contacts: [] })
    }

    // Build role filter based on visibility setting.
    const roles: string[] = []
    if (visibility === 'admin') roles.push('admin')
    else if (visibility === 'manager') roles.push('manager')
    else if (visibility === 'both') roles.push('admin', 'manager')

    const staff = await prisma.user.findMany({
      where: { role: { in: roles }, deletedAt: null },
      select: {
        id: true,
        username: true,
        displayName: true,
        avatar: true,
        isOnline: true,
        lastSeen: true,
        role: true,
      },
      orderBy: [{ isOnline: 'desc' }, { lastSeen: 'desc' }],
    })

    // For each staff member, check if the user already has a conversation with them.
    const myConvPartners = await prisma.conversationParticipant.findMany({
      where: { userId: meId },
      select: {
        conversationId: true,
        conversation: {
          select: {
            type: true,
            participants: { select: { userId: true } },
          },
        },
      },
    })
    const partnerConvMap = new Map<string, { conversationId: string; type: string }>()
    for (const cp of myConvPartners) {
      const other = cp.conversation.participants.find((p) => p.userId !== meId)
      if (other) {
        partnerConvMap.set(other.userId, {
          conversationId: cp.conversationId,
          type: cp.conversation.type,
        })
      }
    }

    const contacts = staff.map((u) => {
      const conv = partnerConvMap.get(u.id)
      return {
        id: u.id,
        username: u.username,
        displayName: u.displayName,
        avatar: u.avatar,
        isOnline: u.isOnline,
        lastSeen: u.lastSeen,
        role: u.role,
        isSupport: true,
        hasConversation: !!conv,
        conversationId: conv?.conversationId || null,
        conversationType: conv?.type || null,
      }
    })

    res.json({ contacts, visibility })
  }),
)

// POST /api/chat/cleanup-test-data — admin only (requireAdminOnly).
// Removes test/demo conversations and messages from the database.
// Criteria for "test" data:
//   - Conversations where ANY participant's username/email matches test patterns
//     (starts with "test", "demo", "example", or contains "тест", "демо").
//   - Messages from users whose username matches test patterns.
//   - Empty support conversations with no messages at all.
// Real client conversations are preserved.
router.post(
  '/cleanup-test-data',
  requireAuth,
  requireAdminOnly,
  asyncHandler(async (req: AuthedRequest, res) => {
    const TEST_PATTERNS = [
      /^test/i, /^demo/i, /^example/i, /^тест/i, /^демо/i,
      /test/i, /demo/i, /тест/i, /демо/i,
    ]
    function isTestIdentifier(s: string | null | undefined): boolean {
      if (!s) return false
      return TEST_PATTERNS.some((re) => re.test(s))
    }

    // 1. Find all users whose username/email matches test patterns.
    const testUsers = await prisma.user.findMany({
      where: {
        OR: [
          { username: { contains: 'test' } },
          { username: { contains: 'demo' } },
          { username: { contains: 'тест' } },
          { username: { contains: 'демо' } },
          { email: { contains: 'test' } },
          { email: { contains: 'example.com' } },
          { email: { contains: 'demo' } },
          { email: { contains: 'тест' } },
          { email: { contains: 'демо' } },
        ],
      },
      select: { id: true, username: true, email: true, createdAt: true },
    })
    // Also JS-filter for case-insensitive patterns (Cyrillic).
    const testUserIds = new Set(
      testUsers
        .filter((u) => isTestIdentifier(u.username) || isTestIdentifier(u.email))
        .map((u) => u.id)
    )

    // 2. Find conversations involving test users.
    const testConvParticipants = await prisma.conversationParticipant.findMany({
      where: { userId: { in: Array.from(testUserIds) } },
      select: { conversationId: true },
    })
    const testConvIds = new Set(testConvParticipants.map((p) => p.conversationId))

    // 3. Also find empty support conversations (no messages at all).
    const allSupportConvs = await prisma.conversation.findMany({
      where: { type: 'support' },
      select: {
        id: true,
        _count: { select: { messages: true } },
      },
    })
    for (const c of allSupportConvs) {
      if (c._count.messages === 0) testConvIds.add(c.id)
    }

    // 4. Hard-delete test conversations and their messages + participant rows.
    const convIdList = Array.from(testConvIds)
    let deletedMessages = 0
    let deletedConversations = 0
    if (convIdList.length > 0) {
      const msgResult = await prisma.message.deleteMany({
        where: { conversationId: { in: convIdList } },
      })
      deletedMessages = msgResult.count
      await prisma.conversationParticipant.deleteMany({
        where: { conversationId: { in: convIdList } },
      })
      const convResult = await prisma.conversation.deleteMany({
        where: { id: { in: convIdList } },
      })
      deletedConversations = convResult.count
    }

    // 5. Soft-delete test user accounts (anonymize PII, kick sessions).
    let deletedUsers = 0
    if (testUserIds.size > 0) {
      for (const userId of testUserIds) {
        const { hashPassword } = await import('../lib/auth.js')
        const { kickUserSockets } = await import('../socket/handlers.js')
        await prisma.user.update({
          where: { id: userId },
          data: {
            email: `deleted-${userId}@deleted.local`,
            phone: `deleted-${userId}`,
            username: `deleted-${userId}`,
            displayName: 'Deleted user',
            avatar: null,
            bio: null,
            password: await hashPassword(
              crypto.randomUUID() + crypto.randomUUID(),
            ),
            deletedAt: new Date(),
            tokenVersion: { increment: 1 },
            isOnline: false,
          },
        })
        try { kickUserSockets(userId) } catch { /* non-critical */ }
        deletedUsers++
      }
    }

    await auditLogRaw(req.user!.id, req, 'chat', 'chat:cleanup', 'cleanup_test_data', {
      after: {
        deletedConversations,
        deletedMessages,
        deletedUsers,
        convIds: convIdList,
      },
    })

    res.json({
      ok: true,
      deletedConversations,
      deletedMessages,
      deletedUsers,
    })
  }),
)

// ============================================================================
// GET /api/chat/admin/all-conversations — admin/manager only.
// Returns ALL conversations in the system (regardless of admin's participation)
// for the Studio chat-moderation view. Used to find abusive chats, help users, etc.
// ============================================================================
router.get(
  '/admin/all-conversations',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: AuthedRequest, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit ?? 100) || 100, 1), 500)
    const offset = Math.max(Number(req.query.offset ?? 0) || 0, 0)
    const search = (req.query.q as string | undefined)?.trim()

    const where: any = {}
    if (search) {
      // Search by participant username/displayName.
      where.participants = {
        some: {
          user: {
            OR: [
              { username: { contains: search } },
              { displayName: { contains: search } },
            ],
          },
        },
      }
    }

    const [conversations, total] = await Promise.all([
      prisma.conversation.findMany({
        where,
        include: {
          participants: { include: { user: { select: userSelect } } },
          messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
        orderBy: [{ type: 'desc' }, { updatedAt: 'desc' }],
        take: limit,
        skip: offset,
      }),
      prisma.conversation.count({ where }),
    ])

    res.json({
      items: conversations.map((c) => formatConversation(c, req.user!.id)),
      total,
      limit,
      offset,
    })
  }),
)

export default router
