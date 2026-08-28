import type { Server as IoServer, Socket } from 'socket.io'
import { prisma } from '../lib/prisma.js'
import { verifyToken, getCachedAuth, setCachedAuth, type JwtPayload } from '../lib/auth.js'
import { sendMessageSchema } from '../lib/schemas.js'
import { serialiseMessage as serialiseMessageShared, buildMessagePreview, USER_PUBLIC_SELECT } from '../lib/serialisers.js'
import { sendPushToUser } from '../routes/push.js'
import { moderateContent } from '../lib/moderation.js'

// Maps: socketId -> { userId, username }, userId -> Set<socketId>
const socketToUser = new Map<string, { userId: string; username: string }>()
const userSockets = new Map<string, Set<string>>()

// Typing-indicator TTL timers. Keyed by `${conversationId}:${userId}` so a
// user typing in conversation A doesn't accidentally clear their timer in
// conversation B. Entries are added on `typing:start` and cleared either by
// an explicit `typing:stop` from the client OR by the 5-second auto-expiry
// (which itself broadcasts `typing:stop` so other participants see the
// indicator disappear). Timers call `.unref()` so they don't block process
// shutdown.
const typingTimers = new Map<string, NodeJS.Timeout>()

// ============================================================================
// Exported helpers — used by REST route handlers to mirror socket behavior.
// Without these, REST-sent messages (e.g. POST /api/chat/conversations/:id/messages)
// would NOT trigger push notifications for offline recipients, breaking the
// "notify when app is closed" feature.
// ============================================================================

/** Returns true if the user has at least one active socket connection. */
export function isUserOnline(userId: string): boolean {
  const sockets = userSockets.get(userId)
  return !!sockets && sockets.size > 0
}

/**
 * Send a Web Push notification to ALL participants of a conversation
 * (except the sender).
 *
 * v24.5 BUGFIX: Previously only sent push to OFFLINE participants (those
 * with no active socket connections). But "online" (socket connected) does
 * NOT mean "looking at the app" — the tab could be in the background. In
 * that case the user got the real-time socket message but NO system
 * notification, so they missed messages when the tab was minimized.
 *
 * Now: send push to ALL participants. The Service Worker decides:
 *   • If the app tab is VISIBLE → suppress the system notification (forward
 *     to the page for in-app toast)
 *   • If the app tab is HIDDEN or CLOSED → show a system notification
 *
 * This ensures the user ALWAYS gets notified, whether the app is open,
 * minimized, or fully closed.
 *
 * Called from BOTH the socket message:send handler AND the REST POST
 * /api/chat/conversations/:id/messages endpoint so the notification policy
 * is consistent regardless of how the message was sent.
 */
export async function notifyOfflineParticipants(
  conversationId: string,
  senderId: string,
  message: { id?: string; content?: string | null; mediaType?: string | null; attachments?: any[] | null; sender?: { displayName?: string | null; username?: string } | null },
): Promise<void> {
  try {
    const participants = await prisma.conversationParticipant.findMany({
      where: { conversationId, userId: { not: senderId } },
      select: { userId: true },
    })

    // v24.5: send push to ALL participants (not just offline).
    // The SW handles suppression when the app is visible.
    const recipientIds = participants.map((p) => p.userId)

    if (recipientIds.length === 0) return

    const senderName = message.sender?.displayName || message.sender?.username || 'Пользователь'
    // v12: use shared buildMessagePreview which handles attachments
    const body = buildMessagePreview({
      content: message.content,
      mediaType: message.mediaType,
      attachments: message.attachments,
    })

    // UNIQUE TAG PER MESSAGE — previously used `msg-${conversationId}` which
    // caused the OS to replace previous notifications from the same
    // conversation. A user receiving 5 rapid messages only saw the last
    // one. Now each message has its own tag (`msg-${conversationId}-${messageId}`)
    // and renotify:true so each one alerts the user. The OS shade groups
    // them by conversation automatically.
    const messageId = message.id || `${Date.now()}`
    const tag = `msg-${conversationId}-${messageId}`

    for (const recipientId of recipientIds) {
      void sendPushToUser(recipientId, {
        title: senderName,
        body,
        tag,
        url: '/?view=chat',
        data: { conversationId, messageId },
        renotify: true,
      }).catch((e) => {
        // Log push failures so we can diagnose "user didn't get notified" issues.
        // Previously this was silently swallowed — made debugging impossible.
        console.error('[PUSH] notifyOfflineParticipants: sendPushToUser failed for', recipientId, e instanceof Error ? e.message : e)
      })
    }
  } catch (e) {
    // Push is best-effort — never fail the message send because of a push error.
    // But log it so we can diagnose "user didn't get notified" issues.
    console.error('[PUSH] notifyOfflineParticipants error:', e instanceof Error ? e.message : e)
  }
}

// ============================================================================
//  Lead status push notification
// ============================================================================
//  When an admin changes a lead's status, the linked user (if any) should
//  receive a Web Push notification IF they have no active socket connection
//  (app closed / backgrounded). Online users get the status change in
//  real-time via the `lead:status-changed` socket event.
//
//  This mirrors the chat notification policy: push = offline fallback only.
// ============================================================================
const LEAD_STATUS_LABELS: Record<string, string> = {
  new: 'Новая заявка',
  processing: 'В обработке',
  working: 'В работе',
  done: 'Выполнена',
  cancelled: 'Отменена',
}

export async function sendLeadStatusPush(userId: string, lead: { id: string; status: string; productTitle?: string | null }): Promise<void> {
  // Online users get the real-time socket event — skip push to avoid double notifications.
  if (isUserOnline(userId)) return
  const statusLabel = LEAD_STATUS_LABELS[lead.status] || lead.status
  const product = lead.productTitle ? ` «${lead.productTitle}»` : ''
  void sendPushToUser(userId, {
    title: 'Заявка обновлена',
    body: `Статус заявки${product}: ${statusLabel}`,
    tag: `lead-${lead.id}`,
    url: '/?view=orders',
    data: { leadId: lead.id, status: lead.status },
  })
}

// v13.3 (audit dedup): use shared USER_PUBLIC_SELECT from lib/serialisers.
const userSelect = USER_PUBLIC_SELECT

