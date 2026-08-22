'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { api, assetUrl } from '@/lib/api'
import type { Conversation, Message } from '@/lib/types'
import { useAuthStore } from '@/lib/auth-store'
import { useSocket } from '@/lib/use-socket'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Textarea } from '@/components/ui/textarea'
// useScrollLock removed — SupportView is a routed view, not a modal (F-HIGH-001).
import { toast } from '@/lib/notifications'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Headphones, Send, Paperclip, Image as ImageIcon, Loader2,
  Check, CheckCheck, ChevronLeft, FileText, X,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// formatPrice imported but not used in this component — removed to keep lint clean.

// ============================================================================
// SupportView — full support chat between the user and the 999PRO team.
//
// Reuses the existing chat infrastructure (Socket.IO + REST API) but wraps
// it in a dedicated UI that:
// - Auto-creates a support conversation on first visit (POST /api/chat/support)
// - Shows a "team" header instead of the other participant's name
// - Supports text + image + file messages
// - Real-time message delivery via Socket.IO
// - Read receipts (✓ / ✓✓)
// - Auto-scroll to bottom on new message
// - Loading states for connection + message send
// ============================================================================

interface SupportMessage extends Message {
  // Override sender to always include the full user object (the backend
  // returns it for messages, but we want to be defensive).
  // NOTE: type must EXACTLY match Message.sender (`{...} | null`) — adding
  // `| undefined` breaks `extends` under TypeScript strict mode because
  // the parent type doesn't include `undefined`.
  sender?: {
    id: string
    username: string
    displayName?: string | null
    avatar?: string | null
  }
  // Extra UI-only fields not present on Message.
  failed?: boolean
}

