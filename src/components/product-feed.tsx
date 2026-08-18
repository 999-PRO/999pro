'use client'

// ============================================================================
//  ProductFeed — fullscreen vertical product feed (Reels / TikTok style).
//  v25.10 (Task #3) — rewritten v25.10.1 for clarity + scroll + UX.
//  ----------------------------------------------------------------------------
//  UX goals:
//    • Premium dark cinematic look — gradient vignette, glass info panel,
//      large price, clear CTAs.
//    • Works on desktop (wheel + arrow keys + drag) AND mobile (touch swipe).
//    • Snap-scrolling between items — each slide fills the viewport.
//    • 3:4 video/image, NO crop (object-contain).
//    • Two primary CTAs: "Описание" (opens bottom sheet) + "Перейти к товару"
//      (opens existing Product Viewer, closes the feed).
//    • Existing contact CTAs (WhatsApp, phone, leave-request) preserved.
//
//  Architecture:
//    • Mounted globally in AppShell, listens for `open-feed` window event.
//    • Fetches products via /api/products?shuffle=true&limit=20.
//    • When user taps "Перейти к товару", dispatches `999pro:open-product`
//      event with the product payload — page.tsx opens the existing
//      ProductPage viewer. The feed closes so the viewer is top-most.
// ============================================================================

import { useEffect, useState, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X, ChevronUp, ChevronDown, FileText, ArrowRight, Phone, MessageCircle,
  Send, Loader2, ShoppingBag, Heart,
} from 'lucide-react'
import Image from 'next/image'
import { api, assetUrl } from '@/lib/api'
import { formatPrice } from '@/lib/format'
import { toast } from '@/lib/notifications'
import { haptic } from '@/lib/haptic'
import { useScrollLock } from '@/lib/use-scroll-lock'
import { cn } from '@/lib/utils'
import type { Product } from '@/lib/types'

interface FeedItem extends Product {
  firstImage: string | null
}