async function tryAuth(socket: Socket): Promise<{ userId: string; username: string } | null> {
  const token =
    (socket.handshake.auth?.token as string | undefined) ||
    (socket.handshake.headers.authorization?.replace(/^Bearer\s+/i, '') as string | undefined)
  if (!token) return null
  try {
    const decoded: JwtPayload = verifyToken(token)
    // B-HIGH-008: short-circuit the DB lookup when the user's auth entry is
    // already cached by a recent REST request. Without this, every socket
    // connect (initial, reconnect, multiple tabs, mobile background→foreground
    // transitions) triggered a `prisma.user.findUnique` — under load this
    // produced thousands of identical queries per second on the same user ids
    // that had JUST been validated by requireAuth on the bootstrap HTTP
    // request. The cache invalidates automatically on token-version bump
    // (getCachedAuth compares v and deletes on mismatch).
    const cached = getCachedAuth(decoded.sub, decoded.v)
    if (cached) {
      // v25.6 (auth security fix): re-check emailVerified + lockedUntil on cache HIT.
      // Previously the socket layer accepted any cached entry, allowing unverified
      // users to connect and use socket events (chat, typing, calls) even when
      // EMAIL_VERIFICATION_REQUIRED=true.
      if (cached.lockedUntil && cached.lockedUntil.getTime() > Date.now()) return null
      if (!cached.emailVerified) {
        const securitySettings = await prisma.securitySettings.findUnique({ where: { id: 'default' } })
        const emailVerificationRequired =
          securitySettings?.emailVerificationRequired ??
          process.env.EMAIL_VERIFICATION_REQUIRED === 'true'
        if (emailVerificationRequired) return null
      }
      return { userId: decoded.sub, username: decoded.username }
    }
    // Cache miss — fall through to DB lookup, then populate the cache so the
    // NEXT socket connect (and any REST request) hits the cache.
    const user = await prisma.user.findUnique({
      where: { id: decoded.sub },
      // v25.6: select emailVerified + lockedUntil so we can check them here
      // AND cache them for future cache-HIT checks.
      select: { tokenVersion: true, deletedAt: true, role: true, emailVerified: true, lockedUntil: true },
    })
    if (!user || user.deletedAt) return null
    if (user.tokenVersion !== decoded.v) return null
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) return null
    // v25.6: enforce email verification on socket connect too
    if (!user.emailVerified) {
      const securitySettings = await prisma.securitySettings.findUnique({ where: { id: 'default' } })
      const emailVerificationRequired =
        securitySettings?.emailVerificationRequired ??
        process.env.EMAIL_VERIFICATION_REQUIRED === 'true'
      if (emailVerificationRequired) return null
    }
    setCachedAuth(decoded.sub, {
      v: user.tokenVersion,
      role: user.role as 'user' | 'admin',
      expires: Date.now() + 60_000,
      emailVerified: user.emailVerified,
      lockedUntil: user.lockedUntil,
    })
    return { userId: decoded.sub, username: decoded.username }
  } catch {
    return null
  }
}

/**
 * Per-socket rate limiter — token bucket per event name.
 * Limits how fast a single client can emit any given event.
 *
 * Without this, a single malicious user can flood message:send or
 * typing:start at thousands of events per second, each triggering a DB
 * write + push dispatch + room broadcast.
 */
interface RateBucket { tokens: number; lastRefill: number }
const RATE_LIMITS: Record<string, { capacity: number; refillPerSec: number }> = {
  'message:send': { capacity: 8, refillPerSec: 2 }, // 8 burst, then 2/sec
  'message:forward': { capacity: 5, refillPerSec: 1 },
  'typing:start': { capacity: 5, refillPerSec: 2 },
  'message:read': { capacity: 20, refillPerSec: 5 },
  'conversation:join': { capacity: 30, refillPerSec: 10 },
}

/**
 * Force-disconnect every socket owned by `userId`. Call this when the
 * user's tokenVersion is bumped (password change, role demotion, remote
 * logout) so that they have to re-authenticate to keep using real-time
 * channels.
 *
 * IMPORTANT: We do NOT clear `userSockets.get(userId)` here. The disconnect
 * is async — the socket's `disconnect` event fires later, and the
 * `disconnect` handler (below) is what cleans up `sockets.delete(socket.id)`
 * + calls `setUserOffline` when the set becomes empty. If we cleared here,
 * the disconnect handler would find an empty Set / undefined map and skip
 * the offline transition — leaving isOnline=true in the DB forever.
 */
export function kickUserSockets(userId: string) {
  const sockets = userSockets.get(userId)
  if (!sockets) return
  // Snapshot to array so we don't mutate during iteration.
  const snapshot = Array.from(sockets)
  for (const socketId of snapshot) {
    const socket = ioInstance?.sockets.sockets.get(socketId)
    if (socket) socket.disconnect(true)
  }
}

function rateLimit(socket: Socket, event: string): boolean {
  // H4 fix: FAIL-CLOSED для unmapped events. Раньше возвращалось `true`
  // (разрешить), что означало: любое новое событие, добавленное без записи в
  // RATE_LIMITS, полностью обходило лимитирование (DoS-поверхность). Теперь
  // применяем консервативный default-лимит (1 запрос в секунду, burst 3) —
  // достаточно для легитимных редких событий, но блокирует flood.
  const cfg = RATE_LIMITS[event] ?? { capacity: 3, refillPerSec: 1 }
  const map = (socket.data.rateBuckets ??= new Map<string, RateBucket>()) as Map<string, RateBucket>
  let bucket = map.get(event)
  const now = Date.now()
  if (!bucket) {
    bucket = { tokens: cfg.capacity, lastRefill: now }
    map.set(event, bucket)
  } else {
    const elapsed = (now - bucket.lastRefill) / 1000
    bucket.tokens = Math.min(cfg.capacity, bucket.tokens + elapsed * cfg.refillPerSec)
    bucket.lastRefill = now
  }
  if (bucket.tokens < 1) return false
  bucket.tokens -= 1
  return true
}

async function setUserOnline(userId: string) {
  await prisma.user
    .update({ where: { id: userId }, data: { isOnline: true, lastSeen: new Date() } })
    .catch(() => {})
}

