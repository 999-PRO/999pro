'use client'

// ChatListItem — extracted from chat.tsx (stage 12 refactor).
// Renders a single conversation card in the chat list.
// Pastel glass design with palette per user, online dot, unread badge,
// support pin, last message preview.
//
// v16.8.4: добавлена поддержка долгого нажатия (long-press) для открытия
// контекстного меню (Удалить / Очистить / Архивировать / Закрепить).

import { useRef, useCallback, memo } from 'react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { assetUrl } from '@/lib/api'
import { initials, timeAgo } from '@/lib/format'
import { getChatCardPalette } from '@/lib/gradients'
import { haptic } from '@/lib/haptic'
import type { Conversation } from '@/lib/types'

export interface ChatListItemProps {
  conversation: Conversation
  unread: number
  isActive: boolean
  /** v25.4: index is optional now (kept for back-compat but unused). */
  index?: number
  /** v25.4: convId passed to onClick/onLongPress so callbacks can be stable. */
  convId?: string
  onClick: (convId: string) => void
  onLongPress?: (convId: string) => void
}

// v25.4 (perf audit P-1): wrap in React.memo with a custom comparator so
// the card only re-renders when its own unread/isActive/conversation changes.
// Previously every ChatView re-render (keystroke, typing indicator, viewport
// resize) reconciled ALL 50-200 cards because the inline onClick/onLongPress
// arrows were new function identities each render.
function ChatListItemImpl({
  conversation: c,
  unread,
  isActive,
  onClick,
  onLongPress,
  convId,
}: ChatListItemProps) {
  const palette = getChatCardPalette(c.participant?.id || c.id)

  // ---- Long-press detection (mobile + desktop) ----
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressFired = useRef(false)
  const startPos = useRef<{ x: number; y: number } | null>(null)

  const startLongPress = useCallback((clientX: number, clientY: number) => {
    startPos.current = { x: clientX, y: clientY }
    longPressFired.current = false
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true
      haptic.tap()
      onLongPress?.(c.id)
    }, 500)
  }, [onLongPress, c.id])

  const cancelLongPress = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }, [])

  const handleTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0]
    startLongPress(t.clientX, t.clientY)
  }

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!startPos.current) return
    const t = e.touches[0]
    const dx = Math.abs(t.clientX - startPos.current.x)
    const dy = Math.abs(t.clientY - startPos.current.y)
    // If moved more than 10px, cancel long-press (it's a scroll)
    if (dx > 10 || dy > 10) {
      cancelLongPress()
    }
  }

  const handleTouchEnd = (e: React.TouchEvent) => {
    cancelLongPress()
    // If long-press fired, prevent the click
    if (longPressFired.current) {
      e.preventDefault()
    }
  }

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return // only left button
    startLongPress(e.clientX, e.clientY)
  }

  const handleMouseUp = () => {
    cancelLongPress()
  }

  const handleClick = () => {
    if (longPressFired.current) {
      longPressFired.current = false
      return // suppress click after long-press
    }
    onClick(c.id)
  }

  return (
    <button
      onClick={handleClick}
      onTouchStart={onLongPress ? handleTouchStart : undefined}
      onTouchMove={onLongPress ? handleTouchMove : undefined}
      onTouchEnd={onLongPress ? handleTouchEnd : undefined}
      onMouseDown={onLongPress ? handleMouseDown : undefined}
      onMouseUp={onLongPress ? handleMouseUp : undefined}
      onMouseLeave={onLongPress ? handleMouseUp : undefined}
      onContextMenu={onLongPress ? (e) => {
        e.preventDefault()
        onLongPress(c.id)
      } : undefined}
      className="animate-card-in w-full text-left rounded-2xl p-3 transition-transform duration-200 hover:scale-[1.01] select-none"
      style={{
        // v25.4: use a stable 0ms delay — `index` was removed to keep
        // ChatListItem props minimal for React.memo. The stagger animation
        // was barely visible and caused all cards to depend on `index`.
        animationDelay: '0ms',
        contentVisibility: 'auto' as React.CSSProperties['contentVisibility'],
        containIntrinsicSize: '72px',
        background: isActive
          ? `linear-gradient(135deg, ${palette.ring}22 0%, ${palette.solid}11 100%)`
          : palette.bg,
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        border: `1px solid ${isActive ? `${palette.solid}55` : `${palette.solid}1a`}`,
        boxShadow: isActive
          ? `0 4px 16px -4px ${palette.glow}, inset 0 0 0 1px ${palette.solid}22`
          : `0 2px 8px -2px rgba(0,0,0,0.06)`,
        WebkitTouchCallout: 'none',
        WebkitUserSelect: 'none',
        userSelect: 'none',
      }}
    >
      <div className="relative flex items-center gap-3">
        {/* Avatar 40px round with palette ring */}
        <div className="relative shrink-0">
          <Avatar
            className="h-10 w-10"
            style={{ boxShadow: `0 0 0 2px ${palette.ring}44` }}
          >
            <AvatarImage src={assetUrl(c.participant?.avatar)} />
            <AvatarFallback
              className="text-white font-bold text-sm"
              style={{
                background:
                  c.type === 'support'
                    ? 'linear-gradient(135deg, #60a5fa 0%, #3b82f6 100%)'
                    : `linear-gradient(135deg, ${palette.ring} 0%, ${palette.solid} 100%)`,
              }}
            >
              {initials(c.participant?.displayName || c.participant?.username || '?')}
            </AvatarFallback>
          </Avatar>
          {/* Online status dot — 8px, emerald */}
          {c.participant?.isOnline && (
            <div
              className="absolute bottom-0 right-0 h-2 w-2 rounded-full border-2 bg-emerald-500"
              style={{
                borderColor: 'var(--background)',
                boxShadow: '0 0 6px rgba(16, 185, 129, 0.6)',
              }}
            />
          )}
        </div>

        {/* Text content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-0.5">
            <div className="flex items-center gap-1.5 min-w-0">
              {/* Pinned badge for support conversations */}
              {c.type === 'support' && (
                <span
                  className="shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold text-white"
                  style={{ background: 'linear-gradient(135deg, #60a5fa 0%, #3b82f6 100%)' }}
                  title="Закреплённый чат с поддержкой"
                >
                  999PRO
                </span>
              )}
              <div className="text-sm font-semibold truncate text-foreground">
                {c.type === 'support'
                  ? 'Поддержка'
                  : c.participant?.displayName || c.participant?.username || 'Без имени'}
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {/* Unread badge — round 20px, palette accent */}
              {unread > 0 && (
                <span
                  className="grid place-items-center h-5 min-w-5 px-1.5 rounded-full text-[11px] font-bold text-white"
                  style={{ background: palette.solid, boxShadow: `0 0 8px ${palette.glow}` }}
                >
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
              {c.lastMessage && (
                <div className="text-[11px] text-muted-foreground">
                  {timeAgo(c.lastMessage.createdAt)}
                </div>
              )}
            </div>
          </div>
          <div className="text-xs text-muted-foreground truncate">
            {c.lastMessage?.deletedForAll
              ? 'Сообщение удалено'
              : c.lastMessage?.content ||
                (c.lastMessage?.attachments && c.lastMessage.attachments.length > 0
                  ? (() => {
                      const counts: Record<string, number> = {}
                      c.lastMessage.attachments!.forEach((a) => { counts[a.type] = (counts[a.type] || 0) + 1 })
                      const parts: string[] = []
                      if (counts.image) parts.push(`📷 ${counts.image}`)
                      if (counts.video) parts.push(`🎥 ${counts.video}`)
                      if (counts.file) parts.push(`📄 ${counts.file}`)
                      if (counts.audio) parts.push(`🎤 ${counts.audio}`)
                      return parts.join(' · ')
                    })()
                  : c.lastMessage?.mediaType === 'image'
                    ? '📷 Фото'
                    : c.lastMessage?.mediaType === 'video'
                      ? '🎥 Видео'
                      : c.lastMessage?.mediaType === 'audio'
                        ? '🎤 Голосовое'
                        : c.lastMessage?.mediaType === 'file'
                          ? '📎 Файл'
                          : c.lastMessage?.mediaType === 'product'
                            ? '🛍 Товар'
                            : 'Нет сообщений')}
          </div>
        </div>
      </div>
    </button>
  )
}

// v25.4 (perf audit P-1): memoize with a custom comparator so the card only
// re-renders when its own conversation data, unread count, or active state
// changes. Callbacks (onClick/onLongPress) are now stable (useCallback in
// parent) so they don't trigger re-renders.
export const ChatListItem = memo(ChatListItemImpl, (prev, next) => {
  return (
    prev.conversation.id === next.conversation.id &&
    prev.conversation.updatedAt === next.conversation.updatedAt &&
    prev.conversation.unreadCount === next.conversation.unreadCount &&
    prev.conversation.lastMessage?.id === next.conversation.lastMessage?.id &&
    prev.conversation.participant?.isOnline === next.conversation.participant?.isOnline &&
    prev.unread === next.unread &&
    prev.isActive === next.isActive
  )
})