export function ProductFeed() {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<FeedItem[]>([])
  const [loading, setLoading] = useState(false)
  const [activeIdx, setActiveIdx] = useState(0)
  const [descOpen, setDescOpen] = useState<FeedItem | null>(void 0 as unknown as FeedItem | null)
  const [favorited, setFavorited] = useState<Set<string>>(new Set())
  const scrollRef = useRef<HTMLDivElement>(null)
  // v25.10.2: closeRef lets the 'close-feed' event listener (registered in
  // the open effect, runs once on mount) call the LATEST close() callback
  // without re-registering the listener on every close() identity change.
  const closeRef = useRef<() => void>(() => {})

  // v25.10.2 (CRITICAL): useScrollLock with `preserveTouchAction: true` so
  // the feed's snap-scroll container can receive touch events. Without this,
  // useScrollLock sets `body { touch-action: none }` AND blocks `touchmove`
  // on the document (except inside [data-scroll-lock-ignore] elements).
  // The feed container has `data-scroll-lock-ignore` below, but the
  // touch-action:none on body was still intersecting the container's
  // `touch-action: pan-y` down to `none` on iOS Safari — killing touch
  // swipe. preserveTouchAction skips the body touch-action override.
  useScrollLock(open, { preserveTouchAction: true })

  // ─── Open via window event ───
  useEffect(() => {
    const onOpen = async () => {
      setOpen(true)
      setLoading(true)
      setActiveIdx(0)
      try {
        const data = await api.get<{ items: Product[] }>(
          '/api/products?shuffle=true&limit=20',
        )
        const enriched: FeedItem[] = (data.items || []).map((p) => ({
          ...p,
          firstImage: p.images?.[0] || null,
        }))
        setItems(enriched)
      } catch (err: any) {
        toast.error(err?.message || 'Не удалось загрузить ленту')
        setOpen(false)
      } finally {
        setLoading(false)
      }
    }
    window.addEventListener('open-feed', onOpen)
    // v25.10.2: FeedSlide emits 'close-feed' from its top-bar close button
    // (instead of calling close() directly) so the slide doesn't need a
    // closure ref to the parent. Listen here and call close().
    const onClose = () => closeRef.current()
    window.addEventListener('close-feed', onClose)
    return () => {
      window.removeEventListener('open-feed', onOpen)
      window.removeEventListener('close-feed', onClose)
    }
  }, [])

  // ─── Snap to slide on wheel / arrow keys (desktop) ───
  // Without this, snap-mandatory + wheel only moves a few px per wheel notch
  // because the browser interprets each notch as a small scroll, not a full
  // page. We detect wheel direction and call scrollToSlide() to advance.
  const scrollToSlide = useCallback((idx: number) => {
    const container = scrollRef.current
    if (!container) return
    const clamped = Math.max(0, Math.min(items.length, idx))
    const slide = container.querySelector(`[data-idx="${clamped}"]`) as HTMLElement | null
    if (slide) {
      slide.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [items.length])

  // Wheel handler — debounced so one wheel notch = one slide advance.
  const wheelLockRef = useRef(false)
  useEffect(() => {
    if (!open) return
    const container = scrollRef.current
    if (!container) return

    const onWheel = (e: WheelEvent) => {
      // Ignore tiny trackpad scrolls (more sensitive than mouse wheels).
      if (Math.abs(e.deltaY) < 15) return
      e.preventDefault()
      if (wheelLockRef.current) return
      wheelLockRef.current = true
      const dir = e.deltaY > 0 ? 1 : -1
      const next = Math.max(0, Math.min(items.length, activeIdx + dir))
      if (next !== activeIdx) {
        setActiveIdx(next)
        haptic.select()
        scrollToSlide(next)
      }
      // Unlock after the smooth-scroll animation finishes (~400ms).
      setTimeout(() => { wheelLockRef.current = false }, 450)
    }

    container.addEventListener('wheel', onWheel, { passive: false })
    return () => container.removeEventListener('wheel', onWheel)
  }, [open, activeIdx, items.length, scrollToSlide])

  // Keyboard handler — arrow keys + Escape.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown' || e.key === 'PageDown') {
        e.preventDefault()
        const next = Math.min(items.length, activeIdx + 1)
        if (next !== activeIdx) { setActiveIdx(next); scrollToSlide(next); haptic.select() }
      } else if (e.key === 'ArrowUp' || e.key === 'PageUp') {
        e.preventDefault()
        const prev = Math.max(0, activeIdx - 1)
        if (prev !== activeIdx) { setActiveIdx(prev); scrollToSlide(prev); haptic.select() }
      } else if (e.key === 'Escape') {
        close()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, activeIdx, items.length, scrollToSlide])

  // Track active slide via IntersectionObserver (touch swipe detection).
  useEffect(() => {
    if (!open || items.length === 0) return
    const container = scrollRef.current
    if (!container) return

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && entry.intersectionRatio > 0.6) {
            const idx = Number((entry.target as HTMLElement).dataset.idx)
            if (!Number.isNaN(idx) && idx !== activeIdx) {
              setActiveIdx(idx)
              haptic.select()
            }
          }
        })
      },
      { root: container, threshold: [0.6, 0.9] },
    )

    const slides = container.querySelectorAll('[data-idx]')
    slides.forEach((s) => observer.observe(s))
    return () => observer.disconnect()
  }, [open, items, activeIdx])

  const close = useCallback(() => {
    haptic.tap()
    setOpen(false)
    setDescOpen(null)
    setItems([])
  }, [])

  // Keep closeRef in sync so the 'close-feed' event listener always calls
  // the latest close(). This is safe because close() has empty deps — it's
  // stable — but we still update the ref to be defensive.
  closeRef.current = close

  const openProductViewer = useCallback((item: FeedItem) => {
    haptic.tap()
    window.dispatchEvent(
      new CustomEvent('999pro:open-product', {
        detail: { productId: item.id, initialProduct: item },
      }),
    )
    setOpen(false)
    setDescOpen(null)
  }, [])

  const leaveRequest = useCallback((item: FeedItem) => {
    haptic.tap()
    window.dispatchEvent(
      new CustomEvent('open-lead', { detail: { product: item } }),
    )
    setDescOpen(null)
  }, [])

  const toggleFavorite = useCallback((item: FeedItem) => {
    haptic.select()
    setFavorited((prev) => {
      const next = new Set(prev)
      if (next.has(item.id)) {
        next.delete(item.id)
        toast.info('Убрано из избранного')
      } else {
        next.add(item.id)
        toast.success('Добавлено в избранное')
      }
      return next
    })
  }, [])

  if (!open) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.25 }}
        className="fixed inset-0 z-[450] bg-black"
      >
        {/* v25.10.2: Top bar moved INSIDE each FeedSlide so it floats over
            the image (not over the slide container). The old container-level
            top bar would have overlapped the image's top edge on mobile
            because the image area is now flex-1 (fills all space above the
            info panel) and starts directly under the status bar. */}

        {/* ─── Loading state ─── */}
        {loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-white z-40">
            <Loader2 className="h-10 w-10 animate-spin mb-3" />
            <p className="text-sm text-white/70">Загружаем ленту…</p>
          </div>
        )}

        {/* ─── Vertical snap-scroll container ─── */}
        <div
          ref={scrollRef}
          data-scroll-lock-ignore
          className="h-[100dvh] w-full overflow-y-scroll snap-y snap-mandatory no-scrollbar overscroll-y-contain"
          style={{
            scrollSnapType: 'y mandatory',
            // v25.10.2: explicit touch-action: pan-y so iOS Safari allows
            // vertical touch swipe even when body has touch-action:none
            // (set by useScrollLock for the BACKGROUND page — we don't want
            // the background to scroll, but the feed MUST scroll).
            touchAction: 'pan-y',
            WebkitOverflowScrolling: 'touch', // iOS momentum scroll
          }}
        >
          {items.map((item, idx) => (
            <FeedSlide
              key={item.id}
              item={item}
              idx={idx}
              total={items.length}
              isActive={idx === activeIdx}
              isFavorited={favorited.has(item.id)}
              onOpenDescription={() => setDescOpen(item)}
              onOpenProductViewer={() => openProductViewer(item)}
              onLeaveRequest={() => leaveRequest(item)}
              onToggleFavorite={() => toggleFavorite(item)}
            />
          ))}

          {/* End-of-feed sentinel */}
          {items.length > 0 && (
            <div className="snap-start h-[100dvh] flex flex-col items-center justify-center text-white/70 px-6 text-center">
              <ShoppingBag className="h-12 w-12 mb-4 opacity-50" />
              <p className="text-lg font-semibold mb-1">Это всё 🛍</p>
              <p className="text-sm text-white/50 mb-6">Лента закончилась — листайте вверх или закройте.</p>
              <button
                onClick={close}
                className="px-5 py-2.5 rounded-full bg-white/10 backdrop-blur-md ring-1 ring-white/20 text-white font-semibold text-sm hover:bg-white/20 transition-colors"
              >
                Закрыть ленту
              </button>
            </div>
          )}
        </div>

        {/* ─── Side nav arrows (desktop only) ─── */}
        {items.length > 0 && (
          <>
            {activeIdx > 0 && (
              <button
                onClick={() => { setActiveIdx(activeIdx - 1); scrollToSlide(activeIdx - 1); haptic.select() }}
                aria-label="Предыдущий товар"
                className="hidden md:grid absolute left-4 top-1/2 -translate-y-1/2 z-30 h-12 w-12 rounded-full bg-white/10 backdrop-blur-md ring-1 ring-white/20 place-items-center text-white hover:bg-white/20 active:scale-95 transition-all"
              >
                <ChevronUp className="h-6 w-6" />
              </button>
            )}
            {activeIdx < items.length && (
              <button
                onClick={() => { setActiveIdx(activeIdx + 1); scrollToSlide(activeIdx + 1); haptic.select() }}
                aria-label="Следующий товар"
                className="hidden md:grid absolute right-4 top-1/2 -translate-y-1/2 z-30 h-12 w-12 rounded-full bg-white/10 backdrop-blur-md ring-1 ring-white/20 place-items-center text-white hover:bg-white/20 active:scale-95 transition-all"
              >
                <ChevronDown className="h-6 w-6" />
              </button>
            )}
          </>
        )}

        {/* ─── Description bottom sheet ─── */}
        <DescriptionSheet
          item={descOpen}
          onClose={() => setDescOpen(null)}
          onOpenProductViewer={(it) => { setDescOpen(null); openProductViewer(it) }}
          onLeaveRequest={(it) => leaveRequest(it)}
        />
      </motion.div>
    </AnimatePresence>
  )
}

