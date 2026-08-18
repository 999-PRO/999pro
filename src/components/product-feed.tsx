'use client'

// ============================================================================
//  ProductFeed — v25.12 final, Instagram-style.
//  Fixes:
//    • Vertical scroll WORKS (preserveTouchAction + data-scroll-lock-ignore)
//    • No "Subscribe" button
//    • Close button + counter DON'T overlap content (top padding on first slide)
//    • Compact layout — nothing stretched, nothing cut off
// ============================================================================

import { useEffect, useState, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useTheme } from 'next-themes'
import {
  X, ChevronLeft, ChevronRight, Play,
  Heart, MessageCircle, Share2, ShoppingBag, ArrowRight, Send,
} from 'lucide-react'
import { api, assetUrl } from '@/lib/api'
import { formatPrice } from '@/lib/format'
import { toast } from '@/lib/notifications'
import { haptic } from '@/lib/haptic'
import { sounds } from '@/lib/sounds'
import { useFavoritesStore } from '@/lib/cart-store'
import { useAuthStore } from '@/lib/auth-store'
import { useScrollLock } from '@/lib/use-scroll-lock'
import type { Product } from '@/lib/types'

interface FeedItem extends Product {
  media: MediaItem[]
}

interface MediaItem {
  type: 'video' | 'image'
  url: string
  poster?: string | null
}

const MOCK_AUTHORS = [
  { name: 'Менеджер Анна', timeAgo: '1 дн назад', views: '6.4K' },
  { name: 'Менеджер Иван', timeAgo: '3 дн назад', views: '2.1K' },
  { name: 'Менеджер Ольга', timeAgo: '5 дн назад', views: '8.7K' },
  { name: 'Менеджер Петр', timeAgo: '1 нед назад', views: '12K' },
]

// v25.12: theme-aware colors for the feed overlay
function useFeedTheme() {
  const { theme } = useTheme()
  const isLight = theme !== 'dark' && theme !== 'neon'
  return {
    isLight,
    bg: isLight ? '#f9fafb' : '#000000',
    text: isLight ? '#111827' : '#ffffff',
    textMuted: isLight ? 'rgba(75,85,99,0.8)' : 'rgba(255,255,255,0.6)',
    panelFrom: isLight ? 'rgba(249,250,251,0.98)' : 'rgba(0,0,0,0.98)',
    panelVia: isLight ? 'rgba(249,250,251,0.9)' : 'rgba(0,0,0,0.9)',
    cardBg: isLight ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.1)',
    cardBorder: isLight ? '1px solid rgba(0,0,0,0.06)' : 'none',
    buttonBg: isLight ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.5)',
    buttonText: isLight ? '#111827' : '#ffffff',
    mediaBg: isLight ? '#e5e7eb' : '#000000',
    counterBg: isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.15)',
    counterText: isLight ? '#374151' : '#ffffff',
    backBg: isLight ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.15)',
    backText: isLight ? '#111827' : '#ffffff',
    phoneBg: isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.15)',
    phoneText: isLight ? '#374151' : '#ffffff',
    dotColor: isLight ? '#9ca3af' : 'rgba(255,255,255,0.5)',
    dotActive: isLight ? '#374151' : '#ffffff',
  }
}

