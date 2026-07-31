'use client'

// ============================================================================
// UserProfileSheet — красивая страница профиля пользователя в чате.
// ----------------------------------------------------------------------------
// Открывается при нажатии на имя пользователя в Header.
// Содержит:
//   • Аватар (кликабельный — открывает полноэкранный просмотр)
//   • Имя + никнейм
//   • Статус (в сети / был(а) недавно)
//   • Информация о пользователе
//   • Кнопки «Позвонить» и «Видеозвонок»
//   • История звонков
//   • Общие медиа / документы / ссылки (горизонтальный скролл-превью)
// ============================================================================

import { motion, AnimatePresence } from 'framer-motion'
import { useState, useEffect, useCallback } from 'react'
import {
  X, Phone, Video, Clock, Image as ImageIcon, FileText, Link2,
  ChevronRight, AtSign, Info, ChevronLeft,
} from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { assetUrl, api } from '@/lib/api'
import { initials, timeAgo } from '@/lib/format'
import { useScrollLock } from '@/lib/use-scroll-lock'
import { useChatAttachments } from './hooks/use-chat-attachments'
import type { Conversation, Message } from '@/lib/types'

interface UserProfileSheetProps {
  open: boolean
  conversation: Conversation | null
  messages: Message[]
  onClose: () => void
  onAudioCall: () => void
  onVideoCall: () => void
  onShowCallHistory: () => void
  onAvatarClick: () => void
}

