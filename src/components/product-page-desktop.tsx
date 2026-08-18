'use client'

// ============================================================================
//  ProductPageDesktop — Floating Glass Panels (visionOS / Arc / Linear style).
//  ----------------------------------------------------------------------------
//  v9-premium-v3: removed the big white container. Each panel is now an
//  independent floating glass card with air between them — no shared wrapper.
//
//  Architecture:
//    • Backdrop: darkened + blurred (depth, no container on top)
//    • Center: large photo (dominant) + thumbnails BELOW (separate card)
//    • Left: Reviews card (independent) + Similar products card (independent)
//    • Right: Info card (sticky, independent) — title, price, buttons, specs
//
//  No business logic changes. Reuses the same API calls, stores, hooks, and
//  child components (BuySheet, SmartShareSheet, QrModal, ProductReviewsInline).
// ============================================================================

import { useEffect, useState, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Heart, ShoppingCart, Star, Share2, QrCode,
  Truck, Shield, RefreshCw, Check, Store, X, AlertTriangle,
} from 'lucide-react'
import { api, assetUrl } from '@/lib/api'
import type { Product } from '@/lib/types'
import { getStockLabel } from '@/lib/types'
import { useCartStore, useFavoritesStore } from '@/lib/cart-store'
import { formatPrice, formatCompactNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import { toast } from '@/lib/notifications'
import { useScrollLock } from '@/lib/use-scroll-lock'
import { useFocusTrap } from '@/lib/use-focus-trap'
import { haptic } from '@/lib/haptic'
// v16.1: BuySheet removed — "Купить сейчас" opens CheckoutSheet via event.
import { ProductReviewsInline } from './product-reviews-inline'
import { useShareLink } from '@/lib/use-share-link'
import { SmartShareSheet } from './share/smart-share-sheet'
import { QrModal } from './share/qr-modal'
// v25.6 (Task #3): reuse the same DepartmentContacts component used on mobile
// so the "Связаться по товару" block looks + behaves identically on desktop.
import { DepartmentContacts } from './product-page'

interface ProductPageDesktopProps {
  productId: string
  onClose: () => void
}

export function ProductPageDesktop({ productId, onClose }: ProductPageDesktopProps) {
  const [product, setProduct] = useState<Product | null>(null)
  const [loading, setLoading] = useState(true)
  const [imgIndex, setImgIndex] = useState(0)
  const [zoomed, setZoomed] = useState(false)
  const [zoomPos, setZoomPos] = useState({ x: 50, y: 50 })
  const [buyOpen, setBuyOpen] = useState(false)
  void buyOpen // v16.1: unused after BuySheet removal — kept to avoid churning the state shape.
  const [shareOpen, setShareOpen] = useState(false)
  const [qrOpen, setQrOpen] = useState(false)
  // v10-perf: subscribe to specific actions + state instead of whole stores.
  // The previous `useCartStore()` / `useFavoritesStore()` (no selectors)
  // re-rendered this entire component on EVERY store update anywhere.
  const cartAdd = useCartStore((s) => s.add)
  const favoritesToggle = useFavoritesStore((s) => s.toggle)
  // Per-product favorite flag — recomputed only when product.id or store changes.
  const isFavorite = useFavoritesStore((s) => (product ? s.has(product.id) : false))
  const galleryRef = useRef<HTMLDivElement>(null)
  const { data: shareLink } = useShareLink(product?.id ?? null)

  useEffect(() => {
    if (!productId) return
    let alive = true
    setLoading(true)
    setProduct(null)
    setImgIndex(0)
    api
      .get<Product>(`/api/products/${productId}`)
      .then((p) => alive && setProduct(p))
      .catch(() => {
        if (!alive) return
        toast.error('Не удалось загрузить товар')
        onClose()
      })
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [productId, onClose])

  useEffect(() => {
    if (!productId) return
    api.post(`/api/products/${productId}/view`, { json: {} }).catch(() => {})
  }, [productId])

  // v20: Reset scroll position to top when product changes (similar products).
  const rightColRef = useRef<HTMLDivElement>(null)
  const leftColRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!productId) return
    const t = setTimeout(() => {
      rightColRef.current?.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
      leftColRef.current?.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
    }, 50)
    return () => clearTimeout(t)
  }, [productId])

  useScrollLock(!!productId)
  const containerRef = useRef<HTMLDivElement>(null)
  useFocusTrap(containerRef, !!productId)

  const refetchProduct = useCallback(() => {
    if (!productId) return
    api
      .get<Product>(`/api/products/${productId}`)
      .then((p) => setProduct(p))
      .catch(() => {})
  }, [productId])

  useEffect(() => {
    if (!productId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (zoomed) setZoomed(false)
        else onClose()
      }
      if (e.key === 'ArrowLeft' && product)
        setImgIndex((i) => (i - 1 + product.images.length) % product.images.length)
      if (e.key === 'ArrowRight' && product)
        setImgIndex((i) => (i + 1) % product.images.length)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [productId, product, onClose, zoomed])

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!galleryRef.current) return
    const rect = galleryRef.current.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 100
    const y = ((e.clientY - rect.top) / rect.height) * 100
    setZoomPos({ x, y })
  }, [])

  return (
    <>
      <AnimatePresence>
        {productId && (
          <motion.div
            ref={containerRef}
            role="dialog"
            aria-modal="true"
            aria-label={product?.title || 'Товар'}
            // v9-premium-v4: outer is FIXED height (h-screen), no scroll on outer.
            // Each column scrolls independently. Center image is completely fixed.
            className="fixed inset-0 z-[80] flex items-stretch justify-center overflow-hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            {/* Backdrop — darkened + blurred, creates depth. No container on top. */}
            <motion.div
              className="fixed inset-0 bg-slate-950/45 dark:bg-slate-950/55 backdrop-blur-xl"
              onClick={onClose}
            />

            {/* Close button — floats independently at top-right */}
            <button
              onClick={onClose}
              aria-label="Закрыть"
              className="fixed top-6 right-6 z-50 h-11 w-11 rounded-full bg-white/60 dark:bg-slate-800/60 backdrop-blur-xl grid place-items-center hover:bg-white dark:hover:bg-slate-700 ring-1 ring-white/30 dark:ring-white/10 shadow-[0_8px_32px_-8px_rgba(0,0,0,0.3)] transition-all hover:scale-105 active:scale-95"
            >
              <X className="h-5 w-5" />
            </button>

            {loading || !product ? (
              <div className="relative z-10 w-full min-h-screen grid place-items-center p-12">
                <div className="text-center">
                  <div className="h-12 w-12 mx-auto rounded-full border-4 border-blue-500/30 border-t-blue-500 animate-spin" />
                  <p className="text-sm text-white/80 mt-3">Загрузка товара…</p>
                </div>
              </div>
            ) : (
              /* ============================================================
                 v9-premium-v4: FIXED 3-column layout, full viewport height.
                 • Left column: independent vertical scroll (reviews + similar)
                 • Center column: NO scroll — image stays fixed & centered
                 • Right column: independent vertical scroll (info + buttons)
                 Each column is h-full with its own overflow-y-auto.
                 ============================================================ */
              <motion.div
                className="relative z-10 w-full h-full max-w-[1440px] mx-auto p-8 lg:p-10"
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 20, opacity: 0 }}
                transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              >
                <div className="grid lg:grid-cols-[300px_minmax(0,1fr)_360px] gap-8 h-full">
                  {/* ============ LEFT COLUMN: independent scroll ============ */}
                  <div ref={leftColRef} className="flex flex-col gap-10 h-full overflow-y-auto no-scrollbar min-h-0 pr-1 pb-24" data-scroll-lock-ignore>
                    {/* Reviews card — independent floating glass */}
                    <motion.div
                      initial={{ opacity: 0, x: -24, y: 12 }}
                      animate={{ opacity: 1, x: 0, y: 0 }}
                      transition={{ duration: 0.4, delay: 0.1 }}
                    >
                      <GlassCard>
                        <SectionHeader>Отзывы</SectionHeader>
                        {product.rating > 0 ? (
                          <>
                            <div className="flex items-center gap-3 mb-4">
                              <div className="text-4xl font-extrabold bg-gradient-to-br from-blue-500 to-indigo-600 bg-clip-text text-transparent leading-none">
                                {product.rating.toFixed(1)}
                              </div>
                              <div>
                                <div className="flex items-center gap-0.5">
                                  {[1, 2, 3, 4, 5].map((s) => (
                                    <Star
                                      key={s}
                                      className={cn(
                                        'h-3.5 w-3.5',
                                        s <= Math.round(product.rating)
                                          ? 'fill-amber-400 text-amber-400'
                                          : 'text-slate-300 dark:text-slate-600',
                                      )}
                                    />
                                  ))}
                                </div>
                                <div className="text-xs text-slate-500 mt-1">
                                  {formatCompactNumber(product.reviewsCount)} отзывов
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-2xl bg-emerald-500/10 ring-1 ring-emerald-500/20 mb-4">
                              <div className="h-7 w-7 rounded-full bg-emerald-500/20 grid place-items-center shrink-0">
                                <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                              </div>
                              <div className="flex-1">
                                <div className="text-sm font-bold text-emerald-700 dark:text-emerald-400">
                                  {product.rating >= 4 ? '92%' : product.rating >= 3 ? '71%' : '48%'} рекомендуют
                                </div>
                                <div className="text-[11px] text-slate-500">на основе оценок</div>
                              </div>
                            </div>
                          </>
                        ) : (
                          <p className="text-sm text-slate-500 mb-4">Пока нет отзывов — будьте первым!</p>
                        )}
                        <ProductReviewsInline product={product} onReviewChanged={refetchProduct} compact />
                      </GlassCard>
                    </motion.div>

                      {/* Similar products card — v9-premium-v6: more vertical
                          breathing room, lighter container, full visibility. */}
                      <motion.div
                        initial={{ opacity: 0, x: -24, y: 12 }}
                        animate={{ opacity: 1, x: 0, y: 0 }}
                        transition={{ duration: 0.4, delay: 0.2 }}
                      >
                        <GlassCard>
                          <SectionHeader>Похожие товары</SectionHeader>
                          <SimilarProductsVertical product={product} />
                        </GlassCard>
                      </motion.div>
                  </div>

                  {/* ============ CENTER COLUMN: FIXED — no scroll, image top-aligned with side panels ============ */}
                  <div className="flex flex-col items-center gap-6 h-full min-h-0 pt-0">
                    {/* v25.10 (Task #6): vertical product video — desktop variant.
                        Shown ABOVE the main photo when the admin uploaded one.
                        Same 3:4 aspect + max-w as the photo so the layout
                        doesn't shift. Native controls + PiP + fullscreen. */}
                    {product.videoUrl && (
                      <motion.div
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.4 }}
                        className="w-full flex justify-center"
                      >
                        <div className="relative aspect-[3/4] w-full max-w-[560px] max-h-[calc(100vh-12rem)] rounded-xl overflow-hidden bg-black ring-1 ring-white/30 dark:ring-white/10 shadow-[0_24px_70px_-24px_rgba(0,0,0,0.4)]">
                          <video
                            src={assetUrl(product.videoUrl)}
                            poster={product.videoPoster ? assetUrl(product.videoPoster) : undefined}
                            className="h-full w-full object-cover"
                            controls
                            playsInline
                            preload="metadata"
                          />
                        </div>
                      </motion.div>
                    )}
                    {/* v9-premium-v5: image top-aligned (items-start) so its top edge
                        aligns with left/right panel tops. Was justify-center which
                        dropped the image down. */}
                    {/* Main photo — the largest element, minimal framing.
                        v9-premium-v4: max-h constrains to viewport so it never overflows.
                        Image is completely fixed — never moves on scroll. */}
                    <motion.div
                      initial={{ opacity: 0, y: 24 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.45, delay: 0.05 }}
                      className="w-full flex justify-center min-h-0"
                    >
                      <div
                        ref={galleryRef}
                        // v25.4 (TZ-2 task #6): 3:4 aspect ratio on desktop too,
                        // matching mobile. The taller format gives product photos
                        // more vertical space (better for showing apparel, full-body
                        // product shots, etc.) and keeps the visual language
                        // consistent across devices.
                        className="relative aspect-[3/4] w-full max-w-[560px] max-h-[calc(100vh-12rem)] rounded-[20px] overflow-hidden bg-slate-100/60 dark:bg-slate-900/40 select-none cursor-zoom-in ring-1 ring-white/30 dark:ring-white/10 shadow-[0_24px_70px_-24px_rgba(0,0,0,0.4)] backdrop-blur-sm"
                        onMouseMove={handleMouseMove}
                        onMouseEnter={() => setZoomed(true)}
                        onMouseLeave={() => setZoomed(false)}
                        onDoubleClick={() => setZoomed((z) => !z)}
                      >
                        <AnimatePresence mode="wait">
                          <motion.img
                            key={imgIndex}
                            src={assetUrl(product.images[imgIndex])}
                            alt={`${product.title} — фото ${imgIndex + 1}`}
                            className="absolute inset-0 h-full w-full object-cover transition-transform duration-200 ease-out"
                            style={{
                              transform: zoomed ? `scale(1.8)` : 'scale(1)',
                              transformOrigin: `${zoomPos.x}% ${zoomPos.y}%`,
                            }}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.2 }}
                            decoding="async"
                            draggable={false}
                          />
                        </AnimatePresence>

                        {/* Discount badge */}
                        {product.oldPrice && product.oldPrice > product.price && (
                          <div className="absolute top-5 left-5 px-3.5 py-1.5 rounded-full bg-gradient-to-r from-rose-500 to-pink-600 text-white text-xs font-bold shadow-lg backdrop-blur-sm">
                            -{Math.round(100 - (product.price / product.oldPrice) * 100)}%
                          </div>
                        )}

                        {/* Image counter */}
                        {product.images.length > 1 && (
                          <div className="absolute bottom-5 right-5 px-3 py-1.5 rounded-full bg-black/40 backdrop-blur-md text-white text-xs font-medium ring-1 ring-white/10">
                            {imgIndex + 1} / {product.images.length}
                          </div>
                        )}

                        {/* Zoom hint */}
                        <div className="absolute bottom-5 left-5 px-3 py-1.5 rounded-full bg-black/40 backdrop-blur-md text-white/90 text-xs ring-1 ring-white/10">
                          {zoomed ? 'Кликните для выхода' : 'Наведите для зума · Двойной клик'}
                        </div>
                      </div>
                    </motion.div>

                    {/* Thumbnails — v9-premium-v5: fully floating, radius 20px,
                        no container at all. Active: soft blue glow + glass ring +
                        scale + lift. Inactive: only external shadow, no ring.
                        Generous padding so glow/shadow never clipped. */}
                    {product.images.length > 1 && (
                      <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.4, delay: 0.25 }}
                        className="w-full flex justify-center shrink-0"
                      >
                        <div className="flex gap-5 overflow-x-auto no-scrollbar py-7 px-6 -mx-6">
                          {product.images.map((src, i) => (
                            <motion.button
                              key={i}
                              onClick={() => setImgIndex(i)}
                              aria-label={`Фото ${i + 1}`}
                              whileHover={{ scale: 1.06, y: -5 }}
                              whileTap={{ scale: 0.94 }}
                              transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                              className={cn(
                                'shrink-0 h-22 w-22 overflow-hidden transition-all duration-200 relative',
                                i === imgIndex
                                  ? 'scale-105 z-20 opacity-100 rounded-[20px] shadow-[0_12px_44px_-8px_rgba(0,0,0,0.4)]'
                                  : 'z-10 opacity-50 hover:opacity-100 rounded-[20px] shadow-[0_6px_24px_-10px_rgba(0,0,0,0.4)] hover:shadow-[0_10px_32px_-8px_rgba(0,0,0,0.45)]',
                              )}
                              style={{ height: '5.25rem', width: '5.25rem' }}
                            >
                              <img
                                src={assetUrl(src)}
                                alt={`${product.title} — фото ${i + 1}`}
                                className="h-full w-full object-cover"
                                loading="lazy"
                                draggable={false}
                              />
                            </motion.button>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </div>

                  {/* ============ RIGHT COLUMN: independent scroll ============ */}
                  <motion.div
                    ref={rightColRef}
                    className="h-full overflow-y-auto no-scrollbar min-h-0 pr-1 pb-20"
                    data-scroll-lock-ignore
                    initial={{ opacity: 0, x: 24, y: 12 }}
                    animate={{ opacity: 1, x: 0, y: 0 }}
                    transition={{ duration: 0.4, delay: 0.15 }}
                  >
                    <GlassCard className="p-7">
                      {/* Category */}
                      {product.category && (
                        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 text-xs font-semibold mb-4 ring-1 ring-blue-500/20">
                          <Store className="h-3 w-3" /> {product.category}
                        </div>
                      )}

                      {/* Title */}
                      <h1 className="text-2xl lg:text-3xl font-extrabold leading-tight tracking-tight text-slate-900 dark:text-white">
                        {product.title}
                      </h1>

                      {/* Rating */}
                      {product.rating > 0 && (
                        <div className="flex items-center gap-2 mt-3">
                          <div className="flex items-center gap-0.5">
                            {[1, 2, 3, 4, 5].map((s) => (
                              <Star
                                key={s}
                                className={cn(
                                  'h-4 w-4',
                                  s <= Math.round(product.rating)
                                    ? 'fill-amber-400 text-amber-400'
                                    : 'text-slate-300 dark:text-slate-600',
                                )}
                              />
                            ))}
                          </div>
                          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                            {product.rating.toFixed(1)}
                          </span>
                          <span className="text-sm text-slate-500">
                            · {formatCompactNumber(product.reviewsCount)} отзывов
                          </span>
                        </div>
                      )}

                      {/* Price — v9-premium-v5: deep glass gradient blue,
                          expressive glow, text-shadow for depth. */}
                      <div className="mt-6 mb-5">
                        <div className="flex items-baseline gap-3 flex-wrap">
                          <span
                            className="text-5xl lg:text-6xl font-extrabold tracking-tight bg-gradient-to-br from-sky-300 via-blue-500 to-indigo-700 bg-clip-text text-transparent"
                            style={{
                              filter: 'drop-shadow(0 2px 14px rgba(59,130,246,0.45)) drop-shadow(0 0 32px rgba(96,165,250,0.22))',
                            }}
                          >
                            {formatPrice(product.price, product.currency)}
                          </span>
                          {product.oldPrice && product.oldPrice > product.price && (
                            <span className="text-xl text-slate-400 line-through">
                              {formatPrice(product.oldPrice, product.currency)}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Buttons — v9-premium-v6: NO container block. Buttons are part
                          of the composition flow, floating independently after price.
                          Buy = gradient accent (the star). Cart = pure glass. Actions =
                          circular floating orbs with soft shadows. */}
                      <div className="flex flex-col gap-3 mb-6 mt-2">
                        {/* Buy — primary accent, the hero CTA */}
                        <motion.button
                          whileHover={{ scale: 1.02, y: -2 }}
                          whileTap={{ scale: 0.98 }}
                          transition={{ type: 'spring', stiffness: 400, damping: 22 }}
                          onClick={() => {
                            haptic.tap()
                            // v25.10 (Task #16): "Купить сейчас" → "Оставить заявку".
                            // Payments are not connected; the primary CTA now opens
                            // the LeadSheet (existing /api/leads backend route).
                            if (product) {
                              window.dispatchEvent(new CustomEvent('open-lead', {
                                detail: { product },
                              }))
                            }
                          }}
                          className="rounded-xl font-bold text-white shadow-[0_14px_36px_-10px_rgba(99,102,241,0.6)] bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 hover:shadow-[0_18px_48px_-10px_rgba(99,102,241,0.72)] transition-all"
                          style={{ height: '3.25rem' }}
                        >
                          Оставить заявку
                        </motion.button>

                        {/* Add to cart — pure glass, no solid bg */}
                        <motion.button
                          whileHover={{ scale: 1.02, y: -2 }}
                          whileTap={{ scale: 0.98 }}
                          transition={{ type: 'spring', stiffness: 400, damping: 22 }}
                          onClick={() => {
                            cartAdd({
                              productId: product.id,
                              title: product.title,
                              price: product.price,
                              image: product.images[0],
                            })
                            toast.success('Добавлено в корзину', { sound: 'cart' })
                          }}
                          className="rounded-[20px] font-semibold text-slate-700 dark:text-slate-100 bg-white/40 dark:bg-white/10 backdrop-blur-xl ring-1 ring-white/40 dark:ring-white/15 hover:bg-white/60 dark:hover:bg-white/15 shadow-[0_8px_24px_-12px_rgba(0,0,0,0.2)] transition-all flex items-center justify-center gap-2"
                          style={{ height: '3.25rem' }}
                        >
                          <ShoppingCart className="h-4 w-4" /> В корзину
                        </motion.button>

                        {/* Tertiary actions — circular floating orbs */}
                        <div className="flex items-center justify-center gap-3 mt-2">
                          <motion.button
                            whileHover={{ scale: 1.1, y: -3 }}
                            whileTap={{ scale: 0.92 }}
                            transition={{ type: 'spring', stiffness: 400, damping: 18 }}
                            onClick={() => {
                              const wasFavorite = isFavorite
                              favoritesToggle(product.id)
                              toast.success(wasFavorite ? 'Удалено из избранного' : 'Добавлено в избранное')
                            }}
                            aria-label="В избранное"
                            className={cn(
                              'h-12 w-12 rounded-full grid place-items-center transition-colors backdrop-blur-xl shadow-[0_8px_24px_-10px_rgba(0,0,0,0.3)]',
                              isFavorite
                                ? 'bg-rose-500/20 text-rose-500 ring-1 ring-rose-400/40'
                                : 'bg-white/40 dark:bg-white/10 text-slate-600 dark:text-slate-200 ring-1 ring-white/40 dark:ring-white/15 hover:bg-white/60 dark:hover:bg-white/15',
                            )}
                          >
                            <Heart
                              className="h-5 w-5"
                              fill={isFavorite ? 'currentColor' : 'none'}
                            />
                          </motion.button>

                          <motion.button
                            whileHover={{ scale: 1.1, y: -3 }}
                            whileTap={{ scale: 0.92 }}
                            transition={{ type: 'spring', stiffness: 400, damping: 18 }}
                            onClick={() => setShareOpen(true)}
                            aria-label="Поделиться"
                            className="h-12 w-12 rounded-full grid place-items-center bg-white/40 dark:bg-white/10 backdrop-blur-xl text-slate-600 dark:text-slate-200 ring-1 ring-white/40 dark:ring-white/15 hover:bg-white/60 dark:hover:bg-white/15 shadow-[0_8px_24px_-10px_rgba(0,0,0,0.3)] transition-colors"
                          >
                            <Share2 className="h-5 w-5" />
                          </motion.button>

                          <motion.button
                            whileHover={{ scale: 1.1, y: -3 }}
                            whileTap={{ scale: 0.92 }}
                            transition={{ type: 'spring', stiffness: 400, damping: 18 }}
                            onClick={() => setQrOpen(true)}
                            aria-label="QR-код"
                            className="h-12 w-12 rounded-full grid place-items-center bg-white/40 dark:bg-white/10 backdrop-blur-xl text-slate-600 dark:text-slate-200 ring-1 ring-white/40 dark:ring-white/15 hover:bg-white/60 dark:hover:bg-white/15 shadow-[0_8px_24px_-10px_rgba(0,0,0,0.3)] transition-colors"
                          >
                            <QrCode className="h-5 w-5" />
                          </motion.button>
                        </div>
                      </div>

                      {/* v25.6 (Task #3): «Связаться по товару» block — placed
                          AFTER the buy/cart buttons + stock badges, BEFORE the
                          description. Renders only when the product has a
                          department with at least one configured contact
                          method (phone / WhatsApp / Telegram / email / address).
                          The contacts auto-detect from the product's department
                          (Реклама, Подарки, etc.) — no per-product config. */}
                      {product.department && (
                        <div className="mb-5">
                          <DepartmentContacts department={product.department} />
                        </div>
                      )}

                      {/* Stock + delivery badges — v11: 3 stock states */}
                      <div className="flex flex-wrap gap-2 mb-6">
                        {(() => {
                          const stock = getStockLabel(product)
                          const cls =
                            stock.variant === 'in-stock'
                              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 ring-1 ring-emerald-500/20'
                              : stock.variant === 'low'
                                ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 ring-1 ring-amber-500/20'
                                : 'bg-rose-500/10 text-rose-600 dark:text-rose-400 ring-1 ring-rose-500/20'
                          const Icon = stock.variant === 'in-stock' ? Check : stock.variant === 'low' ? AlertTriangle : X
                          return (
                            <div className={cn('inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium', cls)}>
                              <Icon className="h-3.5 w-3.5" /> {stock.text}
                            </div>
                          )
                        })()}
                        {/* v22: Removed fake specs — same as mobile product-page.tsx */}
                      </div>

                      {/* Description */}
                      {product.description && (
                        <div className="mb-5 pt-5 border-t border-slate-200/40 dark:border-slate-700/40">
                          <SectionHeader small>Описание</SectionHeader>
                          <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                            {product.description}
                          </p>
                        </div>
                      )}

                      {/* Specs — v9-premium-v5: airy glass rows, almost invisible
                          dividers, increased padding, smooth hover lift. */}
                      <div className="pt-5 border-t border-slate-200/30 dark:border-slate-700/30">
                        <SectionHeader small>Характеристики</SectionHeader>
                        <div className="flex flex-col gap-1">
                          <SpecRow label="Категория" value={product.category || '—'} />
                          <SpecRow label="Артикул" value={product.id.slice(-8).toUpperCase()} />
                          <SpecRow label="Валюта" value={product.currency || 'RUB'} />
                          <SpecRow label="Наличие" value={getStockLabel(product).text} />
                          {/* v11: show actual stock quantity if > 0 */}
                          {product.quantity != null && product.quantity > 0 && (
                            <SpecRow label="Остаток" value={`${product.quantity} шт.`} />
                          )}
                          <SpecRow label="Количество фото" value={String(product.images.length)} />
                        </div>
                      </div>
                    </GlassCard>
                  </motion.div>
                </div>
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* v16.1: BuySheet removed — "Купить сейчас" now opens the unified
          CheckoutSheet via the `open-checkout` window event (AppShell handles it). */}

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

      {product && shareLink && <QrEventListener onOpenQr={() => setQrOpen(true)} />}
    </>
  )
}

// ============================================================================
//  GlassCard — independent floating glass panel (visionOS style).
//  No outer container. Soft shadow + blur + slight transparency + hairline ring.
//  Hover: lifts slightly, shadow deepens (150-250ms).
// ============================================================================

function GlassCard({ children, className }: { children: React.ReactNode; className?: string }) {
  // v9-premium-v6: ultra-light glass. Almost invisible bg, hairline ring,
  // very soft shadow. No heavy container feel — panels float effortlessly.
  return (
    <motion.div
      whileHover={{ y: -3 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      className={cn(
        'rounded-[20px] bg-white/45 dark:bg-white/[0.06] backdrop-blur-2xl',
        'ring-1 ring-white/30 dark:ring-white/10',
        'shadow-[0_8px_32px_-16px_rgba(0,0,0,0.18)]',
        'hover:shadow-[0_14px_44px_-16px_rgba(0,0,0,0.24)]',
        'p-6',
        className,
      )}
    >
      {children}
    </motion.div>
  )
}

function SectionHeader({ children, small }: { children: React.ReactNode; small?: boolean }) {
  return (
    <h2
      className={cn(
        'font-extrabold tracking-tight mb-4 bg-gradient-to-r from-blue-500 via-blue-600 to-indigo-600 bg-clip-text text-transparent',
        small ? 'text-sm uppercase tracking-wider' : 'text-lg',
      )}
    >
      {children}
    </h2>
  )
}

function SpecRow({ label, value }: { label: string; value: string }) {
  // v9-premium-v5: airy glass row with hover lift, almost-invisible divider.
  return (
    <motion.div
      whileHover={{ y: -1, backgroundColor: 'rgba(255,255,255,0.08)' }}
      transition={{ duration: 0.15 }}
      className="flex items-center justify-between gap-4 px-4 py-3.5 rounded-xl"
    >
      <span className="text-sm text-slate-500 dark:text-slate-400">{label}</span>
      <span className="text-sm font-semibold text-slate-800 dark:text-slate-100 text-right">{value}</span>
    </motion.div>
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
//  SimilarProductsVertical — vertical list in the left card (desktop only)
// ============================================================================

function SimilarProductsVertical({ product }: { product: Product }) {
  const [items, setItems] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true)
    api
      .get<{ items: Product[] }>('/api/products', { query: { limit: 24 } })
      .then((d) => {
        if (!alive) return
        const same = d.items.filter((p) => p.id !== product.id && p.category === product.category)
        const fallback = d.items.filter((p) => p.id !== product.id)
        setItems(same.length > 0 ? same.slice(0, 5) : fallback.slice(0, 5))
      })
      .catch(() => alive && setItems([]))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [product.id, product.category])

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex gap-3 items-center p-2">
            <div className="h-16 w-16 rounded-2xl bg-slate-200/50 dark:bg-slate-800/50 animate-pulse" />
            <div className="flex-1 space-y-2">
              <div className="h-3 w-3/4 rounded bg-slate-200/50 dark:bg-slate-800/50 animate-pulse" />
              <div className="h-3 w-1/2 rounded bg-slate-200/50 dark:bg-slate-800/50 animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (items.length === 0) {
    return <p className="text-sm text-slate-500">Похожих товаров нет</p>
  }

  return (
    <div className="space-y-2">
      {items.map((p, i) => (
        <motion.a
          key={p.id}
          href={`?product=${p.id}`}
          onClick={(e) => {
            e.preventDefault()
            // v25.6 (Task #1): dispatch a custom switch-product event
            // instead of `popstate`. Same fix as mobile product-page.tsx.
            if (typeof window !== 'undefined') {
              window.dispatchEvent(
                new CustomEvent('999pro:switch-product', { detail: { productId: p.id } }),
              )
            }
          }}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.05 }}
          whileHover={{ scale: 1.03, x: 3 }}
          className="flex gap-3 items-center p-2 rounded-2xl hover:bg-white/60 dark:hover:bg-slate-800/50 ring-1 ring-transparent hover:ring-blue-500/20 transition-all cursor-pointer group"
        >
          <div className="h-16 w-16 rounded-2xl overflow-hidden bg-slate-100 dark:bg-slate-800 shrink-0 ring-1 ring-black/5 dark:ring-white/5">
            {p.images?.[0] && (
              <img
                src={assetUrl(p.images[0])}
                alt={p.title}
                className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300"
                loading="lazy"
              />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate leading-tight">
              {p.title}
            </div>
            <div className="text-base font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mt-0.5">
              {formatPrice(p.price, p.currency)}
            </div>
          </div>
        </motion.a>
      ))}
    </div>
  )
}
