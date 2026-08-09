'use client'

// MessageBubble — extracted from chat.tsx.
// Renders a single chat message: text, image, video, audio, document, or reply/forward.
// Long-press (mobile) or right-click (desktop) opens the context menu.

import React, { useRef } from 'react'
import {
  Check, CheckCheck, Forward, Trash2, Star,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { assetUrl } from '@/lib/api'
import { formatTime } from '@/lib/format'
import { linkify } from '@/lib/message-utils'
import { OUTGOING_GRADIENT } from '@/lib/gradients'
import type { Message } from '@/lib/types'
import { DocumentAttachment } from '@/components/document-attachment'
import { AudioMessage } from './audio-message'
import { ProductMessageCard } from './product-message-card'
import { AttachmentGroup } from './attachment-group'
import { SwipeToReply } from './swipe-to-reply'
// v16.9.2: Audio Hub card — lazy-loaded to keep the chat bundle small.
import dynamic from 'next/dynamic'
const AudioChatCard = dynamic(
  () => import('@/modules/audio-hub/components/audio-chat-card').then(m => ({ default: m.AudioChatCard })),
  { ssr: false },
)
// v17: Video Hub film card — also lazy-loaded.
const FilmChatCard = dynamic(
  () => import('@/modules/films/components/film-chat-card').then(m => ({ default: m.FilmChatCard })),
  { ssr: false },
)

export interface MessageBubbleProps {
  message: Message
  isOwn: boolean
  onContextMenu: (e: React.MouseEvent | React.TouchEvent) => void
  onScrollToMessage: (id: string) => void
  onImageClick?: (imageUrl: string) => void
  registerRef: (el: HTMLDivElement | null) => void
  /** Open the product bottom-sheet (same flow as clicking a product in the
   *  catalog grid). Called when the user taps an inline product card. */
  onOpenProduct?: (productId: string) => void
  /** Called when the user swipe-to-replies this message. Parent sets this
   *  message as the reply target. */
  onReply?: (message: Message) => void
  /** v16.8.3: Избранное — показывает значок ⭐ на сообщении и позволяет toggling. */
  isFavorite?: boolean
  onToggleFavorite?: () => void
}

export function MessageBubbleImpl({ message, isOwn, onContextMenu, onScrollToMessage, onImageClick, registerRef, onOpenProduct, onReply, isFavorite, onToggleFavorite }: MessageBubbleProps) {
  const isDeleted = message.deletedForAll

  // Long-press for mobile.
  // v16.8 final fix: при долгом нажатии браузер по умолчанию начинает выделять
  // текст сообщения (native text selection + iOS callout menu). Чтобы этого
  // не происходило:
  //   1. `e.preventDefault()` в onTouchStart — блокирует native context menu
  //      и text-selection callout на iOS Safari.
  //   2. `-webkit-touch-callout: none` + `user-select: none` на самом bubble —
  //      отключает long-press callout и выделение текста на тач-устройствах.
  //   3. `touch-action: manipulation` — позволяет tap/scroll, но блокирует
  //      double-tap zoom (который тоже может запустить selection).
  // При этом обычный tap остаётся рабочим (links внутри сообщения кликабельны
  // через `linkify`), а выделение текста доступно через double-tap на desktop
  // и через long-press на oscrollable area вокруг bubble.
  const touchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onTouchStart = (e: React.TouchEvent) => {
    // preventDefault на touchstart блокирует native text-selection callout
    // на iOS. Не блокирует click (он работает через touchend без long-press).
    e.preventDefault()
    touchTimerRef.current = setTimeout(() => onContextMenu(e), 500)
  }
  const onTouchEnd = () => {
    if (touchTimerRef.current) clearTimeout(touchTimerRef.current)
  }

  let preview = ''
  if (isDeleted) preview = 'Сообщение удалено'
  else if (message.content) preview = message.content
  else if (message.attachments && message.attachments.length > 0) {
    // v12: attachment group preview
    const counts: Record<string, number> = {}
    message.attachments.forEach((a) => { counts[a.type] = (counts[a.type] || 0) + 1 })
    const parts: string[] = []
    if (counts.image) parts.push(`📷 Фото (${counts.image})`)
    if (counts.video) parts.push(`🎥 Видео (${counts.video})`)
    if (counts.file) parts.push(`📄 Документы (${counts.file})`)
    if (counts.audio) parts.push(`🎤 Голосовые (${counts.audio})`)
    preview = parts.join(' · ')
  }
  else if (message.mediaType === 'image') preview = '📷 Фото'
  else if (message.mediaType === 'video') preview = '🎥 Видео'
  else if (message.mediaType === 'audio') preview = '🎤 Голосовое'
  else if (message.mediaType === 'product') preview = '🛍 Товар'
  else if (message.mediaType === 'audio-hub') preview = '🎵 Аудио'
  else if (message.mediaType === 'film') preview = '🎬 Фильм'

  // Определяем тип контента для рендера
  const isImage = message.mediaType === 'image' && message.mediaUrl
  const isVideo = message.mediaType === 'video' && message.mediaUrl
  const isAudio = message.mediaType === 'audio' && message.mediaUrl
  // Product message — mediaUrl carries the productId (NOT an /uploads/ path).
  // Rendered as an inline interactive card; the bubble wrapper is suppressed
  // (the card has its own glass surface) and `isDocument` excludes it so the
  // "document fallback" path doesn't try to treat the productId as a URL.
  const isProduct = message.mediaType === 'product' && !!message.mediaUrl
  // v16.9.2: Audio Hub track — mediaUrl carries the track id.
  const isAudioHub = message.mediaType === 'audio-hub' && !!message.mediaUrl
  // v17: Video Hub film card — mediaUrl carries the film card JSON.
  const isFilm = message.mediaType === 'film' && !!message.mediaUrl
  // v12: attachment group — message has multiple files in `attachments` array
  const isAttachmentGroup = !!message.attachments && message.attachments.length > 0
  // Если mediaUrl есть, но тип не image/video/audio/product/audio-hub/film — это документ
  const isDocument = !isImage && !isVideo && !isAudio && !isProduct && !isAudioHub && !isFilm && !isAttachmentGroup && !!message.mediaUrl

  // v10-photo: images get NO bubble — just a thin border card.
  // Outgoing: thin blue border. Incoming: thin beige-grey border.
  // v10-doc: documents get NO bubble — DocumentAttachment has its own glass
  // card (media-compact-card), same style as voice messages. Wrapping it in
  // another glass bubble was redundant and looked heavy.
  // v12: attachment groups also get NO bubble — AttachmentGroup has its own card.
  const isTrulyBubbleless = (isAudio && !message.content) || (isProduct && !message.content) || (isAudioHub && !message.content) || (isFilm && !message.content) || (isDocument && !message.content) || isAttachmentGroup
  const isBubbleless = isDocument || isAudio || isProduct || isAudioHub || isFilm || isAttachmentGroup

  return (
    <div
      ref={registerRef}
      className={cn('flex animate-message-in', isOwn ? 'justify-end' : 'justify-start')}
      style={{
        // Phase 11.1: content-visibility:auto lets the browser skip rendering
        // (paint+layout) for message bubbles that are scrolled off-screen.
        // This is native virtualization — no JS needed, works in Chrome 85+,
        // Safari 18+, Firefox 125+. Older browsers ignore it (graceful degrade).
        // contain-intrinsic-size gives the browser a placeholder height so the
        // scrollbar doesn't jump when bubbles enter/exit the viewport.
        contentVisibility: 'auto' as React.CSSProperties['contentVisibility'],
        containIntrinsicSize: '80px',
      }}
    >
      <SwipeToReply
        direction={isOwn ? 'left' : 'right'}
        onReply={() => onReply?.(message)}
        maxWidthClass="max-w-[82%] sm:max-w-[68%]"
      >
      <div
        onContextMenu={(e) => { e.preventDefault(); onContextMenu(e) }}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        onTouchMove={onTouchEnd}
        className={cn(
          'relative select-none',
          isImage
            ? cn(
                'rounded-[20px] p-0.5 overflow-hidden',
                // v11-photo: thin border, NO bubble background, soft brand glow.
                // Outgoing: thin blue border + subtle blue glow.
                // Incoming: thin slate border + subtle neutral glow.
                isOwn
                  ? 'ring-1 ring-blue-400/30 bg-blue-500/5'
                  : 'ring-1 ring-slate-300/30 dark:ring-slate-600/30 bg-slate-100/20 dark:bg-slate-800/20',
              )
            : isTrulyBubbleless
              ? 'px-1 py-0.5' // voice-only — no bubble, no background
              : isBubbleless
                ? 'glass-message rounded-2xl p-1.5'
                : 'glass-message cursor-pointer px-3 py-2', // compact text bubble
          // Only apply outgoing/incoming bubble colors when there IS a bubble (non-image)
          !isImage && !isTrulyBubbleless && (isOwn ? 'glass-message-outgoing' : 'glass-message-incoming'),
          !isImage && !isTrulyBubbleless && (isOwn ? 'rounded-br-md' : 'rounded-bl-md'),
          isDeleted && 'opacity-50',
        )}
        style={{
          // v16.8 final: disable text selection + iOS callout on long-press.
          // Применяется ко ВСЕМ типам bubble (image, voice, document, text) —
          // long-press должен открывать context menu, а не выделять текст.
          WebkitUserSelect: 'none',
          userSelect: 'none',
          WebkitTouchCallout: 'none',
          touchAction: 'manipulation',
          // Сохраняем прежние background/boxShadow настройки для каждой ветки:
          ...(isImage
            ? {
                background: undefined,
                // v11-photo: soft brand glow — subtle, not acid.
                // Outgoing: blue glow. Incoming: neutral shadow.
                boxShadow: isOwn
                  ? '0 2px 12px -2px rgba(59, 130, 246, 0.18), 0 1px 4px -1px rgba(15, 23, 42, 0.06)'
                  : '0 2px 12px -2px rgba(15, 23, 42, 0.10), 0 1px 4px -1px rgba(15, 23, 42, 0.04)',
              }
            : isTrulyBubbleless
              ? { background: 'transparent' }
              : isBubbleless && isOwn
                ? { background: OUTGOING_GRADIENT.bg }
                : isBubbleless
                  ? { background: undefined }
                  : {}),
        }}
      >
        {/* Forwarded tag */}
        {message.forwardedFrom && (
          <div className="text-[10px] opacity-70 mb-1 flex items-center gap-1">
            <Forward className="h-3 w-3" />
            Переслано от {message.forwardedFrom.sender?.displayName || message.forwardedFrom.sender?.username || 'пользователя'}
          </div>
        )}

        {/* Reply quote — БЕЗ карточки, просто текст + curved arrow.
            Стрелка показывает что мы отвечаем на это сообщение.
            Кликабельная — скроллит к оригиналу. */}
        {message.replyTo && (
          <button
            onClick={(e) => { e.stopPropagation(); onScrollToMessage(message.replyTo!.id) }}
            className="block w-full text-left mb-1.5 relative"
          >
            {/* Curved arrow — от текста-ответа вниз к нашему сообщению */}
            <svg
              className="absolute -bottom-1.5 left-1"
              width="16" height="12" viewBox="0 0 16 12" fill="none"
              aria-hidden="true"
              style={{ color: isOwn ? 'rgba(255,255,255,0.4)' : 'rgba(59,130,246,0.4)' }}
            >
              <path
                d="M 2 0 Q 2 8, 8 8 L 14 8"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                fill="none"
              />
            </svg>
            <div className="flex items-start gap-1.5">
              <div
                className="w-0.5 self-stretch rounded-full shrink-0 mt-0.5"
                style={{ background: isOwn ? 'rgba(255,255,255,0.4)' : '#3b82f6' }}
              />
              <div className="flex-1 min-w-0">
                <div className={cn(
                  'font-semibold text-[11px] truncate',
                  isOwn ? 'text-white/80' : 'text-blue-500',
                )}>
                  {message.replyTo.sender?.displayName || message.replyTo.sender?.username || 'Пользователь'}
                </div>
                <div className={cn(
                  'truncate text-[11px] mt-0.5',
                  isOwn ? 'text-white/50' : 'text-muted-foreground',
                )}>
                  {message.replyTo.deletedForAll
                    ? 'Сообщение удалено'
                    : message.replyTo.content ||
                      (message.replyTo.mediaType === 'image' ? '📷 Фото'
                        : message.replyTo.mediaType === 'video' ? '🎥 Видео'
                        : message.replyTo.mediaType === 'audio' ? '🎤 Голосовое'
                        : message.replyTo.mediaType === 'product' ? '🛍 Товар'
                        : message.replyTo.mediaType === 'audio-hub' ? '🎵 Аудио'
                        : 'Вложение')}
                </div>
              </div>
            </div>
          </button>
        )}

        {/* Content */}
        {isDeleted ? (
          <div className="text-sm italic opacity-60 flex items-center gap-1.5 text-muted-foreground">
            <Trash2 className="h-3.5 w-3.5" /> Сообщение удалено
          </div>
        ) : isImage ? (
          <div className="relative">
            <img
              src={assetUrl(message.mediaUrl)}
              alt="Изображение"
              className="rounded-[20px] max-w-full max-h-80 object-cover cursor-zoom-in"
              loading="lazy"
              onClick={(e) => { e.stopPropagation(); onImageClick?.(message.mediaUrl!) }}
            />
            <div className={cn(
              'absolute bottom-2 right-2 text-[10px] px-2 py-1 rounded-full backdrop-blur-md flex items-center gap-1',
              isOwn ? 'bg-black/40 text-white' : 'bg-black/50 text-white'
            )}>
              {formatTime(message.createdAt)}
              {/* v25.9: "изменено" indicator on image messages too. */}
              {message.editedAt && <span className="italic opacity-80">изменено</span>}
              {isOwn && (message.isRead ? <CheckCheck className="h-3 w-3" /> : <Check className="h-3 w-3" />)}
            </div>
          </div>
        ) : isVideo ? (
          <video
            src={assetUrl(message.mediaUrl)}
            controls
            className="rounded-[20px] max-w-full max-h-72"
          />
        ) : isAudio ? (
          <AudioMessage
            url={message.mediaUrl!}
            duration={message.duration}
            isOwn={isOwn}
            // v16.8-final: pass the self-destruct deadline so the audio bubble
            // can render the "auto-deletes in X" badge.
            selfDestructAt={message.selfDestructAt}
            // v16.8-attachments: sender context for AudioPlayerManager
            // (mini-player display + attachments center list).
            messageId={message.id}
            conversationId={message.conversationId}
            senderName={message.sender?.displayName || message.sender?.username}
            senderAvatar={message.sender?.avatar || undefined}
            createdAt={message.createdAt}
            // v18.6: optimistic-upload flags so the play button shows a spinner / error.
            isUploading={message.isUploading}
            uploadFailed={message.uploadFailed}
          />
        ) : isProduct ? (
          <ProductMessageCard
            productId={message.mediaUrl!}
            isOwn={isOwn}
            onOpenProduct={onOpenProduct}
          />
        ) : isAudioHub ? (
          // v16.9.2: Audio Hub track card — distinct from voice messages.
          // Vertical card with cover art, title/artist, progress bar, frequency bars.
          <AudioChatCard trackId={message.mediaUrl!} isOwn={isOwn} />
        ) : isFilm ? (
          // v17: Video Hub film card — mediaUrl carries the FilmChatCardData JSON.
          // Clicking the card opens the embedded Video Hub screen (no website).
          (() => {
            try {
              const payload = JSON.parse(message.mediaUrl!) as import('@/modules/films/types').FilmChatCardData
              return <FilmChatCard payload={payload} isOwn={isOwn} />
            } catch {
              return <DocumentAttachment url={message.mediaUrl!} isOwn={isOwn} />
            }
          })()
        ) : isAttachmentGroup ? (
          // v12: attachment group — multi-file message (photos grid, doc list, or mixed)
          <AttachmentGroup
            attachments={message.attachments!}
            isOwn={isOwn}
            onImageClick={onImageClick}
          />
        ) : isDocument ? (
          <DocumentAttachment url={message.mediaUrl!} isOwn={isOwn} />
        ) : message.content ? (
          <div className="selectable text-sm whitespace-pre-wrap break-words leading-relaxed text-foreground">
            {linkify(message.content).map((seg, i) => {
              if (seg.type === 'link' && seg.url) {
                return (
                  <a
                    key={i}
                    href={seg.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:opacity-80 transition-opacity text-primary"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {seg.text}
                  </a>
                )
              }
              return <span key={i}>{seg.text}</span>
            })}
          </div>
        ) : null}

        {/* Meta — только если контент не картинка (там время overlay) */}
        {!isImage && (
          <div className="flex items-center gap-1 mt-1 text-[10px] text-muted-foreground">
            {formatTime(message.createdAt)}
            {/* v25.9: "изменено" indicator — shown when the message was edited. */}
            {message.editedAt && <span className="italic opacity-80">изменено</span>}
            {isFavorite && <Star className="h-3 w-3 fill-amber-400 text-amber-400" />}
            {isOwn && (message.isRead ? <CheckCheck className="h-3 w-3" /> : <Check className="h-3 w-3" />)}
          </div>
        )}
      </div>
      </SwipeToReply>
    </div>
  )
}

// Phase 11.1: React.memo prevents re-rendering all 100+ message bubbles
// when the parent chat.tsx re-renders (e.g. on every keystroke in the input).
// The memo comparison checks message.id + isOwn — if those are unchanged,
// the bubble is skipped. Callback props (onContextMenu, etc.) are stable
// via useCallback in chat.tsx, so they don't trigger re-renders.
export const MessageBubble = React.memo(MessageBubbleImpl, (prev, next) => {
  // Only re-render if the message itself changed or ownership changed.
  // Callbacks are stable (useCallback in parent), so we skip comparing them.
  // v12: also compare attachments reference (changes when a new group arrives)
  // v25.9: also compare editedAt so the "изменено" indicator appears when
  // a message is edited via the new message:edit socket event.
  // v25.9: also compare isFavorite so the ⭐ badge toggles without a parent
  // re-render.
  return (
    prev.message.id === next.message.id &&
    prev.message.content === next.message.content &&
    prev.message.isRead === next.message.isRead &&
    prev.message.deletedForAll === next.message.deletedForAll &&
    prev.message.attachments === next.message.attachments &&
    prev.message.editedAt === next.message.editedAt &&
    prev.isFavorite === next.isFavorite &&
    prev.isOwn === next.isOwn
  )
})
