'use client'

// ============================================================================
//  ChatRecipientPicker — premium bottom sheet for choosing chat recipient(s)
//  when sharing a product (or any shareable entity) directly into a chat.
//
//  Design goals:
//    • Looks & feels native to 999 — Три девятки — reuses InteractiveSheet, glass cards,
//      palette per user, online dot, timeAgo, formatPrice — no new design tokens.
//    • Mirrors the chat-list behaviour of chat.tsx (same /api/chat/users +
//      /api/chat/conversations endpoints, same search debounce, same
//      support-chat pinning rule).
//    • Single-select mode by default. Multi-select can be enabled via prop
//      for future "broadcast" features; not used today to keep UX simple.
//    • On select: calls onPick(participantId) — the parent decides whether
//      to start a new conversation, reuse an existing one, and what message
//      payload to send. This keeps the picker decoupled from messaging logic.
// ============================================================================

import { useEffect, useState, useCallback, useRef } from 'react'
import { X, Search, MessageCircle, Check, Loader2, AlertCircle } from 'lucide-react'
import { InteractiveSheet } from '@/components/ui/interactive-sheet'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { api, assetUrl } from '@/lib/api'
import { initials, timeAgo } from '@/lib/format'
import { getChatCardPalette } from '@/lib/gradients'
import { cn } from '@/lib/utils'
import { toast } from '@/lib/notifications'
import type { Conversation, ChatUser } from '@/lib/types'

interface Props {
  open: boolean
  onClose: () => void
  /** Called when the user picks a recipient. Receives the participantId and
   *  an optional existing conversationId (if the user picked from existing
   *  chats). The parent decides what to do (start new conv, send message). */
  onPick: (participantId: string, existingConversationId?: string) => void
  /** Optional title override. Default: "Отправить в чат". */
  title?: string
  /** When true, shows a checkmark on selected items and allows picking
   *  multiple recipients. Default: false (single-select). */
  multiSelect?: boolean
  /** When multiSelect is true, called with the full set of selected ids. */
  onPickMulti?: (participantIds: string[]) => void
}

