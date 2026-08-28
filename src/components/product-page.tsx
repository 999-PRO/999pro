'use client'

// ============================================================================
//  ProductPage — full-screen product details page (v25.3, TZ task #2)
// ----------------------------------------------------------------------------
//  Previous implementation was a framer-motion bottom sheet with drag-to-dismiss
//  gesture. That pattern caused cross-browser issues:
//    - Safari iOS: backdrop-filter + transform created a containing block that
//      broke position:fixed children (the CTA bar jumped around).
//    - Chrome Android: drag-to-dismiss conflicted with internal scroll, the
//      sheet sometimes closed when the user just wanted to scroll up.
//    - Yandex Browser: backdrop-filter blur was sometimes not applied,
//      leaving the page looking like a modal with no separation.
//
//  v25.3 redesign: render as a NATIVE full-screen page.
//    - No AnimatePresence, no motion.div, no drag handle, no backdrop.
//    - The page mounts at z-[350] (same as before, so other modals like
//      CheckoutSheet z-[250] still appear under it; SmartShareSheet is
//      rendered in a portal above it as before).
//    - The page itself scrolls (position: fixed; inset: 0; overflow-y: auto)
//      — uses native browser scrolling, which works identically in Safari,
//      Chrome, Yandex, Firefox, etc.
//    - A sticky top bar with a "back" button is always visible at the top.
//    - The bottom CTA bar (favorites / share / cart / buy) is sticky at the
//      bottom, so it stays accessible while scrolling.
//    - All existing functionality is preserved: image carousel, thumbnails,
//      specs, reviews, similar products, share, QR, department contacts,
//      add-to-cart, buy-now (opens CheckoutSheet).
// ============================================================================