export function SupportView({ onNavigate }: { onNavigate: (v: string) => void }) {
  const user = useAuthStore((s) => s.user)
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const [conversation, setConversation] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<SupportMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [connected, setConnected] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  // SupportView is a routed full-page view (not a modal), so it must NOT
  // lock body scroll. F-HIGH-001: previously `useScrollLock(true)` was called
  // unconditionally with a literal `true`, locking scroll forever after the
  // user navigated to /?view=support.

  // Get-or-create the support conversation on mount.
  const initConversation = useCallback(async () => {
    if (!isAuthenticated) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const data = await api.post<{ conversation: Conversation }>('/api/chat/support', { auth: true })
      setConversation(data.conversation)
      // Load message history
      const msgData = await api.get<{ items: SupportMessage[] }>(
        `/api/chat/conversations/${data.conversation.id}/messages`,
        { query: { limit: 100 }, auth: true },
      )
      setMessages(msgData.items.reverse()) // API returns newest-first, we want oldest-first
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Не удалось подключиться к поддержке'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [isAuthenticated])

  useEffect(() => {
    initConversation()
  }, [initConversation])

  // Socket.IO: listen for incoming messages in real-time.
  // FIX (Phase 4): capture isConnected from useSocket to reflect the REAL
  // connection state in the header indicator. Previously a fake setInterval
  // set connected=true every 2s regardless of actual socket state.
  const { isConnected: socketConnected } = useSocket({
    enabled: !!conversation && isAuthenticated,
    onMessage: useCallback((m: Message) => {
      if (m.conversationId !== conversation?.id) return
      setMessages((cur) => {
        // Avoid duplicates (Socket may deliver the same message we just sent)
        if (cur.some((x) => x.id === m.id)) return cur
        return [...cur, m as SupportMessage]
      })
      // Mark as read immediately since the user is viewing the conversation
      if (m.senderId !== user?.id && conversation) {
        api.patch(`/api/chat/messages/${m.id}/read`, { auth: true }).catch(() => {})
      }
    }, [conversation?.id, user?.id]),
  })

  // Track connection state for the indicator in the header.
  // FIX (Phase 4): use real socket connection state from useSocket instead
  // of a fake setInterval that always sets connected=true.
  useEffect(() => {
    setConnected(socketConnected)
  }, [socketConnected])

  // Auto-scroll to bottom on new messages.
  useEffect(() => {
    const el = messagesEndRef.current
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }
  }, [messages])

  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault()
    const content = text.trim()
    if (!content || !conversation || sending) return
    setSending(true)
    const tempId = `tmp_${Date.now()}`
    const optimistic: SupportMessage = {
      id: tempId,
      conversationId: conversation.id,
      senderId: user!.id,
      content,
      mediaUrl: null,
      mediaType: 'text',
      isRead: false,
      // `deletedFor` was a raw string column on the backend, but the
      // client-side `Message` type exposes it as `deletedForMe: boolean`.
      // Removed — it was never read client-side anyway.
      deletedForAll: false,
      deletedForMe: false,
      createdAt: new Date().toISOString(),
      // `replyToId` / `forwardedFromId` are backend column names — the
      // client `Message` type uses `replyTo` / `forwardedFrom` (object refs).
      replyTo: null,
      forwardedFrom: null,
      duration: null,
      tempId,
      sender: {
        id: user!.id,
        username: user!.username,
        displayName: user!.displayName,
        avatar: user!.avatar,
      },
    }
    setMessages((cur) => [...cur, optimistic])
    setText('')
    try {
      const sent = await api.post<SupportMessage>(
        `/api/chat/conversations/${conversation.id}/messages`,
        { json: { content, tempId }, auth: true },
      )
      setMessages((cur) => cur.map((m) => (m.id === tempId ? sent : m)))
    } catch (err: unknown) {
      // Mark the optimistic message as failed
      setMessages((cur) => cur.map((m) => (m.id === tempId ? { ...m, failed: true } as SupportMessage : m)))
      const msg = err instanceof Error ? err.message : 'Не удалось отправить сообщение'
      toast.error(msg)
    } finally {
      setSending(false)
    }
  }

  const handleFileUpload = async (file: File, isImage: boolean) => {
    if (!conversation || uploading) return
    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const data = await api.post<{ url: string }>('/api/upload', { form: formData, auth: true })
      const tempId = `tmp_${Date.now()}`
      const mediaType = isImage ? 'image' : 'file'
      const optimistic: SupportMessage = {
        id: tempId,
        conversationId: conversation.id,
        senderId: user!.id,
        content: null,
        mediaUrl: data.url,
        mediaType,
        isRead: false,
        deletedForAll: false,
        deletedForMe: false,
        createdAt: new Date().toISOString(),
        replyTo: null,
        forwardedFrom: null,
        duration: null,
        tempId,
        sender: { id: user!.id, username: user!.username, displayName: user!.displayName, avatar: user!.avatar },
      }
      setMessages((cur) => [...cur, optimistic])
      const sent = await api.post<SupportMessage>(
        `/api/chat/conversations/${conversation.id}/messages`,
        { json: { mediaUrl: data.url, mediaType, tempId }, auth: true },
      )
      setMessages((cur) => cur.map((m) => (m.id === tempId ? sent : m)))
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Не удалось загрузить файл'
      toast.error(msg)
    } finally {
      setUploading(false)
    }
  }

  if (!isAuthenticated) {
    return (
      <div className="page-top-padding pb-28 md:pb-6 px-6 text-center max-w-md mx-auto min-h-[60vh] flex flex-col items-center justify-center">
        <div className="h-24 w-24 rounded-full gradient-brand mx-auto mb-4 grid place-items-center shadow-glow">
          <Headphones className="h-10 w-10 text-white" />
        </div>
        <h2 className="text-2xl font-extrabold mb-2">Поддержка</h2>
        <p className="text-muted-foreground mb-5">Войдите, чтобы начать чат с командой 999PRO</p>
        <Button
          onClick={() => onNavigate('home')}
          className="rounded-full gradient-brand text-white font-semibold shadow-glow h-11 px-6"
        >
          На главную
        </Button>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="page-top-padding pb-28 md:pb-6 flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-3 text-primary" />
          <p className="text-sm text-muted-foreground">Подключение к поддержке…</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="page-top-padding pb-28 md:pb-6 px-6 text-center max-w-md mx-auto min-h-[60vh] flex flex-col items-center justify-center">
        <div className="h-20 w-20 rounded-full bg-destructive/15 mx-auto mb-4 grid place-items-center">
          <X className="h-10 w-10 text-destructive" />
        </div>
        <h2 className="text-xl font-bold mb-2">Не удалось подключиться</h2>
        <p className="text-sm text-muted-foreground mb-5">{error}</p>
        <Button onClick={initConversation} className="rounded-full gradient-brand text-white h-11 px-6">
          Попробовать снова
        </Button>
      </div>
    )
  }

  // Find the "other" participant (the support agent) for the header.
  // Conversation type uses `participant` (singular, the other party in a
  // 1-on-1 chat) — not `participants` (plural). The previous code path
  // always returned undefined, so the header always showed the fallback
  // Headphones icon. Now we use the correct field.
  const supportAgent = conversation?.participant ?? null

  return (
    <div className="flex flex-col h-screen md:h-[calc(100vh-0px)] page-top-padding-fix">
      {/* Header */}
      <div className="glass border-b border-border/30 px-4 py-3 flex items-center gap-3 sticky top-0 z-10 bg-background/80 backdrop-blur">
        <button
          onClick={() => onNavigate('home')}
          className="h-9 w-9 rounded-full hover:bg-accent grid place-items-center"
          aria-label="Назад"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="relative">
          <Avatar className="h-10 w-10">
            {supportAgent?.avatar && <AvatarImage src={supportAgent.avatar} alt="Support" />}
            <AvatarFallback className="gradient-brand text-white">
              <Headphones className="h-5 w-5" />
            </AvatarFallback>
          </Avatar>
          {connected && (
            <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full bg-emerald-500 border-2 border-background" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm">Поддержка 999PRO</div>
          <div className="text-xs text-muted-foreground">
            {connected ? 'Онлайн · отвечает в течение часа' : 'Подключение…'}
          </div>
        </div>
      </div>

      {/* Messages */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto px-4 py-4 space-y-3 scrollbar-premium"
        style={{ maxHeight: 'calc(100vh - 11rem)' }}
      >
        {/* Welcome message banner */}
        <div className="text-center py-2">
          <div className="inline-block px-4 py-2 rounded-full glass text-xs text-muted-foreground">
            Чат с поддержкой · ответы в течение 1 часа
          </div>
        </div>

        <AnimatePresence initial={false}>
          {messages.map((m) => (
            <MessageBubble
              key={m.id}
              message={m}
              isOwn={m.senderId === user?.id}
            />
          ))}
        </AnimatePresence>

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form
        onSubmit={handleSend}
        className="border-t border-border/30 bg-background/80 backdrop-blur p-3 flex items-end gap-2 sticky bottom-0"
      >
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) handleFileUpload(f, false)
            e.target.value = ''
          }}
        />
        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) handleFileUpload(f, true)
            e.target.value = ''
          }}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="rounded-full h-10 w-10 shrink-0"
          onClick={() => imageInputRef.current?.click()}
          disabled={uploading || sending}
          aria-label="Прикрепить фото"
        >
          {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImageIcon className="h-5 w-5" />}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="rounded-full h-10 w-10 shrink-0"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading || sending}
          aria-label="Прикрепить файл"
        >
          <Paperclip className="h-5 w-5" />
        </Button>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Напишите сообщение…"
          rows={1}
          className="flex-1 min-h-[40px] max-h-32 resize-none rounded-2xl bg-accent/30"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              handleSend()
            }
          }}
        />
        <Button
          type="submit"
          size="icon"
          disabled={!text.trim() || sending}
          className="rounded-full h-10 w-10 gradient-brand text-white shadow-glow shrink-0"
          aria-label="Отправить"
        >
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </form>
    </div>
  )
}

