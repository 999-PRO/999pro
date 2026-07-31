// ============================================================================
// useChatSocket — extracted from chat.tsx (Wave 4 / F-ARCH-005)
// ----------------------------------------------------------------------------
// Encapsulates the Socket.IO subscription logic for chat:
//   - connects to the socket (via the shared use-socket singleton)
//   - registers handlers for message:received, typing, calls, lead status
//   - exposes `send` for emitting message:send
//   - exposes `isConnected` for UI feedback
//
// Extraction goal: reduce chat.tsx from ~2008 lines toward ~400 by moving
// socket plumbing out of the view. The view still owns message state and
// renders bubbles — this hook just wires the real-time layer.
//
// NOTE: this is a staged extraction. For now it's a thin wrapper around
// useSocket that documents the intent. Full migration (moving onMessage /
// onTypingStart / etc. handlers here) is backlog — see F-ARCH-005 in the
// audit report.
// ============================================================================

'use client'

import { useCallback } from 'react'
import { useSocket } from '@/lib/use-socket'
import type { Message } from '@/lib/types'

export interface ChatSocketHandlers {
  onMessage?: (m: Message) => void
  onMessageDeleted?: (data: { messageId: string; conversationId: string }) => void
  onMessageForwarded?: (payload: { sourceMessageId: string; count: number }) => void
  onTypingStart?: (data: { conversationId: string; userId: string; username: string }) => void
  onTypingStop?: (data: { conversationId: string; userId: string }) => void
  onUserOnline?: (data: { userId: string; username: string }) => void
  onUserOffline?: (data: { userId: string; username: string }) => void
  onRead?: (data: { conversationId: string; userId: string }) => void
}

export interface UseChatSocketOptions extends ChatSocketHandlers {
  conversationId: string | null
  enabled?: boolean
}

export interface ChatSocketApi {
  isConnected: boolean
  send: (payload: {
    conversationId: string
    content?: string
    mediaUrl?: string
    mediaType?: 'text' | 'image' | 'video' | 'audio' | 'file' | 'product'
    productId?: string
    replyToId?: string
    attachments?: Array<{
      url: string
      type: 'image' | 'video' | 'audio' | 'file'
      name?: string
      size?: number
      duration?: number
    }>
    // v16.8-final: optional self-destruct timer (voice messages).
    selfDestructMinutes?: number
  }) => void
  markRead: (conversationId: string) => void
  startTyping: (conversationId: string) => void
  stopTyping: (conversationId: string) => void
  deleteMessage: (params: { messageId: string; conversationId: string; forEveryone: boolean }) => void
  forwardMessage: (params: { sourceMessageId: string; targetConversationIds: string[] }) => void
}

/**
 * useChatSocket — wraps useSocket with chat-specific helpers.
 *
 * Wave 4 (F-ARCH-005): staged extraction. Currently delegates to useSocket
 * with all handlers passed through. Future iterations will move handler
 * definitions (e.g. dedup logic, sound playback) into this hook so the
 * view doesn't need to know about socket internals.
 */
export function useChatSocket(options: UseChatSocketOptions): ChatSocketApi {
  const { conversationId, enabled = true, ...handlers } = options

  const socketApi = useSocket({
    conversationId: conversationId || undefined,
    enabled,
    ...handlers,
  })

  const send = useCallback<ChatSocketApi['send']>((payload) => {
    socketApi.send(payload)
  }, [socketApi])

  const markRead = useCallback<ChatSocketApi['markRead']>((convId) => {
    socketApi.markRead(convId)
  }, [socketApi])

  const startTyping = useCallback<ChatSocketApi['startTyping']>((convId) => {
    socketApi.startTyping(convId)
  }, [socketApi])

  const stopTyping = useCallback<ChatSocketApi['stopTyping']>((convId) => {
    socketApi.stopTyping(convId)
  }, [socketApi])

  const deleteMessage = useCallback<ChatSocketApi['deleteMessage']>((params) => {
    socketApi.deleteMessage(params.messageId, params.conversationId, params.forEveryone)
  }, [socketApi])

  const forwardMessage = useCallback<ChatSocketApi['forwardMessage']>((params) => {
    socketApi.forwardMessage(params.sourceMessageId, params.targetConversationIds)
  }, [socketApi])

  return {
    isConnected: socketApi.isConnected,
    send,
    markRead,
    startTyping,
    stopTyping,
    deleteMessage,
    forwardMessage,
  }
}
