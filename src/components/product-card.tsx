'use client'

import React, { useState, memo } from 'react'
import Image from 'next/image'
import { Heart, Eye, Star, ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { assetUrl } from '@/lib/api'
import { formatPrice, formatCompactNumber } from '@/lib/format'
import { haptic } from '@/lib/haptic'
import { sounds } from '@/lib/sounds'
import type { Product } from '@/lib/types'
import { getStockLabel } from '@/lib/types'
import { useFavoritesStore } from '@/lib/cart-store'
import { toast } from '@/lib/notifications'

// React.memo with a custom comparator — prevents re-rendering 48 cards in a
// grid when the parent re-renders (e.g. search query changed but the
// underlying products list is the same). Without memo, every keystroke in
// the search box re-renders all visible cards even though their `product`
// prop didn't change.
//
// Comparator: shallow-compare `product` (deep enough — primitives + a few
// arrays) + `onOpen` reference. If the parent passes a new `onOpen`
// callback each render without useCallback, memo won't help — but that's
// the parent's responsibility, not ours.
const ProductCardImpl = ({ product, onOpen }: { product: Product; onOpen?: (id: string) => void }) => {
  const [imgIndex, setImgIndex] = useState(0)
  // Selector-based subscriptions — avoid re-rendering the whole card on every
  // favorites store change (FE-029)
  const favorited = useFavoritesStore((s) => s.ids.includes(product.id))
  const toggleFavorite = useFavoritesStore((s) => s.toggle)

  const handleFavorite = (e: React.MouseEvent) => {
    e.stopPropagation()
    const willFavorite = !favorited
    toggleFavorite(product.id)
    haptic.select() // v10-native: haptic on favorite toggle
    if (willFavorite) sounds.like() // v10-native: sound on add to favorites
    toast.success(willFavorite ? 'Добавлено в избранное' : 'Удалено из избранного')
  }

  const handleOpen = () => {
    haptic.tap() // v10-native: light tap on product open
    onOpen?.(product.id)
  }

  const discount =
    product.oldPrice && product.oldPrice > product.price
      ? Math.round(100 - (product.price / product.oldPrice) * 100)
      : 0

  return (
    <article
      onClick={handleOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          handleOpen()
        }
      }}
      className="group relative rounded-3xl overflow-hidden glass shadow-soft hover:shadow-glow transition-all cursor-pointer hover:-translate-y-0.5"
      style={{
        // Phase 11.3: content-visibility:auto — browser skips rendering
        // for product cards scrolled off-screen. With 48+ cards in the
        // catalog grid, this significantly reduces initial render cost.
        contentVisibility: 'auto' as React.CSSProperties['contentVisibility'],
        containIntrinsicSize: '320px',
      }}
    >
      {/* Image carousel — square aspect ratio (1:1) + overflow-hidden +
          object-cover. Square format is the new standard for product photos
          (matches the share page and modern marketplaces like Ozon/WB).
          Old 3:4 photos are cropped via object-cover — looks clean. */}
      <div className="relative aspect-square overflow-hidden bg-muted/40">
        <div
          className="flex h-full transition-transform duration-300 ease-out"
          style={{ transform: `translateX(-${imgIndex * 100}%)` }}
        >
          {product.images.map((src, i) => (
            // F-CRIT-001: next/image with `fill` requires a positioned
            // ancestor. The flex child wrapper gets `relative` so the
            // absolutely-positioned <Image fill> snaps to it. Each child
            // keeps `shrink-0 w-full h-full` so the carousel flex layout
            // (translateX%) is unchanged.
            <div key={i} className="relative h-full w-full shrink-0">
              <Image
                src={assetUrl(src)}
                alt={`${product.title} — фото ${i + 1}`}
                fill
                sizes="(max-width: 768px) 50vw, (max-width: 1280px) 25vw, 16vw"
                className="object-cover"
                loading={i === 0 ? 'eager' : 'lazy'}
                draggable={false}
              />
            </div>
          ))}
        </div>

        {/* Discount badge */}
        {discount > 0 && (
          <div className="absolute top-3 left-3 px-2.5 py-1 rounded-full bg-destructive text-white text-xs font-bold shadow-lg">
            -{discount}%
          </div>
        )}

        {/* Favorite */}
        <button
          onClick={handleFavorite}
          aria-label={favorited ? 'Убрать из избранного' : 'Добавить в избранное'}
          className="absolute top-3 right-3 h-10 w-10 rounded-full glass-strong grid place-items-center hover:scale-110 active:scale-95 transition-transform"
        >
          <Heart
            className={cn('h-5 w-5', favorited ? 'text-destructive' : 'text-foreground/70')}
            fill={favorited ? 'currentColor' : 'none'}
          />
        </button>

        {/* Image dots */}
        {product.images.length > 1 && (
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
            {product.images.map((_, i) => (
              <button
                key={i}
                onClick={(e) => {
                  e.stopPropagation()
                  setImgIndex(i)
                }}
                aria-label={`Фото ${i + 1}`}
                className={cn(
                  'h-1.5 rounded-full transition-all',
                  i === imgIndex ? 'w-5 bg-white' : 'w-1.5 bg-white/60',
                )}
              />
            ))}
          </div>
        )}

        {/* Arrows on hover (desktop) */}
        {product.images.length > 1 && (
          <>
            <button
              onClick={(e) => {
                e.stopPropagation()
                setImgIndex((i) => (i - 1 + product.images.length) % product.images.length)
              }}
              aria-label="Предыдущее фото"
              className="hidden md:grid absolute left-2 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full glass-strong place-items-center opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                setImgIndex((i) => (i + 1) % product.images.length)
              }}
              aria-label="Следующее фото"
              className="hidden md:grid absolute right-2 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full glass-strong place-items-center opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </>
        )}

        {/* Quick view button — appears on hover (desktop) */}
        <button
          onClick={(e) => {
            e.stopPropagation()
            handleOpen()
          }}
          className="hidden md:flex absolute bottom-3 right-3 items-center gap-1.5 px-3 py-1.5 rounded-full glass-strong text-xs font-medium opacity-0 group-hover:opacity-100 transition-opacity hover:scale-105 active:scale-95"
        >
          <Eye className="h-3.5 w-3.5" /> Открыть
        </button>
      </div>

      {/* Body */}
      <div className="p-4 space-y-2.5">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold text-sm leading-tight line-clamp-2">{product.title}</h3>
          {product.rating > 0 && (
            <div className="flex items-center gap-0.5 text-xs shrink-0 mt-0.5">
              <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
              <span className="font-semibold">{product.rating.toFixed(1)}</span>
              <span className="text-muted-foreground">({formatCompactNumber(product.reviewsCount)})</span>
            </div>
          )}
        </div>

        {product.category && (
          <div className="text-xs text-muted-foreground">{product.category}</div>
        )}

        <div className="flex items-baseline gap-2 pt-1">
          <span className="text-lg font-bold text-foreground">{formatPrice(product.price, product.currency)}</span>
          {product.oldPrice && product.oldPrice > product.price && (
            <span className="text-sm text-muted-foreground line-through">
              {formatPrice(product.oldPrice, product.currency)}
            </span>
          )}
        </div>

        {/* v11: Stock badge — В наличии / Заканчивается / Нет в наличии */}
        {(() => {
          const stock = getStockLabel(product)
          const colorClass =
            stock.variant === 'in-stock'
              ? 'text-emerald-600 dark:text-emerald-400'
              : stock.variant === 'low'
                ? 'text-amber-600 dark:text-amber-400'
                : 'text-rose-500 dark:text-rose-400'
          return (
            <div className={cn('text-[11px] font-medium', colorClass)}>
              {stock.text}
            </div>
          )
        })()}
      </div>
    </article>
  )
}

// Custom comparator — re-render only when product fields or onOpen reference
// change. Compares the primitives that affect rendering; ignores nested
// arrays (images) since they only change when the whole product changes.
function arePropsEqual(prev: { product: Product; onOpen?: (id: string) => void }, next: { product: Product; onOpen?: (id: string) => void }) {
  if (prev.onOpen !== next.onOpen) return false
  const p = prev.product
  const n = next.product
  return (
    p.id === n.id &&
    p.title === n.title &&
    p.price === n.price &&
    p.oldPrice === n.oldPrice &&
    p.currency === n.currency &&
    p.category === n.category &&
    p.images === n.images && // string (JSON); same reference if unchanged
    p.rating === n.rating &&
    p.reviewsCount === n.reviewsCount &&
    p.inStock === n.inStock &&
    p.quantity === n.quantity && // v11: re-render when stock changes
    p.isPopular === n.isPopular &&
    p.isAction === n.isAction &&
    p.isNew === n.isNew
  )
}

export const ProductCard = memo(ProductCardImpl, arePropsEqual)
