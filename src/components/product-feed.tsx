'use client'

// ============================================================================
//  ProductFeed — v25.14 premium redesign.
//  Changes vs v25.12/13:
//    • FAKE AUTHORS REMOVED («Менеджер Анна/Иван…» — the store has exactly
//      ONE seller: the owner). The header now shows the real brand name
//      from Studio settings (appTitle) + category chip.
//    • Premium full-bleed media: cover-fill + blurred backdrop + slow
//      Ken-Burns zoom on the active slide + cinematic gradient scrims.
//    • Real metrics only (favorites / comment count from /api/reviews).
//  Kept from previous versions:
//    • Vertical snap-scroll WORKS (preserveTouchAction + data-scroll-lock-ignore)
//    • Close button + counter DON'T overlap content
//    • Real favorites + real comments via /api/reviews
// ============================================================================

import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
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
// v25.20: фоновая музыка товара в ленте
import { playProductMusic, stopProductMusic, useProductMusic } from '@/lib/product-music'
import { sounds } from '@/lib/sounds'
import { useFavoritesStore } from '@/lib/cart-store'
import { useAuthStore } from '@/lib/auth-store'
import { useScrollLock } from '@/lib/use-scroll-lock'
// v25.27 (owner): категории ленты на десктопе — драг мышью + стрелки
import { useDragScroll } from '@/lib/use-drag-scroll'
import type { Product } from '@/lib/types'
// v25.24: длинный текст — «Показать ещё / Свернуть»
import { CollapsibleText } from './collapsible-text'

interface FeedItem extends Product {
  media: MediaItem[]
}

interface MediaItem {
  type: 'video' | 'image'
  url: string
  poster?: string | null
}