export function ProductFeed() {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<FeedItem[]>([])
  const [loading, setLoading] = useState(false)
  const [activeIdx, setActiveIdx] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const t = useFeedTheme()

  // v25.12: preserveTouchAction: true — keeps body touch-action as '' instead of 'none',
  // so the snap-scroll container's own touch-action: pan-y works.
  useScrollLock(open, { preserveTouchAction: true })

  useEffect(() => {
    const onOpen = async () => {
      setOpen(true)
      setLoading(true)
      setActiveIdx(0)
      try {
        const data = await api.get<{ items: Product[] }>('/api/products?shuffle=true&limit=20')
        const enriched: FeedItem[] = (data.items || []).map((p) => {
          const media: MediaItem[] = []
          if (p.videoUrl) media.push({ type: 'video', url: p.videoUrl, poster: p.videoPoster || p.images?.[0] || null })
          for (const img of p.images || []) media.push({ type: 'image', url: img })
          if (media.length === 0) media.push({ type: 'image', url: '' })
          return { ...p, media }
        })
        setItems(enriched)
      } catch (err: any) {
        toast.error(err?.message || 'Не удалось загрузить ленту')
        setOpen(false)
      } finally {
        setLoading(false)
      }
    }
    window.addEventListener('open-feed', onOpen)
    return () => window.removeEventListener('open-feed', onOpen)
  }, [])

  useEffect(() => {
    if (!open || items.length === 0) return
    const container = scrollRef.current
    if (!container) return
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && entry.intersectionRatio > 0.55) {
            const idx = Number((entry.target as HTMLElement).dataset.idx)
            if (!Number.isNaN(idx) && idx !== activeIdx) {
              setActiveIdx(idx)
              haptic.select()
            }
          }
        })
      },
      { root: container, threshold: [0.55, 0.9] },
    )
    const slides = container.querySelectorAll('[data-idx]')
    slides.forEach((s) => observer.observe(s))
    return () => observer.disconnect()
  }, [open, items, activeIdx])

  const close = useCallback(() => {
    haptic.tap()
    setOpen(false)
    setItems([])
  }, [])

  const openProductViewer = useCallback((item: FeedItem) => {
    haptic.tap()
    const { media, ...product } = item
    void media
    window.dispatchEvent(new CustomEvent('999pro:open-product', { detail: { productId: item.id, initialProduct: product } }))
    setOpen(false)
  }, [])

  const leaveRequest = useCallback((item: FeedItem) => {
    haptic.tap()
    const { media, ...product } = item
    void media
    window.dispatchEvent(new CustomEvent('open-lead', { detail: { product } }))
  }, [])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[450]" style={{ background: t.bg }}>
      {/* v25.12: Back arrow — top-LEFT, like Instagram. Safe-area aware. */}
      <button
        onClick={close}
        aria-label="Закрыть ленту"
        className="absolute z-50 h-10 w-10 rounded-full grid place-items-center hover:scale-105 active:scale-95 transition-transform backdrop-blur"
        style={{
          top: 'max(env(safe-area-inset-top, 0px), 12px)',
          left: '12px',
          background: t.backBg,
          color: t.backText,
        }}
      >
        <ChevronLeft className="h-5 w-5" />
      </button>

      {/* Slide counter — top-RIGHT */}
      {items.length > 0 && (
        <div
          className="absolute z-50 px-2.5 py-1 rounded-full backdrop-blur text-[11px] font-semibold"
          style={{
            top: 'max(env(safe-area-inset-top, 0px), 16px)',
            right: '12px',
            background: t.counterBg,
            color: t.counterText,
          }}
        >
          {activeIdx + 1} / {items.length}
        </div>
      )}

      {loading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-white">
          <div className="h-10 w-10 rounded-full border-4 animate-spin mb-3"
          style={{ borderColor: t.dotColor, borderTopColor: t.dotActive }} />
          <p className="text-sm" style={{ color: t.textMuted }}>Загружаем ленту…</p>
        </div>
      )}

      {/* Vertical snap-scroll container.
          v25.12: data-scroll-lock-ignore + overscroll-behavior: contain +
          touch-action: pan-y → vertical scroll works on iOS/Android.
          preserveTouchAction in useScrollLock keeps body touch-action empty
          so this container's pan-y isn't intersected down to none. */}
      <div
        ref={scrollRef}
        data-scroll-lock-ignore
        className="h-[100dvh] w-full overflow-y-scroll snap-y snap-mandatory no-scrollbar"
        style={{
          scrollSnapType: 'y mandatory',
          overscrollBehavior: 'contain',
          touchAction: 'pan-y',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {items.map((item, idx) => (
          <FeedSlide
            key={item.id}
            item={item}
            idx={idx}
            isActive={idx === activeIdx}
            onOpenProductViewer={() => openProductViewer(item)}
            onLeaveRequest={() => leaveRequest(item)}
          />
        ))}

        {items.length > 0 && (
          <div className="snap-start h-[100dvh] flex flex-col items-center justify-center px-6 text-center"
          style={{ background: t.bg }}>
            <ShoppingBag className="h-12 w-12 mb-4 opacity-50" />
            <p className="text-lg font-semibold mb-1" style={{ color: t.text }}>Это всё 🛍</p>
            <p className="text-sm mb-6" style={{ color: t.textMuted }}>Лента закончилась — листайте вверх.</p>
            <button onClick={close} className="px-5 py-2.5 rounded-full backdrop-blur font-semibold text-sm" style={{ background: t.buttonBg, color: t.buttonText }}>
              Закрыть ленту
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================================================
//  FeedSlide — один слайд h-[100dvh], flex-col.
//  Top padding on first slide so close button doesn't overlap author row.
// ============================================================================
function FeedSlide({
  item, idx, isActive, onOpenProductViewer, onLeaveRequest,
}: {
  item: FeedItem
  idx: number
  isActive: boolean
  onOpenProductViewer: () => void
  onLeaveRequest: () => void
}) {
  const t = useFeedTheme()
  const [mediaIdx, setMediaIdx] = useState(0)
  const [videoPaused, setVideoPaused] = useState(false)
  const [showComments, setShowComments] = useState(false)
  const [commentText, setCommentText] = useState('')
  const [commentsList, setCommentsList] = useState<Array<{ id: string; author: string; text: string; createdAt: string }>>([])
  const [commentsLoading, setCommentsLoading] = useState(false)
  const [submittingComment, setSubmittingComment] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const author = MOCK_AUTHORS[idx % MOCK_AUTHORS.length]
  const authed = useAuthStore((s) => s.isAuthenticated)
  const user = useAuthStore((s) => s.user)

  // v25.12: real favorites — heart works like on product page
  const favorited = useFavoritesStore((s) => s.ids.includes(item.id))
  const toggleFavorite = useFavoritesStore((s) => s.toggle)

  const media = item.media
  const current = media[mediaIdx]
  const hasMultiple = media.length > 1

  useEffect(() => {
    setMediaIdx(0)
    setVideoPaused(false)
    setShowComments(false)
  }, [item.id])

  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    if (isActive && !videoPaused && current?.type === 'video') v.play().catch(() => {})
    else v.pause()
  }, [isActive, videoPaused, current, mediaIdx])

  const toggleVideoPause = (e: React.MouseEvent) => {
    e.stopPropagation()
    setVideoPaused((p) => !p)
    haptic.tap()
  }

  // v25.12: real heart — uses favorites store (same as product page)
  const toggleLike = (e: React.MouseEvent) => {
    e.stopPropagation()
    toggleFavorite(item.id)
    haptic.select()
    if (!favorited) sounds.like()
    toast.success(favorited ? 'Удалено из избранного' : 'Добавлено в избранное')
  }

  // v25.12: real comments — fetch from /api/reviews
  const fetchComments = useCallback(async () => {
    setCommentsLoading(true)
    try {
      const d = await api.get<{ items: Array<any> }>(`/api/reviews?productId=${item.id}&limit=50`)
      const raw = (d as any).items || (d as any).reviews || []
      const mapped = raw.map((r: any) => ({
        id: r.id,
        author: r.user?.displayName || r.user?.username || r.authorName || 'Гость',
        text: r.content || r.text || r.comment || '',
        createdAt: r.createdAt,
      })).filter((c: any) => c.text)
      setCommentsList(mapped)
    } catch {
      setCommentsList([])
    } finally {
      setCommentsLoading(false)
    }
  }, [item.id])

  const toggleComments = (e: React.MouseEvent) => {
    e.stopPropagation()
    haptic.tap()
    if (!showComments) {
      setShowComments(true)
      fetchComments()
    } else {
      setShowComments(false)
    }
  }

  const submitComment = async () => {
    if (!commentText.trim()) return
    if (!authed) {
      toast.error('Войдите, чтобы оставить комментарий')
      return
    }
    setSubmittingComment(true)
    haptic.tap()
    try {
      await api.post('/api/reviews', {
        json: {
          productId: item.id,
          rating: 5,
          content: commentText.trim(),
        },
        auth: true,
      })
      toast.success('Комментарий добавлен!')
      setCommentText('')
      fetchComments()
      haptic.success()
    } catch (err: any) {
      toast.error(err?.message || 'Не удалось добавить комментарий')
    } finally {
      setSubmittingComment(false)
    }
  }

  // Horizontal swipe detection — only triggers when |dx| > |dy|
  const touchStartX = useRef<number | null>(null)
  const touchStartY = useRef<number | null>(null)
  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX
    touchStartY.current = e.touches[0].clientY
  }
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null || touchStartY.current === null) return
    const dx = e.changedTouches[0].clientX - touchStartX.current
    const dy = e.changedTouches[0].clientY - touchStartY.current
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 40) {
      if (dx < 0 && mediaIdx < media.length - 1) { setMediaIdx((i) => i + 1); haptic.select() }
      else if (dx > 0 && mediaIdx > 0) { setMediaIdx((i) => i - 1); haptic.select() }
    }
    touchStartX.current = null
    touchStartY.current = null
  }

  const baseCount = (str: string, base: number) => {
    let h = 0
    for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0
    return base + Math.abs(h) % 500
  }
  const likes = baseCount(item.id, 380)
  const comments = baseCount(item.id + 'c', 12)
  const shares = baseCount(item.id + 'sh', 20)

  return (
    <section
      data-idx={idx}
      className="snap-start h-[100dvh] w-full relative snap-always flex flex-col"
      style={{ scrollSnapAlign: 'start', background: t.bg }}
      style={{ scrollSnapAlign: 'start' }}
    >
      {/* === TOP: Author row — CENTERED, so back arrow (left) + counter (right) don't overlap === */}
      <div
        className="shrink-0 relative flex items-center justify-center py-1.5 z-20"
        style={{ paddingTop: 'max(env(safe-area-inset-top, 0px), 6px)' }}
      >
        {/* Centered author info */}
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-full bg-gradient-to-br from-[#EC4899] to-[#9333EA] grid place-items-center text-white text-[10px] font-bold ring-2 ring-white/20 shrink-0">
            {author.name.split(' ').map((w) => w[0]).join('').slice(0, 2)}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-xs truncate" style={{ color: t.text }}>{author.name}</span>
              <span className="text-[10px]" style={{ color: t.textMuted }}>· {author.timeAgo}</span>
            </div>
            <span className="text-[10px]" style={{ color: t.textMuted }}>{author.views} просмотров</span>
          </div>
        </div>
      </div>

      {/* === MIDDLE: Media area (flex-1, object-contain) === */}
      <div
        className="flex-1 relative min-h-0 flex items-center justify-center overflow-hidden"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <div className="flex h-full w-full transition-transform duration-300 ease-out" style={{ transform: `translateX(-${mediaIdx * 100}%)` }}>
          {media.map((m, i) => (
            <div key={i} className="relative h-full w-full shrink-0 flex items-center justify-center" style={{ background: t.mediaBg }}>
              {m.type === 'video' ? (
                <video
                  ref={i === mediaIdx ? videoRef : undefined}
                  src={assetUrl(m.url)}
                  poster={m.poster ? assetUrl(m.poster) : undefined}
                  className="max-h-full max-w-full object-contain"
                  loop muted playsInline
                  preload={i === mediaIdx ? 'auto' : 'metadata'}
                  onClick={toggleVideoPause}
                />
              ) : m.url ? (
                <img
                  src={assetUrl(m.url)}
                  alt={item.title}
                  className="max-h-full max-w-full object-contain"
                  loading={idx < 2 && i === 0 ? 'eager' : 'lazy'}
                  draggable={false}
                />
              ) : (
                <div className="grid place-items-center text-white/40">
                  <ShoppingBag className="h-12 w-12" />
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Pause indicator */}
        {current?.type === 'video' && videoPaused && (
          <button onClick={toggleVideoPause} className="absolute inset-0 grid place-items-center pointer-events-auto z-10"
          style={{ background: t.isLight ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.4)' }} aria-label="Возобновить видео">
            <div className="h-14 w-14 rounded-full backdrop-blur grid place-items-center" style={{ background: t.buttonBg }}>
              <Play className="h-7 w-7" style={{ color: t.buttonText }} fill="currentColor" />
            </div>
          </button>
        )}

        {/* Media nav arrows (desktop) */}
        {hasMultiple && (
          <>
            <button
              onClick={(e) => { e.stopPropagation(); if (mediaIdx > 0) { setMediaIdx((i) => i - 1); haptic.tap() } }}
              disabled={mediaIdx === 0}
              aria-label="Предыдущее"
              className="hidden md:grid absolute left-2 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full backdrop-blur place-items-center disabled:opacity-0 transition-colors z-10"
              style={{ background: t.buttonBg, color: t.buttonText }}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); if (mediaIdx < media.length - 1) { setMediaIdx((i) => i + 1); haptic.tap() } }}
              disabled={mediaIdx === media.length - 1}
              aria-label="Следующее"
              className="hidden md:grid absolute right-2 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full backdrop-blur place-items-center disabled:opacity-0 transition-colors z-10"
              style={{ background: t.buttonBg, color: t.buttonText }}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </>
        )}

        {/* Media dots — top center of media area */}
        {hasMultiple && (
          <div className="absolute top-1.5 left-1/2 -translate-x-1/2 flex gap-1 z-10">
            {media.map((_, i) => (
              <span key={i} className={`h-1 rounded-full transition-all ${i === mediaIdx ? 'w-3' : 'w-1'}`}
              style={{ background: i === mediaIdx ? t.dotActive : t.dotColor }} />
            ))}
          </div>
        )}

        {/* === RIGHT SIDE: Action buttons — Heart (real), Comments (real), Share === */}
        <div className="absolute right-1.5 top-1/2 -translate-y-1/2 z-10 flex flex-col gap-2.5 items-center">
          <button onClick={toggleLike} className="flex flex-col items-center gap-0.5">
            <span className="h-9 w-9 rounded-full grid place-items-center backdrop-blur transition-all" style={{ background: favorited ? 'rgba(239,68,68,0.4)' : t.buttonBg }}>
              <Heart className={`h-5 w-5 ${favorited ? 'text-[#FF3B30]' : ''}`} style={{ color: favorited ? '#FF3B30' : t.buttonText }} fill={favorited ? 'currentColor' : 'none'} />
            </span>
            <span className="text-[9px] font-medium drop-shadow" style={{ color: t.text }}>{likes + (favorited ? 1 : 0)}</span>
          </button>
          <button onClick={toggleComments} className="flex flex-col items-center gap-0.5">
            <span className="h-9 w-9 rounded-full grid place-items-center backdrop-blur transition-all" style={{ background: showComments ? 'rgba(168,85,247,0.4)' : t.buttonBg }}>
              <MessageCircle className="h-5 w-5" style={{ color: showComments ? '#A855F7' : t.buttonText }} />
            </span>
            <span className="text-[9px] font-medium drop-shadow" style={{ color: t.text }}>{comments + commentsList.length}</span>
          </button>
          <button onClick={(e) => { e.stopPropagation(); haptic.tap(); if (navigator.share) navigator.share({ title: item.title, url: `${window.location.origin}/?product=${item.id}` }).catch(()=>{}); else { navigator.clipboard?.writeText(`${window.location.origin}/?product=${item.id}`); toast.success('Ссылка скопирована') } }} className="flex flex-col items-center gap-0.5">
            <span className="h-9 w-9 rounded-full grid place-items-center backdrop-blur" style={{ background: t.buttonBg }}>
              <Share2 className="h-5 w-5" style={{ color: t.buttonText }} />
            </span>
            <span className="text-[9px] font-medium drop-shadow" style={{ color: t.text }}>{shares}</span>
          </button>
        </div>
      </div>

      {/* === COMMENTS OVERLAY — v25.12: real comments via /api/reviews === */}
      {showComments && (
        <div className="absolute inset-0 z-30 flex flex-col" style={{ background: t.bg }} onClick={(e) => { e.stopPropagation(); setShowComments(false) }}>
          {/* Comments header */}
          <div className="shrink-0 flex items-center gap-2 px-4 py-2.5 border-b" style={{ borderColor: t.isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.1)', paddingTop: 'max(env(safe-area-inset-top, 0px), 12px)' }} onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setShowComments(false)} className="h-8 w-8 rounded-full grid place-items-center" style={{ background: t.buttonBg, color: t.buttonText }}>
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="font-semibold text-sm" style={{ color: t.text }}>Комментарии</span>
            <span className="text-xs" style={{ color: t.textMuted }}>{commentsList.length}</span>
          </div>

          {/* Comments list */}
          <div className="flex-1 overflow-y-auto px-4 py-2 space-y-2" onClick={(e) => e.stopPropagation()}>
            {commentsLoading ? (
              <div className="text-center py-8 text-sm" style={{ color: t.textMuted }}>Загрузка…</div>
            ) : commentsList.length === 0 ? (
              <div className="text-center py-8 text-sm" style={{ color: t.textMuted }}>
                Пока нет комментариев. Будьте первым!
              </div>
            ) : (
              commentsList.map((c) => (
                <div key={c.id} className="flex gap-2">
                  <div className="h-7 w-7 rounded-full grid place-items-center text-[10px] font-bold shrink-0" style={{ background: 'linear-gradient(135deg, #EC4899, #9333EA)', color: '#fff' }}>
                    {c.author.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="font-semibold text-xs" style={{ color: t.text }}>{c.author}</span>
                    <p className="text-sm leading-tight" style={{ color: t.text }}>{c.text}</p>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Comment input */}
          <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-t" style={{ borderColor: t.isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.1)', paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 8px)' }} onClick={(e) => e.stopPropagation()}>
            <input
              type="text"
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitComment() } }}
              placeholder={authed ? 'Написать комментарий…' : 'Войдите, чтобы комментировать'}
              disabled={!authed || submittingComment}
              className="flex-1 h-9 px-3 rounded-full text-sm outline-none"
              style={{
                background: t.isLight ? '#f3f4f6' : 'rgba(255,255,255,0.1)',
                color: t.text,
                border: 'none',
              }}
              maxLength={500}
            />
            <button
              onClick={submitComment}
              disabled={!authed || !commentText.trim() || submittingComment}
              className="h-9 w-9 rounded-full grid place-items-center shrink-0 disabled:opacity-40"
              style={{ background: 'linear-gradient(135deg, #EC4899, #9333EA)', color: '#fff' }}
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* === BOTTOM: Title + product card (compact, no overlap) === */}
      <div
        className="shrink-0 px-3 pt-2 pb-3 space-y-1.5 z-20"
        style={{ background: `linear-gradient(to top, ${t.panelFrom} 0%, ${t.panelVia} 50%, transparent 100%)`, paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 12px)' }}
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 12px)' }}
      >
        {/* Title + price */}
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <h2 className="font-semibold text-sm leading-tight line-clamp-1" style={{ color: t.text }}>{item.title}</h2>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="text-[#EC4899] font-bold text-sm">{formatPrice(item.price, item.currency)}</span>
              {item.oldPrice && item.oldPrice > item.price && (
                <span className="text-white/40 line-through text-[10px]">{formatPrice(item.oldPrice, item.currency)}</span>
              )}
            </div>
          </div>
          {item.category && (
            <span className="px-1.5 py-0.5 rounded-full text-[9px] shrink-0"
            style={{ background: t.counterBg, color: t.textMuted }}>
              {item.category}
            </span>
          )}
        </div>

        {/* Compact product card — one row */}
        <div className="flex items-center gap-1.5 backdrop-blur rounded-xl p-1.5"
        style={{ background: t.cardBg, border: t.cardBorder }}>
          <button
            onClick={(e) => { e.stopPropagation(); onOpenProductViewer() }}
            className="relative h-10 w-10 rounded-lg overflow-hidden bg-white/10 shrink-0 hover:opacity-80 transition-opacity"
            aria-label="Открыть товар"
          >
            {current?.url ? (
              <img src={assetUrl(current.url)} alt={item.title} className="h-full w-full object-cover" />
            ) : (
              <div className="h-full w-full grid place-items-center"><ShoppingBag className="h-4 w-4 text-white/50" /></div>
            )}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onOpenProductViewer() }}
            className="flex-1 min-w-0 text-left"
          >
            <div className="text-[11px] font-medium truncate" style={{ color: t.text }}>Открыть товар</div>
            <div className="text-[10px]" style={{ color: t.textMuted }}>Описание · характеристики</div>
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onLeaveRequest() }}
            className="h-9 px-3 rounded-full bg-gradient-to-r from-[#EC4899] via-[#A855F7] to-[#FB923C] text-white font-bold text-[11px] shadow-lg hover:scale-105 active:scale-95 transition-all shrink-0"
          >
            Заявка
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onOpenProductViewer() }}
            className="h-11 w-11 rounded-full backdrop-blur grid place-items-center shrink-0"
            aria-label="Подробнее"
          >
            <ArrowRight className="h-3.5 w-3.5 text-white" />
          </button>
        </div>

        {/* WhatsApp / Phone — compact */}
        {(item.department?.whatsapp || item.department?.phone) && (
          <div className="flex gap-1.5">
            {item.department?.whatsapp && (
              <a
                href={`https://wa.me/${item.department.whatsapp.replace(/\D/g, '')}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="flex-1 h-8 rounded-lg bg-emerald-500/90 text-white font-semibold text-[11px] flex items-center justify-center gap-1 hover:bg-emerald-500 transition-colors"
              >
                <MessageCircle className="h-3 w-3" /> WhatsApp
              </a>
            )}
            {item.department?.phone && (
              <a
                href={`tel:${item.department.phone}`}
                onClick={(e) => e.stopPropagation()}
                className="flex-1 h-8 rounded-lg backdrop-blur font-semibold text-[11px] flex items-center justify-center gap-1 transition-colors"
                style={{ background: t.phoneBg, color: t.phoneText }}
              >
                <Send className="h-3 w-3" /> Позвонить
              </a>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
