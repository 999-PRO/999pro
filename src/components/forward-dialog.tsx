'use client'

import { useEffect, useMemo, useState } from 'react'
import { Forward, Search, Send, X, Check } from 'lucide-react'
import { api, assetUrl } from '@/lib/api'
import type { Conversation, Message } from '@/lib/types'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { initials, timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'
import { toast } from '@/lib/notifications'

interface ForwardDialogProps {
  open: boolean
  message: Message | null
  onForward: (targetConversationIds: string[]) => void
  onClose: () => void
}

// ============================================================================
// ForwardDialog — premium modal for forwarding a message to one or more chats.
//
// Design goals:
//  - Beautiful, calm glassmorphism — matches the app's design system.
//  - Fast to scan: avatar + name + last message preview + time.
//  - Multi-select with a sticky action bar at the bottom showing the count
//    and a clear "Переслать" CTA.
//  - Search-as-you-type filters by display name or username.
//  - The message being forwarded is shown at the top in a soft preview card
//    so the user has full context before confirming.
// ============================================================================

export function ForwardDialog({ open, message, onForward, onClose }: ForwardDialogProps) {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!open) return
    setSelected(new Set())
    setSearch('')
    setLoading(true)
    api
      .get<{ items: Conversation[] }>('/api/chat/conversations', { query: { limit: 100 }, auth: true })
      .then((d) => setConversations(d.items))
      .catch(() => setConversations([]))
      .finally(() => setLoading(false))
  }, [open])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return conversations
    return conversations.filter((c) => {
      const name = c.participant?.displayName || c.participant?.username || ''
      const username = c.participant?.username || ''
      return name.toLowerCase().includes(q) || username.toLowerCase().includes(q)
    })
  }, [conversations, search])

  const toggle = (id: string) => {
    setSelected((cur) => {
      const next = new Set(cur)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleSend = () => {
    if (selected.size === 0) {
      toast.error('Выберите хотя бы один чат')
      return
    }
    onForward(Array.from(selected))
    onClose()
  }

  // Build a human-readable preview of the message being forwarded.
  let messagePreview = ''
  let messageIcon: 'text' | 'image' | 'video' | 'audio' | 'file' = 'text'
  if (message) {
    if (message.content) {
      messagePreview = message.content
    } else if (message.mediaType === 'image') {
      messagePreview = 'Фото'
      messageIcon = 'image'
    } else if (message.mediaType === 'video') {
      messagePreview = 'Видео'
      messageIcon = 'video'
    } else if (message.mediaType === 'audio') {
      messagePreview = 'Голосовое сообщение'
      messageIcon = 'audio'
    } else if (message.mediaType === 'file') {
      messagePreview = 'Файл'
      messageIcon = 'file'
    } else {
      messagePreview = 'Вложение'
      messageIcon = 'file'
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md md:max-w-lg rounded-3xl overflow-hidden p-0 gap-0" showCloseButton={false}>
        {/* Header — brand gradient with icon + title */}
        <div className="relative px-5 py-4 gradient-brand text-white">
          <div className="absolute -top-12 -right-12 h-32 w-32 rounded-full bg-white/15 blur-3xl pointer-events-none" />
          <DialogHeader className="space-y-0">
            <DialogTitle className="flex items-center gap-2.5 text-lg font-semibold">
              <div className="h-9 w-9 rounded-full bg-white/20 grid place-items-center backdrop-blur-sm">
                <Forward className="h-4 w-4" strokeWidth={2.5} />
              </div>
              Переслать сообщение
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs text-white/80 mt-1.5 ml-11">
            Выберите один или несколько чатов
          </p>
          <button
            onClick={onClose}
            className="absolute right-3 top-3 h-8 w-8 rounded-full bg-white/15 hover:bg-white/25 grid place-items-center transition-colors"
            aria-label="Закрыть"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Message preview card */}
        {message && (
          <div className="px-4 pt-4">
            <div className="rounded-2xl bg-accent/60 border border-border/40 px-3.5 py-2.5 backdrop-blur-sm">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">
                <Forward className="h-3 w-3" />
                Пересылаемое сообщение
              </div>
              <div className="flex items-center gap-2.5">
                <MessageIcon type={messageIcon} />
                <p className="text-sm text-foreground line-clamp-2 flex-1">
                  {messagePreview}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Search bar */}
        <div className="px-4 py-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск чатов…"
              className="w-full pl-10 pr-3 py-2.5 rounded-2xl bg-accent/50 border border-border/40 text-sm placeholder:text-muted-foreground/70 outline-none focus:border-primary/40 focus:bg-accent/70 transition-colors"
            />
          </div>
        </div>

        {/* Conversations list — scrollable area */}
        <div
          className="max-h-[44vh] min-h-[200px] overflow-y-auto px-2 pb-2 scrollbar-premium"
          style={{ overscrollBehavior: 'contain' } as React.CSSProperties}
        >
          {loading ? (
            <div className="py-10 grid place-items-center">
              <div className="h-7 w-7 rounded-full border-2 border-primary border-t-transparent animate-spin" />
              <p className="text-xs text-muted-foreground mt-2">Загрузка чатов…</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-10 text-center">
              <div className="h-12 w-12 mx-auto rounded-full bg-accent/60 grid place-items-center mb-2">
                <Search className="h-5 w-5 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">
                {search ? 'Чаты не найдены' : 'У вас пока нет чатов'}
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {filtered.map((c) => {
                const isSelected = selected.has(c.id)
                const name = c.participant?.displayName || c.participant?.username || 'Без имени'
                const lastMsg = c.lastMessage?.deletedForAll
                  ? 'Сообщение удалено'
                  : c.lastMessage?.content ||
                    (c.lastMessage?.mediaType === 'image'
                      ? '📷 Фото'
                      : c.lastMessage?.mediaType === 'video'
                        ? '🎥 Видео'
                        : c.lastMessage?.mediaType === 'audio'
                          ? '🎤 Голосовое'
                          : c.lastMessage?.mediaType === 'file'
                            ? '📎 Файл'
                            : 'Нет сообщений')
                return (
                  <button
                    key={c.id}
                    onClick={() => toggle(c.id)}
                    className={cn(
                      'w-full flex items-center gap-3 p-2.5 rounded-2xl transition-all text-left',
                      'border border-transparent',
                      isSelected
                        ? 'bg-primary/12 ring-1 ring-primary/30'
                        : 'hover:bg-accent/40 active:bg-accent/60',
                    )}
                  >
                    <div className="relative shrink-0">
                      <Avatar className="h-11 w-11 ring-2 ring-border/40">
                        {c.participant?.avatar ? (
                          <AvatarImage src={assetUrl(c.participant.avatar)} alt={name} />
                        ) : null}
                        <AvatarFallback className="gradient-brand text-white text-xs font-bold">
                          {initials(name)}
                        </AvatarFallback>
                      </Avatar>
                      {c.participant?.isOnline && (
                        <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full bg-emerald-400 border-2 border-background" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-semibold truncate text-foreground">{name}</div>
                        {c.lastMessage && (
                          <div className="text-[10px] text-muted-foreground shrink-0">
                            {timeAgo(c.lastMessage.createdAt)}
                          </div>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">{lastMsg}</div>
                    </div>
                    {/* Selection indicator */}
                    <div
                      className={cn(
                        'h-6 w-6 rounded-full grid place-items-center transition-all shrink-0 border-2',
                        isSelected
                          ? 'bg-primary border-primary text-primary-foreground'
                          : 'border-border/60 text-transparent',
                      )}
                    >
                      <Check className="h-3.5 w-3.5" strokeWidth={3} />
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Sticky action bar */}
        <div className="border-t border-border/40 px-4 py-3 flex items-center gap-2 bg-background/95 backdrop-blur-sm">
          <Button
            variant="ghost"
            className="rounded-full text-muted-foreground hover:text-foreground"
            onClick={onClose}
          >
            Отмена
          </Button>
          <div className="flex-1" />
          {selected.size > 0 && (
            <span className="text-xs text-muted-foreground mr-1">
              Выбрано: <span className="font-semibold text-foreground">{selected.size}</span>
            </span>
          )}
          <Button
            onClick={handleSend}
            disabled={selected.size === 0}
            className="rounded-full gradient-brand text-white shadow-glow gap-1.5 px-5 disabled:opacity-50 disabled:shadow-none"
          >
            <Send className="h-4 w-4" />
            Переслать
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// Small icon for the message preview — gives visual context at a glance.
function MessageIcon({ type }: { type: 'text' | 'image' | 'video' | 'audio' | 'file' }) {
  const Icon = type === 'image'
    ? PhotoIcon
    : type === 'video'
      ? VideoIcon
      : type === 'audio'
        ? MicIcon
        : type === 'file'
          ? FileIcon
          : MessageIconText
  return (
    <div className="h-8 w-8 rounded-xl bg-primary/10 grid place-items-center text-primary shrink-0">
      <Icon />
    </div>
  )
}

// Inline SVGs (smaller than pulling the whole lucide bundle).
function PhotoIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
    </svg>
  )
}
function VideoIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m22 8-6 4 6 4V8Z" />
      <rect x="2" y="6" width="14" height="12" rx="2" />
    </svg>
  )
}
function MicIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" x2="12" y1="19" y2="22" />
    </svg>
  )
}
function FileIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2Z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  )
}
function MessageIconText() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  )
}