async function setUserOffline(userId: string) {
  const sockets = userSockets.get(userId)
  if (sockets && sockets.size > 0) return
  await prisma.user
    .update({ where: { id: userId }, data: { isOnline: false, lastSeen: new Date() } })
    .catch(() => {})
}

async function isParticipant(conversationId: string, userId: string): Promise<boolean> {
  const p = await prisma.conversationParticipant.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
    select: { id: true },
  })
  return Boolean(p)
}

// Serialise a message for socket broadcast (same shape as REST)
// DE DUPLICATED: previously a 60-line copy lived here alongside the one in
// routes/chat.ts. Now both import from lib/serialisers.ts — single source
// of truth. We keep the local wrapper for backwards compatibility with the
// existing call sites inside this file (socket broadcasts include a tempId
// field that REST responses don't have).
function serialiseMessage(m: any, viewerId: string) {
  const out = serialiseMessageShared(m, viewerId)
  // Socket broadcasts include a tempId field (always undefined for server-
  // sent messages — only client-sent optimistic messages have one).
  return { ...out, tempId: undefined }
}

// Send an event to all of a user's connected sockets (multi-tab support)
function emitToUserSockets(io: IoServer, userId: string, event: string, payload: any) {
  const sockets = userSockets.get(userId)
  if (!sockets) return
  for (const socketId of sockets) {
    io.to(socketId).emit(event, payload)
  }
}

// Singleton reference to the Socket.IO server, set by registerChatHandlers.
// This allows REST route handlers (e.g. POST /api/chat/conversations/:id/messages)
// to broadcast `message:received` events so messages sent via REST API reach
// all connected clients in real-time — not just those sent via socket emit.
let ioInstance: IoServer | null = null

export function getIo(): IoServer | null {
  return ioInstance
}