export function UserProfileSheet({
  open,
  conversation,
  messages,
  onClose,
  onAudioCall,
  onVideoCall,
  onShowCallHistory,
  onAvatarClick,
}: UserProfileSheetProps) {
  // v16.8.8: preserveTouchAction: true — КРИТИЧНО для горизонтального скролла
  // общих медиа/документов. Без этого useScrollLock ставит touch-action: none
  // на body, что блокирует все touch-жесты в этом sheet (включая скролл медиа).
  useScrollLock(open, { preserveTouchAction: true })
  const attachments = useChatAttachments(messages)
  const [callHistory, setCallHistory] = useState<any[]>([])
  // v16.8.6: lightbox для общих медиа (index выбранного фото, null = закрыт).
  const [photoLightbox, setPhotoLightbox] = useState<number | null>(null)

  const participant = conversation?.participant

  useEffect(() => {
    if (!open || !conversation) return
    // Fetch call history for this conversation
    void api
      .get<{ items: any[] }>(`/api/calls/history/${conversation.id}`, { auth: true })
      .then((data) => setCallHistory(data.items || []))
      .catch(() => setCallHistory([]))
  }, [open, conversation])

  return (
    <AnimatePresence>
      {open && participant && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[95] bg-black/40"
            style={{ backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
            onClick={onClose}
          />

          {/* Sheet */}
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 360, damping: 36, mass: 0.9 }}
            className="fixed left-0 right-0 bottom-0 z-[96] mx-auto max-w-md"
            style={{ maxHeight: '90vh' }}
          >
            <div
              className="rounded-t-[28px] overflow-hidden flex flex-col"
              style={{
                background: 'color-mix(in oklch, var(--card) 92%, transparent)',
                backdropFilter: 'blur(28px) saturate(160%)',
                WebkitBackdropFilter: 'blur(28px) saturate(160%)',
                border: '1px solid color-mix(in oklch, var(--border) 60%, transparent)',
                borderBottom: 'none',
                boxShadow: '0 -10px 40px -10px rgba(15,23,42,0.3)',
                maxHeight: '90vh',
              }}
            >
              {/* Handle bar */}
              <div className="flex justify-center pt-2.5 pb-1">
                <div className="h-1 w-10 rounded-full bg-foreground/20" />
              </div>

              {/* Close button */}
              <button
                onClick={onClose}
                className="absolute top-3 right-3 h-8 w-8 rounded-full grid place-items-center hover:bg-foreground/5 active:scale-90 transition-all z-10"
                aria-label="Закрыть"
              >
                <X className="h-4 w-4" />
              </button>

              {/* Scrollable content — v16.8.8: data-scroll-lock-ignore КРИТИЧЕН.
                  useScrollLock вешает touchmove listener на document, который
                  preventDefault'ит все touchmove КРОМЕ [data-scroll-lock-ignore].
                  Без этого атрибута скролл содержимого профиля не работает. */}
              <div
                data-scroll-lock-ignore
                className="overflow-y-auto overscroll-contain px-5 pb-[calc(env(safe-area-inset-bottom)+20px)]"
                style={{
                  WebkitOverflowScrolling: 'touch',
                  touchAction: 'pan-y',
                }}
              >
                {/* Avatar + Name + Nickname */}
                <div className="flex flex-col items-center pt-3 pb-5">
                  <button
                    onClick={onAvatarClick}
                    className="active:scale-95 transition-transform"
                    aria-label="Просмотреть аватар"
                  >
                    <Avatar
                      className="h-24 w-24"
                      style={{ boxShadow: '0 8px 24px -4px rgba(37,99,235,0.3)' }}
                    >
                      <AvatarImage src={assetUrl(participant.avatar)} />
                      <AvatarFallback
                        className="text-2xl font-bold text-white"
                        style={{ background: 'var(--gradient-brand)' }}
                      >
                        {initials(participant.displayName || participant.username || '?')}
                      </AvatarFallback>
                    </Avatar>
                  </button>
                  <div className="text-xl font-bold mt-3 text-center">
                    {participant.displayName || participant.username}
                  </div>
                  <div className="flex items-center gap-1 text-sm text-muted-foreground mt-0.5">
                    <AtSign className="h-3 w-3" />
                    {participant.username}
                  </div>
                  <div className="flex items-center gap-1.5 mt-2 text-sm">
                    {participant.isOnline ? (
                      <>
                        <span className="h-2 w-2 rounded-full bg-emerald-500" />
                        <span className="text-emerald-600 dark:text-emerald-400 font-medium">в сети</span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">
                        был(а) {timeAgo(participant.lastSeen || '')}
                      </span>
                    )}
                  </div>
                </div>

                {/* Action buttons — separate floating glass capsules */}
                <div className="flex items-center justify-center gap-3 mb-5">
                  <button
                    onClick={onAudioCall}
                    className="flex flex-col items-center gap-1.5 px-6 py-3 rounded-2xl active:scale-95 transition-all text-white"
                    style={{
                      background: 'var(--gradient-brand)',
                      boxShadow: '0 4px 16px -4px rgba(37,99,235,0.4)',
                    }}
                    aria-label="Аудиозвонок"
                  >
                    <Phone className="h-5 w-5" />
                    <span className="text-[11px] font-medium">Позвонить</span>
                  </button>
                  <button
                    onClick={onVideoCall}
                    className="flex flex-col items-center gap-1.5 px-6 py-3 rounded-2xl active:scale-95 transition-all text-foreground"
                    style={{
                      background: 'color-mix(in oklch, var(--card) 65%, transparent)',
                      backdropFilter: 'blur(16px) saturate(140%)',
                      WebkitBackdropFilter: 'blur(16px) saturate(140%)',
                      border: '1px solid color-mix(in oklch, var(--border) 45%, transparent)',
                    }}
                    aria-label="Видеозвонок"
                  >
                    <Video className="h-5 w-5 text-primary" />
                    <span className="text-[11px] font-medium">Видео</span>
                  </button>
                </div>

                {/* Info section */}
                <div
                  className="rounded-2xl p-3 mb-4"
                  style={{
                    background: 'color-mix(in oklch, var(--card) 50%, transparent)',
                    border: '1px solid color-mix(in oklch, var(--border) 35%, transparent)',
                  }}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <Info className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Информация
                    </span>
                  </div>
                  <div className="text-sm text-foreground/90 leading-relaxed">
                    {/* v16.8.4: bio field is optional on participant — show fallback. */}
                    {(participant as any)?.bio || 'Информация отсутствует'}
                  </div>
                </div>

                {/* Call history */}
                <button
                  onClick={onShowCallHistory}
                  className="w-full flex items-center gap-3 p-3 rounded-2xl mb-4 active:scale-[0.98] transition-transform"
                  style={{
                    background: 'color-mix(in oklch, var(--card) 50%, transparent)',
                    border: '1px solid color-mix(in oklch, var(--border) 35%, transparent)',
                  }}
                >
                  <div
                    className="grid place-items-center h-10 w-10 rounded-xl"
                    style={{ background: 'var(--gradient-brand)' }}
                  >
                    <Clock className="h-4 w-4 text-white" />
                  </div>
                  <div className="flex-1 text-left">
                    <div className="text-sm font-medium">История звонков</div>
                    <div className="text-xs text-muted-foreground">
                      {callHistory.length > 0 ? `${callHistory.length} звонков` : 'Нет звонков'}
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </button>

                {/* Shared media — v16.8.8: data-scroll-lock-ignore для
                    горизонтального скролла (без него useScrollLock блокирует). */}
                {attachments.photos.length > 0 && (
                  <SharedSection
                    icon={ImageIcon}
                    title="Общие медиа"
                    count={attachments.photos.length}
                  >
                    <div
                      data-scroll-lock-ignore
                      className="flex gap-2 overflow-x-auto no-scrollbar"
                      style={{
                        WebkitOverflowScrolling: 'touch',
                        overscrollBehaviorX: 'contain',
                        touchAction: 'pan-x pan-y',
                      }}
                    >
                      {attachments.photos.map((p, idx) => (
                        <button
                          key={p.id}
                          onClick={() => setPhotoLightbox(idx)}
                          className="shrink-0 h-16 w-16 rounded-lg overflow-hidden bg-foreground/5 active:scale-95 transition-transform"
                          aria-label={`Фото ${idx + 1}`}
                        >
                          { }
                          <img
                            src={assetUrl(p.url)}
                            alt=""
                            className="h-full w-full object-cover"
                            loading="lazy"
                          />
                        </button>
                      ))}
                    </div>
                  </SharedSection>
                )}

                {/* Shared documents — v16.8.8: data-scroll-lock-ignore + показываем ВСЕ. */}
                {attachments.documents.length > 0 && (
                  <SharedSection
                    icon={FileText}
                    title="Общие документы"
                    count={attachments.documents.length}
                  >
                    <div
                      data-scroll-lock-ignore
                      className="flex gap-2 overflow-x-auto no-scrollbar"
                      style={{
                        WebkitOverflowScrolling: 'touch',
                        overscrollBehaviorX: 'contain',
                        touchAction: 'pan-x pan-y',
                      }}
                    >
                      {attachments.documents.map((d) => (
                        <div
                          key={d.id}
                          className="shrink-0 w-40 p-2 rounded-xl"
                          style={{
                            background: 'color-mix(in oklch, var(--card) 50%, transparent)',
                            border: '1px solid color-mix(in oklch, var(--border) 35%, transparent)',
                          }}
                        >
                          <FileText className="h-4 w-4 text-primary mb-1" />
                          <div className="text-xs font-medium truncate">{d.name}</div>
                        </div>
                      ))}
                    </div>
                  </SharedSection>
                )}

                {/* Shared links */}
                {attachments.links.length > 0 && (
                  <SharedSection
                    icon={Link2}
                    title="Общие ссылки"
                    count={attachments.links.length}
                  >
                    <div className="space-y-1">
                      {attachments.links.slice(0, 5).map((l) => (
                        <a
                          key={l.id}
                          href={l.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2 p-2 rounded-lg hover:bg-foreground/5 transition-colors"
                        >
                          <Link2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-medium truncate">{l.domain}</div>
                            <div className="text-[10px] text-muted-foreground truncate">{l.url}</div>
                          </div>
                        </a>
                      ))}
                    </div>
                  </SharedSection>
                )}
              </div>
            </div>
          </motion.div>

          {/* v16.8.6: Photo lightbox — полноэкранный просмотр со свайпами.
              Открывается при нажатии на миниатюру в "Общие медиа".
              Свайпы между фото, закрытие по клику/Escape. */}
          {photoLightbox !== null && attachments.photos.length > 0 && (
            <PhotoLightbox
              photos={attachments.photos.map((p) => ({ id: p.id, url: p.url, senderName: p.senderName, createdAt: p.createdAt }))}
              index={photoLightbox}
              onClose={() => setPhotoLightbox(null)}
              onNavigate={setPhotoLightbox}
            />
          )}
        </>
      )}
    </AnimatePresence>
  )
}