export function ChatRecipientPicker({
  open,
  onClose,
  onPick,
  title = 'Отправить в чат',
  multiSelect = false,
  onPickMulti,
}: Props) {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [chatUsers, setChatUsers] = useState<ChatUser[]>([])
  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState<ChatUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [submitting, setSubmitting] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ---- Fetch existing conversations + chat users on open ----
  // We DO call setLoading(true) + setError(false) when `open` flips to true.
  // React 19's `react-hooks/set-state-in-effect` rule warns about this, but
  // the cascading render here is intentional and cheap (one extra render to
  // reset the picker's state when the user re-opens it). Suppressing the rule.
  useEffect(() => {
    if (!open) return
    let alive = true
    setLoading(true)
    setError(false)

    Promise.all([
      // QW2 (F-BUG-001): backend returns { items: [...] }, not { conversations: [...] }
      api.get<{ items: Conversation[] }>('/api/chat/conversations', { auth: true }),
      api.get<{ users: ChatUser[] }>('/api/chat/users', { auth: true, query: { limit: 200 } }),
    ])
      .then(([convRes, usersRes]) => {
        if (!alive) return
        setConversations(convRes.items || [])
        setChatUsers(usersRes.users || [])
      })
      .catch(() => {
        if (!alive) return
        setError(true)
      })
      .finally(() => {
        if (!alive) return
        setLoading(false)
      })

    return () => {
      alive = false
    }
  }, [open])

  // ---- Debounced user search ----
  useEffect(() => {
    if (!open) return
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    if (!search.trim()) {
      setSearchResults([])
      return
    }
    searchTimerRef.current = setTimeout(() => {
      api
        .get<{ users: ChatUser[] }>('/api/chat/users', {
          query: { q: search.trim(), limit: 50 },
          auth: true,
        })
        .then((d) => setSearchResults(d.users || []))
        .catch(() => setSearchResults([]))
    }, 250)
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    }
  }, [search, open])

  // Reset selection on close
  useEffect(() => {
    if (!open) {
      setSelected(new Set())
      setSearch('')
    }
  }, [open])

  // ---- Build the visible list ----
  // 1. Pinned support chat first (type='support')
  // 2. Existing direct conversations sorted by updatedAt desc
  // 3. Then registered users we have NO conversation with (so the user can
  //    start a new chat by tapping them)
  // 4. If search is non-empty, only show search results.
  const meIdRaw =
    typeof window !== 'undefined'
      ? (() => {
          try {
            const raw = window.localStorage.getItem('999pro-auth')
            if (!raw) return null
            const parsed = JSON.parse(raw)
            return parsed?.state?.user?.id || null
          } catch {
            return null
          }
        })()
      : null

  const existingConvUserIds = new Set(
    conversations
      .filter((c) => c.type !== 'support' && c.participant)
      .map((c) => c.participant!.id),
  )

  const sortedConvs = [...conversations].sort((a, b) => {
    // Support first
    if (a.type === 'support' && b.type !== 'support') return -1
    if (a.type !== 'support' && b.type === 'support') return 1
    // Then by updatedAt desc
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  })

  const usersWithoutConv = chatUsers.filter(
    (u) => u.id !== meIdRaw && !existingConvUserIds.has(u.id),
  )

  // ---- Pick handler ----
  const handlePick = useCallback(
    async (participantId: string, existingConversationId?: string) => {
      if (multiSelect) {
        setSelected((cur) => {
          const next = new Set(cur)
          if (next.has(participantId)) next.delete(participantId)
          else next.add(participantId)
          return next
        })
        return
      }

      // Single-select: immediately call onPick. The parent will start the
      // conversation and send the message.
      setSubmitting(participantId)
      try {
        await onPick(participantId, existingConversationId)
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Не удалось отправить'
        toast.error(msg)
      } finally {
        setSubmitting(null)
      }
    },
    [multiSelect, onPick],
  )

  const handleSendMulti = useCallback(async () => {
    if (selected.size === 0 || !onPickMulti) return
    setSubmitting('multi')
    try {
      await onPickMulti(Array.from(selected))
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Не удалось отправить'
      toast.error(msg)
    } finally {
      setSubmitting(null)
    }
  }, [selected, onPickMulti])

  // ---- Render a single row (user or conversation) ----
  const renderUserRow = (
    user: { id: string; username: string; displayName: string | null; avatar: string | null; isOnline?: boolean; lastSeen?: string },
    existingConversationId?: string,
    index: number = 0,
  ) => {
    const isSelected = selected.has(user.id)
    const palette = getChatCardPalette(user.id)
    const isSubmittingThis = submitting === user.id

    return (
      <button
        key={user.id}
        onClick={() => handlePick(user.id, existingConversationId)}
        disabled={!!submitting}
        className="animate-card-in w-full text-left rounded-2xl p-3 transition-transform duration-200 hover:scale-[1.01] disabled:opacity-50 disabled:hover:scale-100"
        style={{
          animationDelay: `${Math.min(index, 8) * 40}ms`,
          background: isSelected ? `linear-gradient(135deg, ${palette.ring}22 0%, ${palette.solid}11 100%)` : palette.bg,
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          border: `1px solid ${isSelected ? `${palette.solid}55` : `${palette.solid}1a`}`,
          boxShadow: `0 2px 8px -2px rgba(0,0,0,0.06)`,
        }}
      >
        <div className="relative flex items-center gap-3">
          {/* Avatar 40px with palette ring */}
          <div className="relative shrink-0">
            <Avatar className="h-10 w-10 ring-2" style={{ '--tw-ring-color': palette.solid } as React.CSSProperties}>
              {user.avatar ? <AvatarImage src={assetUrl(user.avatar)} /> : null}
              <AvatarFallback style={{ background: palette.solid, color: '#fff' }}>
                {initials(user.displayName || user.username)}
              </AvatarFallback>
            </Avatar>
            {user.isOnline && (
              <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-emerald-500 ring-2 ring-background" />
            )}
          </div>

          {/* Name + last-seen */}
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm truncate text-foreground">
              {user.displayName || user.username}
            </div>
            <div className="text-[11px] text-muted-foreground truncate">
              {user.isOnline
                ? 'в сети'
                : user.lastSeen
                  ? `был(а) ${timeAgo(user.lastSeen)}`
                  : `@${user.username}`}
            </div>
          </div>

          {/* Right side: checkmark (multi-select) or chevron (single) or spinner */}
          {isSubmittingThis ? (
            <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
          ) : multiSelect ? (
            <div
              className={cn(
                'h-5 w-5 rounded-full grid place-items-center shrink-0 transition-colors',
                isSelected ? 'bg-primary text-primary-foreground' : 'bg-muted border border-border',
              )}
            >
              {isSelected && <Check className="h-3 w-3" />}
            </div>
          ) : null}
        </div>
      </button>
    )
  }

  // ---- Render the conversation row (uses participant info) ----
  const renderConvRow = (c: Conversation, index: number) => {
    if (!c.participant) return null
    return renderUserRow(
      {
        id: c.participant.id,
        username: c.participant.username,
        displayName: c.participant.displayName || null,
        avatar: c.participant.avatar || null,
        isOnline: c.participant.isOnline,
        lastSeen: c.participant.lastSeen,
      },
      c.id,
      index,
    )
  }

  // ---- Body content ----
  const showSearchResults = search.trim().length > 0
  const hasAny =
    sortedConvs.length > 0 ||
    usersWithoutConv.length > 0 ||
    (showSearchResults && searchResults.length > 0)

  return (
    <InteractiveSheet
      open={open}
      onClose={onClose}
      side="bottom"
      ariaLabel={title}
      desktopWidth={520}
      // z-index via inline style — MUST be above SmartShareSheet (z-[100]).
      // Inline style wins over Tailwind classes regardless of
      // tailwind-merge behaviour, so this is the most reliable way to
      // guarantee the picker renders on top of the share sheet.
      className="z-[120]"
      panelClassName="bg-background border-border/40 max-h-[100vh] md:max-h-full"
    >
      <div className="flex flex-col h-[85vh] md:h-[80vh]">
        {/* Header */}
        <div className="px-5 pt-4 pb-3 flex items-start justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-sky-400 via-blue-500 to-violet-600 grid place-items-center text-white shrink-0">
              <MessageCircle className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="font-bold text-base leading-tight">{title}</div>
              <div className="text-xs text-muted-foreground truncate">
                Выберите получателя
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Закрыть"
            className="h-8 w-8 rounded-full bg-muted grid place-items-center hover:bg-muted/80 transition-colors shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Search */}
        <div className="px-5 pb-3 shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск по имени или @username"
              className="w-full h-11 rounded-2xl bg-muted/60 pl-10 pr-4 text-sm font-medium placeholder:text-muted-foreground/70 border border-border/40 focus:outline-none focus:ring-2 focus:ring-primary/40"
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto overscroll-contain px-5 pb-4 space-y-2">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin mb-2" />
              <div className="text-sm">Загрузка чатов…</div>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
              <AlertCircle className="h-6 w-6 mb-2" />
              <div className="text-sm mb-3">Не удалось загрузить чаты</div>
              <button
                onClick={() => {
                  setError(false)
                  setLoading(true)
                  Promise.all([
                    api.get<{ conversations: Conversation[] }>('/api/chat/conversations', { auth: true }),
                    api.get<{ users: ChatUser[] }>('/api/chat/users', { auth: true, query: { limit: 200 } }),
                  ])
                    .then(([convRes, usersRes]) => {
                      setConversations(convRes.conversations || [])
                      setChatUsers(usersRes.users || [])
                    })
                    .catch(() => setError(true))
                    .finally(() => setLoading(false))
                }}
                className="text-sm font-semibold text-primary hover:underline"
              >
                Повторить
              </button>
            </div>
          ) : !hasAny ? (
            <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
              <MessageCircle className="h-6 w-6 mb-2 opacity-50" />
              <div className="text-sm">
                {showSearchResults ? 'Ничего не найдено' : 'Нет доступных получателей'}
              </div>
            </div>
          ) : showSearchResults ? (
            // ---- Search results: only users ----
            <>
              {searchResults.length > 0 ? (
                searchResults.map((u, i) => renderUserRow(u, undefined, i))
              ) : (
                <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
                  <Search className="h-6 w-6 mb-2 opacity-50" />
                  <div className="text-sm">Ничего не найдено</div>
                </div>
              )}
            </>
          ) : (
            <>
              {/* ---- Existing conversations ---- */}
              {sortedConvs.length > 0 && (
                <div className="space-y-2">
                  {sortedConvs.map((c, i) => renderConvRow(c, i))}
                </div>
              )}

              {/* ---- Users without existing conversation ---- */}
              {usersWithoutConv.length > 0 && (
                <>
                  <div className="pt-3 pb-1 px-1">
                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      {sortedConvs.length > 0 ? 'Другие пользователи' : 'Все пользователи'}
                    </div>
                  </div>
                  <div className="space-y-2">
                    {usersWithoutConv.slice(0, 50).map((u, i) => renderUserRow(u, undefined, i))}
                  </div>
                </>
              )}
            </>
          )}
        </div>

        {/* Footer (multi-select only) */}
        {multiSelect && (
          <div className="px-5 py-3 border-t border-border/40 shrink-0 safe-area-pb">
            <button
              onClick={handleSendMulti}
              disabled={selected.size === 0 || !!submitting}
              className="w-full h-12 rounded-2xl bg-gradient-to-r from-blue-600 to-violet-600 text-white font-bold shadow-lg shadow-blue-500/30 hover:shadow-xl hover:scale-[1.02] transition-all disabled:opacity-50 disabled:hover:scale-100 flex items-center justify-center gap-2"
            >
              {submitting === 'multi' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              {selected.size === 0
                ? 'Выберите получателей'
                : `Отправить ${selected.size} ${selected.size === 1 ? 'получателю' : 'получателям'}`}
            </button>
          </div>
        )}
      </div>
    </InteractiveSheet>
  )
}
