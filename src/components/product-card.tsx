'use client'

import React, { useState, memo } from 'react'
import Image from 'next/image'
import { Heart, Star, ChevronLeft, ChevronRight, ShoppingCart, Share2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { assetUrl } from '@/lib/api'
import { formatPrice, formatCompactNumber } from '@/lib/format'
import { haptic } from '@/lib/haptic'
import { sounds } from '@/lib/sounds'
import type { Product } from '@/lib/types'
import { getStockLabel } from '@/lib/types'
import { useFavoritesStore, useCartStore } from '@/lib/cart-store'
import { toast } from '@/lib/notifications'

// v25.12: ProductCard — точная реплика с IMG_3193/IMG_3194.
// Цветные бейджи (Скидка розовый, -X% красный, Новинка зелёный, Хит оранжевый),
// фиолетовая цена, круглая фиолетовая кнопка корзины (правый нижний угол),
// вертикальные кнопки сердце/поделиться на картинке.

interface ProductCardProps {
  product: Product
  onOpen?: (id: string) => void
  variant?: 'default' | 'deal' | 'compact'
}

const ProductCardImpl = ({ product, onOpen, variant = 'default' }: ProductCardProps) => {
  const [imgIndex, setImgIndex] = useState(0)
  const favorited = useFavoritesStore((s) => s.ids.includes(product.id))
  const toggleFavorite = useFavoritesStore((s) => s.toggle)
  const cartAdd = useCartStore((s) => s.add)

  const handleFavorite = (e: React.MouseEvent) => {
    e.stopPropagation()
    const willFavorite = !favorited
    toggleFavorite(product.id)
    haptic.select()
    if (willFavorite) sounds.like()
    toast.success(willFavorite ? 'Добавлено в избранное' : 'Удалено из избранного')
  }

  const handleShare = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (typeof navigator !== 'undefined' && navigator.share) {
      navigator.share({
        title: product.title,
        url: `${window.location.origin}/?product=${product.id}`,
      }).catch(() => {})
    } else {
      navigator.clipboard?.writeText(`${window.location.origin}/?product=${product.id}`)
      toast.success('Ссылка скопирована')
    }
  }

  const handleCart = (e: React.MouseEvent) => {
    e.stopPropagation()
    cartAdd({
      productId: product.id,
      title: product.title,
      price: product.price,
      image: product.images[0],
    })
    haptic.success()
    toast.success('Добавлено в список заявок', { sound: 'cart' })
  }

  const handleOpen = () => {
    haptic.tap()
    onOpen?.(product.id)
  }

  const discount =
    product.oldPrice && product.oldPrice > product.price
      ? Math.round(100 - (product.price / product.oldPrice) * 100)
      : 0

  const isCompact = variant === 'compact'
  const isDeal = variant === 'deal'

  return (
    <article
      onClick={handleOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleOpen() } }}
      // v25.13 (theme regression fix): use bg-card / shadow via CSS vars so
      // the card adapts to light/dark/neon themes. Previously this was a
      // hard-coded `bg-white` — which made every product card a bright white
      // "island" on top of the dark/neon app background. The text inside was
      // also hard-coded to dark (`text-[#111827]`) which is fine on white
      // but invisible on the dark card surface once the surface followed
      // the theme. Now both surface AND text follow the theme.
      className="group relative rounded-xl overflow-hidden bg-card shadow-[0_2px_12px_-4px_rgba(0,0,0,0.08)] dark:shadow-[0_2px_12px_-4px_rgba(0,0,0,0.4)] hover:shadow-[0_8px_24px_-8px_rgba(160,32,112,0.2)] transition-all cursor-pointer hover:-translate-y-0.5"
    >
      {/* Image carousel — v25.12: 3:4 aspect ratio (was square) */}
      <div className={cn(
        'relative overflow-hidden bg-muted',
        'aspect-[3/4]',
      )}>
        <div
          className="flex h-full transition-transform duration-300 ease-out"
          style={{ transform: `translateX(-${imgIndex * 100}%)` }}
        >
          {product.images.length > 0 ? (
            product.images.map((src, i) => (
              <div key={i} className="relative h-full w-full shrink-0">
                <Image
                  src={assetUrl(src)}
                  alt={`${product.title} — фото ${i + 1}`}
                  fill
                  sizes="(max-width: 768px) 50vw, 25vw"
                  className="object-cover"
                  loading={i < 2 ? 'eager' : 'lazy'}
                  draggable={false}
                />
              </div>
            ))
          ) : (
            <div className="h-full w-full grid place-items-center text-muted-foreground/40">
              <ShoppingCart className="h-8 w-8" />
            </div>
          )}
        </div>

        {/* Badges — верхний левый угол (стек) */}
        <div className="absolute top-2 left-2 flex flex-col gap-1 items-start">
          {isDeal && (
            <span className="px-2 py-0.5 rounded-full bg-[#FB7185] text-white text-[10px] font-bold shadow">
              Скидка
            </span>
          )}
          {discount > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-[#FF3B30] text-white text-[10px] font-bold shadow">
              -{discount}%
            </span>
          )}
          {product.isNew && (
            <span className="px-2 py-0.5 rounded-full bg-[#10B981] text-white text-[10px] font-bold shadow">
              Новинка
            </span>
          )}
          {product.isPopular && (
            <span className="px-2 py-0.5 rounded-full bg-[#F59E0B] text-white text-[10px] font-bold shadow">
              Хит
            </span>
          )}
        </div>

        {/* Action buttons — правая сторона, вертикально (сердце + шеринг) */}
        <div className="absolute top-2 right-2 flex flex-col gap-1.5">
          <button
            onClick={handleFavorite}
            aria-label={favorited ? 'Убрать из избранного' : 'Добавить в избранное'}
            className="h-8 w-8 rounded-full bg-white/95 backdrop-blur grid place-items-center shadow-md hover:scale-110 active:scale-95 transition-transform"
          >
            <Heart
              className={cn('h-4 w-4', favorited ? 'text-[#FF3B30]' : 'text-[#6B7280]')}
              fill={favorited ? 'currentColor' : 'none'}
            />
          </button>
          <button
            onClick={handleShare}
            aria-label="Поделиться"
            className="h-8 w-8 rounded-full bg-white/95 backdrop-blur grid place-items-center shadow-md hover:scale-110 active:scale-95 transition-transform"
          >
            <Share2 className="h-4 w-4 text-[#6B7280]" />
          </button>
        </div>

        {/* Image dots */}
        {product.images.length > 1 && (
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
            {product.images.map((_, i) => (
              <button
                key={i}
                onClick={(e) => { e.stopPropagation(); setImgIndex(i) }}
                aria-label={`Фото ${i + 1}`}
                className={cn('h-1.5 rounded-full transition-all', i === imgIndex ? 'w-4 bg-white' : 'w-1.5 bg-white/60')}
              />
            ))}
          </div>
        )}

        {/* Arrows on hover (desktop) */}
        {product.images.length > 1 && (
          <>
            <button
              onClick={(e) => { e.stopPropagation(); setImgIndex((i) => (i - 1 + product.images.length) % product.images.length) }}
              aria-label="Предыдущее фото"
              className="hidden md:grid absolute left-2 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full bg-white/95 backdrop-blur place-items-center shadow-md opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setImgIndex((i) => (i + 1) % product.images.length) }}
              aria-label="Следующее фото"
              className="hidden md:grid absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full bg-white/95 backdrop-blur place-items-center shadow-md opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </>
        )}
      </div>

      {/* Body */}
      <div className="p-3 space-y-1.5">
        {/* Title */}
        {/* v25.13 (theme regression fix): use text-card-foreground so the
            title is readable on every theme (light card / dark card / neon
            card). Previously this was `text-[#111827]` (hard-coded dark
            gray) — fine on a white card but invisible on a dark card. */}
        <h3 className="font-semibold text-sm leading-tight line-clamp-2 text-card-foreground min-h-[2.4em]">
          {product.title}
        </h3>

        {/* Rating */}
        {product.rating > 0 && (
          <div className="flex items-center gap-1 text-xs">
            <Star className="h-3.5 w-3.5 fill-[#FBBF24] text-[#FBBF24]" />
            <span className="font-semibold text-card-foreground">{product.rating.toFixed(1)}</span>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground">{formatCompactNumber(product.reviewsCount)} отз.</span>
          </div>
        )}

        {/* Price + cart button */}
        <div className="flex items-end justify-between gap-2 pt-1">
          <div className="min-w-0">
            {product.oldPrice && product.oldPrice > product.price && (
              <div className="text-[11px] text-muted-foreground line-through">
                {formatPrice(product.oldPrice, product.currency)}
              </div>
            )}
            {/* v25.13: text-primary adapts to theme (light: deep magenta,
                dark: lighter magenta, neon: violet). Previously hard-coded
                `text-[#A02070]` which was unreadable on neon theme. */}
            <div className="text-base md:text-lg font-bold text-primary">
              {formatPrice(product.price, product.currency)}
            </div>
          </div>
          {/* Round purple cart button */}
          {/* v25.13: use gradient-brand so the cart button adapts to theme
              (gradient uses CSS var --gradient-brand). Previously
              hard-coded `bg-[#A02070]` — fine in light/dark, off-style in neon. */}
          <button
            onClick={handleCart}
            aria-label="В список заявок"
            className="h-9 w-9 md:h-10 md:w-10 rounded-full gradient-brand grid place-items-center shadow-[0_4px_12px_-4px_rgba(160,32,112,0.5)] active:scale-90 transition-all shrink-0"
          >
            <ShoppingCart className="h-4 w-4 text-white" />
          </button>
        </div>

        {/* Stock badge — только если не дефолтный вариант */}
        {!isCompact && (
          <div className="pt-0.5">
            {(() => {
              const stock = getStockLabel(product)
              const colorClass =
                stock.variant === 'in-stock' ? 'text-emerald-600 dark:text-emerald-400'
                  : stock.variant === 'low' ? 'text-amber-600 dark:text-amber-400'
                    : 'text-rose-500 dark:text-rose-400'
              return <div className={cn('text-[10px] font-medium', colorClass)}>{stock.text}</div>
            })()}
          </div>
        )}
      </div>
    </article>
  )
}

function arePropsEqual(prev: ProductCardProps, next: ProductCardProps) {
  if (prev.onOpen !== next.onOpen) return false
  const p = prev.product
  const n = next.product
  return (
    p.id === n.id && p.title === n.title && p.price === n.price && p.oldPrice === n.oldPrice &&
    p.currency === n.currency && p.category === n.category && p.images === n.images &&
    p.rating === n.rating && p.reviewsCount === n.reviewsCount && p.inStock === n.inStock &&
    p.quantity === n.quantity && p.isPopular === n.isPopular && p.isAction === n.isAction && p.isNew === n.isNew
  )
}

export const ProductCard = memo(ProductCardImpl, arePropsEqual)
