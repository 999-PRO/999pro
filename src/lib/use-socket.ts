'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { io, type Socket } from 'socket.io-client'
import { socketUrl, getToken, api } from '@/lib/api'
import { useAuthStore } from '@/lib/auth-store'
import type { Message, CallState } from '@/lib/types'
// C-HIGH-007: offline message queue — when socket AND REST both fail, the
// message is persisted to localStorage so it can be retried on next mount.
import {
  getQueuedMessages,
  queueMessage,
  removeQueuedMessage,
} from '@/lib/message-queue'

interface UseSocketOptions {
  conversationId?: string
  onMessage?: (m: Message) => void
  onMessageDeleted?: (payload: { messageId: string; conversationId: string; deletedForAll?: boolean; deletedForMe?: boolean }) => void
  // v25.9: edit support — fired when another participant edits a message.
  onMessageEdited?: (m: Message) => void
  // v25.27: закрепление сообщений (Telegram-style pin)
  onMessagePinned?: (payload: { conversationId: string; messageId: string | null; pinnedAt: string | null }) => void
  onMessageForwarded?: (payload: { sourceMessageId: string; count: number }) => void
  onTypingStart?: (data: { conversationId: string; userId: string; username: string }) => void
  onTypingStop?: (data: { conversationId: string; userId: string }) => void
  // v9-voice: peer voice recording indicators
  onVoiceRecordingStart?: (data: { conversationId: string; userId: string; username: string }) => void
  onVoiceRecordingStop?: (data: { conversationId: string; userId: string }) => void
  onUserOnline?: (data: { userId: string; username: string }) => void
  onUserOffline?: (data: { userId: string; username: string }) => void
  onRead?: (data: { conversationId: string; userId: string }) => void
  // v25.6 (chat sync): broadcast when a new conversation is created with this user
  onConversationCreated?: (payload: { conversation: any }) => void
  // v25.9: broadcast when a conversation is hard-deleted (admin or both
  // participants soft-deleted). Lets the chat list update in real-time.
  onConversationDeleted?: (payload: { conversationId: string }) => void
  // Call events
  onCallIncoming?: (payload: { callId: string; conversationId: string; type: 'audio' | 'video'; caller: any }) => void
  onCallStarted?: (payload: { callId: string; conversationId: string }) => void
  onCallAccepted?: (payload: { callId: string }) => void
  onCallRejected?: (payload: { callId: string }) => void
  onCallEnded?: (payload: { callId: string; reason?: string; duration?: number }) => void
  onCallCancelled?: (payload: { callId: string }) => void
  onCallSignal?: (payload: { callId: string; from: string; data: any }) => void
  enabled?: boolean
}

let sharedSocket: Socket | null = null
let socketListeners = 0
let currentToken: string | null = null

function getSocket(): Socket | null {
  if (typeof window === 'undefined') return null
  let token = getToken()
  // v8-audit-fix: fallback to localStorage if getToken() returns null
  // (Zustand persist might not have hydrated yet when useSocket first runs)
  if (!token && typeof window !== 'undefined') {
    try {
      const raw = window.localStorage.getItem('999pro-auth')
      if (raw) {
        const parsed = JSON.parse(raw)
        token = parsed?.state?.token || null
      }
    } catch {}
  }
  if (!token) return null
  if (sharedSocket && currentToken === token) return sharedSocket
  if (sharedSocket && currentToken !== token) {
    sharedSocket.disconnect()
    sharedSocket = null
  }
  currentToken = token
  const { url, query } = socketUrl()
  sharedSocket = io(url, {
    path: '/socket.io/',
    query,
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnection: true,
    // CAP reconnection attempts. `Infinity` was a battery drain on mobile —
    // if the backend was down, the client would retry forever (every 5s
    // after the backoff cap), keeping the radio awake and burning battery.
    // 20 attempts (~3-4 minutes of retries with backoff) is enough — after
    // that we surface a "disconnected" state and let the user pull-to-refresh.
    reconnectionAttempts: 20,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 10000,
  })
  return sharedSocket
}