export function registerChatHandlers(io: IoServer) {
  ioInstance = io
  io.use(async (socket, next) => {
    const auth = await tryAuth(socket)
    if (!auth) return next(new Error('Unauthorized'))
    ;(socket.data as any).auth = auth
    next()
  })

  io.on('connection', async (socket: Socket) => {
    const auth = (socket.data as any).auth as { userId: string; username: string }
    if (!auth) {
      socket.disconnect(true)
      return
    }

    const { userId, username } = auth

    // SECURITY: cap concurrent sockets per user to prevent DoS. A malicious
    // or buggy client can otherwise open thousands of sockets per second,
    // each triggering setUserOnline + presence broadcast + auto-join loop.
    // 10 is enough for any legitimate use (multiple tabs + multiple devices).
    const MAX_SOCKETS_PER_USER = 10
    const existingSockets = userSockets.get(userId)
    if (existingSockets && existingSockets.size >= MAX_SOCKETS_PER_USER) {
      console.warn(`[SOCKET] Rejecting socket for ${username}: ${existingSockets.size} sockets already open (cap=${MAX_SOCKETS_PER_USER})`)
      socket.emit('error', { message: 'Too many concurrent connections' })
      socket.disconnect(true)
      return
    }

    socketToUser.set(socket.id, { userId, username })
    let sockets = userSockets.get(userId)
    if (!sockets) {
      sockets = new Set()
      userSockets.set(userId, sockets)
    }
    sockets.add(socket.id)
    void setUserOnline(userId)
    void broadcastPresenceToPartners(io, userId, 'user:online', { userId, username })

    // ========================================================================
    // PERSONAL + ADMIN ROOMS
    // Every socket joins `user:<userId>` so we can target events (like
    // lead:status-changed) directly at the user regardless of which
    // conversation they're viewing. If the user is an admin, they also
    // join the `admins` room — used for admin-wide broadcasts such as
    // lead status updates visible to all admin studios.
    // ========================================================================
    socket.join(`user:${userId}`)
    try {
      const u = await prisma.user.findUnique({
        where: { id: userId },
        select: { role: true },
      })
      if (u?.role === 'admin') {
        socket.join('admins')
      }
    } catch {
      /* non-critical */
    }

    // ========================================================================
    // AUTO-JOIN all of the user's conversations.
    // This is the critical fix: previously the frontend only joined a room
    // when the user opened a specific conversation. That meant messages in
    // other conversations were NEVER delivered to the user when they were
    // not viewing that chat (or were elsewhere in the app). Now the server
    // joins every connected socket to every conversation the user is a
    // participant of, so `message:received` broadcasts reach them no matter
    // which view they're on. The client-side `conversation:join` is kept as
    // a no-op compatibility shim.
    //
    // v13.1 (audit P1-12 fix): emit a 'ready' event after the auto-join
    // completes so the client can wait for it before sending messages.
    // Previously the IIFE was fire-and-forget — between socket connection
    // and the IIFE completing, any `message:received` broadcast to a
    // conversation room would NOT reach this socket. The client doesn't
    // strictly need to wait on 'ready' (older clients still work), but
    // new clients CAN wait to guarantee delivery.
    ;(async () => {
      try {
        const participations = await prisma.conversationParticipant.findMany({
          where: { userId },
          select: { conversationId: true },
        })
        for (const p of participations) {
          socket.join(`conversation:${p.conversationId}`)
        }
        socket.data.ready = true
        socket.emit('ready', { userId })
      } catch (e) {
        console.error('[SOCKET] auto-join conversations error:', e)
      }
    })()

    // ====== Conversation room management (kept for backwards compat) ======
    socket.on('conversation:join', async (conversationId: string) => {
      try {
        if (!conversationId || typeof conversationId !== 'string') return
        const ok = await isParticipant(conversationId, userId)
        if (!ok) {
          socket.emit('error', { event: 'conversation:join', error: 'Not a participant' })
          return
        }
        socket.join(`conversation:${conversationId}`)
      } catch (e) {
        socket.emit('error', { event: 'conversation:join', error: 'Internal error' })
      }
    })

    // conversation:leave is now a NO-OP — the server auto-joins every
    // socket to every conversation the user is a participant of. Leaving a
    // room would silently break `message:received` delivery for that
    // conversation, killing in-app toast notifications, unread-badge
    // increments, and chat-list preview refreshes for any conversation
    // the user has ever opened. Per-conversation filtering is done
    // client-side in chat.tsx.
    //
    // The handler is kept (not deleted) so legacy clients that still emit
    // the event don't get an "unknown event" warning in the socket.io logs.
    socket.on('conversation:leave', (_conversationId: string) => {
      // intentionally no-op
    })

    // ====== Typing indicators ======
    // Server-side TTL: if a client sends `typing:start` and then crashes /
    // closes the tab before sending `typing:stop`, other participants would
    // see a permanent "печатает…" indicator. We arm a 5-second timer on each
    // `typing:start` — if the client doesn't refresh or explicitly stop, we
    // auto-broadcast `typing:stop` to the room.
    // Map keyed by `${conversationId}:${userId}` so multiple conversations
    // from the same user (impossible in 1:1, but possible in group) don't
    // collide. `timer.unref()` prevents the timer from keeping the event
    // loop alive on shutdown.
    const typingTimerKey = (conversationId: string) => `${conversationId}:${userId}`
    const clearTypingTimer = (conversationId: string) => {
      const t = typingTimers.get(typingTimerKey(conversationId))
      if (t) {
        clearTimeout(t)
        typingTimers.delete(typingTimerKey(conversationId))
      }
    }

    socket.on('typing:start', async ({ conversationId }: { conversationId: string }) => {
      try {
        if (!conversationId) return
        if (!rateLimit(socket, 'typing:start')) return
        if (!(await isParticipant(conversationId, userId))) return
        socket.to(`conversation:${conversationId}`).emit('typing:start', { conversationId, userId, username })

        // (Re)arm the TTL timer. If an existing timer is already running
        // (client refreshed `typing:start`), clear it first to extend the
        // window.
        clearTypingTimer(conversationId)
        const timer = setTimeout(() => {
          socket.to(`conversation:${conversationId}`).emit('typing:stop', { conversationId, userId })
          typingTimers.delete(typingTimerKey(conversationId))
        }, 5000)
        timer.unref?.()
        typingTimers.set(typingTimerKey(conversationId), timer)
      } catch {}
    })

    socket.on('typing:stop', async ({ conversationId }: { conversationId: string }) => {
      try {
        if (!conversationId) return
        if (!(await isParticipant(conversationId, userId))) return
        socket.to(`conversation:${conversationId}`).emit('typing:stop', { conversationId, userId })
        clearTypingTimer(conversationId)
      } catch {}
    })

    // ====== Voice recording indicators (v9-voice) ======
    // When a user starts recording a voice message, broadcast to the room
    // so other participants see "username записывает голосовое сообщение…"
    // Same pattern as typing:start/stop — no persistence, no DB writes.
    socket.on('voice:recording:start', async ({ conversationId }: { conversationId: string }) => {
      try {
        if (!conversationId) return
        if (!rateLimit(socket, 'typing:start')) return // reuse typing rate limit
        if (!(await isParticipant(conversationId, userId))) return
        socket.to(`conversation:${conversationId}`).emit('voice:recording:start', { conversationId, userId, username })
      } catch {}
    })

    socket.on('voice:recording:stop', async ({ conversationId }: { conversationId: string }) => {
      try {
        if (!conversationId) return
        if (!(await isParticipant(conversationId, userId))) return
        socket.to(`conversation:${conversationId}`).emit('voice:recording:stop', { conversationId, userId })
      } catch {}
    })

    // ====== Send message (with reply / forward support) ======
    socket.on(
      'message:send',
      async (payload: {
        conversationId: string
        content?: string
        mediaUrl?: string
        mediaType?: 'text' | 'image' | 'video' | 'audio' | 'file' | 'product' | 'audio-hub' | 'film' | 'game'
        duration?: number
        tempId?: string
        replyToId?: string
        forwardedFromId?: string
        // v12-fix: attachments array for multi-file messages. Was missing
        // from the payload type (runtime worked, but TS complained).
        attachments?: Array<{ url: string; type: string; name?: string; size?: number; duration?: number }>
        // v16.8-final: optional self-destruct timer (voice messages).
        // Validated by sendMessageSchema to be one of 0, 60, 720, 1440, 10080.
        selfDestructMinutes?: number
      }) => {
        try {
          if (!rateLimit(socket, 'message:send')) {
            socket.emit('error', { event: 'message:send', error: 'Rate limit exceeded' })
            return
          }
          if (!payload?.conversationId) {
            socket.emit('error', { event: 'message:send', error: 'conversationId required' })
            return
          }
          const data = sendMessageSchema.parse({
            content: payload.content,
            mediaUrl: payload.mediaUrl,
            mediaType: payload.mediaType,
            // v12-fix: pass attachments to schema validation (was missing →
            // multi-file messages lost their attachments on socket send path)
            attachments: payload.attachments,
            duration: payload.duration,
            replyToId: payload.replyToId,
            forwardedFromId: payload.forwardedFromId,
            selfDestructMinutes: payload.selfDestructMinutes,
          })

          if (!(await isParticipant(payload.conversationId, userId))) {
            socket.emit('error', { event: 'message:send', error: 'Not a participant' })
            return
          }

          // Validate reply target if provided
          if (data.replyToId) {
            const replied = await prisma.message.findUnique({
              where: { id: data.replyToId },
              select: { conversationId: true },
            })
            if (!replied || replied.conversationId !== payload.conversationId) {
              socket.emit('error', { event: 'message:send', error: 'Reply target not in this conversation' })
              return
            }
          }

          // C-CRIT-002 fix: idempotency via clientMessageId. If the client
          // provides a tempId, check if a message with the same clientMessageId
          // already exists (e.g. socket retry, REST fallback after socket
          // timeout). If so, return the existing message instead of creating
          // a duplicate. This prevents the "duplicate messages on flaky
          // mobile network" bug.
          const clientMessageId = payload.tempId || null
          if (clientMessageId) {
            const existing = await prisma.message.findFirst({
              where: { senderId: userId, clientMessageId },
              include: {
                sender: { select: userSelect },
                replyTo: { include: { sender: { select: userSelect } } },
                forwardedFrom: { include: { sender: { select: userSelect } } },
              },
            })
            if (existing) {
              // Idempotent response — return the existing message with tempId
              // tag so the client reconciles its optimistic UI.
              const formatted = serialiseMessage(existing, '')
              ;(formatted as any).tempId = clientMessageId
              socket.emit('message:received', formatted)
              return
            }
          }

          // v16.9 MODERATION — run two-level check before persisting.
          // If blocked, emit 'message:blocked' to the sender with the reason
          // and DO NOT persist the message.
          if (data.content && data.content.trim()) {
            const modDecision = await moderateContent(data.content, {
              userId,
              targetType: 'message',
              conversationId: payload.conversationId,
            })
            if (!modDecision.allowed) {
              socket.emit('message:blocked', {
                tempId: payload.tempId,
                reason: modDecision.reason,
                severity: modDecision.severity,
                categories: modDecision.categories,
              })
              return
            }
          }

          const message = await prisma.message.create({
            data: {
              conversationId: payload.conversationId,
              senderId: userId,
              content: data.content,
              mediaUrl: data.mediaUrl,
              mediaType: data.mediaType,
              // v12: store attachments as JSON string if present
              attachments: data.attachments ? JSON.stringify(data.attachments) : null,
              duration: data.duration,
              replyToId: data.replyToId,
              forwardedFromId: data.forwardedFromId,
              clientMessageId, // C-CRIT-002: persist for future dedup
              // v16.8-final: self-destruct timer. If selfDestructMinutes > 0
              // and the message is a voice message, compute the deadline from
              // now. 0 / undefined → null (no auto-delete).
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
            where: { id: payload.conversationId },
            data: { updatedAt: new Date() },
          })

          // C-HIGH-001 fix: tempId is sender-side reconciliation key — broadcast
          // only to the sender's socket. Other participants receive the message
          // without tempId (prevents minor info leak + dedup confusion).
          const senderFormatted = serialiseMessage(message, '')
          ;(senderFormatted as any).tempId = payload.tempId
          socket.emit('message:received', senderFormatted)
          const othersFormatted = serialiseMessage(message, '')
          socket.to(`conversation:${payload.conversationId}`).emit('message:received', othersFormatted)

          // ====================================================================
          // WEB PUSH NOTIFICATION — delegate to the shared helper so the
          // logic stays in sync with the REST endpoint. Previously this was
          // duplicated inline and would drift from notifyOfflineParticipants.
          // ====================================================================
          void notifyOfflineParticipants(payload.conversationId, userId, {
            id: message.id,
            content: message.content,
            mediaType: message.mediaType,
            sender: message.sender,
          })
        } catch (e: any) {
          socket.emit('error', {
            event: 'message:send',
            error: e?.issues?.[0]?.message || e?.message || 'Failed to send message',
          })
        }
      },
    )

    // ====== Read receipts ======
    socket.on('message:read', async ({ conversationId }: { conversationId: string }) => {
      try {
        if (!conversationId) return
        if (!(await isParticipant(conversationId, userId))) {
          socket.emit('error', { event: 'message:read', error: 'Not a participant' })
          return
        }
        await prisma.message.updateMany({
          where: { conversationId, senderId: { not: userId }, isRead: false },
          data: { isRead: true },
        })
        socket.to(`conversation:${conversationId}`).emit('message:read', { conversationId, userId })
      } catch (e) {
        socket.emit('error', { event: 'message:read', error: 'Failed to mark messages as read' })
      }
    })

    // ====== Delete message (sync across participants) ======
    socket.on(
      'message:delete',
      async (payload: { messageId: string; conversationId: string; forEveryone: boolean }) => {
        try {
          if (!payload?.messageId || !payload?.conversationId) return
          if (!(await isParticipant(payload.conversationId, userId))) {
            socket.emit('error', { event: 'message:delete', error: 'Not a participant' })
            return
          }

          const msg = await prisma.message.findUnique({
            where: { id: payload.messageId },
            select: { id: true, senderId: true, deletedFor: true, deletedForAll: true, conversationId: true },
          })
          if (!msg || msg.conversationId !== payload.conversationId) {
            socket.emit('error', { event: 'message:delete', error: 'Message not found' })
            return
          }

          const isOwner = msg.senderId === userId

          if (payload.forEveryone) {
            if (!isOwner) {
              socket.emit('error', { event: 'message:delete', error: 'Only sender can delete for everyone' })
              return
            }
            await prisma.message.update({
              where: { id: msg.id },
              data: { deletedForAll: true, content: null, mediaUrl: null, mediaType: null, duration: null },
            })
            io.to(`conversation:${payload.conversationId}`).emit('message:deleted', {
              messageId: msg.id,
              conversationId: payload.conversationId,
              deletedForAll: true,
            })
          } else {
            const deletedFor: string[] = (() => {
              try { return JSON.parse(msg.deletedFor || '[]') } catch { return [] }
            })()
            if (!deletedFor.includes(userId)) {
              deletedFor.push(userId)
              await prisma.message.update({
                where: { id: msg.id },
                data: { deletedFor: JSON.stringify(deletedFor) },
              })
            }
            // Only inform the user's own sockets — others should not see this
            emitToUserSockets(io, userId, 'message:deleted', {
              messageId: msg.id,
              conversationId: payload.conversationId,
              deletedForMe: true,
            })
          }
        } catch (e: any) {
          socket.emit('error', { event: 'message:delete', error: e?.message || 'Failed to delete' })
        }
      },
    )

    // ====== Forward message to one or more conversations ======
    socket.on(
      'message:forward',
      async (payload: { sourceMessageId: string; targetConversationIds: string[] }) => {
        try {
          if (!payload?.sourceMessageId || !Array.isArray(payload.targetConversationIds)) {
            socket.emit('error', { event: 'message:forward', error: 'Invalid payload' })
            return
          }
          if (payload.targetConversationIds.length === 0 || payload.targetConversationIds.length > 20) {
            socket.emit('error', { event: 'message:forward', error: 'Target conversations count out of range' })
            return
          }

          const source = await prisma.message.findUnique({
            where: { id: payload.sourceMessageId },
          })
          if (!source || source.deletedForAll) {
            socket.emit('error', { event: 'message:forward', error: 'Source message not available' })
            return
          }

          // C-CRIT-001 fix: verify the caller is a participant of the SOURCE
          // conversation. Without this check, any authenticated user could
          // forward ANY message by ID (privacy breach — they could exfiltrate
          // message content + mediaUrl from any conversation in the system
          // by guessing/enumerating Prisma cuids).
          // The REST endpoint POST /api/chat/messages/:id/forward already has
          // this check (SECURITY FIX comment at routes/chat.ts:580-606), but
          // the socket handler was missed.
          if (!(await isParticipant(source.conversationId, userId))) {
            socket.emit('error', { event: 'message:forward', error: 'Source message not available' })
            return
          }

          for (const targetId of payload.targetConversationIds) {
            if (!(await isParticipant(targetId, userId))) continue

            const msg = await prisma.message.create({
              data: {
                conversationId: targetId,
                senderId: userId,
                content: source.content,
                mediaUrl: source.mediaUrl,
                mediaType: source.mediaType,
                duration: source.duration,
                forwardedFromId: source.id,
              },
              include: {
                sender: { select: userSelect },
                replyTo: { include: { sender: { select: userSelect } } },
                forwardedFrom: { include: { sender: { select: userSelect } } },
              },
            })
            await prisma.conversation.update({
              where: { id: targetId },
              data: { updatedAt: new Date() },
            })
            const formatted = serialiseMessage(msg, '')
            io.to(`conversation:${targetId}`).emit('message:received', formatted)
          }
          socket.emit('message:forwarded', { sourceMessageId: payload.sourceMessageId, count: payload.targetConversationIds.length })
        } catch (e: any) {
          socket.emit('error', { event: 'message:forward', error: e?.message || 'Forward failed' })
        }
      },
    )

    // ====== Edit message (v25.9 — previously missing) ======
    // Allows the sender to edit their own text message within a 48-hour window.
    // Broadcasts `message:edited` to all conversation participants so the UI
    // updates in real-time on every device. The `editedAt` column is set so
    // the message bubble shows an "edited" indicator.
    socket.on(
      'message:edit',
      async (payload: { messageId: string; conversationId: string; content: string }) => {
        try {
          if (!payload?.messageId || !payload?.conversationId) return
          if (typeof payload.content !== 'string') return
          const trimmed = payload.content.trim()
          if (!trimmed) {
            socket.emit('error', { event: 'message:edit', error: 'Content required' })
            return
          }
          if (trimmed.length > 4000) {
            socket.emit('error', { event: 'message:edit', error: 'Message too long' })
            return
          }
          if (!(await isParticipant(payload.conversationId, userId))) {
            socket.emit('error', { event: 'message:edit', error: 'Not a participant' })
            return
          }
          const msg = await prisma.message.findUnique({
            where: { id: payload.messageId },
            select: { id: true, senderId: true, conversationId: true, createdAt: true, deletedForAll: true, mediaType: true },
          })
          if (!msg || msg.conversationId !== payload.conversationId) {
            socket.emit('error', { event: 'message:edit', error: 'Message not found' })
            return
          }
          if (msg.deletedForAll) {
            socket.emit('error', { event: 'message:edit', error: 'Message deleted' })
            return
          }
          // Only the sender can edit their own message.
          if (msg.senderId !== userId) {
            socket.emit('error', { event: 'message:edit', error: 'Only sender can edit' })
            return
          }
          // 48-hour edit window.
          const ageMs = Date.now() - msg.createdAt.getTime()
          if (ageMs > 48 * 60 * 60 * 1000) {
            socket.emit('error', { event: 'message:edit', error: 'Edit window expired' })
            return
          }
          // Run moderation on the new content (same as send).
          try {
            const mod = await moderateContent(trimmed, {
              userId,
              targetType: 'message',
              conversationId: payload.conversationId,
            })
            if (!mod.allowed) {
              socket.emit('message:blocked', {
                tempId: payload.messageId,
                reason: mod.reason,
                severity: mod.severity,
                categories: mod.categories,
              })
              return
            }
          } catch { /* non-critical */ }
          const updated = await prisma.message.update({
            where: { id: msg.id },
            data: { content: trimmed, editedAt: new Date() },
            include: {
              sender: { select: userSelect },
              replyTo: { include: { sender: { select: userSelect } } },
              forwardedFrom: { include: { sender: { select: userSelect } } },
            },
          })
          const formatted = serialiseMessage(updated, '')
          // Broadcast to ALL participants (including sender — sender's other tabs need to update).
          io.to(`conversation:${payload.conversationId}`).emit('message:edited', formatted)
        } catch (e: any) {
          socket.emit('error', { event: 'message:edit', error: e?.message || 'Failed to edit message' })
        }
      },
    )

    // ========================================================================
    // WEBRTC CALL SIGNALING
    // Socket.IO is used ONLY for signaling (offer/answer/ICE). The actual
    // audio/video streams flow directly peer-to-peer over WebRTC.
    // ========================================================================

    // Initiate a call — creates a Call record and notifies the recipient
    socket.on(
      'call:start',
      async (payload: { conversationId: string; recipientId: string; type: 'audio' | 'video' }) => {
        try {
          if (!payload?.conversationId || !payload?.recipientId || !payload?.type) {
            socket.emit('error', { event: 'call:start', error: 'Invalid payload' })
            return
          }
          if (!(await isParticipant(payload.conversationId, userId))) {
            socket.emit('error', { event: 'call:start', error: 'Not a participant' })
            return
          }
          if (payload.recipientId === userId) {
            socket.emit('error', { event: 'call:start', error: 'Cannot call yourself' })
            return
          }

          // Don't allow calling an offline user
          const recipient = await prisma.user.findUnique({
            where: { id: payload.recipientId },
            select: { id: true, isOnline: true, username: true, displayName: true, avatar: true },
          })
          if (!recipient) {
            socket.emit('error', { event: 'call:start', error: 'Recipient not found' })
            return
          }
          if (!recipient.isOnline && !userSockets.has(recipient.id)) {
            socket.emit('error', { event: 'call:start', error: 'User is offline' })
            return
          }

          const call = await prisma.call.create({
            data: {
              conversationId: payload.conversationId,
              callerId: userId,
              recipientId: payload.recipientId,
              type: payload.type,
              status: 'ringing',
            },
          })

          const caller = await prisma.user.findUnique({
            where: { id: userId },
            select: userSelect,
          })

          // Notify the recipient (across all their sockets — multi-tab)
          emitToUserSockets(io, payload.recipientId, 'call:incoming', {
            callId: call.id,
            conversationId: payload.conversationId,
            type: payload.type,
            caller: caller
              ? {
                  id: caller.id,
                  username: caller.username,
                  displayName: caller.displayName,
                  avatar: caller.avatar,
                }
              : null,
          })
          socket.emit('call:started', { callId: call.id, conversationId: payload.conversationId })

          // ====== MISSED CALL TIMEOUT ======
          // If the recipient doesn't answer within 45 seconds, auto-mark the
          // call as 'missed' and notify both parties. Without this, the call
          // stays in 'ringing' forever — the caller sees "Вызов…" endlessly
          // and the recipient's phone keeps vibrating if push was sent.
          //
          // 45s is the industry standard (Telegram, WhatsApp, Viber all use
          // 30-60s). Long enough for the recipient to grab their phone, short
          // enough to not waste the caller's time.
          setTimeout(() => {
            (async () => {
              try {
                const fresh = await prisma.call.findUnique({
                  where: { id: call.id },
                  select: { id: true, status: true, callerId: true, recipientId: true },
                })
                if (!fresh) return
                if (fresh.status !== 'ringing') return // already accepted/rejected/cancelled
                await prisma.call.update({
                  where: { id: call.id },
                  data: { status: 'missed', endedAt: new Date() },
                })
                // Notify both: caller sees "missed", recipient sees "missed" too
                emitToUserSockets(io, fresh.callerId, 'call:ended', {
                  callId: call.id,
                  reason: 'missed',
                  duration: null,
                })
                emitToUserSockets(io, fresh.recipientId, 'call:ended', {
                  callId: call.id,
                  reason: 'missed',
                  duration: null,
                })
              } catch (e) {
                console.error('[CALL] missed timeout error:', e instanceof Error ? e.message : e)
              }
            })()
          }, 45_000).unref?.() // unref so the timer doesn't keep Node alive on shutdown

          // WEB PUSH for incoming call — fires when the recipient has NO
          // active socket connection (app fully closed or backgrounded).
          // The push notification includes Answer/Decline action buttons
          // that the SW handles via `notificationclick` -> event.action.
          // requireInteraction: true so the notification persists until
          // the user acts on it (otherwise Android auto-dismisses after
          // ~5s and the user misses the call).
          if (!isUserOnline(payload.recipientId)) {
            const callerName = caller?.displayName || caller?.username || 'Пользователь'
            const callTitle = `Входящий ${payload.type === 'video' ? 'видеозвонок' : 'аудиозвонок'}`
            void sendPushToUser(payload.recipientId, {
              title: callTitle,
              body: `От ${callerName}`,
              tag: `call-${call.id}`,
              url: '/?view=chat',
              data: {
                conversationId: payload.conversationId,
                callId: call.id,
                callType: payload.type,
                callerId: userId,
              },
              requireInteraction: true,
              renotify: false, // call tag is already unique per call
              actions: [
                { action: 'answer', title: 'Ответить' },
                { action: 'decline', title: 'Отклонить' },
              ],
            })
          }
        } catch (e: any) {
          socket.emit('error', { event: 'call:start', error: e?.message || 'Call start failed' })
        }
      },
    )

    // Accept an incoming call
    socket.on('call:accept', async (payload: { callId: string }) => {
      try {
        if (!payload?.callId) return
        const call = await prisma.call.findUnique({
          where: { id: payload.callId },
          select: { id: true, callerId: true, recipientId: true, status: true, conversationId: true },
        })
        if (!call) {
          socket.emit('error', { event: 'call:accept', error: 'Call not found' })
          return
        }
        if (call.recipientId !== userId) {
          socket.emit('error', { event: 'call:accept', error: 'Not the recipient' })
          return
        }
        if (call.status !== 'ringing') {
          socket.emit('error', { event: 'call:accept', error: `Call already ${call.status}` })
          return
        }
        await prisma.call.update({
          where: { id: call.id },
          data: { status: 'accepted', startedAt: new Date() },
        })
        emitToUserSockets(io, call.callerId, 'call:accepted', { callId: call.id })
      } catch (e: any) {
        socket.emit('error', { event: 'call:accept', error: e?.message })
      }
    })

    // Reject an incoming call
    socket.on('call:reject', async (payload: { callId: string }) => {
      try {
        if (!payload?.callId) return
        const call = await prisma.call.findUnique({
          where: { id: payload.callId },
          select: { id: true, callerId: true, recipientId: true, status: true },
        })
        if (!call) return
        if (call.recipientId !== userId && call.callerId !== userId) return
        if (call.status !== 'ringing') return
        await prisma.call.update({
          where: { id: call.id },
          data: { status: 'rejected', endedAt: new Date() },
        })
        emitToUserSockets(io, call.callerId, 'call:rejected', { callId: call.id })
        emitToUserSockets(io, call.recipientId, 'call:rejected', { callId: call.id })
      } catch (e: any) {
        socket.emit('error', { event: 'call:reject', error: e?.message })
      }
    })

    // End an active call
    socket.on('call:end', async (payload: { callId: string; reason?: string }) => {
      try {
        if (!payload?.callId) return
        const call = await prisma.call.findUnique({
          where: { id: payload.callId },
          select: { id: true, callerId: true, recipientId: true, status: true, startedAt: true },
        })
        if (!call) return
        if (call.callerId !== userId && call.recipientId !== userId) return

        const duration = call.startedAt
          ? Math.floor((Date.now() - call.startedAt.getTime()) / 1000)
          : null
        await prisma.call.update({
          where: { id: call.id },
          data: { status: 'ended', endedAt: new Date(), duration },
        })
        emitToUserSockets(io, call.callerId, 'call:ended', { callId: call.id, reason: payload.reason || 'ended', duration })
        emitToUserSockets(io, call.recipientId, 'call:ended', { callId: call.id, reason: payload.reason || 'ended', duration })
      } catch (e: any) {
        socket.emit('error', { event: 'call:end', error: e?.message })
      }
    })

    // Cancel an outgoing call before the recipient answers
    socket.on('call:cancel', async (payload: { callId: string }) => {
      try {
        if (!payload?.callId) return
        const call = await prisma.call.findUnique({
          where: { id: payload.callId },
          select: { id: true, callerId: true, recipientId: true, status: true },
        })
        if (!call) return
        if (call.callerId !== userId) return
        if (call.status !== 'ringing') return
        await prisma.call.update({
          where: { id: call.id },
          data: { status: 'cancelled', endedAt: new Date() },
        })
        emitToUserSockets(io, call.recipientId, 'call:cancelled', { callId: call.id })
      } catch (e: any) {
        socket.emit('error', { event: 'call:cancel', error: e?.message })
      }
    })

    // WebRTC signaling — relay offer/answer/ICE candidates to the peer.
    // The server does NOT touch the media; it just forwards signaling messages.
    socket.on('call:signal', async (payload: { callId: string; to: string; data: any }) => {
      try {
        if (!payload?.callId || !payload?.to || !payload?.data) return
        // B-HIGH-007: cap relayed signal payload to 16 KiB. Without this, a
        // malicious or buggy client can ship an arbitrarily-large `data`
        // object (e.g. SDP with embedded data channels, base64 media) which
        // the server happily re-serialises and broadcasts to every socket of
        // the peer — a trivial amplification / memory-exhaustion vector.
        // 16 KiB is far above any legit SDP+ICE bundle (typical: 2–4 KiB).
        const dataStr = JSON.stringify(payload.data)
        if (dataStr.length > 16_384) {
          socket.emit('error', { event: 'call:signal', error: 'Signal payload too large' })
          return
        }
        // Verify the caller is part of this call
        const call = await prisma.call.findUnique({
          where: { id: payload.callId },
          select: { callerId: true, recipientId: true, status: true },
        })
        if (!call) return
        if (call.callerId !== userId && call.recipientId !== userId) return
        // v13.0 (audit P0-3 fix): the previous version only validated that
        // the SENDER (userId) is a participant, but did not validate that
        // payload.to (the recipient of the relayed signaling) is the OTHER
        // participant. An attacker in a call with user B could relay SDP/ICE
        // to ANY arbitrary user ID — leaking their ICE candidates (IPs)
        // and spamming their UI. Now strictly require payload.to to be the
        // other party of the same call.
        if (payload.to !== call.callerId && payload.to !== call.recipientId) return
        if (payload.to === userId) return // cannot signal yourself
        // v13.0 (audit P1-11 fix): only relay signaling once the call is
        // accepted. Previously `ringing` was allowed — letting the caller
        // push SDP/ICE to the recipient before they consented to the call,
        // leaking their ICE candidates. Now strictly require `accepted`.
        if (call.status !== 'accepted') return
        // Forward to the peer's sockets
        emitToUserSockets(io, payload.to, 'call:signal', {
          callId: payload.callId,
          from: userId,
          data: payload.data,
        })
      } catch (e: any) {
        socket.emit('error', { event: 'call:signal', error: e?.message })
      }
    })

    // ====== Disconnect ======
    socket.on('disconnect', async () => {
      socketToUser.delete(socket.id)
      const sockets = userSockets.get(userId)
      if (sockets) {
        sockets.delete(socket.id)
        if (sockets.size === 0) {
          userSockets.delete(userId)
          await setUserOffline(userId)
          void broadcastPresenceToPartners(io, userId, 'user:offline', { userId, username })

          // ====== AUTO-END ACTIVE CALLS ON DISCONNECT ======
          // If the user had an active call and their socket dropped without
          // calling call:end, we need to clean up. Otherwise the OTHER party
          // stays in the call forever waiting for a peer that's gone.
          //
          // We check 3 seconds after disconnect — this gives a brief window
          // for the client to reconnect (mobile network flaps) before we
          // declare the call dead. If the user reconnects within 3s, their
          // new socket re-registers and the call continues normally.
          setTimeout(() => {
            (async () => {
              try {
                // If the user reconnected (any socket is alive), skip cleanup.
                if (isUserOnline(userId)) return

                // Find any active call where this user is caller OR recipient
                // AND the call is in an active state (accepted/connected).
                const activeCalls = await prisma.call.findMany({
                  where: {
                    OR: [{ callerId: userId }, { recipientId: userId }],
                    status: { in: ['accepted', 'ringing'] },
                  },
                  select: {
                    id: true,
                    callerId: true,
                    recipientId: true,
                    status: true,
                    startedAt: true,
                    conversationId: true,
                  },
                })
                for (const c of activeCalls) {
                  const duration = c.startedAt
                    ? Math.floor((Date.now() - c.startedAt.getTime()) / 1000)
                    : null
                  // ringing → missed (caller's perspective) or cancelled (recipient's)
                  // accepted → ended (with duration)
                  const newStatus = c.status === 'ringing'
                    ? (c.callerId === userId ? 'cancelled' : 'missed')
                    : 'ended'
                  await prisma.call.update({
                    where: { id: c.id },
                    data: { status: newStatus, endedAt: new Date(), duration },
                  })
                  const otherId = c.callerId === userId ? c.recipientId : c.callerId
                  emitToUserSockets(io, otherId, 'call:ended', {
                    callId: c.id,
                    reason: newStatus === 'missed' ? 'missed' : newStatus === 'cancelled' ? 'cancelled' : 'peer-disconnected',
                    duration,
                  })
                  // Also notify the disconnecting user (in case they reconnect
                  // — they should see the call ended)
                  emitToUserSockets(io, userId, 'call:ended', {
                    callId: c.id,
                    reason: newStatus === 'missed' ? 'missed' : newStatus === 'cancelled' ? 'cancelled' : 'peer-disconnected',
                    duration,
                  })
                }
              } catch (e) {
                console.error('[CALL] disconnect cleanup error:', e instanceof Error ? e.message : e)
              }
            })()
          }, 3_000).unref?.() // 3s grace period for reconnect
        }
      }
    })
  })
}

async function broadcastPresenceToPartners(
  io: IoServer,
  userId: string,
  event: string,
  payload: any,
) {
  try {
    const participations = await prisma.conversationParticipant.findMany({
      where: { userId },
      select: { conversationId: true },
    })
    const roomSet = new Set<string>()
    for (const p of participations) {
      roomSet.add(`conversation:${p.conversationId}`)
    }
    for (const room of roomSet) {
      io.to(room).emit(event, payload)
    }
  } catch (e) {
    console.error('[SOCKET] broadcastPresenceToPartners error:', e)
  }
}
