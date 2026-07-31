'use client'

import { useEffect, useState, useRef } from 'react'
import { motion, AnimatePresence, useMotionValue, useTransform, animate, useDragControls, type PanInfo } from 'framer-motion'
import {
  ChevronLeft, ChevronRight, Heart, ShoppingCart, Star, Share2,
  Truck, Shield, RefreshCw, Check, Store, AlertTriangle, X,
  Phone, MessageCircle, Send, Mail, MapPin, User,
} from 'lucide-react'
import { api, assetUrl } from '@/lib/api'
import type { Product } from '@/lib/types'
import { getStockLabel } from '@/lib/types'
import { useCartStore, useFavoritesStore } from '@/lib/cart-store'
import { formatPrice, formatCompactNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import { toast } from '@/lib/notifications'
import { useScrollLock } from '@/lib/use-scroll-lock'
import { haptic } from '@/lib/haptic'
import { sounds } from '@/lib/sounds'
import { useFocusTrap } from '@/lib/use-focus-trap'
// v16.1: BuySheet removed — "Купить" now opens the unified CheckoutSheet
// via the `open-checkout` window event (handled by AppShell).
import { ProductReviewsInline } from './product-reviews-inline'
import { useShareLink } from '@/lib/use-share-link'
import { SmartShareSheet } from './share/smart-share-sheet'
import { QrModal } from './share/qr-modal'
import { DragHandleHint } from '@/components/ui/drag-handle-hint'
// v9-premium: Desktop-only premium 3-column layout (lg+ breakpoint).
// Mobile/tablet (md and below) keep using the original layout below.
import { ProductPageDesktop } from './product-page-desktop'

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
  const [shareOpen, setShareOpen] = useState(false)
  const [qrOpen, setQrOpen] = useState(false)
  const touchStartX = useRef(0)
  const touchStartYRef = useRef(0)

  // v9-interactive-dismiss + v9-smooth-open:
  // dragY is the SINGLE source of truth for the sheet's vertical position.
  // - 0 = fully open (rest position)
  // - window.innerHeight = fully closed (off-screen below)
  //
  // We drive BOTH opening and closing through this MotionValue to avoid
  // the framer-motion pitfall where `style.y` (a MotionValue) overrides
  // `initial`/`animate`/`exit` props — which previously caused the sheet
  // to "flash white" on close (the bg-white/70 sheet remained visible
  // while the exit opacity animation ran, leaking onto the app background).
  const viewportH = typeof window !== 'undefined' ? window.innerHeight : 800
  const dragY = useMotionValue(viewportH) // start off-screen below
  const dragScale = useTransform(dragY, [0, 400], [1, 0.98])
  // Backdrop opacity ramps with distance from rest:
  //   dragY = 0 (open)      → 0.6 (full backdrop)
  //   dragY = 400 (dragged) → 0.2 (faded backdrop)
  //   dragY = viewportH     → 0   (no backdrop — fully dismissed)
  const backdropOpacity = useTransform(dragY, [0, 400, viewportH], [0.6, 0.2, 0])
  const backdropBlur = useTransform(backdropOpacity, (o) => `blur(${Math.max(0, o * 28)}px)`)

  // dragControls lets us start drag ONLY from the handle (not from inside
  // the scrollable content) — otherwise the inner scroll would break.
  const dragControls = useDragControls()

  // --- OPEN animation: when productId arrives, spring from viewportH → 0 ---
  // Spring physics chosen for "heavy, physical" feel:
  //   - high stiffness (320) → reaches rest quickly
  //   - high damping (36) → no overshoot, no bounce
  //   - mass (0.9) → feels substantial
  // The card slides up from below, decelerates naturally, settles.
  useEffect(() => {
    if (!productId) return
    const target = typeof window !== 'undefined' ? window.innerHeight : 800
    dragY.set(target) // ensure starting off-screen
    const controls = animate(dragY, 0, {
      type: 'spring',
      stiffness: 320,
      damping: 36,
      mass: 0.9,
    })
    return () => controls.stop()
  }, [productId, dragY])

  // --- CLOSE via drag ---
  const handleSheetDragEnd = (_e: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    const viewport = typeof window !== 'undefined' ? window.innerHeight : 800
    if (info.offset.y > viewport * 0.3 || info.velocity.y > 700) {
      // Dismiss — spring dragY to viewportH (off-screen), then onClose.
      const controls = animate(dragY, viewport, {
        type: 'spring',
        stiffness: 320,
        damping: 36,
        mass: 0.9,
      })
      controls.finished
        .then(() => {
          onClose()
          // Reset for next open (after a tick so onClose has unmounted).
          setTimeout(() => dragY.set(viewport), 16)
        })
        .catch(() => {
          onClose()
          setTimeout(() => dragY.set(viewport), 16)
        })
    } else {
      // Spring back to rest.
      animate(dragY, 0, { type: 'spring', stiffness: 460, damping: 42, mass: 0.8 })
    }
  }
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
  }, [productId])

  // v20: Reset scroll position to top whenever the product changes.
  // This fires when the user opens a similar product from the "Похожие
  // товары" block — the new product should always start at the top
  // (photo, title, price, rating, buy buttons), not mid-page at the
  // description.
  useEffect(() => {
    if (!productId) return
    // Small delay so the new product data has time to render before we
    // reset the scroll position (otherwise the reset happens on the old
    // content height and gets overridden when new content renders).
    const t = setTimeout(() => {
      if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
      }
    }, 50)
    return () => clearTimeout(t)
  }, [productId])

  // Lock body scroll while open. The shared useScrollLock hook handles
  // iOS Safari's quirks (touchmove prevention on the backdrop, overscroll
  // containment, refcounting so multiple modals don't unlock early).
  // The product content area is marked [data-scroll-lock-ignore] so its
  // own internal scrolling still works.
  useScrollLock(!!productId)

  // v12.6.1: Suppress PTR while the product sheet is open. This prevents
  // the sheet's drag-to-close gesture from propagating to PTR and
  // triggering a page refresh. When the sheet closes, PTR is unsuppressed
  // and resumes normal gesture handling.
  useEffect(() => {
    if (!productId) return
    const ptr = (window as unknown as { __ptr?: { suppress?: () => void; unsuppress?: () => void } }).__ptr
    ptr?.suppress?.()
    return () => {
      const ptr2 = (window as unknown as { __ptr?: { unsuppress?: () => void } }).__ptr
      ptr2?.unsuppress?.()
    }
  }, [productId])

  // v20: scroll container ref — reset to top when productId changes so the
  // user always sees the photo/title/price/rating first when opening a
  // similar product (instead of landing mid-page at the description).
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  // Phase 13: focus trap for keyboard accessibility
  const containerRef = useRef<HTMLDivElement>(null)
  useFocusTrap(containerRef, !!productId)

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

  // Esc to close
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

  return (
    <>
    {/* v9-premium: Desktop layout (lg+ only). Mobile/tablet use the original
        layout below. Both share the same productId/onClose props, the same
        BuySheet, SmartShareSheet, QrModal, and the same API calls. No business
        logic duplication — ProductPageDesktop is purely a presentation layer. */}
    {productId && (
      <div className="hidden lg:block relative z-[350]">
        <ProductPageDesktop productId={productId} onClose={onClose} />
      </div>
    )}

    <AnimatePresence>
      {productId && (
        <motion.div
          className="fixed inset-0 z-[350] flex items-end md:items-center justify-center lg:hidden"
          // v9-smooth-open: no initial/animate/exit here — dragY (a MotionValue)
          // is the single source of truth for the sheet's vertical position.
          // The open/close springs are driven from useEffect + onDragEnd.
          // Without this, framer-motion's exit prop fights with style.y and
          // the bg-white/70 sheet leaks onto the app background on close.
          initial={{ opacity: 1 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          {/* Backdrop — opacity + blur ramp DOWN as the sheet is dragged.
              At dragY = 0 (open) → opacity 0.6, blur ~17px.
              At dragY = viewportH (closed) → opacity 0, blur 0. */}
          <motion.div
            className="absolute inset-0 bg-black/60"
            style={{
              opacity: backdropOpacity,
              backdropFilter: backdropBlur,
              WebkitBackdropFilter: backdropBlur,
            }}
            onClick={onClose}
          />

          {/* Sheet — uses a smooth tween (not spring) so the modal slides
              up without overshooting. Spring animations with low damping
              cause the content (image + text) to briefly appear larger
              than its final size during the overshoot, which looks like
              a "huge for a second" glitch. A 0.3s ease-out tween has no
              overshoot — the modal reaches its final size smoothly. */}
          {/* Sheet — v9-premium-v6-mobile: lighter glass container, almost
              transparent so the blurred backdrop shows through. Elements inside
              appear to float over the blurred background, not inside a heavy box. */}
          {/* v9-interactive-dismiss + v9-smooth-open:
              drag="y" enables 1:1 finger tracking.
              dragListener={false} + dragControls means drag only starts when
              the user grabs the handle below — not when they touch inside
              the scrollable content. dragElastic={{ bottom: 1 }} allows
              free downward drag for dismiss.
              `style={{ y: dragY }}` is the SINGLE source of truth — the
              spring from useEffect (open) and onDragEnd (close) drives it.
              No initial/animate/exit on this motion.div (they'd fight
              the MotionValue and cause the white-flash regression). */}
          <motion.div
            ref={containerRef}
            role="dialog"
            aria-modal="true"
            aria-label={product?.title || 'Товар'}
            className="relative w-full md:max-w-3xl lg:max-w-4xl bg-white/70 dark:bg-slate-950/70 backdrop-blur-2xl rounded-t-[32px] md:rounded-[32px] shadow-[0_-20px_60px_-20px_rgba(0,0,0,0.4)] overflow-hidden max-h-[94vh] md:max-h-[90vh] flex flex-col lg:hidden ring-1 ring-white/30 dark:ring-white/10"
            drag="y"
            dragControls={dragControls}
            dragListener={false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 1 }}
            onDragEnd={handleSheetDragEnd}
            style={{ y: dragY, scale: dragScale, willChange: 'transform' }}
          >
            {/* Drag handle (mobile) — the ONLY element that starts a drag.
                onPointerDown initiates the drag via dragControls; the rest
                of the sheet tracks the finger 1:1 until release.
                v9-handle-hint: DragHandleHint renders an iOS-style pill that
                gently bobs once after the sheet opens to suggest "swipe down
                to close". The hint plays once per open (keyed on productId). */}
            <div onPointerDown={(e) => dragControls.start(e)} style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
              <DragHandleHint
                triggerKey={productId}
                className="md:hidden"
              />
            </div>

            {/* v8-audit-fix: removed X close button. Close via swipe-down or ESC. */}

            {loading || !product ? (
              <div className="flex-1 grid place-items-center p-12">
                <div className="text-center">
                  <div className="h-12 w-12 mx-auto rounded-full border-4 border-primary/30 border-t-primary animate-spin" />
                  <p className="text-sm text-muted-foreground mt-3">Загрузка товара…</p>
                </div>
              </div>
            ) : (
              <div ref={scrollContainerRef} className="flex-1 overflow-y-auto overscroll-contain" data-scroll-lock-ignore style={{ overscrollBehavior: 'contain' } as any}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-0 md:gap-8 p-4 md:p-6 pb-32">
                  {/* LEFT COLUMN (mobile: full width / desktop: left half) —
                      contains the main image carousel + the thumbnail strip
                      BELOW it. Wrapped in a single div so that on desktop the
                      thumbnails stay under the main image (modern marketplace
                      layout), not next to it. */}
                  <div className="flex flex-col gap-3">
                    {/* v9-premium-v6-mobile: photo floats — light glass bg,
                        hairline ring, soft shadow, rounded-[20px]. No heavy
                        container feel. */}
                    <div
                      className="relative aspect-square rounded-[20px] overflow-hidden bg-slate-100/50 dark:bg-slate-900/40 shrink-0 select-none h-[calc(100vw-32px)] md:h-auto ring-1 ring-white/30 dark:ring-white/10 shadow-[0_16px_48px_-20px_rgba(0,0,0,0.35)] backdrop-blur-sm"
                      onTouchStart={(e) => { touchStartX.current = e.touches[0].clientX }}
                      onTouchEnd={(e) => {
                        if (product.images.length <= 1) return
                        const dx = e.changedTouches[0].clientX - touchStartX.current
                        if (dx < -50) setImgIndex((i) => (i + 1) % product.images.length)
                        else if (dx > 50) setImgIndex((i) => (i - 1 + product.images.length) % product.images.length)
                      }}
                    >
                      <div
                        className="flex h-full transition-transform duration-300 ease-out"
                        style={{ transform: `translateX(-${imgIndex * 100}%)` }}
                      >
                        {product.images.map((src, i) => (
                          <img
                            key={i}
                            src={assetUrl(src)}
                            alt={`${product.title} — фото ${i + 1}`}
                            className="h-full w-full object-cover shrink-0"
                            // aspect-ratio on the img itself prevents FOUC
                            // (Flash of Unstyled Content) on mobile PWA.
                            // With aspect-ratio set directly, the browser
                            // reserves the correct space immediately.
                            style={{ aspectRatio: '1 / 1' }}
                            // async decoding keeps the main thread responsive
                            decoding="async"
                            draggable={false}
                          />
                        ))}
                      </div>

                      {/* Arrows */}
                      {product.images.length > 1 && (
                        <>
                          <button
                            onClick={() => setImgIndex((i) => (i - 1 + product.images.length) % product.images.length)}
                            aria-label="Предыдущее фото"
                            className="hidden md:grid absolute left-3 top-1/2 -translate-y-1/2 h-10 w-10 rounded-full glass-strong place-items-center hover:scale-105 active:scale-95 transition-transform"
                          >
                            <ChevronLeft className="h-5 w-5" />
                          </button>
                          <button
                            onClick={() => setImgIndex((i) => (i + 1) % product.images.length)}
                            aria-label="Следующее фото"
                            className="hidden md:grid absolute right-3 top-1/2 -translate-y-1/2 h-10 w-10 rounded-full glass-strong place-items-center hover:scale-105 active:scale-95 transition-transform"
                          >
                            <ChevronRight className="h-5 w-5" />
                          </button>
                        </>
                      )}

                      {/* Dots */}
                      {product.images.length > 1 && (
                        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
                          {product.images.map((_, i) => (
                            <button
                              key={i}
                              onClick={() => setImgIndex(i)}
                              aria-label={`Фото ${i + 1}`}
                              className={cn(
                                'h-1.5 rounded-full transition-all',
                                i === imgIndex ? 'w-6 bg-white' : 'w-1.5 bg-white/60',
                              )}
                            />
                          ))}
                        </div>
                      )}

                      {/* Discount badge */}
                      {product.oldPrice && product.oldPrice > product.price && (
                        <div className="absolute top-3 left-3 px-3 py-1.5 rounded-full bg-destructive text-white text-xs font-bold shadow-lg">
                          -{Math.round(100 - (product.price / product.oldPrice) * 100)}%
                        </div>
                      )}
                    </div>

                    {/* Thumbnails — v9-premium-v6-mobile: fully floating,
                        no containers. Active: soft blue glow + glass ring +
                        rounded-[16px] + scale. Inactive: only soft shadow,
                        no border. Generous padding so glow never clipped. */}
                    {product.images.length > 1 && (
                      <div className="flex gap-3 overflow-x-auto no-scrollbar py-4 px-2 -mx-2">
                        {product.images.map((src, i) => (
                          <button
                            key={i}
                            onClick={() => setImgIndex(i)}
                            aria-label={`Фото ${i + 1}`}
                            className={cn(
                              'shrink-0 h-16 w-16 overflow-hidden transition-all duration-200 relative',
                              i === imgIndex
                                ? 'scale-105 z-20 opacity-100 rounded-[18px] shadow-[0_8px_28px_-8px_rgba(0,0,0,0.4)]'
                                : 'z-10 opacity-55 hover:opacity-100 rounded-[18px] shadow-[0_4px_16px_-8px_rgba(0,0,0,0.35)] hover:shadow-[0_8px_24px_-8px_rgba(0,0,0,0.4)]',
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
                  </div>

                  {/* RIGHT COLUMN (mobile: full width below / desktop: right half)
                      — title, rating, price, description, specs, reviews, similar. */}
                  <div className="flex flex-col gap-4 pt-2 md:pt-0">
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

                    {/* Price — v9-premium-v6-mobile: gradient blue with glow. */}
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

                    {/* Stock + delivery — v11: 3 stock states via getStockLabel */}
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
                      {/* v22: Removed fake specs (Доставка 2–4 дня / Гарантия 12 мес. / Возврат 14 дней).
                          These were hardcoded values not configurable in Studio. If the product has
                          real leadTime/warranty data from AI KB, those are shown in the specs section. */}
                    </div>

                    {/* Description */}
                    {product.description && (
                      <div className="pt-2">
                        <h2 className="text-sm font-bold mb-1.5">Описание</h2>
                        <p className="text-sm text-muted-foreground leading-relaxed">
                          {product.description}
                        </p>
                      </div>
                    )}

                    {/* v24.4: Department contacts — show the right manager's
                        contacts based on the product's department. */}
                    {product.department && (
                      <DepartmentContacts department={product.department} />
                    )}

                    {/* Specs — v9-premium-v6-mobile: airy glass rows, no heavy table. */}
                    <div className="pt-1">
                      <h2 className="text-sm font-extrabold mb-2 bg-gradient-to-r from-blue-500 via-blue-600 to-indigo-600 bg-clip-text text-transparent">Характеристики</h2>
                      <div className="flex flex-col gap-1">
                        <SpecRow label="Категория" value={product.category || '—'} />
                        <SpecRow label="Артикул" value={product.id.slice(-8).toUpperCase()} />
                        <SpecRow label="Валюта" value={product.currency || 'RUB'} />
                        <SpecRow
                          label="Наличие"
                          value={getStockLabel(product).text}
                        />
                        {/* v11: show actual stock quantity if > 0 */}
                        {product.quantity != null && product.quantity > 0 && (
                          <SpecRow label="Остаток" value={`${product.quantity} шт.`} />
                        )}
                        <SpecRow
                          label="Количество фото"
                          value={String(product.images.length)}
                        />
                      </div>
                    </div>

                    {/* Reviews + star rating — real, interactive, persisted to DB */}
                    <ProductReviewsInline product={product} onReviewChanged={refetchProduct} />

                    {/* Similar products from the same category */}
                    <SimilarProducts product={product} />
                  </div>
                </div>

                {/* v9-premium-v6-mobile: floating action bar — lighter glass,
                    no heavy border, buttons feel part of the composition. */}
                <div className="fixed bottom-0 left-0 right-0 z-30 bg-white/60 dark:bg-slate-950/60 backdrop-blur-2xl border-t border-white/20 dark:border-white/5 p-3 md:p-4"
                  style={{
                    paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))',
                  }}
                >
                  <div className="max-w-3xl mx-auto flex items-center gap-2.5">
                    <button
                      onClick={() => {
                        const wasFavorite = isFavorite
                        favoritesToggle(product.id)
                        haptic.select() // v10-native: haptic on favorite toggle
                        if (!wasFavorite) sounds.like() // v10-native: sound on add to favorites
                        toast.success(wasFavorite ? 'Удалено из избранного' : 'Добавлено в избранное')
                      }}
                      aria-label="В избранное"
                      className={cn(
                        'h-12 w-12 rounded-full grid place-items-center transition-all shrink-0 backdrop-blur-xl shadow-[0_6px_20px_-8px_rgba(0,0,0,0.3)]',
                        isFavorite
                          ? 'bg-rose-500/20 text-rose-500 ring-1 ring-rose-400/40'
                          : 'bg-white/50 dark:bg-white/10 text-slate-600 dark:text-slate-200 ring-1 ring-white/40 dark:ring-white/15',
                      )}
                    >
                      <Heart
                        className="h-5 w-5"
                        fill={isFavorite ? 'currentColor' : 'none'}
                      />
                    </button>

                    <button
                      onClick={() => {
                        // v24.3: Close the product card FIRST, then open the
                        // Share sheet. Previously the Share sheet (z-[100])
                        // opened UNDER the still-open product page (z-[350]),
                        // making it look broken. Closing the product card
                        // ensures the Share sheet is visible on top. The
                        // SmartShareSheet is rendered in a portal at the end
                        // of this component, so it persists after the product
                        // card unmounts (state shareOpen is in this component's
                        // parent — see the {shareOpen && <SmartShareSheet/>}
                        // block below which is outside the AnimatePresence of
                        // the product page sheet).
                        // Actually, shareOpen state lives in THIS component.
                        // If we call onClose() the component unmounts and
                        // shareOpen is lost. So we use a small delay: open
                        // share first, then close the product card after the
                        // share sheet has mounted.
                        setShareOpen(true)
                        setTimeout(() => onClose(), 100)
                      }}
                      aria-label="Поделиться"
                      className="h-12 w-12 rounded-full grid place-items-center bg-white/50 dark:bg-white/10 backdrop-blur-xl text-slate-600 dark:text-slate-200 ring-1 ring-white/40 dark:ring-white/15 hover:bg-white/70 dark:hover:bg-white/15 transition-colors shrink-0 shadow-[0_6px_20px_-8px_rgba(0,0,0,0.3)]"
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
                        haptic.success() // v10-native: haptic on add to cart
                        toast.success('Добавлено в корзину', { sound: 'cart' })
                      }}
                      className="h-12 rounded-[18px] flex-1 font-semibold text-slate-700 dark:text-slate-100 bg-white/50 dark:bg-white/10 backdrop-blur-xl ring-1 ring-white/40 dark:ring-white/15 hover:bg-white/70 dark:hover:bg-white/15 transition-all flex items-center justify-center gap-2 shadow-[0_6px_20px_-8px_rgba(0,0,0,0.3)]"
                    >
                      <ShoppingCart className="h-4 w-4" /> В корзину
                    </button>

                    <button
                      onClick={() => {
                        haptic.tap()
                        // v16.1: open the unified CheckoutSheet (same as cart flow)
                        // via the `open-checkout` window event. AppShell listens
                        // and mounts CheckoutSheet as a sibling (no transformed
                        // ancestor), so it covers the full viewport correctly.
                        if (product) {
                          window.dispatchEvent(new CustomEvent('open-checkout', {
                            detail: {
                              items: [{ productId: product.id, quantity: 1 }],
                              products: { [product.id]: product },
                            },
                          }))
                          // v18.8: close the ProductPage sheet BEFORE the checkout
                          // opens. ProductPage uses z-[350] and CheckoutSheet uses
                          // z-[250] — if both are visible, the checkout appears
                          // UNDER the product page (which the user reported as
                          // "the panel appears under the product"). Closing the
                          // product page first ensures the checkout is on top.
                          // Re-opening the product page later (if user cancels
                          // checkout) is handled by the back button — they can
                          // tap the product card again.
                          setTimeout(() => onClose(), 50)
                        }
                      }}
                      className="h-12 rounded-[18px] flex-1 font-bold text-white shadow-[0_10px_28px_-8px_rgba(99,102,241,0.6)] bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 hover:shadow-[0_14px_36px_-8px_rgba(99,102,241,0.72)] transition-all"
                    >
                      Купить
                    </button>
                  </div>
                </div>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
    {/* v16.1: BuySheet removed — "Купить" now opens the unified CheckoutSheet
        via the `open-checkout` window event (handled by AppShell). */}

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

function SpecRow({ label, value }: { label: string; value: string }) {
  // v9-premium-v6-mobile: airy glass row with hover lift.
  return (
    <div className="flex items-center justify-between gap-3 px-3.5 py-3 rounded-xl hover:bg-white/40 dark:hover:bg-white/5 transition-colors">
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
        // Same category, excluding the current product.
        const same = d.items.filter(
          (p) => p.id !== product.id && p.category === product.category,
        )
        // Fallback: if the category has no siblings, just show other products.
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
            <div key={i} className="shrink-0 w-28 rounded-2xl overflow-hidden glass">
              <div className="aspect-square skeleton" />
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
    // v9-premium-v6-mobile: more space before title, lighter cards, full visibility.
    <div className="pt-12 pb-4">
      <h2 className="text-sm font-extrabold mb-4 px-1 bg-gradient-to-r from-blue-500 via-blue-600 to-indigo-600 bg-clip-text text-transparent">Похожие товары</h2>
      <div className="flex gap-3.5 overflow-x-auto no-scrollbar -mx-1 px-1 pb-3 pt-1"
        style={{ touchAction: 'pan-x' }}
      >
        {items.map((p) => (
          <a
            key={p.id}
            href={`?product=${p.id}`}
            onClick={(e) => {
              e.preventDefault()
              if (typeof window !== 'undefined') {
                const url = new URL(window.location.href)
                url.searchParams.set('product', p.id)
                window.history.pushState({}, '', url.toString())
                window.dispatchEvent(new PopStateEvent('popstate'))
              }
            }}
            className="shrink-0 w-36 rounded-[18px] overflow-hidden bg-white/50 dark:bg-white/5 backdrop-blur-xl ring-1 ring-white/30 dark:ring-white/10 hover:shadow-[0_12px_32px_-12px_rgba(0,0,0,0.25)] hover:bg-white/70 dark:hover:bg-white/10 transition-all hover:-translate-y-1"
          >
            <div className="aspect-square overflow-hidden bg-slate-100/50 dark:bg-slate-900/40">
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
              <div className="text-xs font-semibold truncate leading-tight text-slate-800 dark:text-slate-100">{p.title}</div>
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
//  v24.4: DepartmentContacts — shows the right manager's contacts based on
//  the product's department. Each product is linked to a department
//  (Реклама, Подарки, Мебель, etc.) and the user sees the specific
//  manager's phone, WhatsApp, Telegram, email, address.
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

function DepartmentContacts({ department }: { department: Department }) {
  // Build WhatsApp link from phone number if whatsapp field is a number
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

  // Don't render if no contacts at all
  if (!department.phone && !department.whatsapp && !department.telegram && !department.email && !department.address) {
    return null
  }

  return (
    <div className="pt-2">
      <div className="rounded-2xl border border-violet-500/20 bg-violet-500/5 p-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="h-8 w-8 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 grid place-items-center">
            <Store className="h-4 w-4 text-white" />
          </div>
          <div>
            <h2 className="text-sm font-bold leading-tight">{department.name}</h2>
            {department.managerName && (
              <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                <User className="h-3 w-3" /> {department.managerName}
              </p>
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