import { useEffect, useState, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ChevronLeft, ChevronRight, Heart, ShoppingCart, Star, Share2,
  Check, Store, AlertTriangle, X, Copy, Music, VolumeX,
  Phone, MessageCircle, Send, Mail, MapPin, User, ArrowLeft,
} from 'lucide-react'
import { api, assetUrl } from '@/lib/api'
import type { Product } from '@/lib/types'
import { getStockLabel } from '@/lib/types'
import { useCartStore, useFavoritesStore } from '@/lib/cart-store'
import { formatPrice, formatCompactNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
// v25.20: фоновая музыка товара («как в Инстаграме»)
import { playProductMusic, stopProductMusic, useProductMusic } from '@/lib/product-music'
import { toast } from '@/lib/notifications'
import { haptic } from '@/lib/haptic'
import { sounds } from '@/lib/sounds'
// v16.1: BuySheet removed — "Купить" now opens the unified CheckoutSheet
// via the `open-checkout` window event (handled by AppShell).
import { ProductReviewsInline } from './product-reviews-inline'
import { useShareLink } from '@/lib/use-share-link'
import { SmartShareSheet } from './share/smart-share-sheet'
import { QrModal } from './share/qr-modal'
// v9-premium: Desktop-only premium 3-column layout (lg+ breakpoint).
// Mobile/tablet (md and below) keep using the original layout below.
import { ProductPageDesktop } from './product-page-desktop'
// v25.7 (TZ ЭТАП 2.8): SmartScrollButton — floating ↑/↓ button inside the
// product page's own scroll container. The product page is position:fixed
// with overflow-y:auto, so window.scroll never fires — we must pass the
// page's own scrollContainerRef so the button listens to the right scroller.
import { SmartScrollButton } from './smart-scroll-button'

interface ProductPageProps {
  productId: string | null
  onClose: () => void
  /** v21: Optional initial product data (from orders/cart). When provided,
   *  the page shows it immediately while fetching fresh data in the background.
   *  This ensures soft-deleted products from past orders still render. */
  initialProduct?: Product | null
}

export function ProductPage({ productId, onClose, initialProduct }: ProductPageProps) {
  const [product, setProduct] = useState<Product | null>(null)
  const [loading, setLoading] = useState(true)
  const [imgIndex, setImgIndex] = useState(0)
  // v25.20: фоновая музыка товара — играет на ФОТО-слайдах, на видео пауза
  // (у видео свой звук). Останавливается при уходе со страницы.
  const pmTrack = (product as any)?.music as { id: string; title: string; artist?: string | null; url: string } | null | undefined
  const videoSlideIdx = (() => {
    if (!product?.videoUrl) return -1
    const imgs = (product.images || []).length
    return Math.min(product.videoPosition ?? 0, imgs)
  })()
  const currentSlideIsVideo = videoSlideIdx >= 0 && imgIndex === videoSlideIdx
  useEffect(() => {
    if (!pmTrack?.url || currentSlideIsVideo) {
      stopProductMusic()
      return
    }
    playProductMusic(pmTrack)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pmTrack?.url, currentSlideIsVideo])
  useEffect(() => () => stopProductMusic(), [])
  // Состояние плеера фоновой музыки (для кнопки-переключателя на галерее)
  const productMusic = useProductMusic()
  // v25.8 (TRI999 launch): selected color index — when set, the main image
  // switches to that color's photo. null = use the regular image gallery.
  const [selectedColorIdx, setSelectedColorIdx] = useState<number | null>(null)
  const [shareOpen, setShareOpen] = useState(false)
  const [qrOpen, setQrOpen] = useState(false)
  // v25.15: выпадающее меню быстрых связей вместо верхней кнопки «Поделиться»
  const [contactMenuOpen, setContactMenuOpen] = useState(false)
  const touchStartX = useRef(0)

  // F-CRIT-001: ProductPage is mounted globally via AppShell — full-store
  // subscriptions would re-render it on every cart/favorites change. Select
  // only the actions + per-product presence flag we actually read.
  const cartAdd = useCartStore((s) => s.add)
  const favoritesToggle = useFavoritesStore((s) => s.toggle)
  const isFavorite = useFavoritesStore((s) => (product ? s.has(product.id) : false))
  // Smart Share — fetch (or create on demand) the short share link for this
  // product. The hook falls back to a per-product URL if the backend is
  // unreachable, so the share button always works.
  const { data: shareLink } = useShareLink(product?.id ?? null)

  useEffect(() => {
    if (!productId) return
    let alive = true
    setLoading(true)
    setImgIndex(0)
    setSelectedColorIdx(null)
    // v21: If initialProduct is provided (from orders/cart), show it immediately
    // so the user sees content right away. Then try to fetch fresh data with
    // includeDeleted=true (handles soft-deleted products from past orders).
    if (initialProduct) {
      setProduct(initialProduct)
      setLoading(false)
    } else {
      setProduct(null)
    }
    api
      .get<Product>(`/api/products/${productId}?includeDeleted=true`)
      .then((p) => {
        if (!alive) return
        setProduct(p)
      })
      .catch(() => {
        if (!alive) return
        // If we have initialProduct, keep showing it — don't close.
        if (!initialProduct) {
          toast.error('Не удалось загрузить товар')
          onClose()
        }
      })
      .finally(() => {
        if (!alive) return
        setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [productId, onClose, initialProduct])

  // Track product view — fire-and-forget POST. The backend dedupes per
  // (user OR IP) per 60s so re-mounts don't inflate the counter. The
  // product's `views` field feeds into the smart-ranking algorithm's
  // "trending" and "fast-selling" blocks on the home page.
  useEffect(() => {
    if (!productId) return
    api.post(`/api/products/${productId}/view`, { json: {} }).catch(() => {})
    // v25.11: also record in localStorage for the "Recently viewed" block
    // on the home page (used as a fallback for anonymous users).
    try {
      const raw = localStorage.getItem('999pro-recently-viewed')
      let ids: string[] = raw ? JSON.parse(raw) : []
      if (!Array.isArray(ids)) ids = []
      ids = ids.filter((id) => id !== productId)
      ids.unshift(productId)
      ids = ids.slice(0, 20)
      localStorage.setItem('999pro-recently-viewed', JSON.stringify(ids))
      window.dispatchEvent(new CustomEvent('999pro:recently-viewed-changed'))
    } catch { /* ignore */ }
  }, [productId])

  // v20: Reset scroll position to top whenever the product changes.
  // This fires when the user opens a similar product from the "Похожие
  // товары" block — the new product should always start at the top
  // (photo, title, price, rating, buy buttons), not mid-page at the
  // description.
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!productId) return
    const t = setTimeout(() => {
      if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
      }
    }, 50)
    return () => clearTimeout(t)
  }, [productId])

  // v25.3: Lock body scroll while open. The shared useScrollLock hook handles
  // iOS Safari's quirks (touchmove prevention, overscroll containment, refcounting).
  // The product page itself is marked [data-scroll-lock-ignore] so its own
  // internal scrolling still works.
  // v25.3: NOT using useScrollLock — instead the page itself is position:fixed
  // with overflow-y:auto, so the body behind it doesn't scroll anyway. This
  // avoids the iOS Safari scroll-lock quirks that were causing the bottom
  // sheet to feel "stuck". The body's overflow is naturally contained because
  // the product page covers the entire viewport.
  // (Importing the hook but not calling it to keep the import structure stable
  // — it's a no-op now.)

  // v12.6.1: Suppress PTR while the product page is open. This prevents
  // the page's natural scroll-to-top gesture from triggering a pull-to-refresh.
  useEffect(() => {
    if (!productId) return
    const ptr = (window as unknown as { __ptr?: { suppress?: () => void; unsuppress?: () => void } }).__ptr
    ptr?.suppress?.()
    return () => {
      const ptr2 = (window as unknown as { __ptr?: { unsuppress?: () => void } }).__ptr
      ptr2?.unsuppress?.()
    }
  }, [productId])

  // Refetch the product (used after a review is submitted so the product's
  // rating + reviewsCount update in the header). The backend re-aggregates
  // Product.rating after every review change, so a fresh fetch picks up
  // the new numbers.
  const refetchProduct = () => {
    if (!productId) return
    api
      .get<Product>(`/api/products/${productId}`)
      .then((p) => setProduct(p))
      .catch(() => {})
  }

  // Esc to close + arrow nav for image carousel (desktop)
  useEffect(() => {
    if (!productId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') setImgIndex((i) => (product ? (i - 1 + product.images.length) % product.images.length : 0))
      if (e.key === 'ArrowRight') setImgIndex((i) => (product ? (i + 1) % product.images.length : 0))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [productId, product, onClose])

  // v25.4 (TZ-2 task #4): System Back gesture support (Android).
  // Push a sentinel history state when the product page opens — when the
  // user presses the system Back button/gesture, we intercept it and close
  // the product page (instead of navigating away from the app).
  useEffect(() => {
    if (!productId) return
    if (typeof window === 'undefined') return
    // Push a sentinel state so Back doesn't navigate away from the page.
    window.history.pushState({ productOverlay: true }, '')
    const onPopState = () => {
      // Back was pressed — close the product page (don't navigate away).
      onClose()
    }
    window.addEventListener('popstate', onPopState)
    return () => {
      window.removeEventListener('popstate', onPopState)
      // If we added a history state and the product page is closing without
      // Back being pressed, pop it so the history stack stays clean.
      if (typeof window !== 'undefined' && window.history.state?.productOverlay) {
        window.history.back()
      }
    }
  }, [productId, onClose])

  // ========================================================================
  // v25.3: Render — full-screen page (no modal, no drag, no backdrop)
  // ========================================================================
  return (
    <>
      {/* v9-premium: Desktop layout (lg+ only). Mobile/tablet use the
          full-screen page layout below. Both share the same productId/onClose
          props, the same SmartShareSheet, QrModal, and the same API calls.
          No business logic duplication — ProductPageDesktop is purely a
          presentation layer. */}
      {productId && (
        <div className="hidden lg:block relative z-[350]">
          <ProductPageDesktop productId={productId} onClose={onClose} />
        </div>
      )}

      {/* v25.3: Mobile/tablet full-screen page.
          - position: fixed; inset: 0 — covers the viewport
          - overflow-y: auto — native browser scrolling (works everywhere)
          - z-[350] — same z-index as before, so other modals (CheckoutSheet
            z-[250]) appear UNDER it, and SmartShareSheet (rendered as a
            sibling below) appears ABOVE it (its own z-index is higher).
          - No backdrop, no drag handle, no rounded corners at top — the page
            IS the screen, not a popup.
          - v25.4 (TZ-2 task #6): image is now FULL-BLEED on mobile (no top/
            side padding), 3:4 aspect ratio, with a gradient overlay at the
            bottom that smoothly transitions into the product description.
            The back/share buttons float over the image (glass style). */}
      {productId && (
        <>
        <div
          ref={scrollContainerRef}
          data-scroll-lock-ignore
          className="lg:hidden fixed inset-0 z-[350] bg-background overflow-y-auto overscroll-contain"
          style={{
            // Native scrolling — no transform, no motion-value tricks.
            // The browser handles scroll, momentum, overscroll identically
            // across Safari / Chrome / Yandex / Firefox.
            overscrollBehavior: 'contain',
            WebkitOverflowScrolling: 'touch',
          }}
        >
          {/* Content — image carousel + info, in normal document flow. */}
          {loading || !product ? (
            <div className="grid place-items-center p-12 min-h-[60vh]">
              <div className="text-center">
                <div className="h-12 w-12 mx-auto rounded-full border-4 border-primary/30 border-t-primary animate-spin" />
                <p className="text-sm text-muted-foreground mt-3">Загрузка товара…</p>
              </div>
            </div>
          ) : (
            <div className="pb-32">
              {/* v25.10 (Task #6): vertical (3:4) product video — shown above
                  the image carousel when the admin uploaded one. Renders in
                  the same 3:4 aspect as the carousel so the visual rhythm is
                  preserved. The video uses native browser controls (play,
                  pause, seek, fullscreen, Picture-in-Picture). The poster
                  (first frame extracted by FFmpeg) shows before the user
                  taps play, so the page doesn't show a black frame. */}
              {/* v25.12: UNIFIED MEDIA CAROUSEL — video + images in ONE carousel.
                  Video position is controlled by product.videoPosition (0 = first,
                  1 = after 1st image, etc.). Admin sets this in Studio.
                  Swipe left/right navigates between video and images. */}
              {(() => {
                // Build media list: array of { type: 'video' | 'image', url, poster? }
                // Video is inserted at position = product.videoPosition (default 0).
                const videoPos = product.videoPosition ?? 0
                const imagesArr = product.images || []
                const mediaList: Array<{ type: 'video' | 'image'; url: string; poster?: string | null }> = []
                const videoInserted = { done: false }
                for (let i = 0; i < imagesArr.length; i++) {
                  // Insert video before this image if position matches
                  if (!videoInserted.done && videoPos === i && product.videoUrl) {
                    mediaList.push({ type: 'video', url: product.videoUrl, poster: product.videoPoster })
                    videoInserted.done = true
                  }
                  mediaList.push({ type: 'image', url: imagesArr[i] })
                }
                // If video not yet inserted (position >= images.length), append at end
                if (!videoInserted.done && product.videoUrl) {
                  mediaList.push({ type: 'video', url: product.videoUrl, poster: product.videoPoster })
                }
                const mediaCount = mediaList.length
                const usingColorImage = selectedColorIdx !== null && product.colors?.[selectedColorIdx]?.image

                return (
                  <div
                    className="relative w-full aspect-[3/4] overflow-hidden bg-slate-100 dark:bg-slate-900 select-none"
                    style={{ touchAction: 'pan-y' }}
                    onTouchStart={(e) => { touchStartX.current = e.touches[0].clientX }}
                    onTouchEnd={(e) => {
                      if (usingColorImage || mediaCount <= 1) return
                      const dx = e.changedTouches[0].clientX - touchStartX.current
                      if (dx < -50) setImgIndex((i) => (i + 1) % mediaCount)
                      else if (dx > 50) setImgIndex((i) => (i - 1 + mediaCount) % mediaCount)
                    }}
                  >
                    {/* v25.20: кнопка фоновой музыки товара (только если трек задан).
                        Пульс — когда играет; перечёркнутая нота — mute. */}
                    {pmTrack?.url && (() => {
                      const playing = productMusic.playing && !productMusic.muted && !currentSlideIsVideo
                      return (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            productMusic.toggleMute()
                            haptic.select()
                          }}
                          aria-label={productMusic.muted ? 'Включить музыку товара' : 'Выключить музыку товара'}
                          title={pmTrack.title + (pmTrack.artist ? ' · ' + pmTrack.artist : '')}
                          className="absolute bottom-3 right-3 z-20 h-10 w-10 rounded-full grid place-items-center backdrop-blur-md transition-all active:scale-90"
                          style={{
                            background: 'rgba(0,0,0,0.45)',
                            border: '1px solid rgba(255,255,255,0.22)',
                            color: playing ? '#fff' : 'rgba(255,255,255,0.75)',
                          }}
                        >
                          {playing && (
                            <motion.span
                              aria-hidden
                              className="absolute inset-0 rounded-full"
                              style={{ border: '1.5px solid rgba(168,85,247,0.7)' }}
                              animate={{ scale: [1, 1.35], opacity: [0.7, 0] }}
                              transition={{ duration: 1.6, repeat: Infinity, ease: 'easeOut' }}
                            />
                          )}
                          {productMusic.muted || currentSlideIsVideo ? (
                            <VolumeX className="h-4.5 w-4.5" style={{ width: 18, height: 18 }} />
                          ) : (
                            <Music className="h-4.5 w-4.5" style={{ width: 18, height: 18 }} />
                          )}
                        </button>
                      )
                    })()}
                    <div
                      className="flex h-full transition-transform duration-300 ease-out"
                      style={{
                        transform: usingColorImage
                          ? 'translateX(0)'
                          : `translateX(-${imgIndex * 100}%)`,
                      }}
                    >
                      {usingColorImage ? (
                        <img
                          src={assetUrl(product.colors[selectedColorIdx].image)}
                          alt={`${product.title} — ${product.colors[selectedColorIdx].name}`}
                          className="h-full w-full object-cover shrink-0"
                          style={{ aspectRatio: '3 / 4' }}
                          decoding="async"
                          draggable={false}
                        />
                      ) : (
                        mediaList.map((m, i) => (
                          <div key={i} className="relative h-full w-full shrink-0 bg-slate-100 dark:bg-slate-900" style={{ aspectRatio: '3 / 4' }}>
                            {m.type === 'video' ? (
                              <video
                                src={assetUrl(m.url)}
                                poster={m.poster ? assetUrl(m.poster) : undefined}
                                className="h-full w-full object-cover"
                                controls
                                playsInline
                                preload="metadata"
                              />
                            ) : (
                              /* v25.18: Ken Burns-параллакс на активном кадре —
                                 «как в ленте», оживляет галерею товара. */
                              <img
                                src={assetUrl(m.url)}
                                alt={`${product.title} — фото ${i + 1}`}
                                className={cn(
                                  'h-full w-full object-cover',
                                  i === imgIndex && (i % 2 === 0 ? 'kb-ambient-a' : 'kb-ambient-b'),
                                )}
                                style={{ aspectRatio: '3 / 4' }}
                                decoding="async"
                                draggable={false}
                              />
                            )}
                          </div>
                        ))
                      )}
                    </div>

                {/* Top overlay — back + share buttons + discount badge.
                    Glass style so they're visible over any image color.
                    Safe-area-aware so they don't go under the iOS notch. */}
                <div
                  className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-3 pb-8 pt-3"
                  style={{
                    paddingTop: 'max(env(safe-area-inset-top, 0px), 0.75rem)',
                    background: 'linear-gradient(to bottom, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0.15) 60%, transparent 100%)',
                  }}
                >
                  <button
                    onClick={() => { haptic.tap(); onClose() }}
                    aria-label="Назад"
                    className="h-10 w-10 rounded-full grid place-items-center bg-black/30 backdrop-blur-md text-white hover:bg-black/40 active:scale-95 transition-all shrink-0"
                  >
                    <ArrowLeft className="h-5 w-5" />
                  </button>
                  <div className="flex items-center gap-2">
                    {product.oldPrice && product.oldPrice > product.price && (
                      <div className="px-3 py-1.5 rounded-full bg-destructive text-white text-xs font-bold shadow-lg">
                        -{Math.round(100 - (product.price / product.oldPrice) * 100)}%
                      </div>
                    )}
                    {/* v25.15 (owner feedback): верхняя кнопка «Поделиться»
                        заменена на выпадающее меню быстрых действий
                        («позвонить или написать в WhatsApp») — без прокрутки
                        вниз к блоку контактов. Нижняя кнопка Поделиться
                        остаётся на месте. */}
                    <div className="relative">
                      <button
                        onClick={() => { haptic.tap(); setContactMenuOpen((v) => !v) }}
                        aria-label={contactMenuOpen ? 'Закрыть меню связи' : 'Связаться по товару'}
                        aria-expanded={contactMenuOpen}
                        className={cn(
                          'h-10 w-10 rounded-full grid place-items-center text-white active:scale-95 transition-all shrink-0',
                          contactMenuOpen ? 'bg-black/45 rotate-90' : 'bg-black/30 backdrop-blur-md hover:bg-black/40',
                        )}
                      >
                        {contactMenuOpen ? (
                          <X className="h-5 w-5" />
                        ) : (
                          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /><circle cx="5" cy="12" r="1" />
                          </svg>
                        )}
                      </button>

                      <AnimatePresence>
                        {contactMenuOpen && (
                          <>
                            {/* невидимый полноэкранный слой — закрытие по тапу вне меню */}
                            <div
                              className="fixed inset-0 z-[1]"
                              onClick={() => setContactMenuOpen(false)}
                            />
                            <motion.div
                              initial={{ opacity: 0, y: -8, scale: 0.96 }}
                              animate={{ opacity: 1, y: 0, scale: 1 }}
                              exit={{ opacity: 0, y: -6, scale: 0.97 }}
                              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                              className="absolute right-0 top-12 z-[2] w-52 origin-top-right rounded-2xl overflow-hidden bg-card ring-1 ring-black/10 dark:ring-white/10 shadow-[0_20px_50px_-16px_rgba(0,0,0,0.4)]"
                            >
                              <ContactActionItems product={product} onAfter={() => setContactMenuOpen(false)} onOpenShare={() => { setContactMenuOpen(false); setShareOpen(true) }} />
                            </motion.div>
                          </>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>
                </div>

                {/* Arrows (desktop only — mobile uses swipe). v25.12: uses mediaCount */}
                {(() => {
                  const mediaCount = (product.videoUrl ? 1 : 0) + product.images.length
                  if (mediaCount <= 1) return null
                  return (
                    <>
                      <button
                        onClick={() => setImgIndex((i) => (i - 1 + mediaCount) % mediaCount)}
                        aria-label="Предыдущее"
                        className="hidden md:grid absolute left-3 top-1/2 -translate-y-1/2 h-10 w-10 rounded-full bg-background/80 backdrop-blur-md place-items-center hover:scale-105 active:scale-95 transition-transform shadow-md"
                      >
                        <ChevronLeft className="h-5 w-5" />
                      </button>
                      <button
                        onClick={() => setImgIndex((i) => (i + 1) % mediaCount)}
                        aria-label="Следующее"
                        className="hidden md:grid absolute right-3 top-1/2 -translate-y-1/2 h-10 w-10 rounded-full bg-background/80 backdrop-blur-md place-items-center hover:scale-105 active:scale-95 transition-transform shadow-md"
                      >
                        <ChevronRight className="h-5 w-5" />
                      </button>
                    </>
                  )
                })()}

                {/* Dots — float above the gradient. v25.12: includes video slide */}
                {(() => {
                  const mediaCount = (product.videoUrl ? 1 : 0) + product.images.length
                  if (mediaCount <= 1) return null
                  return (
                    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 flex gap-1.5">
                      {Array.from({ length: mediaCount }).map((_, i) => (
                        <button
                          key={i}
                          onClick={() => setImgIndex(i)}
                          aria-label={i === 0 && product.videoUrl ? 'Видео' : `Фото ${i - (product.videoUrl ? 1 : 0) + 1}`}
                          className={cn(
                            'h-1.5 rounded-full transition-all',
                            i === imgIndex ? 'w-6 bg-white' : 'w-1.5 bg-white/60',
                          )}
                        />
                      ))}
                    </div>
                  )
                })()}

                {/* v25.15: белый градиент под фото УДАЛЁН (owner feedback:
                    «между описанием, ценой и картинкой какой-то белый
                    эффект»). Фото теперь заканчивается чётким краем,
                    а подпись под ним идёт без цветовых примесей.
                
                <div
                  className="absolute bottom-0 left-0 right-0 h-32 pointer-events-none"
                  style={{
                    background: 'linear-gradient(to bottom, transparent 0%, var(--background) 100%)',
                  }}
                />
                */}
                </div>
              )
              })()}

              {/* Info section — sits below the image, with the gradient
                  making it look like a natural continuation of the image. */}
              <div className="px-4 pt-2 flex flex-col gap-4">

              {/* Thumbnails */}
              {product.images.length > 1 && selectedColorIdx === null && (
                <div
                  className="flex gap-3 overflow-x-auto no-scrollbar py-4 px-1 -mx-1"
                  // v25.7 (TZ ЭТАП 2.8): allow vertical scroll pass-through so
                  // the page doesn't get "stuck" when the user starts a swipe
                  // over the thumbnails strip.
                  style={{ touchAction: 'pan-x pan-y' }}
                >
                  {product.images.map((src, i) => (
                    <button
                      key={i}
                      onClick={() => setImgIndex(i)}
                      aria-label={`Фото ${i + 1}`}
                      className={cn(
                        'shrink-0 h-16 w-12 overflow-hidden transition-all duration-200 relative rounded-[12px] shadow-sm',
                        i === imgIndex
                          ? 'scale-105 z-20 opacity-100 ring-2 ring-primary'
                          : 'z-10 opacity-55 hover:opacity-100',
                      )}
                    >
                      <img
                        src={assetUrl(src)}
                        alt={`${product.title} — фото ${i + 1}`}
                        className="h-full w-full object-cover"
                        loading="lazy"
                        draggable={false}
                      />
                    </button>
                  ))}
                </div>
              )}

              {/* v25.8 (TRI999 launch): Color selector — clicking a color
                  instantly switches the main image to that color's photo. */}
              {product.colors && product.colors.length > 0 && (
                <div className="py-2">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-semibold">
                      Цвет: {selectedColorIdx !== null ? product.colors[selectedColorIdx].name : 'выберите'}
                    </span>
                    {selectedColorIdx !== null && (
                      <button
                        onClick={() => setSelectedColorIdx(null)}
                        className="text-xs text-muted-foreground hover:text-foreground"
                      >
                        Сбросить
                      </button>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {product.colors.map((color, idx) => (
                      <button
                        key={idx}
                        onClick={() => {
                          haptic.tap()
                          setSelectedColorIdx(idx === selectedColorIdx ? null : idx)
                        }}
                        aria-label={`Цвет: ${color.name}`}
                        className={cn(
                          'relative h-14 w-14 rounded-full overflow-hidden border-2 transition-all',
                          selectedColorIdx === idx
                            ? 'border-primary scale-110 shadow-glow'
                            : 'border-border/40 hover:border-primary/40',
                        )}
                      >
                        {color.image ? (
                          <img
                            src={assetUrl(color.image)}
                            alt={color.name}
                            className="h-full w-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <div className="h-full w-full grid place-items-center bg-muted text-[10px] font-medium text-muted-foreground">
                            {color.name.slice(0, 3)}
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Info section */}
              <div className="flex flex-col gap-4 pt-2">
                {product.category && (
                  <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full gradient-soft text-primary text-xs font-semibold w-fit">
                    <Store className="h-3 w-3" /> {product.category}
                  </div>
                )}

                <h1 className="text-2xl md:text-3xl font-extrabold leading-tight tracking-tight">
                  {product.title}
                </h1>

                {/* Rating + reviews */}
                {product.rating > 0 && (
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-0.5">
                      {[1, 2, 3, 4, 5].map((s) => (
                        <Star
                          key={s}
                          className={cn(
                            'h-4 w-4',
                            s <= Math.round(product.rating) ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/40',
                          )}
                        />
                      ))}
                    </div>
                    <span className="text-sm font-semibold">{product.rating.toFixed(1)}</span>
                    <span className="text-sm text-muted-foreground">· {formatCompactNumber(product.reviewsCount)} отзывов</span>
                  </div>
                )}

                {/* Price */}
                <div className="flex items-baseline gap-3 flex-wrap">
                  <span
                    className="text-3xl font-extrabold tracking-tight bg-gradient-to-br from-sky-400 via-blue-600 to-indigo-700 bg-clip-text text-transparent"
                    style={{ filter: 'drop-shadow(0 2px 10px rgba(59,130,246,0.35))' }}
                  >
                    {formatPrice(product.price, product.currency)}
                  </span>
                  {product.oldPrice && product.oldPrice > product.price && (
                    <span className="text-lg text-muted-foreground line-through">
                      {formatPrice(product.oldPrice, product.currency)}
                    </span>
                  )}
                </div>

                {/* Stock badge */}
                <div className="flex flex-wrap gap-3 text-xs">
                  {(() => {
                    const stock = getStockLabel(product)
                    const cls =
                      stock.variant === 'in-stock'
                        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                        : stock.variant === 'low'
                          ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                          : 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                    const Icon = stock.variant === 'in-stock' ? Check : stock.variant === 'low' ? AlertTriangle : X
                    return (
                      <div className={cn('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full', cls)}>
                        <Icon className="h-3.5 w-3.5" /> {stock.text}
                      </div>
                    )
                  })()}
                </div>

                {/* Description */}
                {product.description && (
                  <div className="pt-2">
                    <h2 className="text-sm font-bold mb-1.5">Описание</h2>
                    <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">
                      {product.description}
                    </p>
                  </div>
                )}

                {/* Department contacts */}
                {product.department && (
                  <DepartmentContacts department={product.department} />
                )}

                {/* Specs */}
                <div className="pt-1">
                  <h2 className="text-sm font-extrabold mb-2 bg-gradient-to-r from-blue-500 via-blue-600 to-indigo-600 bg-clip-text text-transparent">Характеристики</h2>
                  <div className="flex flex-col gap-1">
                    <SpecRow label="Категория" value={product.category || '—'} />
                    <SpecRow label="Артикул" value={product.id.slice(-8).toUpperCase()} />
                    <SpecRow label="Валюта" value={product.currency || 'RUB'} />
                    <SpecRow label="Наличие" value={getStockLabel(product).text} />
                    {product.quantity != null && product.quantity > 0 && (
                      <SpecRow label="Остаток" value={`${product.quantity} шт.`} />
                    )}
                    <SpecRow label="Количество фото" value={String(product.images.length)} />
                  </div>
                </div>

                {/* Reviews */}
                <ProductReviewsInline product={product} onReviewChanged={refetchProduct} />

                {/* Similar products */}
                <SimilarProducts product={product} />
              </div>
              {/* Close info-section div */}
              </div>
            </div>
          )}

          {/* v25.3: Sticky bottom CTA bar — favorites / share / cart / buy.
              Sticky at the bottom of the scrollable page, so it's always
              accessible while scrolling. Uses safe-area-inset-bottom so it
              doesn't go under the iOS home indicator. */}
          {product && (
            <div
              className="sticky bottom-0 left-0 right-0 z-20 bg-background/90 backdrop-blur-2xl border-t border-border/40 p-3"
              style={{
                paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))',
              }}
            >
              <div className="max-w-3xl mx-auto flex items-center gap-2.5">
                <button
                  onClick={() => {
                    const wasFavorite = isFavorite
                    favoritesToggle(product.id)
                    haptic.select()
                    if (!wasFavorite) sounds.like()
                    toast.success(wasFavorite ? 'Удалено из избранного' : 'Добавлено в избранное')
                  }}
                  aria-label="В избранное"
                  className={cn(
                    'h-12 w-12 rounded-full grid place-items-center transition-all shrink-0 backdrop-blur-xl shadow-[0_6px_20px_-8px_rgba(0,0,0,0.3)]',
                    isFavorite
                      ? 'bg-rose-500/20 text-rose-500 ring-1 ring-rose-400/40'
                      : 'bg-foreground/5 text-foreground ring-1 ring-border/40',
                  )}
                >
                  <Heart className="h-5 w-5" fill={isFavorite ? 'currentColor' : 'none'} />
                </button>

                <button
                  onClick={() => { haptic.tap(); setShareOpen(true) }}
                  aria-label="Поделиться"
                  className="h-12 w-12 rounded-full grid place-items-center bg-foreground/5 backdrop-blur-xl ring-1 ring-border/40 hover:bg-foreground/10 transition-colors shrink-0 shadow-[0_6px_20px_-8px_rgba(0,0,0,0.3)]"
                >
                  <Share2 className="h-5 w-5" />
                </button>

                <button
                  onClick={() => {
                    cartAdd({
                      productId: product.id,
                      title: product.title,
                      price: product.price,
                      image: product.images[0],
                    })
                    haptic.success()
                    toast.success('Добавлено в список заявок', { sound: 'cart' })
                  }}
                  className="h-12 rounded-[18px] flex-1 font-semibold bg-foreground/5 backdrop-blur-xl ring-1 ring-border/40 hover:bg-foreground/10 transition-all flex items-center justify-center gap-2 shadow-[0_6px_20px_-8px_rgba(0,0,0,0.3)]"
                >
                  <ShoppingCart className="h-4 w-4" /> В список
                </button>

                <button
                  onClick={() => {
                    haptic.tap()
                    if (product) {
                      // v25.11: primary CTA — opens LeadSheet (single-product lead).
                      // Payments are not connected; this is the main conversion path.
                      window.dispatchEvent(new CustomEvent('open-lead', {
                        detail: { product },
                      }))
                    }
                  }}
                  className="h-12 rounded-xl flex-[1.4] font-bold text-white shadow-[0_10px_28px_-8px_rgba(99,102,241,0.6)] bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 hover:shadow-[0_14px_36px_-8px_rgba(99,102,241,0.72)] transition-all"
                >
                  Оставить заявку
                </button>
              </div>
            </div>
          )}
        </div>
        {/* v25.7 (TZ ЭТАП 2.8): floating ↑/↓ button inside the product page.
            - Listens to scrollContainerRef (the product page's own scroll
              container), NOT window — because the product page is
              position:fixed with overflow-y:auto, window.scroll never fires.
            - z-[360] sits ABOVE the product page's z-[350] layer so the
              button is always visible over the page content.
            - lg:hidden — the desktop variant (ProductPageDesktop) has its
              own scroll containers and doesn't need this button.
            - key={productId} so the button resets its visible/saved-scroll
              state when the user switches to a similar product (otherwise
              the button would stay visible after a fresh product loads). */}
        <SmartScrollButton
          key={productId}
          scrollContainerRef={scrollContainerRef}
          className="!z-[360] lg:hidden"
        />
        </>
      )}

      {/* Smart Share — premium bottom sheet with 10 share targets, Web Share
          API integration, QR code modal, and Smart Story generator. */}
      {product && shareLink && (
        <>
          <AnimatePresence>
            {shareOpen && (
              <SmartShareSheet
                open={shareOpen}
                onClose={() => setShareOpen(false)}
                product={{
                  id: product.id,
                  title: product.title,
                  description: product.description,
                  price: product.price,
                  oldPrice: product.oldPrice,
                  currency: product.currency,
                  images: product.images,
                  rating: product.rating,
                  reviewsCount: product.reviewsCount,
                }}
                shareUrl={shareLink.shareUrl}
                deepLinkUrl={shareLink.deepLinkUrl}
                shortId={shareLink.shortId}
              />
            )}
          </AnimatePresence>
          <AnimatePresence>
            {qrOpen && (
              <QrModal
                open={qrOpen}
                onClose={() => setQrOpen(false)}
                url={shareLink.deepLinkUrl}
                title={product.title}
                shortId={shareLink.shortId}
              />
            )}
          </AnimatePresence>
        </>
      )}

      {/* Hidden listener: SmartShareSheet dispatches `999pro:open-qr` when the
          user picks "QR-код" inside the sheet. We catch it here to open the
          QrModal in the parent (so the QR modal stacks above the share sheet). */}
      {product && shareLink && (
        <QrEventListener onOpenQr={() => setQrOpen(true)} />
      )}
    </>
  )
}

function QrEventListener({ onOpenQr }: { onOpenQr: () => void }) {
  useEffect(() => {
    const handler = () => onOpenQr()
    window.addEventListener('999pro:open-qr', handler)
    return () => window.removeEventListener('999pro:open-qr', handler)
  }, [onOpenQr])
  return null
}

// ============================================================================
//  v25.15: ContactActionItems — содержимое выпадающего меню быстрых связей
//  (три точки над фото). Заменяет прежнюю кнопку «Поделиться»: теперь можно
//  позвонить / написать в WhatsApp / Telegram сразу, не листая страницу,
//  плюс скопировать артикул или открыть полноценный шаринг карточки.
// ============================================================================
export function ContactActionItems({
  product,
  onAfter,
  onOpenShare,
}: {
  product: Product
  onAfter: () => void
  onOpenShare: () => void
}) {
  const d = product.department

  const waLink =
    d?.whatsapp
      ? d.whatsapp.startsWith('http')
        ? d.whatsapp
        : `https://wa.me/${d.whatsapp.replace(/[^0-9]/g, '')}`
      : null

  const tgLink = d?.telegram
    ? d.telegram.startsWith('http')
      ? d.telegram
      : d.telegram.startsWith('@')
        ? `https://t.me/${d.telegram.slice(1)}`
        : `https://t.me/${d.telegram}`
    : null

  const telLink = d?.phone ? `tel:${d.phone.replace(/[^0-9+]/g, '')}` : null
  const article = product.id.slice(-8).toUpperCase()

  const copyArticle = () => {
    navigator.clipboard?.writeText(article)
      .then(() => toast.success(`Артикул ${article} скопирован`))
      .catch(() => toast.error('Не удалось скопировать'))
    haptic.tap()
    onAfter()
  }

  const rows: Array<{
    key: string
    label: string
    icon: React.ReactNode
    onClick?: () => void
    href?: string
    external?: boolean
    colorClass?: string
  }> = []

  if (telLink) {
    rows.push({
      key: 'tel',
      label: 'Позвонить',
      icon: <Phone className="h-4 w-4 text-violet-500" />,
      href: telLink,
      onClick: () => { haptic.tap(); onAfter() },
    })
  }
  if (waLink) {
    rows.push({
      key: 'wa',
      label: 'WhatsApp',
      icon: <MessageCircle className="h-4 w-4 text-emerald-500" />,
      href: waLink,
      external: true,
      onClick: () => { haptic.tap(); onAfter() },
    })
  }
  if (tgLink) {
    rows.push({
      key: 'tg',
      label: 'Telegram',
      icon: <Send className="h-4 w-4 text-sky-500" />,
      href: tgLink,
      external: true,
      onClick: () => { haptic.tap(); onAfter() },
    })
  }
  // v25.16 (owner feedback): «Поделиться кнопку убери и вместо него Позвонить
  // или же написать в WhatsApp». Меню сверху — ТОЛЬКО контактные действия
  // (+ артикул). Шаринг остаётся на нижней большой кнопке «Поделиться».
  void onOpenShare
  rows.push({
    key: 'article',
    label: `Артикул · ${article}`,
    icon: <Copy className="h-4 w-4 text-muted-foreground" />,
    onClick: copyArticle,
  })

  return (
    <div className="py-1.5">
      {rows.map((r) => {
        const rowCls =
          'flex items-center gap-3 px-3.5 py-2.5 text-sm font-medium hover:bg-accent/50 active:bg-accent transition-colors text-left'
        // tel:/mailto: — обычная ссылка; http(s) — новая вкладка;
        // остальное — кнопки (шаринг, копирование артикула).
        if (r.href && r.external) {
          return (
            <a
              key={r.key}
              href={r.href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={r.onClick}
              className={rowCls}
            >
              {r.icon}
              <span>{r.label}</span>
            </a>
          )
        }
        if (r.href) {
          return (
            <a
              key={r.key}
              href={r.href}
              onClick={r.onClick}
              className={rowCls}
            >
              {r.icon}
              <span className="truncate">{r.label}</span>
            </a>
          )
        }
        return (
          <button
            key={r.key}
            onClick={r.onClick}
            className={`w-full ${rowCls}`}
          >
            {r.icon}
            <span className="truncate">{r.label}</span>
          </button>
        )
      })}
    </div>
  )
}

function SpecRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3.5 py-3 rounded-xl hover:bg-foreground/5 transition-colors">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold text-right">{value}</span>
    </div>
  )
}

function SimilarProducts({ product }: { product: Product }) {
  const [items, setItems] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true)
    api
      .get<{ items: Product[] }>('/api/products', {
        query: { limit: 24 },
      })
      .then((d) => {
        if (!alive) return
        const same = d.items.filter(
          (p) => p.id !== product.id && p.category === product.category,
        )
        const fallback = d.items.filter((p) => p.id !== product.id)
        setItems(same.length > 0 ? same.slice(0, 12) : fallback.slice(0, 12))
      })
      .catch(() => alive && setItems([]))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [product.id, product.category])

  if (loading) {
    return (
      <div className="pt-8">
        <h2 className="text-sm font-bold mb-3 px-1">Похожие товары</h2>
        <div className="flex gap-3 overflow-x-auto no-scrollbar -mx-1 px-1 pb-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="shrink-0 w-28 rounded-xl overflow-hidden bg-foreground/5">
              <div className="aspect-[3/4] skeleton" />
              <div className="p-2 space-y-1">
                <div className="h-3 w-3/4 rounded skeleton" />
                <div className="h-3 w-1/2 rounded skeleton" />
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (items.length === 0) return null

  return (
    <div className="pt-12 pb-4">
      <h2 className="text-sm font-extrabold mb-4 px-1 bg-gradient-to-r from-blue-500 via-blue-600 to-indigo-600 bg-clip-text text-transparent">Похожие товары</h2>
      <div className="flex gap-3.5 overflow-x-auto no-scrollbar -mx-1 px-1 pb-3 pt-1"
        // v25.7 (TZ ЭТАП 2.8): 'pan-x pan-y' — allow BOTH horizontal panning
        // (to scroll the carousel) AND vertical panning (to keep scrolling
        // the product page). Previously this was 'pan-x' which blocked any
        // vertical scroll gesture started over the carousel — the user's
        // thumb naturally rests here while reading the description, so the
        // page felt "stuck". 'pan-x pan-y' is the W3C-recommended value
        // for horizontally-scrolling rows that must not block page scroll.
        style={{ touchAction: 'pan-x pan-y' }}
      >
        {items.map((p) => (
          <a
            key={p.id}
            href={`?product=${p.id}`}
            onClick={(e) => {
              e.preventDefault()
              // v25.6 (Task #1): dispatch a custom switch-product event
              // instead of `popstate`. Previously, dispatching `popstate`
              // triggered ProductPage's own Back-button handler → the card
              // closed instead of switching to the new product.
              // `app/page.tsx` listens for `999pro:switch-product` and calls
              // `openProduct(id)` which:
              //   1. Updates activeProductId state → ProductPage refetches.
              //   2. Pushes ?product=<id> to the URL (so reload works).
              //   3. Does NOT close the card.
              if (typeof window !== 'undefined') {
                haptic.tap()
                window.dispatchEvent(
                  new CustomEvent('999pro:switch-product', { detail: { productId: p.id } }),
                )
              }
            }}
            className="shrink-0 w-36 rounded-xl overflow-hidden bg-foreground/5 ring-1 ring-border/30 hover:shadow-[0_12px_32px_-12px_rgba(0,0,0,0.25)] hover:bg-foreground/10 transition-all hover:-translate-y-1"
          >
            <div className="aspect-[3/4] overflow-hidden bg-foreground/5">
              {p.images?.[0] && (
                <img
                  src={assetUrl(p.images[0])}
                  alt={p.title}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              )}
            </div>
            <div className="p-3">
              <div className="text-xs font-semibold truncate leading-tight">{p.title}</div>
              <div className="text-sm font-bold mt-1 bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
                {formatPrice(p.price, p.currency)}
              </div>
            </div>
          </a>
        ))}
      </div>
    </div>
  )
}

// ============================================================================
//  v24.4 / v25.6 (Task #3): DepartmentContacts — shows the right manager's
//  contacts based on the product's department. Each product is linked to a
//  department (Реклама, Подарки, Мебель, etc.) and the user sees the specific
//  manager's phone, WhatsApp, Telegram, email.
//
//  v25.6 changes:
//   • Renamed UI heading to «Связаться по товару» (was the department name).
//   • Only existing methods are shown (already the case, kept).
//   • Block placement: after price/buy buttons (already on mobile).
//   • Added to desktop ProductPageDesktop as well (separate edit).
// ============================================================================
interface Department {
  id: string
  name: string
  phone?: string | null
  whatsapp?: string | null
  telegram?: string | null
  email?: string | null
  address?: string | null
  managerName?: string | null
}

// v25.6 (Task #3): export DepartmentContacts so the desktop ProductPageDesktop
// can reuse the same component (previously it was a private function).
export function DepartmentContacts({ department }: { department: Department }) {
  const waLink = department.whatsapp
    ? department.whatsapp.startsWith('http')
      ? department.whatsapp
      : `https://wa.me/${department.whatsapp.replace(/[^0-9]/g, '')}`
    : null

  const tgLink = department.telegram
    ? department.telegram.startsWith('http')
      ? department.telegram
      : department.telegram.startsWith('@')
        ? `https://t.me/${department.telegram.slice(1)}`
        : `https://t.me/${department.telegram}`
    : null

  const telLink = department.phone ? `tel:${department.phone.replace(/[^0-9+]/g, '')}` : null
  const mailLink = department.email ? `mailto:${department.email}` : null

  // v25.6: hide the block entirely if no contact methods are configured.
  if (!telLink && !waLink && !tgLink && !mailLink && !department.address) {
    return null
  }

  return (
    <div className="pt-2">
      <div className="rounded-2xl border border-violet-500/20 bg-violet-500/5 p-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="h-8 w-8 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 grid place-items-center">
            <Store className="h-4 w-4 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            {/* v25.6 (Task #3): heading is now «Связаться по товару» so the
                user understands these are the contacts for THIS product's
                direction/department (not the general app support). */}
            <h2 className="text-sm font-bold leading-tight">Связаться по товару</h2>
            {department.managerName && (
              <p className="text-[11px] text-muted-foreground flex items-center gap-1 truncate">
                <User className="h-3 w-3 shrink-0" /> {department.name} · {department.managerName}
              </p>
            )}
            {!department.managerName && (
              <p className="text-[11px] text-muted-foreground truncate">{department.name}</p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {telLink && (
            <a href={telLink} className="flex items-center gap-2 p-2.5 rounded-xl bg-background/50 hover:bg-background transition-colors">
              <Phone className="h-4 w-4 text-violet-600 shrink-0" />
              <span className="text-xs font-medium truncate">Позвонить</span>
            </a>
          )}
          {waLink && (
            <a href={waLink} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 p-2.5 rounded-xl bg-background/50 hover:bg-background transition-colors">
              <MessageCircle className="h-4 w-4 text-green-600 shrink-0" />
              <span className="text-xs font-medium truncate">WhatsApp</span>
            </a>
          )}
          {tgLink && (
            <a href={tgLink} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 p-2.5 rounded-xl bg-background/50 hover:bg-background transition-colors">
              <Send className="h-4 w-4 text-sky-500 shrink-0" />
              <span className="text-xs font-medium truncate">Telegram</span>
            </a>
          )}
          {mailLink && (
            <a href={mailLink} className="flex items-center gap-2 p-2.5 rounded-xl bg-background/50 hover:bg-background transition-colors">
              <Mail className="h-4 w-4 text-blue-500 shrink-0" />
              <span className="text-xs font-medium truncate">Email</span>
            </a>
          )}
        </div>

        {department.address && (
          <div className="flex items-center gap-2 mt-2 p-2.5 rounded-xl bg-background/50">
            <MapPin className="h-4 w-4 text-rose-500 shrink-0" />
            <span className="text-xs text-muted-foreground">{department.address}</span>
          </div>
        )}
      </div>
    </div>
  )
}