// v25.14: MOCK_AUTHORS has been DELETED. Every slide is now attributed to
// the shop itself — the brand name comes from Settings (Studio-editable),
// so nothing in the feed pretends other people posted products.

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
  // v25.27: drag-scroll + стрелки для ленты категорий на десктопе
  const catsDrag = useDragScroll<HTMLDivElement>()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<FeedItem[]>([])
  const [loading, setLoading] = useState(false)
  const [activeIdx, setActiveIdx] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const t = useFeedTheme()
  // v25.14: real brand name from Studio settings — replaces fake authors.
  const [brandName, setBrandName] = useState('TRI999')
  useEffect(() => {
    api
      .get<{ value: string | null }>('/api/settings/appTitle')
      .then((d) => {
        if (typeof d?.value === 'string' && d.value.trim()) setBrandName(d.value.trim())
      })
      .catch(() => {})
  }, [])

  // v25.19 (owner): «в ленте сделать бы категории/фильтры, только не порти
  // саму ленту» — нежная стеклянная лента чипов категорий ПОД шапкой.
  // Фильтрация локальная (по уже загруженным слайдам), лента и её вид
  // не меняются. null = «Все».
  const [activeCat, setActiveCat] = useState<string | null>(null)
  const feedCats = useMemo(() => {
    const s = new Set<string>()
    items.forEach((i) => { if ((i as any).category) s.add((i as any).category) })
    return [...s].slice(0, 12)
  }, [items])
  const visibleItems = useMemo(
    () => (activeCat ? items.filter((i) => (i as any).category === activeCat) : items),
    [items, activeCat],
  )
  useEffect(() => { setActiveIdx(0) }, [activeCat])

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
    if (!open || visibleItems.length === 0) return
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
  }, [open, visibleItems, activeIdx])

  const close = useCallback(() => {
    haptic.tap()
    setOpen(false)
    setItems([])
    // v25.20: уходим из ленты — глушим фоновую музыку товара
    stopProductMusic()
  }, [])

  // v25.16 (QA-фикс): Escape закрывает ленту, стрелки ←/→ листают слайды —
  // как в полноэкранных просмотрщиках.
  useEffect(() => {
    if (!open) return
    const scrollToSlide = (idx: number) => {
      const el = scrollRef.current?.querySelector<HTMLElement>(`[data-idx="${idx}"]`)
      el?.scrollIntoView({ behavior: 'smooth' })
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
      else if (e.key === 'ArrowLeft') scrollToSlide(Math.max(0, activeIdx - 1))
      else if (e.key === 'ArrowRight') scrollToSlide(Math.min(visibleItems.length - 1, activeIdx + 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close, activeIdx, visibleItems.length])

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

  // v25.16: ШАПКА ЛЕНТЫ — теперь ОТДЕЛЬНАЯ ПОЛОСА над слайдами (flex-col):
  // назад · бренд · счётчик в одной строке на ОДНОЙ высоте, с чёткой нижней
  // границей. Раньше кнопки висели absolute ПОВЕРХ слайда и при коротком
  // бренд-чипе казались «прилипшими к картинке» и торчащими за хедер.
  const headerPadTop = 'max(env(safe-area-inset-top, 0px), 10px)'

  return (
    <div
      className="fixed inset-0 z-[450] flex flex-col md:items-center md:justify-center md:p-6"
      style={{ background: t.bg }}
    >
      {/* v25.26 (owner): «лента на десктопе должна быть как на мобильном».
          На десктопе лента — УЗКАЯ вертикальная колонка по центру экрана
          (как TikTok/Reels на больших экранах), фон по бокам затемнён.
          На мобиле — полноэкранный режим без изменений. */}
      <div className="hidden md:block absolute inset-0 bg-black/60" aria-hidden />
      <div
        className="relative z-[1] flex flex-col w-full h-full md:w-full md:max-w-[430px] md:h-[min(920px,100%)] md:rounded-[30px] md:overflow-hidden md:shadow-[0_40px_120px_-24px_rgba(0,0,0,0.75)] md:ring-1 md:ring-white/10"
        style={{ background: t.bg }}
      >
      {/* ═══ ГЛОБАЛЬНАЯ ШАПКА (не перекрывается медиа) ═══ */}
      <div
        className="shrink-0 relative z-[60] flex items-center justify-between gap-2 px-3 pb-2.5"
        style={{
          paddingTop: headerPadTop,
          background: t.bg,
          boxShadow: `0 1px 0 ${t.isLight ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.09)'}`,
        }}
      >
        {/* Назад — слева, 44px — удобная зона нажатия */}
        <button
          onClick={close}
          aria-label="Закрыть ленту"
          className="h-11 w-11 rounded-full grid place-items-center hover:scale-105 active:scale-95 transition-transform backdrop-blur shrink-0"
          style={{
            marginTop: 'auto',
            marginBottom: 'auto',
            background: t.backBg,
            color: t.backText,
          }}
        >
          <ChevronLeft className="h-5 w-5" />
        </button>

        {/* Бренд — центр полосы */}
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          className="flex items-center gap-2 h-9 pl-2 pr-3 rounded-full backdrop-blur-md min-w-0"
          style={{
            background: t.isLight ? 'rgba(255,255,255,0.72)' : 'rgba(255,255,255,0.10)',
            border: t.isLight ? '1px solid rgba(0,0,0,0.05)' : '1px solid rgba(255,255,255,0.14)',
          }}
        >
          <span className="h-5 w-5 rounded-full grid place-items-center shrink-0"
            style={{ background: 'linear-gradient(135deg,#EC4899 0%,#A855F7 55%,#FB923C 120%)' }}>
            <ShoppingBag className="h-3 w-3 text-white" strokeWidth={2.4} />
          </span>
          <span className="font-semibold text-xs tracking-wide truncate max-w-[140px]" style={{ color: t.text }}>
            {brandName}
          </span>
          <span className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-full shrink-0"
            style={{ background: 'rgba(236,72,153,0.14)', color: '#EC4899' }}>
            Лента
          </span>
        </motion.div>

        {/* Счётчик — справа, строго по центру строки с «назад» */}
        {items.length > 0 ? (
          <div
            className="h-11 px-3.5 rounded-full backdrop-blur text-xs font-semibold flex items-center tabular-nums shrink-0"
            style={{
              background: t.counterBg,
              color: t.counterText,
              border: t.isLight ? '1px solid rgba(0,0,0,0.05)' : '1px solid rgba(255,255,255,0.12)',
            }}
          >
            {activeIdx + 1} / {visibleItems.length}
          </div>
        ) : (
          <span className="w-11 shrink-0" />
        )}
      </div>

      {/* ═══ v25.19: ФИЛЬТРЫ-КАТЕГОРИИ — стеклянная лента чипов под шапкой.
          Появляется только если в ленте есть ≥2 категории. Вертикальный
          скролл ленты не затронут (чипы в shrink-0 ряду над ним).
          v25.21 (owner): «чипы слишком прилипли к верхнему блоку» —
          добавлен верхний отступ pt-2.5 и увеличен нижний.
          v25.27 (owner): на десктопе теперь можно перелистывать категории
          мышкой (grab-and-drag) и стрелками ‹ › — на мобильных ничего
          не изменилось (нативный свайп). ═══ */}
      {feedCats.length >= 2 && (
        <div
          className="shrink-0 relative z-[55]"
          style={{ background: t.bg, boxShadow: `0 1px 0 ${t.isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.06)'}` }}
          data-scroll-lock-ignore
        >
          <div
            ref={catsDrag.ref}
            onScroll={catsDrag.update}
            className="flex gap-1.5 overflow-x-auto no-scrollbar px-3 pt-2.5 pb-3 cursor-grab active:cursor-grabbing select-none"
          >
            <FeedChip
              label={`Все · ${items.length}`}
              active={activeCat === null}
              t={t}
              onClick={() => { haptic.select(); setActiveCat(null) }}
            />
            {feedCats.map((c) => (
              <FeedChip
                key={c}
                label={c}
                active={activeCat === c}
                t={t}
                onClick={() => { haptic.select(); setActiveCat(c) }}
              />
            ))}
          </div>
          {/* v25.27: стрелки прокрутки — только десктоп (hidden md:flex),
              появляются когда есть что прокручивать */}
          {catsDrag.canLeft && (
            <button
              type="button"
              aria-label="Прокрутить категории влево"
              onClick={() => catsDrag.scrollBy(-240)}
              className="hidden md:grid place-items-center absolute left-2 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full shadow-lg backdrop-blur-md transition-transform hover:scale-110 active:scale-95"
              style={{ background: t.isLight ? 'rgba(255,255,255,0.92)' : 'rgba(30,30,45,0.85)', color: t.isLight ? '#1e293b' : '#fff', border: t.isLight ? '1px solid rgba(0,0,0,0.06)' : '1px solid rgba(255,255,255,0.12)' }}
            >
              <ChevronLeft className="h-4 w-4" strokeWidth={2.4} />
            </button>
          )}
          {catsDrag.canRight && (
            <button
              type="button"
              aria-label="Прокрутить категории вправо"
              onClick={() => catsDrag.scrollBy(240)}
              className="hidden md:grid place-items-center absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full shadow-lg backdrop-blur-md transition-transform hover:scale-110 active:scale-95"
              style={{ background: t.isLight ? 'rgba(255,255,255,0.92)' : 'rgba(30,30,45,0.85)', color: t.isLight ? '#1e293b' : '#fff', border: t.isLight ? '1px solid rgba(0,0,0,0.06)' : '1px solid rgba(255,255,255,0.12)' }}
            >
              <ChevronRight className="h-4 w-4" strokeWidth={2.4} />
            </button>
          )}
        </div>
      )}

      {loading && (
        <div className="absolute inset-0 top-16 flex flex-col items-center justify-center text-white">
          <div className="h-10 w-10 rounded-full border-4 animate-spin mb-3"
          style={{ borderColor: t.dotColor, borderTopColor: t.dotActive }} />
          <p className="text-sm" style={{ color: t.textMuted }}>Загружаем ленту…</p>
        </div>
      )}

      {/* Vertical snap-scroll container.
          v25.12: data-scroll-lock-ignore + overscroll-behavior: contain +
          touch-action: pan-y → vertical scroll works on iOS/Android.
          preserveTouchAction in useScrollLock keeps body touch-action empty
          so this container's pan-y isn't intersected down to none.
          v25.16: flex-1 под глобальной шапкой вместо h-[100dvh] — медиа
          начинается НИЖЕ полосы шапки и больше не заходит под кнопки. */}
      <div
        ref={scrollRef}
        data-scroll-lock-ignore
        className="relative flex-1 min-h-0 w-full overflow-y-scroll snap-y snap-mandatory no-scrollbar"
        style={{
          scrollSnapType: 'y mandatory',
          overscrollBehavior: 'contain',
          touchAction: 'pan-y',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {visibleItems.map((item, idx) => (
          <FeedSlide
            key={item.id}
            item={item}
            idx={idx}
            isActive={idx === activeIdx}
            onOpenProductViewer={() => openProductViewer(item)}
            onLeaveRequest={() => leaveRequest(item)}
          />
        ))}

        {visibleItems.length > 0 && (
          <div className="snap-start h-full flex flex-col items-center justify-center px-6 text-center"
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
    </div>
  )
}

// ============================================================================
//  FeedSlide — один слайд h-full, flex-col.
//  v25.14: premium layout — cinematic media, glass action rail, animated
//  product panel.
//  v25.16: бренд-шапка переехала в глобальную полосу ProductFeed — слайд
//  теперь медиа от края до края. Карусель фото полностью переделана:
//  интерактивный drag (палец И мышь) с плавным следованием за пальцем,
//  resistance на краях и стабильным определением горизонтали/вертикали
//  (раньше transform-jump по 40px порогу выглядел как «свайпа нет»).
// ============================================================================
// ============================================================================
//  FeedChip — v25.19: чип категории в ленте. Стеклянный, в теме ленты
//  (светлая/тёмная), активный — брендовый градиент. Компактный, чтобы
//  не спорить с контентом слайдов.
// ============================================================================
function FeedChip({
  label,
  active,
  t,
  onClick,
}: {
  label: string
  active: boolean
  t: { isLight: boolean; text: string }
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="shrink-0 h-8 px-3.5 rounded-full text-[12px] font-semibold whitespace-nowrap backdrop-blur-md transition-all active:scale-95"
      style={
        active
          ? {
              background: 'linear-gradient(135deg, #EC4899 0%, #A855F7 100%)',
              color: '#fff',
              boxShadow: '0 6px 18px -6px rgba(168,85,247,0.65)',
            }
          : {
              background: t.isLight ? 'rgba(255,255,255,0.72)' : 'rgba(255,255,255,0.10)',
              color: t.text,
              border: t.isLight ? '1px solid rgba(0,0,0,0.06)' : '1px solid rgba(255,255,255,0.14)',
            }
      }
    >
      {label}
    </button>
  )
}

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
  // v25.16: комментарии с ВЛОЖЕННЫМИ ОТВЕТАМИ (reviews include replies) +
  // режим «ответить» (replyTo) — как в товарах и сообществах.
  interface FeedComment {
    id: string
    userId?: string
    author: string
    text: string
    createdAt: string
    isReply?: boolean
    replies?: Array<{ id: string; userId?: string; author: string; text: string; createdAt: string; replyToName?: string | null; replyToId?: string | null }>
  }
  const [commentsList, setCommentsList] = useState<FeedComment[]>([])
  const [commentsLoading, setCommentsLoading] = useState(false)
  const [submittingComment, setSubmittingComment] = useState(false)
  const [replyTo, setReplyTo] = useState<{ id: string; author: string } | null>(null)
  // v25.17: редактирование/удаление СВОИХ комментариев прямо в ленте
  // (как на странице товара и в объявлениях — «неважно где»).
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null)
  const [editCommentText, setEditCommentText] = useState('')
  const [editCommentBusy, setEditCommentBusy] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const authed = useAuthStore((s) => s.isAuthenticated)
  const meId = useAuthStore((s) => s.user?.id)
  // v25.17: админ может удалять любые комментарии (правка — только свои).
  const isAdminUser = useAuthStore((s) => s.user?.role === 'admin')

  const saveCommentEdit = async () => {
    const text = editCommentText.trim()
    if (!text || !editingCommentId) return
    setEditCommentBusy(true)
    try {
      await api.patch(`/api/reviews/${editingCommentId}`, { json: { content: text }, auth: true })
      toast.success('Комментарий обновлён')
      setEditingCommentId(null)
      fetchComments()
    } catch (e: any) {
      toast.error(e?.details?.error || 'Не удалось сохранить')
    } finally {
      setEditCommentBusy(false)
    }
  }

  const deleteCommentById = async (id: string) => {
    if (!confirm('Удалить этот комментарий?')) return
    try {
      await api.delete(`/api/reviews/${id}`, { auth: true })
      toast.success('Комментарий удалён')
      fetchComments()
    } catch (e: any) {
      toast.error(e?.message || 'Не удалось удалить')
    }
  }

  // v25.12: real favorites — heart works like on product page
  const favorited = useFavoritesStore((s) => s.ids.includes(item.id))
  const toggleFavorite = useFavoritesStore((s) => s.toggle)

  const media = item.media
  const current = media[mediaIdx]
  const hasMultiple = media.length > 1

  // v25.20: фоновая музыка товара в ленте («как в Инстаграме»).
  // Играет ТОЛЬКО у активного слайда и только на ФОТО (у видео свой звук).
  // ВАЖНО: неактивные слайды НЕ трогают плеер (иначе заглушат активный).
  const pmState = useProductMusic()
  useEffect(() => {
    if (!isActive) return
    if (!item.music?.url || current?.type !== 'image' || pmState.muted) {
      stopProductMusic()
      return
    }
    playProductMusic(item.music)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, current?.type, item.music?.url, pmState.muted])

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

  // v25.12: real comments — fetch from /api/reviews (с ответами v25.16)
  const fetchComments = useCallback(async () => {
    setCommentsLoading(true)
    try {
      const d = await api.get<{ items: Array<any> }>(`/api/reviews?productId=${item.id}&limit=50`)
      const raw = (d as any).items || (d as any).reviews || []
      const mapped = raw.map((r: any) => ({
        id: r.id,
        userId: r.user?.id,
        author: r.user?.displayName || r.user?.username || r.authorName || 'Гость',
        text: r.content || r.text || r.comment || '',
        createdAt: r.createdAt,
        replies: Array.isArray(r.replies)
          ? r.replies.map((rep: any) => ({
              id: rep.id,
              userId: rep.user?.id,
              author: rep.user?.displayName || rep.user?.username || 'Гость',
              text: rep.content || '',
              createdAt: rep.createdAt,
              // v25.24: flatten-поля «ответ на ответ»
              replyToName: rep.replyToName ?? null,
              replyToId: rep.replyToId ?? null,
            })).filter((c: any) => c.text)
          : [],
      })).filter((c: any) => c.text || (c.replies && c.replies.length))
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
      if (replyTo) {
        // v25.16: ОТВЕТ на комментарий — доступен любому авторизованному.
        // Автор исходного комментария получит push «↩ Ответ на ваш комментарий»
        // со ссылкой прямо на этот товар.
        await api.post(`/api/reviews/${replyTo.id}/replies`, {
          json: { content: commentText.trim() },
          auth: true,
        })
        toast.success(`Вы ответили ${replyTo.author}`)
        setReplyTo(null)
      } else {
        await api.post('/api/reviews', {
          json: {
            productId: item.id,
            rating: 5,
            content: commentText.trim(),
          },
          auth: true,
        })
        toast.success('Комментарий добавлен!')
      }
      setCommentText('')
      fetchComments()
      haptic.success()
    } catch (err: any) {
      toast.error(err?.message || 'Не удалось добавить комментарий')
    } finally {
      setSubmittingComment(false)
    }
  }

  // ═══ v25.16: ПОЛНОЦЕННАЯ CAROUSEL-КАРУСЕЛЬ (drag, а не скачок по порогу).
  // Слайды тянутся пальцем ИЛИ мышью и следуют за жестом; горизонталь/вертикаль
  // различаются в первые 8px — вертикальный скролл ленты не ломается
  // (touch-action: pan-y на контейнере даёт браузеру приоритет по Y).
  const trackRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ startX: number; startY: number; active: boolean; locked: 'x' | 'y' | null }>({
    startX: 0, startY: 0, active: false, locked: null,
  })
  const [dragX, setDragX] = useState(0)
  const [isDragging, setIsDragging] = useState(false)

  const onPointerDown = (e: React.PointerEvent) => {
    if (media.length <= 1) return
    drag.current = { startX: e.clientX, startY: e.clientY, active: true, locked: null }
    setIsDragging(false)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d.active) return
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    if (!d.locked) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
      d.locked = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
    }
    if (d.locked !== 'x') return
    setIsDragging(true)
    // Resistance у крайних слайдов — тянуть можно, но «туго».
    const atEdge = (dx > 0 && mediaIdx === 0) || (dx < 0 && mediaIdx === media.length - 1)
    setDragX(atEdge ? dx * 0.28 : dx)
  }
  const endDrag = () => {
    const d = drag.current
    d.active = false
    if (d.locked !== 'x') { setDragX(0); return }
    const width = trackRef.current?.clientWidth || 1
    const threshold = Math.min(90, width * 0.18)
    if (dragX < -threshold && mediaIdx < media.length - 1) {
      setMediaIdx((i) => i + 1)
      haptic.select()
    } else if (dragX > threshold && mediaIdx > 0) {
      setMediaIdx((i) => i - 1)
      haptic.select()
    }
    setDragX(0)
    setIsDragging(false)
    d.locked = null
  }

  // v25.13 (real metrics): REMOVED `baseCount` / `likes` / `comments` /
  // `shares` fake-number generators. These were deterministic-hash
  // pseudo-counts that gave every product a fake 380-880 likes + 12-512
  // comments + 20-520 shares — dishonest. The backend does NOT expose
  // per-product view/like/share counts yet, so we hide those metrics
  // entirely until real data is available.
  //
  // `commentsList` (fetched from /api/reviews) is REAL and is shown.
  // `favorited` is a local state (real — user's own action).

  return (
    <section
      data-idx={idx}
      className="snap-start h-full w-full relative snap-always flex flex-col"
      style={{ scrollSnapAlign: 'start', background: t.bg }}
    >
      {/* === MIDDLE: CINEMATIC MEDIA — full-bleed cover + blurred backdrop +
          drag-карусель (v25.16). === */}
      <div
        className="flex-1 relative min-h-0 flex items-center justify-center overflow-hidden"
        style={{ touchAction: 'pan-y' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={endDrag}
      >
        {/* Blurred backdrop — fills letterbox zones, gives depth */}
        {current?.url ? (
          <img
            src={assetUrl(current.url)}
            aria-hidden="true"
            className="absolute inset-0 h-full w-full object-cover scale-125 pointer-events-none select-none"
            style={{ filter: 'blur(48px) saturate(1.4)', opacity: t.isLight ? 0.35 : 0.55 }}
          />
        ) : null}
        {/* Cinematic scrims — top for legibility of header dots, bottom for panel */}
        <div className="absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-black/25 to-transparent pointer-events-none z-[1]" />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-black/45 via-black/15 to-transparent pointer-events-none z-[1]" />

        {/* Drag-трек карусели: следует за пальцем, затем плавно доводится
            до ближайшего слайда. Видео/картинки не перетаскиваются сами
            (draggable=false), клик по видео работает как раньше. */}
        <div
          ref={trackRef}
          className="relative z-[2] flex h-full w-full"
          style={{
            transform: `translateX(calc(${-mediaIdx * 100}% + ${dragX}px))`,
            transition: isDragging ? 'none' : 'transform 320ms cubic-bezier(0.22, 1, 0.36, 1)',
          }}
        >
          {media.map((m, i) => (
            <div key={i} className="relative h-full w-full shrink-0 overflow-hidden" style={{ background: t.mediaBg }}>
              {m.type === 'video' ? (
                <video
                  ref={i === mediaIdx ? videoRef : undefined}
                  src={assetUrl(m.url)}
                  poster={m.poster ? assetUrl(m.poster) : undefined}
                  className="h-full w-full object-cover"
                  loop muted playsInline
                  preload={i === mediaIdx ? 'auto' : 'metadata'}
                  onClick={toggleVideoPause}
                />
              ) : m.url ? (
                <img
                  src={assetUrl(m.url)}
                  alt={item.title}
                  className="h-full w-full object-cover"
                  style={{
                    transform: isActive && i === mediaIdx ? 'scale(1)' : 'scale(1.07)',
                    transition: 'transform 6s cubic-bezier(0.22, 1, 0.36, 1)',
                  }}
                  loading={idx < 2 && i === 0 ? 'eager' : 'lazy'}
                  draggable={false}
                />
              ) : (
                <div className="h-full w-full grid place-items-center text-white/40">
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

        {/* Media dots — крупнее и с чипом «N/M» — свайп теперь заметен */}
        {hasMultiple && (
          <>
            <div className="absolute top-2 left-1/2 -translate-x-1/2 flex gap-1.5 z-10">
              {media.map((_, i) => (
                <span key={i} className={`h-1.5 rounded-full transition-all ${i === mediaIdx ? 'w-5' : 'w-1.5'}`}
                style={{ background: i === mediaIdx ? t.dotActive : t.dotColor }} />
              ))}
            </div>
            {/* Чип позиции — намёк «фото можно листать» */}
            <div
              className="absolute top-1.5 right-2 z-10 h-7 px-2.5 rounded-full backdrop-blur-md text-[10px] font-bold tabular-nums flex items-center gap-1 pointer-events-none"
              style={{
                background: t.isLight ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0.45)',
                color: '#fff',
              }}
            >
              {mediaIdx + 1}/{media.length}
            </div>
          </>
        )}

        {/* === RIGHT SIDE: Action rail — bigger glass buttons with press
            feedback (heart real / comments count real / share) === */}
        <div className="absolute right-2 top-1/2 -translate-y-1/2 z-10 flex flex-col gap-3 items-center">
          <motion.button whileTap={{ scale: 0.82 }} onClick={toggleLike} className="flex flex-col items-center gap-1">
            <span className="h-11 w-11 rounded-full grid place-items-center backdrop-blur-md transition-all"
              style={{
                background: favorited ? 'rgba(239,68,68,0.92)' : t.buttonBg,
                boxShadow: favorited ? '0 8px 24px rgba(239,68,68,0.45)' : '0 6px 20px rgba(0,0,0,0.18)',
                border: '1px solid rgba(255,255,255,0.25)',
              }}>
              <Heart className="h-5 w-5" style={{ color: favorited ? '#fff' : t.buttonText }} fill={favorited ? 'currentColor' : 'none'} />
            </span>
          </motion.button>
          <motion.button whileTap={{ scale: 0.82 }} onClick={toggleComments} className="flex flex-col items-center gap-1">
            <span className="h-11 w-11 rounded-full grid place-items-center backdrop-blur-md transition-all"
              style={{
                background: showComments ? 'rgba(168,85,247,0.92)' : t.buttonBg,
                boxShadow: showComments ? '0 8px 24px rgba(168,85,247,0.4)' : '0 6px 20px rgba(0,0,0,0.18)',
                border: '1px solid rgba(255,255,255,0.25)',
              }}>
              <MessageCircle className="h-5 w-5" style={{ color: showComments ? '#fff' : t.buttonText }} />
            </span>
            {/* v25.13/14: commentsList.length is the REAL count fetched from /api/reviews. */}
            {commentsList.length > 0 && (
              <span className="text-[10px] font-semibold px-1 rounded-full" style={{ color: '#fff', background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(4px)' }}>{commentsList.length}</span>
            )}
          </motion.button>
          <motion.button whileTap={{ scale: 0.82 }} onClick={(e) => { e.stopPropagation(); haptic.tap(); if (navigator.share) navigator.share({ title: item.title, url: `${window.location.origin}/?product=${item.id}` }).catch(()=>{}); else { navigator.clipboard?.writeText(`${window.location.origin}/?product=${item.id}`); toast.success('Ссылка скопирована') } }} className="flex flex-col items-center gap-1">
            <span className="h-11 w-11 rounded-full grid place-items-center backdrop-blur-md"
              style={{ background: t.buttonBg, border: '1px solid rgba(255,255,255,0.25)', boxShadow: '0 6px 20px rgba(0,0,0,0.18)' }}>
              <Share2 className="h-5 w-5" style={{ color: t.buttonText }} />
            </span>
          </motion.button>
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
          <div className="flex-1 overflow-y-auto px-4 py-2 space-y-3" onClick={(e) => e.stopPropagation()}>
            {commentsLoading ? (
              <div className="text-center py-8 text-sm" style={{ color: t.textMuted }}>Загрузка…</div>
            ) : commentsList.length === 0 ? (
              <div className="text-center py-8 text-sm" style={{ color: t.textMuted }}>
                Пока нет комментариев. Будьте первым!
              </div>
            ) : (
              commentsList.map((c) => (
                <div key={c.id}>
                  <div className="flex gap-2">
                    <div className="h-7 w-7 rounded-full grid place-items-center text-[10px] font-bold shrink-0" style={{ background: 'linear-gradient(135deg, #EC4899, #9333EA)', color: '#fff' }}>
                      {c.author.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="font-semibold text-xs" style={{ color: t.text }}>{c.author}</span>
                      {/* v25.17: инлайн-редактирование своего комментария */}
                      {editingCommentId === c.id ? (
                        <div className="mt-1">
                          <textarea
                            value={editCommentText}
                            onChange={(e) => setEditCommentText(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveCommentEdit() }
                              if (e.key === 'Escape') setEditingCommentId(null)
                            }}
                            rows={2}
                            maxLength={2000}
                            autoFocus
                            disabled={editCommentBusy}
                            className="w-full resize-none rounded-xl px-3 py-2 text-sm outline-none ring-1"
                            style={{ background: t.isLight ? '#fff' : 'rgba(255,255,255,0.08)', color: t.text, '--tw-ring-color': 'rgba(236,72,153,0.5)' } as React.CSSProperties}
                          />
                          <div className="flex items-center justify-end gap-2 mt-1">
                            <button onClick={() => setEditingCommentId(null)} className="text-[11px] font-semibold" style={{ color: t.textMuted }}>
                              Отмена
                            </button>
                            <button
                              onClick={saveCommentEdit}
                              disabled={editCommentBusy || !editCommentText.trim()}
                              className="text-[11px] font-bold text-white rounded-full px-3 py-1 disabled:opacity-40"
                              style={{ background: 'linear-gradient(135deg, #EC4899, #9333EA)' }}
                            >
                              {editCommentBusy ? 'Сохранение…' : 'Сохранить'}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          {/* v25.24: длинный комментарий сворачивается */}
                          <div style={{ color: t.text }}>
                            <CollapsibleText
                              text={c.text}
                              maxLines={6}
                              className="text-sm leading-tight whitespace-pre-wrap"
                              buttonClassName="!text-[11px]"
                            />
                          </div>
                          <div className="flex items-center gap-3 mt-0.5">
                            {authed && (
                              <button
                                onClick={() => setReplyTo({ id: c.id, author: c.author })}
                                className="text-[11px] font-semibold"
                                style={{ color: '#EC4899' }}
                              >
                                Ответить
                              </button>
                            )}
                            {authed && c.userId === meId && (
                              <button
                                onClick={() => { setEditCommentText(c.text); setEditingCommentId(c.id) }}
                                className="text-[11px] font-semibold"
                                style={{ color: t.textMuted }}
                              >
                                Изменить
                              </button>
                            )}
                            {authed && (c.userId === meId || isAdminUser) && (
                              <button
                                onClick={() => deleteCommentById(c.id)}
                                className="text-[11px] font-semibold"
                                style={{ color: t.textMuted }}
                              >
                                Удалить
                              </button>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Вложенные ответы (1 уровень) */}
                  {!!c.replies?.length && (
                    <div className="mt-1.5 ml-9 space-y-1.5">
                      {c.replies.map((rep) => (
                        <div key={rep.id} className="flex gap-2">
                          <div className="h-6 w-6 rounded-full grid place-items-center text-[9px] font-bold shrink-0" style={{ background: t.isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.14)', color: t.text }}>
                            {rep.author.charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <span className="font-semibold text-[11px]" style={{ color: t.textMuted }}>{rep.author}</span>
                            {!!rep.replyToName && rep.replyToId !== c.id && (
                              <span className="ml-1 text-[10px]" style={{ color: t.textMuted }}>↩ {rep.replyToName}</span>
                            )}
                            {editingCommentId === rep.id ? (
                              <div className="mt-0.5">
                                <textarea
                                  value={editCommentText}
                                  onChange={(e) => setEditCommentText(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveCommentEdit() }
                                    if (e.key === 'Escape') setEditingCommentId(null)
                                  }}
                                  rows={2}
                                  maxLength={2000}
                                  autoFocus
                                  disabled={editCommentBusy}
                                  className="w-full resize-none rounded-xl px-2.5 py-1.5 text-[13px] outline-none ring-1"
                                  style={{ background: t.isLight ? '#fff' : 'rgba(255,255,255,0.08)', color: t.text, '--tw-ring-color': 'rgba(236,72,153,0.5)' } as React.CSSProperties}
                                />
                                <div className="flex items-center justify-end gap-2 mt-1">
                                  <button onClick={() => setEditingCommentId(null)} className="text-[11px] font-semibold" style={{ color: t.textMuted }}>Отмена</button>
                                  <button
                                    onClick={saveCommentEdit}
                                    disabled={editCommentBusy || !editCommentText.trim()}
                                    className="text-[11px] font-bold text-white rounded-full px-3 py-0.5 disabled:opacity-40"
                                    style={{ background: 'linear-gradient(135deg, #EC4899, #9333EA)' }}
                                  >
                                    {editCommentBusy ? 'Сохранение…' : 'Сохранить'}
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <>
                                {/* v25.24: длинный ответ сворачивается */}
                                <div style={{ color: t.text }}>
                                  <CollapsibleText
                                    text={rep.text}
                                    maxLines={5}
                                    className="text-[13px] leading-tight whitespace-pre-wrap"
                                    buttonClassName="!text-[10px]"
                                  />
                                </div>
                                <div className="flex items-center gap-3">
                                  {/* v25.24: ответить можно на ЛЮБОЙ ответ */}
                                  {authed && (
                                    <button
                                      onClick={() => setReplyTo({ id: rep.id, author: rep.author })}
                                      className="text-[10px] font-semibold"
                                      style={{ color: '#EC4899' }}
                                    >
                                      Ответить
                                    </button>
                                  )}
                                  {authed && (rep.userId === meId || isAdminUser) && (
                                    <>
                                      <button
                                        onClick={() => { setEditCommentText(rep.text); setEditingCommentId(rep.id) }}
                                        className="text-[10px] font-semibold"
                                        style={{ color: t.textMuted }}
                                      >
                                        Изменить
                                      </button>
                                      <button
                                        onClick={() => deleteCommentById(rep.id)}
                                        className="text-[10px] font-semibold"
                                        style={{ color: t.textMuted }}
                                      >
                                        Удалить
                                      </button>
                                    </>
                                  )}
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          {/* Comment input — v25.14: tapping as a guest opens the auth dialog
              ON TOP of everything (z-index fixed globally in ui/dialog.tsx).
              v25.16: поддерживает режим «ответить» с чипом отмены. */}
          <div className="shrink-0 px-3 pt-2 border-t" style={{ borderColor: t.isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.1)', paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 8px)' }} onClick={(e) => e.stopPropagation()}>
            {replyTo && (
              <div className="flex items-center gap-1.5 mb-1.5">
                <span className="text-[11px] font-medium truncate" style={{ color: t.textMuted }}>
                  Ответ для <b style={{ color: t.text }}>{replyTo.author}</b>
                </span>
                <button onClick={() => setReplyTo(null)} aria-label="Отменить ответ" className="ml-auto h-6 w-6 rounded-full grid place-items-center" style={{ background: t.isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.12)' }}>
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}
            <div className="flex items-center gap-2 py-2">
              <input
                type="text"
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitComment() } }}
                onFocus={() => {
                  if (!authed) {
                    window.dispatchEvent(new CustomEvent('999pro:open-auth'))
                    toast.info('Войдите, чтобы оставить комментарий')
                  }
                }}
                placeholder={replyTo ? `Ответить ${replyTo.author}…` : authed ? 'Написать комментарий…' : 'Войдите, чтобы комментировать'}
                readOnly={!authed}
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
        </div>
      )}

      {/* === BOTTOM: Animated premium product panel (v25.14) === */}
      <div
        className="shrink-0 px-3 pt-3 pb-3 z-20"
        style={{ background: `linear-gradient(to top, ${t.panelFrom} 55%, ${t.panelVia} 85%, transparent 100%)`, paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 14px)' }}
      >
        <motion.div
          key={item.id}
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1], delay: 0.05 }}
          className="space-y-2"
        >
          {/* Badges row */}
          {(item.oldPrice && item.oldPrice > item.price) || item.isNew || item.category ? (
            <div className="flex items-center gap-1.5 flex-wrap">
              {item.oldPrice && Number(item.oldPrice) > Number(item.price) && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold text-white" style={{ background: 'linear-gradient(135deg,#F43F5E,#FB923C)' }}>
                  −{Math.round((1 - Number(item.price) / Number(item.oldPrice)) * 100)}%
                </span>
              )}
              {item.isNew && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold text-white" style={{ background: 'linear-gradient(135deg,#10B981,#34D399)' }}>Новинка</span>
              )}
              {item.category && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-medium backdrop-blur-md"
                  style={{ background: t.isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.12)', color: t.textMuted }}>
                  {item.category}
                </span>
              )}
            </div>
          ) : null}

          {/* Title + price */}
          <div className="flex items-end gap-3">
            <h2 className="flex-1 font-bold text-base leading-snug line-clamp-2 drop-shadow-sm" style={{ color: t.text }}>{item.title}</h2>
            <div className="text-right shrink-0">
              <div
                className="font-extrabold text-xl leading-none bg-clip-text text-transparent"
                style={{ backgroundImage: 'linear-gradient(135deg,#EC4899 0%,#A855F7 60%,#FB923C 120%)' }}
              >
                {formatPrice(item.price, item.currency)}
              </div>
              {item.oldPrice && Number(item.oldPrice) > Number(item.price) && (
                <div className="text-[11px] line-through mt-0.5" style={{ color: t.textMuted }}>{formatPrice(item.oldPrice, item.currency)}</div>
              )}
            </div>
          </div>

          {/* Premium action row */}
          <div className="flex items-center gap-2">
            <motion.button
              whileTap={{ scale: 0.96 }}
              onClick={(e) => { e.stopPropagation(); onOpenProductViewer() }}
              className="flex-1 h-11 rounded-2xl backdrop-blur-md font-semibold text-xs flex items-center justify-center gap-1.5 transition-colors"
              style={{
                background: t.isLight ? 'rgba(255,255,255,0.82)' : 'rgba(255,255,255,0.10)',
                border: '1px solid rgba(128,128,128,0.22)',
                color: t.text,
              }}
            >
              Открыть товар
              <ArrowRight className="h-3.5 w-3.5" />
            </motion.button>

            {/* WhatsApp / Phone — компактные круглые */}
            {item.department?.whatsapp && (
              <motion.a
                whileTap={{ scale: 0.88 }}
                href={`https://wa.me/${item.department.whatsapp.replace(/\D/g, '')}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                aria-label="WhatsApp"
                className="h-11 w-11 rounded-2xl grid place-items-center shrink-0 transition-transform"
                style={{ background: 'linear-gradient(135deg,#10B981,#059669)', boxShadow: '0 8px 20px rgba(16,185,129,0.35)' }}
              >
                <MessageCircle className="h-5 w-5 text-white" />
              </motion.a>
            )}

            <motion.button
              whileTap={{ scale: 0.96 }}
              onClick={(e) => { e.stopPropagation(); onLeaveRequest() }}
              className="h-11 px-5 rounded-2xl text-white font-bold text-xs shrink-0 flex items-center gap-1.5"
              style={{
                background: 'linear-gradient(135deg,#EC4899 0%,#A855F7 60%,#FB923C 130%)',
                boxShadow: '0 10px 26px rgba(168,85,247,0.45)',
              }}
            >
              Заявка
              <Send className="h-3.5 w-3.5" />
            </motion.button>
          </div>
        </motion.div>
      </div>
    </section>
  )
}
