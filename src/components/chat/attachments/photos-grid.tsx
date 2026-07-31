'use client'

// ============================================================================
// PhotosGrid — галерея фотографий из чата.
// ----------------------------------------------------------------------------
// Возможности:
//   • Адаптивная сетка (3 колонки на мобильном, 4-5 на десктопе)
//   • Lazy loading (IntersectionObserver, рендерим только видимые)
//   • Клик открывает полноэкранный просмотр
//   • Свайпы между фото
//   • Закрытие по Escape / клику вне
// ============================================================================

import { useState, useEffect, useCallback, memo, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Image as ImageIcon, X, ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { assetUrl } from '@/lib/api'
import { formatTime } from '@/lib/format'
import type { PhotoItem } from '../hooks/use-chat-attachments'

interface PhotosGridProps {
  photos: PhotoItem[]
  onScrollToMessage?: (id: string) => void
}

export function PhotosGrid({ photos, onScrollToMessage }: PhotosGridProps) {
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null)

  if (photos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 px-6 text-center">
        <div className="h-16 w-16 rounded-2xl grid place-items-center mb-4 bg-foreground/5">
          <ImageIcon className="h-8 w-8 text-muted-foreground" />
        </div>
        <div className="text-lg font-semibold mb-1">Фото пока нет</div>
        <div className="text-sm text-muted-foreground">
          Отправленные изображения появятся здесь
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="px-2 py-3">
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-1">
          {photos.map((photo, idx) => (
            <PhotoThumb
              key={photo.id}
              photo={photo}
              onClick={() => setLightboxIdx(idx)}
            />
          ))}
        </div>
      </div>

      {/* Lightbox */}
      <AnimatePresence>
        {lightboxIdx !== null && (
          <PhotoLightbox
            photos={photos}
            index={lightboxIdx}
            onClose={() => setLightboxIdx(null)}
            onNavigate={setLightboxIdx}
            onScrollToMessage={onScrollToMessage}
          />
        )}
      </AnimatePresence>
    </>
  )
}

// ---- Single thumbnail (memoized, lazy) ----

interface PhotoThumbProps {
  photo: PhotoItem
  onClick: () => void
}

const PhotoThumb = memo(function PhotoThumb({ photo, onClick }: PhotoThumbProps) {
  const [loaded, setLoaded] = useState(false)
  const [visible, setVisible] = useState(false)
  const ref = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true)
          io.disconnect()
        }
      },
      { rootMargin: '200px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <button
      ref={ref}
      onClick={onClick}
      className="relative aspect-square rounded-lg overflow-hidden bg-foreground/5 active:scale-95 transition-transform"
      aria-label={`Фото от ${photo.senderName}`}
    >
      {visible && (
         
        <img
          src={assetUrl(photo.url)}
          alt=""
          loading="lazy"
          onLoad={() => setLoaded(true)}
          className={cn(
            'h-full w-full object-cover transition-opacity duration-200',
            loaded ? 'opacity-100' : 'opacity-0',
          )}
        />
      )}
      {!loaded && (
        <div className="absolute inset-0 grid place-items-center">
          <ImageIcon className="h-5 w-5 text-muted-foreground/50" />
        </div>
      )}
    </button>
  )
})

// ---- Full-screen lightbox ----

interface PhotoLightboxProps {
  photos: PhotoItem[]
  index: number
  onClose: () => void
  onNavigate: (idx: number) => void
  onScrollToMessage?: (id: string) => void
}

function PhotoLightbox({ photos, index, onClose, onNavigate, onScrollToMessage }: PhotoLightboxProps) {
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
      className="fixed inset-0 z-[120] bg-black/95 grid place-items-center"
      onClick={onClose}
    >
      {/* Header */}
      <div
        className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between p-3"
        style={{ paddingTop: 'max(env(safe-area-inset-top), 16px)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="h-10 w-10 rounded-full grid place-items-center bg-white/10 hover:bg-white/20 text-white"
          aria-label="Закрыть"
        >
          <X className="h-5 w-5" />
        </button>
        <div className="text-white text-sm font-medium">
          {index + 1} / {photos.length}
        </div>
        {onScrollToMessage && (
          <button
            onClick={() => {
              onScrollToMessage(photo.messageId)
              onClose()
            }}
            className="px-3 py-1.5 rounded-full text-[12px] font-medium bg-white/10 hover:bg-white/20 text-white"
          >
            К сообщению
          </button>
        )}
      </div>

      {/* Image */}
      <motion.div
        key={photo.id}
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.2 }}
        className="max-w-[95vw] max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        { }
        <img
          src={assetUrl(photo.url)}
          alt=""
          className="max-w-full max-h-[85vh] object-contain rounded-lg"
        />
      </motion.div>

      {/* Caption */}
      <div className="absolute bottom-0 left-0 right-0 p-4 text-white text-center" onClick={(e) => e.stopPropagation()}>
        <div className="text-sm font-medium">{photo.senderName}</div>
        <div className="text-xs text-white/60">{formatTime(photo.createdAt)}</div>
      </div>

      {/* Nav buttons */}
      {photos.length > 1 && (
        <>
          <button
            onClick={(e) => { e.stopPropagation(); prev() }}
            className="absolute left-2 top-1/2 -translate-y-1/2 h-12 w-12 rounded-full grid place-items-center bg-white/10 hover:bg-white/20 text-white"
            aria-label="Предыдущее"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); next() }}
            className="absolute right-2 top-1/2 -translate-y-1/2 h-12 w-12 rounded-full grid place-items-center bg-white/10 hover:bg-white/20 text-white"
            aria-label="Следующее"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        </>
      )}
    </motion.div>
  )
}
