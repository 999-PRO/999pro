'use client'

// ============================================================================
//  ProductMessageCard — inline interactive product card rendered inside a
//  chat message bubble. Designed to mirror the look & feel of the main
//  ProductCard / BuySheet flow without introducing new design tokens.
//
//  Behaviour:
//    • Lazy-fetches the product by id via /api/products/batch on mount.
//      The backend already filters deletedAt: null, so a missing response
//      means the product was deleted — we render a graceful "no longer
//      available" state and never throw.
//    • Re-fetches on `productId` change (forwarded messages, etc.).
//    • Click anywhere on the card → opens the existing ProductPage Bottom
//      Sheet (same flow as clicking a product in the catalog grid) via the
//      `onOpenProduct(id)` callback. No new navigation paths.
//    • Uses existing 999PRO design tokens (glass-message, formatPrice,
//      assetUrl, gradients) — no new CSS classes introduced.
//    • Re-render-safe: a single in-flight fetch guarded by an `alive` flag,
//      dedup of identical productId via a tiny module-level cache (so
//      scrolling back through a chat with the same product card 10 times
//      only fetches once).
// ============================================================================

import React, { useEffect, useState } from 'react'
import { Star, ShoppingCart, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { assetUrl, api } from '@/lib/api'
import { formatPrice } from '@/lib/format'
import type { Product } from '@/lib/types'

// Tiny module-level cache: productId → { data, fetchedAt }. Avoids re-fetching
// the same product every time a chat scrolls and a ProductMessageCard remounts.
// Entries expire after 5 minutes so price/stock changes propagate.
const PRODUCT_CACHE = new Map<string, { data: Product | null; fetchedAt: number }>()
const CACHE_TTL_MS = 5 * 60 * 1000

interface Props {
  productId: string
  isOwn: boolean
  /** Optional direct callback. If absent, the card dispatches a global
   *  `navigate` CustomEvent with `detail.productId` so the top-level
   *  page.tsx listener opens the existing ProductPage bottom-sheet. The
   *  callback form is preferred when the parent already has direct access
   *  to `openProduct` (avoids the global event bus). */
  onOpenProduct?: (id: string) => void
}

export function ProductMessageCard({ productId, isOwn, onOpenProduct }: Props) {
  const [product, setProduct] = useState<Product | null | undefined>(() => {
    const cached = PRODUCT_CACHE.get(productId)
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.data
    return undefined // unknown — need to fetch
  })
  const [loading, setLoading] = useState<boolean>(product === undefined)

  useEffect(() => {
    if (product !== undefined) return // already have data (cached)

    let alive = true
    // Note: setLoading(true) is intentionally NOT called here — `loading` is
    // initialised from `product === undefined` on mount, which already covers
    // the first render. Calling setLoading(true) synchronously inside the
    // effect body triggers React 19's `react-hooks/set-state-in-effect` lint
    // rule and causes a cascading render. The initial state is correct; we
    // only ever transition loading → false after the fetch resolves.

    // Use GET /api/products/:id (single fetch) instead of /api/products/batch
    // because the batch endpoint splits ids on `,` and some product ids in
    // this system contain commas (slug-style ids set by the seed script).
    // The single endpoint handles commas correctly via URL-encoding.
    api
      .get<Product>(`/api/products/${encodeURIComponent(productId)}`)
      .then((d) => {
        if (!alive) return
        const found = d && d.id ? (d as Product) : null
        PRODUCT_CACHE.set(productId, { data: found, fetchedAt: Date.now() })
        setProduct(found)
      })
      .catch(() => {
        if (!alive) return
        // Treat fetch failure as "product unavailable" — same as a soft-deleted
        // product. The user sees the same graceful fallback, and a later retry
        // (e.g. on next mount) will re-fetch.
        PRODUCT_CACHE.set(productId, { data: null, fetchedAt: Date.now() })
        setProduct(null)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })

    return () => {
      alive = false
    }
  }, [productId, product])

  // ---- Loading skeleton ----
  if (loading) {
    return (
      <div
        className={cn(
          'rounded-2xl overflow-hidden w-[260px] max-w-full',
          'glass-message',
          isOwn && 'glass-message-outgoing',
        )}
      >
        <div className="h-[140px] bg-slate-200/60 dark:bg-slate-700/40 animate-pulse" />
        <div className="p-3 space-y-2">
          <div className="h-3.5 w-3/4 rounded bg-slate-200/60 dark:bg-slate-700/40 animate-pulse" />
          <div className="h-3 w-1/2 rounded bg-slate-200/60 dark:bg-slate-700/40 animate-pulse" />
        </div>
      </div>
    )
  }

  // ---- Product deleted / unavailable ----
  if (!product) {
    return (
      <div
        className={cn(
          'rounded-2xl p-3 w-[260px] max-w-full flex items-center gap-2.5',
          'glass-message',
          isOwn ? 'glass-message-outgoing' : 'glass-message-incoming',
          'opacity-70',
        )}
      >
        <div className="h-10 w-10 rounded-xl bg-slate-300/60 dark:bg-slate-700/50 grid place-items-center shrink-0">
          <AlertCircle className="h-5 w-5 text-slate-500" />
        </div>
        <div className="text-xs leading-tight">
          <div className="font-semibold">Товар больше недоступен</div>
          <div className="text-muted-foreground mt-0.5">Возможно, он был удалён продавцом.</div>
        </div>
      </div>
    )
  }

  // ---- Live product card ----
  const discount =
    product.oldPrice && product.oldPrice > product.price
      ? Math.round(100 - (product.price / product.oldPrice) * 100)
      : 0
  const image = product.images?.[0]

  const openProductSheet = () => {
    if (onOpenProduct) {
      // Direct callback (preferred when parent has access to openProduct).
      onOpenProduct(product.id)
    } else if (typeof window !== 'undefined') {
      // Fallback: dispatch a dedicated `999pro:open-product` event.
      // The top-level page.tsx listener catches it and opens the existing
      // ProductPage bottom-sheet as an overlay — WITHOUT changing the URL
      // or the current view. This means:
      //   • No page reload, no remount of Root Layout
      //   • The current chat stays mounted underneath
      //   • Closing the product returns the user to the exact same chat
      //     position, with no loss of scroll or state.
      // We deliberately do NOT use the `navigate` event here — that event
      // is for switching the main view (home/catalog/chat/etc.) and reusing
      // it for product-opening caused the "app remounts" regression.
      window.dispatchEvent(
        new CustomEvent('999pro:open-product', { detail: { productId: product.id } }),
      )
    }
  }

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    openProductSheet()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      e.stopPropagation()
      openProductSheet()
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={cn(
        'rounded-2xl overflow-hidden w-[260px] max-w-full cursor-pointer',
        'transition-transform hover:scale-[1.01] active:scale-[0.99]',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60',
        'glass-message',
        isOwn ? 'glass-message-outgoing' : 'glass-message-incoming',
      )}
    >
      {/* Image */}
      <div className="relative h-[140px] bg-slate-100 dark:bg-slate-800 overflow-hidden">
        {image ? (
          <img
            src={assetUrl(image)}
            alt={product.title}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="h-full w-full grid place-items-center">
            <ShoppingCart className="h-8 w-8 text-slate-400" />
          </div>
        )}

        {/* Badges overlay */}
        <div className="absolute top-2 left-2 flex flex-col gap-1">
          {discount > 0 && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-rose-500 text-white shadow">
              −{discount}%
            </span>
          )}
          {!product.inStock || !product.quantity || product.quantity === 0 ? (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-rose-500/90 text-white shadow">
              Нет в наличии
            </span>
          ) : product.quantity <= 5 ? (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-amber-500/90 text-white shadow">
              Заканчивается
            </span>
          ) : null}
        </div>

        {/* Branding chip — keeps 999PRO identity inside the card */}
        <div className="absolute top-2 right-2">
          <span className="text-[9px] font-extrabold px-1.5 py-0.5 rounded-md bg-gradient-to-br from-sky-400 via-blue-500 to-violet-600 text-white shadow">
            999PRO
          </span>
        </div>
      </div>

      {/* Body */}
      <div className="p-2.5 space-y-1.5">
        <div className="text-xs font-semibold leading-tight line-clamp-2 text-foreground">
          {product.title}
        </div>

        {/* Rating + reviews */}
        {(product.rating > 0 || product.reviewsCount > 0) && (
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-0.5">
              <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
              <span className="font-medium text-foreground">
                {product.rating > 0 ? product.rating.toFixed(1) : '—'}
              </span>
            </span>
            {product.reviewsCount > 0 && <span>· {product.reviewsCount} отз.</span>}
          </div>
        )}

        {/* Price */}
        <div className="flex items-baseline gap-1.5 pt-0.5">
          <span
            className={cn(
              'text-sm font-bold',
              isOwn ? 'text-white' : 'text-foreground',
            )}
            style={isOwn ? { color: '#fff' } : undefined}
          >
            {formatPrice(product.price, product.currency)}
          </span>
          {discount > 0 && (
            <span
              className={cn(
                'text-[11px] line-through',
                isOwn ? 'text-white/60' : 'text-muted-foreground',
              )}
            >
              {formatPrice(product.oldPrice!, product.currency)}
            </span>
          )}
        </div>

        {/* CTA */}
        <div
          className={cn(
            'mt-1.5 h-7 rounded-lg flex items-center justify-center gap-1 text-[11px] font-semibold',
            isOwn
              ? 'bg-white/20 text-white'
              : 'bg-primary/10 text-primary',
          )}
        >
          <ShoppingCart className="h-3 w-3" />
          Открыть товар
        </div>
      </div>
    </div>
  )
}