// ============================================================================
//  FeedSlide — one fullscreen item.
//  ----------------------------------------------------------------------------
//  Layout (v25.10.2 — rewritten for proper mobile UX):
//
//    ┌─────────────────────────────┐  ← slide starts at top: 0 (NO empty space)
//    │ [safe area pad]             │
//    │ ┌── top bar (close/count) ─┐│  ← floats over image, glass style
//    │                             │
//    │                             │
//    │      IMAGE / VIDEO          │  ← flex-1, object-contain, NO crop
//    │      (fills available       │     Black bg fills any letterbox space.
//    │       vertical space)       │     Image keeps its original aspect ratio.
//    │                             │
//    │                             │
//    ├─────────────────────────────┤  ← gradient fade for text legibility
//    │ Category • Stock            │
//    │ Title                       │  ← info panel: shrink-0, auto height
//    │ Price / old / discount      │     NOT overlay — real flex item.
//    │ Short description           │
//    │ [Перейти к товару] [Описание]│
//    │ [WA] [☎] [Заявка] [♡]      │
//    └─────────────────────────────┘
//
//  Key fixes vs v25.10.1:
//    • NO `aspect-[3/4]` on the image container — that forced the container
//      to be wider than viewport on mobile (390×844 → 633×844), pushing the
//      image off-screen and creating "empty space" look.
//    • Slide is `flex flex-col` — image area is `flex-1 min-h-0`, info panel
//      is `shrink-0`. Image fills ALL space not used by the info panel.
//    • Info panel is a real flex child (not absolute overlay) so it never
//      overlaps the image and pushes the image up naturally.
//    • `object-contain` on the image preserves the full composition — no
//      crop. Black bg fills any letterbox area so it looks intentional.
//    • Top padding = `env(safe-area-inset-top)` so the image starts directly
//      under the status bar on notch devices — NO huge empty black gap.
// ============================================================================
function FeedSlide({
  item, idx, total, isActive, isFavorited,
  onOpenDescription, onOpenProductViewer, onLeaveRequest, onToggleFavorite,
}: {
  item: FeedItem
  idx: number
  total: number
  isActive: boolean
  isFavorited: boolean
  onOpenDescription: () => void
  onOpenProductViewer: () => void
  onLeaveRequest: () => void
  onToggleFavorite: () => void
}) {
  return (
    <section
      data-idx={idx}
      className="snap-start h-[100dvh] w-full flex flex-col bg-black snap-always overflow-hidden"
      style={{ scrollSnapAlign: 'start', scrollSnapStop: 'always' }}
    >
      {/* ─── Image / Video area — flex-1, fills all space above info panel ─── */}
      <div
        className="relative flex-1 min-h-0 w-full bg-black"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        {item.videoUrl ? (
          <video
            src={assetUrl(item.videoUrl)}
            poster={item.videoPoster ? assetUrl(item.videoPoster) : undefined}
            className="absolute inset-0 h-full w-full object-contain"
            autoPlay={isActive}
            muted
            loop
            playsInline
            preload={isActive ? 'auto' : 'metadata'}
          />
        ) : item.firstImage ? (
          <Image
            src={assetUrl(item.firstImage)}
            alt={item.title}
            fill
            sizes="100vw"
            className="object-contain"
            priority={idx < 2}
            draggable={false}
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center bg-slate-900 text-white/40">
            <ShoppingBag className="h-12 w-12" />
          </div>
        )}

        {/* ─── Top bar — floats over image, glass style ─── */}
        <div className="absolute top-0 left-0 right-0 z-20 pointer-events-none">
          <div className="h-28 bg-gradient-to-b from-black/70 to-transparent" />
        </div>
        <div
          className="absolute top-0 left-0 right-0 z-30 flex items-center justify-between px-4 py-3"
          style={{ paddingTop: 'max(env(safe-area-inset-top), 0.75rem)' }}
        >
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/40 backdrop-blur-md ring-1 ring-white/10">
            <ShoppingBag className="h-3.5 w-3.5 text-white/80" />
            <span className="text-white text-[11px] font-semibold tabular-nums">
              {idx + 1} / {total}
            </span>
          </div>
          <button
            onClick={() => window.dispatchEvent(new CustomEvent('close-feed'))}
            aria-label="Закрыть ленту"
            className="h-9 w-9 rounded-full bg-black/40 backdrop-blur-md ring-1 ring-white/10 grid place-items-center text-white hover:bg-black/60 active:scale-95 transition-all"
          >
            <X className="h-4.5 w-4.5" />
          </button>
        </div>
      </div>

      {/* ─── Info panel — real flex child (shrink-0), pushes image up ─── */}
      <div
        className="relative shrink-0 bg-gradient-to-b from-transparent via-black/95 to-black"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {/* Gradient fade for image-to-info transition */}
        <div className="absolute inset-x-0 -top-16 h-16 bg-gradient-to-t from-black to-transparent pointer-events-none" />
        <div className="relative px-4 sm:px-6 pt-3 pb-4">
          {/* Category chip + stock badge */}
          <div className="flex items-center gap-2 mb-2">
            {item.category && (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-white/10 backdrop-blur-md ring-1 ring-white/10 text-white text-[10px] font-semibold uppercase tracking-wide">
                {item.category}
              </span>
            )}
            {item.inStock ? (
              <span className="inline-flex items-center gap-1 text-emerald-400 text-[10px] font-semibold uppercase tracking-wide">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> В наличии
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-rose-400 text-[10px] font-semibold uppercase tracking-wide">
                <span className="h-1.5 w-1.5 rounded-full bg-rose-400" /> Нет в наличии
              </span>
            )}
          </div>

          {/* Title + Price (single row on desktop, stacked on mobile) */}
          <div className="flex items-end justify-between gap-3 flex-wrap">
            <h2 className="text-white text-xl sm:text-2xl font-bold leading-tight line-clamp-2 drop-shadow-lg flex-1 min-w-0">
              {item.title}
            </h2>
            <div className="flex items-baseline gap-2 shrink-0">
              <span className="text-white font-bold text-xl sm:text-2xl tabular-nums">
                {formatPrice(item.price, item.currency)}
              </span>
              {item.oldPrice && item.oldPrice > item.price && (
                <span className="text-white/40 line-through text-sm tabular-nums">
                  {formatPrice(item.oldPrice, item.currency)}
                </span>
              )}
              {item.oldPrice && item.oldPrice > item.price && (
                <span className="px-1.5 py-0.5 rounded-md bg-rose-500 text-white text-[10px] font-bold leading-none">
                  −{Math.round(100 - (item.price / item.oldPrice) * 100)}%
                </span>
              )}
            </div>
          </div>

          {/* Short description (first 120 chars) */}
          {item.description && (
            <p className="text-white/70 text-[13px] leading-snug line-clamp-1 mt-1.5">
              {item.description.slice(0, 120)}
              {item.description.length > 120 ? '…' : ''}
            </p>
          )}

          {/* ─── Primary CTAs — premium compact design ─── */}
          <div className="flex items-center gap-2 mt-3">
            <button
              onClick={onOpenProductViewer}
              className="flex-1 h-11 rounded-xl bg-white text-black font-semibold text-[13px] flex items-center justify-center gap-1.5 hover:bg-white/90 active:scale-[0.98] transition-all shadow-lg"
            >
              Перейти к товару <ArrowRight className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={onOpenDescription}
              aria-label="Описание"
              className="h-11 px-3.5 rounded-xl bg-white/10 backdrop-blur-md ring-1 ring-white/15 text-white font-medium text-[13px] flex items-center justify-center gap-1.5 hover:bg-white/15 active:scale-[0.98] transition-all"
            >
              <FileText className="h-3.5 w-3.5" /> Описание
            </button>
            <button
              onClick={onToggleFavorite}
              aria-label={isFavorited ? 'Убрать из избранного' : 'Добавить в избранное'}
              className={cn(
                'h-11 w-11 shrink-0 rounded-xl backdrop-blur-md ring-1 ring-white/15 grid place-items-center transition-all active:scale-95',
                isFavorited ? 'bg-rose-500 text-white' : 'bg-white/10 text-white hover:bg-white/15',
              )}
            >
              <Heart className="h-4 w-4" fill={isFavorited ? 'currentColor' : 'none'} />
            </button>
          </div>

          {/* ─── Secondary contact CTAs — slim row, lighter visual weight ─── */}
          <div className="flex items-center gap-1.5 mt-2">
            {item.department?.whatsapp && (
              <a
                href={`https://wa.me/${item.department.whatsapp.replace(/\D/g, '')}`}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="WhatsApp"
                className="h-9 px-3 rounded-lg bg-emerald-500/15 backdrop-blur-md ring-1 ring-emerald-500/30 text-emerald-300 font-medium text-[11px] flex items-center justify-center gap-1 hover:bg-emerald-500/25 transition-colors"
              >
                <MessageCircle className="h-3 w-3" /> WhatsApp
              </a>
            )}
            {item.department?.phone && (
              <a
                href={`tel:${item.department.phone}`}
                aria-label="Позвонить"
                className="h-9 w-9 rounded-lg bg-white/8 backdrop-blur-md ring-1 ring-white/12 text-white grid place-items-center hover:bg-white/15 transition-colors"
              >
                <Phone className="h-3.5 w-3.5" />
              </a>
            )}
            <button
              onClick={onLeaveRequest}
              className="flex-1 h-9 rounded-lg bg-white/8 backdrop-blur-md ring-1 ring-white/12 text-white/85 font-medium text-[11px] flex items-center justify-center gap-1 hover:bg-white/15 transition-colors"
            >
              <Send className="h-3 w-3" /> Оставить заявку
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}

// ============================================================================
//  DescriptionSheet — overlay bottom sheet showing full product description.
// ============================================================================
function DescriptionSheet({
  item, onClose, onOpenProductViewer, onLeaveRequest,
}: {
  item: FeedItem | null | undefined
  onClose: () => void
  onOpenProductViewer: (item: FeedItem) => void
  onLeaveRequest: (item: FeedItem) => void
}) {
  useScrollLock(!!item)

  return (
    <AnimatePresence>
      {item && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[460] flex items-end sm:items-center justify-center"
          onClick={onClose}
        >
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 32, stiffness: 360 }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full sm:max-w-lg max-h-[88vh] overflow-y-auto custom-scroll bg-background sm:rounded-t-3xl sm:rounded-b-3xl rounded-t-3xl shadow-2xl"
          >
            {/* Drag handle */}
            <div className="sm:hidden sticky top-0 z-10 pt-3 pb-1 bg-background/95 backdrop-blur">
              <div className="h-1 w-10 rounded-full bg-muted-foreground/30 mx-auto" />
            </div>

            {/* Close */}
            <button
              onClick={onClose}
              aria-label="Закрыть"
              className="absolute top-3 right-3 h-9 w-9 rounded-full glass-strong grid place-items-center hover:scale-105 active:scale-95 transition-transform z-20"
            >
              <X className="h-4 w-4" />
            </button>

            <div className="p-5 pt-6 space-y-5">
              {/* Product header */}
              <div className="flex items-start gap-3">
                <div className="h-20 w-20 rounded-xl overflow-hidden bg-muted shrink-0">
                  {item.firstImage && (
                    <img
                      src={assetUrl(item.firstImage)}
                      alt={item.title}
                      className="h-full w-full object-cover"
                    />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold text-lg leading-tight line-clamp-2">{item.title}</h3>
                  {item.category && (
                    <div className="text-xs text-muted-foreground mt-1">{item.category}</div>
                  )}
                  <div className="flex items-baseline gap-2 mt-2">
                    <span className="text-xl font-bold text-primary">
                      {formatPrice(item.price, item.currency)}
                    </span>
                    {item.oldPrice && item.oldPrice > item.price && (
                      <span className="text-sm text-muted-foreground line-through">
                        {formatPrice(item.oldPrice, item.currency)}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Stock badge */}
              {item.inStock ? (
                <div className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                  ● В наличии
                </div>
              ) : (
                <div className="text-xs font-medium text-rose-500">
                  ● Нет в наличии
                </div>
              )}

              {/* Full description */}
              {item.description ? (
                <div>
                  <h4 className="text-sm font-semibold text-muted-foreground mb-2">Описание</h4>
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">{item.description}</p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground italic">Описание отсутствует</p>
              )}

              {/* CTAs */}
              <div className="grid grid-cols-2 gap-2 pt-2">
                <button
                  onClick={() => onLeaveRequest(item)}
                  className="h-12 rounded-xl bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 text-white font-bold text-sm flex items-center justify-center gap-1.5 hover:shadow-glow transition-all"
                >
                  <Send className="h-4 w-4" /> Заявка
                </button>
                <button
                  onClick={() => onOpenProductViewer(item)}
                  className="h-12 rounded-xl glass-strong font-bold text-sm flex items-center justify-center gap-1.5 hover:bg-muted/60 transition-colors"
                >
                  К товару <ArrowRight className="h-4 w-4" />
                </button>
              </div>

              {/* Contact options */}
              {(item.department?.whatsapp || item.department?.phone) && (
                <div className="flex gap-2">
                  {item.department?.whatsapp && (
                    <a
                      href={`https://wa.me/${item.department.whatsapp.replace(/\D/g, '')}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 h-11 rounded-xl bg-emerald-500/90 text-white font-semibold text-xs flex items-center justify-center gap-1.5 hover:bg-emerald-500 transition-colors"
                    >
                      <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
                    </a>
                  )}
                  {item.department?.phone && (
                    <a
                      href={`tel:${item.department.phone}`}
                      className="flex-1 h-11 rounded-xl glass font-semibold text-xs flex items-center justify-center gap-1.5 hover:bg-muted/60 transition-colors"
                    >
                      <Phone className="h-3.5 w-3.5" /> Позвонить
                    </a>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