// v25.24: доступ к общему сокету для глобальных слушателей (онлайн-дуэли).
export function getSharedSocket(): Socket | null {
  return getSocket()
}

export function resetSocket() {
  if (sharedSocket) {
    sharedSocket.disconnect()
    sharedSocket = null
  }
  currentToken = null
}

export function useSocket(options: UseSocketOptions = {}) {
  const {
    conversationId,
    onMessage,
    onMessageDeleted,
    onMessageEdited,
    onMessagePinned,
    onMessageForwarded,
    onTypingStart,
    onTypingStop,
    onVoiceRecordingStart,
    onVoiceRecordingStop,
    onUserOnline,
    onUserOffline,
    onRead,
    onConversationCreated,
    onConversationDeleted,
    onCallIncoming,
    onCallStarted,
    onCallAccepted,
    onCallRejected,
    onCallEnded,
    onCallCancelled,
    onCallSignal,
    enabled = true,
  } = options

  const [isConnected, setIsConnected] = useState(false)
  const socketRef = useRef<Socket | null>(null)
  // Wave 2 (F-BUG-002): ref mirror of conversationId so the socket lifecycle
  // effect can read the latest value in its `onConnect` handler without
  // depending on conversationId (which would tear down the socket on every
  // conversation switch).
  const conversationIdRef = useRef<string | null>(conversationId)
  conversationIdRef.current = conversationId
  // Subscribe to the auth store's `token` slice directly. Previously we
  // polled `getToken()` every 1000ms via setInterval — that was wasteful
  // (thousands of unnecessary calls per tab session) and added latency
  // (up to 1s between token change and re-subscription). The store
  // subscription fires synchronously on token change.
  const token = useAuthStore((s) => s.token)

  const handlersRef = useRef({
    onMessage,
    onMessageDeleted,
    onMessageEdited,
    onMessagePinned,
    onMessageForwarded,
    onTypingStart,
    onTypingStop,
    onVoiceRecordingStart,
    onVoiceRecordingStop,
    onUserOnline,
    onUserOffline,
    onRead,
    onConversationCreated,
    onConversationDeleted,
    onCallIncoming,
    onCallStarted,
    onCallAccepted,
    onCallRejected,
    onCallEnded,
    onCallCancelled,
    onCallSignal,
  })

  useEffect(() => {
    handlersRef.current = {
      onMessage,
      onMessageDeleted,
      onMessageEdited,
      onMessagePinned,
      onMessageForwarded,
      onTypingStart,
      onTypingStop,
      onVoiceRecordingStart,
      onVoiceRecordingStop,
      onUserOnline,
      onUserOffline,
      onRead,
      onConversationCreated,
      onConversationDeleted,
      onCallIncoming,
      onCallStarted,
      onCallAccepted,
      onCallRejected,
      onCallEnded,
      onCallCancelled,
      onCallSignal,
    }
  }, [onMessage, onMessageDeleted, onMessageEdited, onMessagePinned, onMessageForwarded, onTypingStart, onTypingStop, onVoiceRecordingStart, onVoiceRecordingStop, onUserOnline, onUserOffline, onRead, onConversationCreated, onConversationDeleted, onCallIncoming, onCallStarted, onCallAccepted, onCallRejected, onCallEnded, onCallCancelled, onCallSignal])

  // Wave 2 (F-BUG-002): split the original single useEffect into two:
  // 1) Socket lifecycle effect — creates/destroys the singleton based on
  //    `enabled` + `token`. Does NOT depend on conversationId, so switching
  //    conversations does NOT tear down + recreate the socket.
  // 2) Conversation membership effect — joins/leaves the conversation room
  //    when conversationId or isConnected changes, on the EXISTING socket.
  //
  // This eliminates the cold-start socket churn bug where `socketListeners`
  // could momentarily hit 0 during the cleanup-then-rerun swap when
  // conversationId changed, causing the singleton to disconnect.

  // ─── Effect 1: socket lifecycle (event listeners + connect/disconnect) ───
  useEffect(() => {
    if (!enabled) return
    const socket = getSocket()
    if (!socket) return
    socketRef.current = socket
    socketListeners += 1

    const onConnect = () => {
      setIsConnected(true)
      // Re-emit conversation:join on every connect event (after reconnect,
      // server-side room membership is lost). The current conversationId
      // is read from a ref to avoid restating this listener on every
      // conversationId change.
      const curConv = conversationIdRef.current
      if (curConv) {
        socket.emit('conversation:join', curConv)
      }
    }
    const onDisconnect = () => setIsConnected(false)
    const handleMessage = (m: Message) => handlersRef.current.onMessage?.(m)
    const handleMessageDeleted = (d: any) => handlersRef.current.onMessageDeleted?.(d)
    // v25.9: edit support
    const handleMessageEdited = (m: Message) => handlersRef.current.onMessageEdited?.(m)
    // v25.27: закрепление сообщений
    const handleMessagePinned = (d: any) => handlersRef.current.onMessagePinned?.(d)
    const handleMessageForwarded = (d: any) => handlersRef.current.onMessageForwarded?.(d)
    const handleTypingStart = (d: any) => handlersRef.current.onTypingStart?.(d)
    const handleTypingStop = (d: any) => handlersRef.current.onTypingStop?.(d)
    const handleVoiceRecordingStart = (d: any) => handlersRef.current.onVoiceRecordingStart?.(d)
    const handleVoiceRecordingStop = (d: any) => handlersRef.current.onVoiceRecordingStop?.(d)
    const handleOnline = (d: any) => handlersRef.current.onUserOnline?.(d)
    const handleOffline = (d: any) => handlersRef.current.onUserOffline?.(d)
    // v25.6 (chat sync): new conversation created with this user
    const handleConversationCreated = (d: any) => handlersRef.current.onConversationCreated?.(d)
    // v25.9: conversation hard-deleted
    const handleConversationDeleted = (d: any) => handlersRef.current.onConversationDeleted?.(d)
    const handleRead = (d: any) => handlersRef.current.onRead?.(d)
    const handleCallIncoming = (d: any) => handlersRef.current.onCallIncoming?.(d)
    const handleCallStarted = (d: any) => handlersRef.current.onCallStarted?.(d)
    const handleCallAccepted = (d: any) => handlersRef.current.onCallAccepted?.(d)
    const handleCallRejected = (d: any) => handlersRef.current.onCallRejected?.(d)
    const handleCallEnded = (d: any) => handlersRef.current.onCallEnded?.(d)
    const handleCallCancelled = (d: any) => handlersRef.current.onCallCancelled?.(d)
    const handleCallSignal = (d: any) => handlersRef.current.onCallSignal?.(d)

    // ====== Lead status changes (admin → user real-time notifications) ======
    const handleLeadStatus = (d: any) => {
      if (typeof window !== 'undefined' && d) {
        window.dispatchEvent(new CustomEvent('lead:status-changed', { detail: d }))
      }
    }

    const handleLeadDeleted = (d: any) => {
      if (typeof window !== 'undefined' && d) {
        window.dispatchEvent(new CustomEvent('lead:deleted', { detail: d }))
      }
    }
    const handleLeadsBulkDeleted = (d: any) => {
      if (typeof window !== 'undefined' && d) {
        window.dispatchEvent(new CustomEvent('leads:bulk-deleted', { detail: d }))
      }
    }

    // v16.2: Order status changes (admin → user real-time notifications)
    const handleOrderStatus = (d: any) => {
      if (typeof window !== 'undefined' && d) {
        window.dispatchEvent(new CustomEvent('order:status-changed', { detail: d }))
      }
    }

    // v16.5: Content refresh — when Studio saves (settings/banners/stories/
    // products/club), backend broadcasts a socket event. We forward it as a
    // window CustomEvent so individual components can refetch their data
    // without prop-drilling or a global store.
    const handleSettingsChanged = (d: any) => {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('999pro:settings-changed', { detail: d }))
      }
    }
    const handleBannersChanged = () => {
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('999pro:banners-changed'))
    }
    // v25.14: categories live-refresh — Studio edits propagate instantly.
    const handleCategoriesChanged = () => {
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('999pro:categories-changed'))
    }
    const handleStoriesChanged = () => {
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('999pro:stories-changed'))
    }
    const handleProductsChanged = () => {
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('999pro:products-changed'))
    }
    const handleClubChanged = (d: any) => {
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('999pro:club-changed', { detail: d }))
    }
    // v16.8: Info pages — when Studio saves an info page, backend broadcasts
    // 'info-pages:changed'. Forward as a window CustomEvent so the frontend
    // (info-page-view + more-sheet) can refetch and show updated content.
    const handleInfoPagesChanged = () => {
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('999pro:info-pages-changed'))
    }

    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    socket.on('message:received', handleMessage)
    socket.on('message:deleted', handleMessageDeleted)
    // v25.9: edit support
    socket.on('message:edited', handleMessageEdited)
    // v25.27: закрепление сообщений
    socket.on('message:pinned', handleMessagePinned)
    socket.on('message:forwarded', handleMessageForwarded)
    // v16.9: moderation — when a message is blocked by the system, show a
    // window event so the chat UI can show the user why their message was
    // not sent.
    socket.on('message:blocked', (d: any) => {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('999pro:message-blocked', { detail: d }))
      }
    })
    socket.on('typing:start', handleTypingStart)
    socket.on('typing:stop', handleTypingStop)
    socket.on('voice:recording:start', handleVoiceRecordingStart)
    socket.on('voice:recording:stop', handleVoiceRecordingStop)
    socket.on('user:online', handleOnline)
    socket.on('user:offline', handleOffline)
    // v25.6 (chat sync): new conversation created with this user
    socket.on('conversation:created', handleConversationCreated)
    // v25.9: conversation hard-deleted
    socket.on('conversation:deleted', handleConversationDeleted)
    socket.on('message:read', handleRead)
    socket.on('call:incoming', handleCallIncoming)
    socket.on('call:started', handleCallStarted)
    socket.on('call:accepted', handleCallAccepted)
    socket.on('call:rejected', handleCallRejected)
    socket.on('call:ended', handleCallEnded)
    socket.on('call:cancelled', handleCallCancelled)
    socket.on('call:signal', handleCallSignal)
    socket.on('lead:status-changed', handleLeadStatus)
    socket.on('lead:deleted', handleLeadDeleted)
    socket.on('leads:bulk-deleted', handleLeadsBulkDeleted)
    socket.on('order:status-changed', handleOrderStatus)
    socket.on('settings:changed', handleSettingsChanged)
    socket.on('banners:changed', handleBannersChanged)
    socket.on('categories:changed', handleCategoriesChanged)
    socket.on('stories:changed', handleStoriesChanged)
    socket.on('products:changed', handleProductsChanged)
    socket.on('club:changed', handleClubChanged)
    socket.on('info-pages:changed', handleInfoPagesChanged)

    if (socket.connected) setIsConnected(true)

    return () => {
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
      socket.off('message:received', handleMessage)
      socket.off('message:deleted', handleMessageDeleted)
      socket.off('message:edited', handleMessageEdited)
      socket.off('message:forwarded', handleMessageForwarded)
      socket.off('typing:start', handleTypingStart)
      socket.off('typing:stop', handleTypingStop)
      socket.off('voice:recording:start', handleVoiceRecordingStart)
      socket.off('voice:recording:stop', handleVoiceRecordingStop)
      socket.off('user:online', handleOnline)
      socket.off('user:offline', handleOffline)
      socket.off('conversation:created', handleConversationCreated)
      socket.off('conversation:deleted', handleConversationDeleted)
      socket.off('message:read', handleRead)
      socket.off('call:incoming', handleCallIncoming)
      socket.off('call:started', handleCallStarted)
      socket.off('call:accepted', handleCallAccepted)
      socket.off('call:rejected', handleCallRejected)
      socket.off('call:ended', handleCallEnded)
      socket.off('call:cancelled', handleCallCancelled)
      socket.off('call:signal', handleCallSignal)
      socket.off('lead:status-changed', handleLeadStatus)
      socket.off('lead:deleted', handleLeadDeleted)
      socket.off('leads:bulk-deleted', handleLeadsBulkDeleted)
      socket.off('order:status-changed', handleOrderStatus)
      socket.off('settings:changed', handleSettingsChanged)
      socket.off('banners:changed', handleBannersChanged)
      socket.off('categories:changed', handleCategoriesChanged)
      socket.off('stories:changed', handleStoriesChanged)
      socket.off('products:changed', handleProductsChanged)
      socket.off('club:changed', handleClubChanged)
      socket.off('info-pages:changed', handleInfoPagesChanged)
      socketListeners -= 1
      if (socketListeners <= 0) {
        sharedSocket?.disconnect()
        sharedSocket = null
        currentToken = null
      }
    }
    // Intentionally do NOT depend on conversationId — see comment block above.
     
  }, [enabled, token])

  // ─── Effect 2: conversation room membership (join only) ───
  // The server AUTO-JOINS every connected socket to every conversation the
  // user is a participant of (handlers.ts ~line 368). We still emit
  // `conversation:join` on connect / conversation switch as a belt-and-
  // suspenders re-join (it's idempotent), but we must NEVER emit
  // `conversation:leave` — doing so removes the socket from the room and
  // silently breaks `message:received` delivery for that conversation,
  // which kills in-app toast notifications, unread-badge increments, and
  // chat-list preview refreshes for any conversation the user has ever
  // opened. Per-conversation event filtering is already done client-side
  // in chat.tsx (onMessage / onTypingStart / etc. all gate on activeConv.id).
  useEffect(() => {
    if (!enabled) return
    const socket = socketRef.current
    if (!socket || !isConnected) return
    const curConv = conversationId
    if (!curConv) return

    socket.emit('conversation:join', curConv)

    // Intentionally NO cleanup — we do not emit `conversation:leave`.
  }, [enabled, conversationId, isConnected])

  const send = useCallback((payload: {
    conversationId: string
    content?: string
    mediaUrl?: string
    mediaType?: 'text' | 'image' | 'video' | 'audio' | 'file' | 'product' | 'audio-hub' | 'film' | 'game'
    // v12: attachments — array of file metadata for multi-file messages
    attachments?: Array<{ url: string; type: 'image' | 'video' | 'audio' | 'file'; name?: string; size?: number; duration?: number }>
    duration?: number
    tempId?: string
    replyToId?: string
    forwardedFromId?: string
    // v16.8-final: optional self-destruct timer (voice messages).
    // Allowed values: 0 (no auto-delete), 60, 720, 1440, 10080 minutes.
    selfDestructMinutes?: number
  }) => {
    const sock = socketRef.current
    // REST fallback when the socket is disconnected and not actively
    // reconnecting. Previously `socket.emit` on a dead socket would
    // silently no-op (Socket.IO queues the emit only if reconnection is
    // expected to succeed; if the socket is in `io.close()` state the
    // emit is dropped). The user's optimistic message would sit in
    // "sending" state forever.
    //
    // Now: if the socket is not connected, fall back to POST
    // /api/chat/conversations/:id/messages. The backend handler mirrors
    // the socket handler (creates the message, broadcasts via Socket.IO
    // to OTHER tabs/devices, triggers push notifications). Returns the
    // created message so the caller can reconcile the optimistic tempId.
    if (!sock || !sock.connected) {
      // F-CRIT-003 fix: replaced dynamic require('@/lib/api') with a static
      // top-level import. The require() was an ESLint error, broke bundler
      // static analysis (Turbopack couldn't tree-shake), and was dead-equivalent.
      // C-CRIT-002 fix: pass clientMessageId (= tempId) to REST endpoint so
      // the backend can dedup on (senderId, clientMessageId) — prevents
      // duplicate messages when socket retries + REST fallback both fire.
      void api
        .post(`/api/chat/conversations/${payload.conversationId}/messages`, {
          json: {
            content: payload.content,
            mediaUrl: payload.mediaUrl,
            mediaType: payload.mediaType,
            // v12: pass attachments to REST endpoint
            attachments: payload.attachments,
            duration: payload.duration,
            replyToId: payload.replyToId,
            forwardedFromId: payload.forwardedFromId,
            clientMessageId: payload.tempId, // C-CRIT-002: idempotency key
            // v16.8-final: self-destruct timer (voice messages).
            selfDestructMinutes: payload.selfDestructMinutes,
          },
          auth: true,
        })
        .then((created: any) => {
          // v25.27 FIX: мгновенная реконсиляция оптимистичного сообщения.
          // Раньше стаб с tmp_-id жил до следующей перезагрузки истории
          // («rely on the next conversation-fetch»), из-за чего ЛЮБОЕ действие
          // над своим недавним сообщением (закрепить/изменить/удалить у всех,
          // ответить) отправляло ВРЕМЕННЫЙ id и падало с 404.
          // Прогоняем серверное сообщение через штатный onMessage — там
          // дедуп по tempId сам смёржит стаб с реальным сообщением.
          if (created && created.id && payload.tempId) {
            ;(created as any).tempId = payload.tempId
            handlersRef.current.onMessage?.(created as Message)
          }
        })
        .catch((e: unknown) => {
          // C-HIGH-007: REST also failed — persist the message to the
          // outbound queue so it can be retried on next app load (or when
          // the socket reconnects — the flush effect below runs on mount).
          // The tempId is reused as the backend's clientMessageId key,
          // so a late-success retry does not create a duplicate (C-CRIT-002).
          if (payload.tempId) {
            queueMessage({
              tempId: payload.tempId,
              conversationId: payload.conversationId,
              content: payload.content,
              mediaUrl: payload.mediaUrl,
              mediaType: payload.mediaType,
              duration: payload.duration,
              replyToId: payload.replyToId,
              // v13.0 (audit P1-9 fix): preserve attachments so offline
              // multi-file messages resend with their attachment metadata.
              attachments: payload.attachments,
              timestamp: Date.now(),
            })
          }
          // REST fallback failed too — surface as a CustomEvent so the
          // chat component can mark the optimistic message as `failed`.
          if (typeof window !== 'undefined') {
            window.dispatchEvent(
              new CustomEvent('message:send-failed', {
                detail: { tempId: payload.tempId, error: e, queued: true },
              }),
            )
          }
        })
      return
    }
    sock.emit('message:send', payload)
  }, [])

  const startTyping = useCallback((convId: string) => {
    socketRef.current?.emit('typing:start', { conversationId: convId })
  }, [])

  const stopTyping = useCallback((convId: string) => {
    socketRef.current?.emit('typing:stop', { conversationId: convId })
  }, [])

  // v9-voice: emit voice recording start/stop so the peer sees the indicator
  const startVoiceRecording = useCallback((convId: string) => {
    socketRef.current?.emit('voice:recording:start', { conversationId: convId })
  }, [])

  const stopVoiceRecording = useCallback((convId: string) => {
    socketRef.current?.emit('voice:recording:stop', { conversationId: convId })
  }, [])

  const markRead = useCallback((convId: string) => {
    socketRef.current?.emit('message:read', { conversationId: convId })
  }, [])

  const deleteMessage = useCallback((messageId: string, conversationId: string, forEveryone: boolean) => {
    socketRef.current?.emit('message:delete', { messageId, conversationId, forEveryone })
  }, [])

  // v25.9: edit message — emits `message:edit` over the socket. The backend
  // validates ownership + 48-hour window + moderation, then broadcasts
  // `message:edited` to ALL participants (including the sender's other tabs).
  // If the socket is disconnected, falls back to PATCH /api/chat/messages/:id.
  const editMessage = useCallback((messageId: string, conversationId: string, content: string) => {
    const sock = socketRef.current
    if (sock && sock.connected) {
      sock.emit('message:edit', { messageId, conversationId, content })
      return
    }
    // REST fallback
    void api
      .patch(`/api/chat/messages/${messageId}`, { json: { content }, auth: true })
      .catch(() => {/* error surfaced via toast in chat.tsx */})
  }, [])

  const forwardMessage = useCallback((sourceMessageId: string, targetConversationIds: string[]) => {
    socketRef.current?.emit('message:forward', { sourceMessageId, targetConversationIds })
  }, [])

  // ====== Call signaling helpers ======
  const startCall = useCallback((conversationId: string, recipientId: string, type: 'audio' | 'video') => {
    socketRef.current?.emit('call:start', { conversationId, recipientId, type })
  }, [])

  const acceptCall = useCallback((callId: string) => {
    socketRef.current?.emit('call:accept', { callId })
  }, [])

  const rejectCall = useCallback((callId: string) => {
    socketRef.current?.emit('call:reject', { callId })
  }, [])

  const endCall = useCallback((callId: string, reason?: string) => {
    socketRef.current?.emit('call:end', { callId, reason })
  }, [])

  const cancelCall = useCallback((callId: string) => {
    socketRef.current?.emit('call:cancel', { callId })
  }, [])

  const sendCallSignal = useCallback((callId: string, to: string, data: any) => {
    socketRef.current?.emit('call:signal', { callId, to, data })
  }, [])

  // C-HIGH-007 fix: flush the offline message queue on mount + whenever the
  // socket (re)connects. Each queued message is retried via REST with the
  // same clientMessageId (= tempId) so the backend's C-CRIT-002 idempotency
  // check deduplicates any that did slip through and were persisted. On
  // success we remove the entry from localStorage; on failure we leave it
  // for the next flush.
  //
  // The flush is keyed on `isConnected` so a transient reconnect triggers
  // a retry without waiting for a full app reload — important for flaky
  // mobile networks where the socket drops for a few seconds and REST is
  // also throwing.
  useEffect(() => {
    if (!isConnected) return
    const queue = getQueuedMessages()
    if (queue.length === 0) return
    // Fire-and-forget — we don't await; failures stay in the queue for
    // the next flush. Avoid Promise.all to prevent a thundering herd of
    // parallel requests if the queue is large.
    void (async () => {
      for (const msg of queue) {
        try {
          await api.post(`/api/chat/conversations/${msg.conversationId}/messages`, {
            json: {
              content: msg.content,
              mediaUrl: msg.mediaUrl,
              mediaType: msg.mediaType,
              duration: msg.duration,
              replyToId: msg.replyToId,
              clientMessageId: msg.tempId, // C-CRIT-002 idempotency key
            },
            auth: true,
          })
          removeQueuedMessage(msg.tempId)
        } catch {
          // Leave in queue for next flush — break out so we don't hammer
          // a dead backend with the rest of the queue.
          break
        }
      }
    })()
  }, [isConnected])

  return {
    isConnected,
    send,
    startTyping,
    stopTyping,
    startVoiceRecording,
    stopVoiceRecording,
    markRead,
    deleteMessage,
    editMessage,
    forwardMessage,
    startCall,
    acceptCall,
    rejectCall,
    endCall,
    cancelCall,
    sendCallSignal,
  }
}