// ============================================================================
// MessageBubble — single message in the support chat.
// ============================================================================

function MessageBubble({ message, isOwn }: { message: SupportMessage; isOwn: boolean }) {
  const time = new Date(message.createdAt).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn('flex gap-2 max-w-[80%]', isOwn ? 'ml-auto flex-row-reverse' : 'flex-row')}
    >
      {!isOwn && (
        <Avatar className="h-7 w-7 shrink-0 mt-1">
          {message.sender?.avatar && <AvatarImage src={message.sender.avatar} alt={message.sender?.displayName || message.sender?.username || 'Support agent'} />}
          <AvatarFallback className="gradient-brand text-white text-[10px]">
            <Headphones className="h-3.5 w-3.5" />
          </AvatarFallback>
        </Avatar>
      )}
      <div className={cn('flex flex-col', isOwn ? 'items-end' : 'items-start')}>
        <div
          className={cn(
            'rounded-2xl px-3 py-2 text-sm break-words',
            isOwn
              ? 'gradient-brand text-white rounded-br-md'
              : 'glass rounded-bl-md',
            message.failed && 'opacity-60 border border-destructive/40',
          )}
        >
          {message.content && <p className="whitespace-pre-wrap selectable">{message.content}</p>}
          {message.mediaUrl && message.mediaType === 'image' && (
            <a href={assetUrl(message.mediaUrl)} target="_blank" rel="noopener noreferrer" className="block mt-1">
              <img
                src={assetUrl(message.mediaUrl)}
                alt="Фото"
                className="rounded-xl max-w-[240px] max-h-[200px] object-cover"
                loading="lazy"
              />
            </a>
          )}
          {message.mediaUrl && message.mediaType === 'file' && (
            <a
              href={assetUrl(message.mediaUrl)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 mt-1 px-2 py-1.5 rounded-xl bg-black/10 hover:bg-black/20 transition-colors"
            >
              <FileText className="h-4 w-4 shrink-0" />
              <span className="text-xs underline">Скачать файл</span>
            </a>
          )}
        </div>
        <div className={cn('flex items-center gap-1 mt-1 px-1', isOwn ? 'flex-row-reverse' : 'flex-row')}>
          <span className="text-[10px] text-muted-foreground">{time}</span>
          {isOwn && (
            message.isRead ? (
              <CheckCheck className="h-3 w-3 text-blue-500" />
            ) : message.failed ? (
              <span className="text-[10px] text-destructive">не отправлено</span>
            ) : (
              <Check className="h-3 w-3 text-muted-foreground" />
            )
          )}
        </div>
      </div>
    </motion.div>
  )
}