// ---- Shared section component ----

function SharedSection({
  icon: Icon,
  title,
  count,
  children,
}: {
  icon: typeof ImageIcon
  title: string
  count: number
  children: React.ReactNode
}) {
  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 mb-2 px-1">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </span>
        <span className="text-xs text-muted-foreground/60">· {count}</span>
      </div>
      {children}
    </div>
  )
}

// ---- Photo lightbox (v16.8.6) ----

interface LightboxPhoto {
  id: string
  url: string
  senderName: string
  createdAt: string
}

interface PhotoLightboxProps {
  photos: LightboxPhoto[]
  index: number
  onClose: () => void
  onNavigate: (idx: number) => void
}

function PhotoLightbox({ photos, index, onClose, onNavigate }: PhotoLightboxProps) {
  const photo = photos[index]

  const prev = useCallback(() => {
    onNavigate((index - 1 + photos.length) % photos.length)
  }, [index, photos.length, onNavigate])

  const next = useCallback(() => {
    onNavigate((index + 1) % photos.length)
  }, [index, photos.length, onNavigate])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft') prev()
      else if (e.key === 'ArrowRight') next()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, prev, next])

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[140] bg-black/95 grid place-items-center"
      onClick={onClose}
    >
      {/* Close */}
      <button
        onClick={onClose}
        className="absolute top-0 right-0 z-10 h-12 w-12 rounded-full grid place-items-center bg-white/10 hover:bg-white/20 text-white active:scale-90 transition-all"
        style={{ top: 'max(env(safe-area-inset-top), 16px)', right: '16px' }}
        aria-label="Закрыть"
      >
        <X className="h-5 w-5" />
      </button>

      {/* Counter */}
      <div
        className="absolute top-0 left-0 z-10 text-white text-sm font-medium px-4"
        style={{ top: 'max(env(safe-area-inset-top), 20px)', left: '16px' }}
      >
        {index + 1} / {photos.length}
      </div>

      {/* Image with AnimatePresence for swap animation */}
      <AnimatePresence mode="wait">
        <motion.div
          key={photo.id}
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.2 }}
          className="max-w-[95vw] max-h-[80vh]"
          onClick={(e) => e.stopPropagation()}
        >
          { }
          <img
            src={assetUrl(photo.url)}
            alt=""
            className="max-w-full max-h-[80vh] object-contain rounded-lg"
          />
        </motion.div>
      </AnimatePresence>

      {/* Caption */}
      <div
        className="absolute bottom-0 left-0 right-0 p-4 text-center text-white"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 16px)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-sm font-medium">{photo.senderName}</div>
      </div>

      {/* Nav buttons */}
      {photos.length > 1 && (
        <>
          <button
            onClick={(e) => { e.stopPropagation(); prev() }}
            className="absolute left-2 top-1/2 -translate-y-1/2 h-12 w-12 rounded-full grid place-items-center bg-white/10 hover:bg-white/20 text-white active:scale-90 transition-all"
            aria-label="Предыдущее"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); next() }}
            className="absolute right-2 top-1/2 -translate-y-1/2 h-12 w-12 rounded-full grid place-items-center bg-white/10 hover:bg-white/20 text-white active:scale-90 transition-all"
            aria-label="Следующее"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        </>
      )}
    </motion.div>
  )
}
