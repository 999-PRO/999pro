'use client'

import React, { useState, useRef, memo } from 'react'
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
  // v25.15: горизонтальный свайп фото ПРЯМО ВНУТРИ карточки («я могу там
  // листать картинки внутри товара, даже если не открыл»). Диагональный
  // фильтр |dx|>|dy| не конфликтует с вертикальным скроллом страницы.
  const touchStartX = useRef<number | null>(null)
  const touchStartY = useRef<number | null>(null)
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
      // v25.14 premium polish: larger radius, layered shadows, image zoom
      // on hover, softer border. Theme-adaptive surfaces kept from v25.13.
      className="group relative rounded-2xl overflow-hidden bg-card ring-1 ring-black/[0.04] dark:ring-white/[0.06] shadow-[0_2px_10px_-4px_rgba(0,0,0,0.08)] dark:shadow-[0_2px_12px_-4px_rgba(0,0,0,0.5)] hover:shadow-[0_16px_36px_-12px_rgba(160,32,112,0.28)] transition-all duration-300 cursor-pointer hover:-translate-y-1"
    >
      {/* Image carousel — v25.12: 3:4 aspect ratio (was square) */}
      <div className={cn(
        'relative overflow-hidden bg-muted',
        'aspect-[3/4]',
      )}
        onTouchStart={(e) => {
          if (product.images.length <= 1) return
          touchStartX.current = e.touches[0].clientX
          touchStartY.current = e.touches[0].clientY
        }}
        onTouchMove={() => {
          /* pass-through — вертикальный скролл страницы не блокируется */
        }}
        onTouchEnd={(e) => {
          if (product.images.length <= 1 || touchStartX.current === null || touchStartY.current === null) return
          const dx = e.changedTouches[0].clientX - touchStartX.current
          const dy = e.changedTouches[0].clientY - touchStartY.current
          if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 36) {
            if (dx < 0 && imgIndex < product.images.length - 1) {
              e.stopPropagation()
              setImgIndex((i) => i + 1)
              haptic.select()
            } else if (dx > 0 && imgIndex > 0) {
              e.stopPropagation()
              setImgIndex((i) => i - 1)
              haptic.select()
            }
          }
          touchStartX.current = null
          touchStartY.current = null
        }}
      >
        {/* Zoom-on-hover wrapper (separate from the translateX track so
            the two transforms never fight each other) */}
        <div className="h-full w-full transition-transform duration-700 ease-out group-hover:scale-[1.05]">
        <div
          className="flex h-full"
          style={{
            // v25.17: пружинная анимация листания (лёгкий overshoot на выходе —
            // «какая-нибудь анимация» из фидбека). Обычный bezier(0.22,1,0.36,1)
            // монотонный, а тут лёгкий отскок cubic-bezier(0.34, 1.3, 0.44, 1).
            transform: `translateX(-${imgIndex * 100}%)`,
            transition: 'transform 520ms cubic-bezier(0.34, 1.3, 0.44, 1)',
          }}
        >
          {product.images.length > 0 ? (
            product.images.map((src, i) => {
              // v25.17: параллакс + микро-зум активного слайда — картинка
              // «дышит» при листании даже без открытия товара.
              const offset = i - imgIndex
              const isActive = offset === 0
              return (
                <div key={i} className="relative h-full w-full shrink-0 overflow-hidden">
                  {/* v25.17: сдвиг параллакса на ОБЁРТКЕ, а Ken Burns-анимация
                      (v25.18, «как в ленте») — на самой картинке: два transform
                      не конфликтуют. Чётные кадры — траектория «a»,
                      нечётные — «b», чтобы соседние фото двигались вразнобой. */}
                  <div
                    className="h-full w-full will-change-transform"
                    style={{
                      transform: `translateX(${offset * 14}%) scale(${isActive ? 1 : 0.94})`,
                      transition: 'transform 560ms cubic-bezier(0.34, 1.3, 0.44, 1)',
                    }}
                  >
                    <Image
                      src={assetUrl(src)}
                      alt={`${product.title} — фото ${i + 1}`}
                      fill
                      sizes="(max-width: 768px) 50vw, 25vw"
                      className={cn(
                        'object-cover',
                        isActive && product.images.length > 0 && (i % 2 === 0 ? 'kb-ambient-a' : 'kb-ambient-b'),
                      )}
                      style={{ filter: isActive ? 'none' : 'saturate(0.92)' }}
                      loading={i < 2 ? 'eager' : 'lazy'}
                      draggable={false}
                    />
                  </div>
                </div>
              )
            })
          ) : (
            <div className="h-full w-full grid place-items-center text-muted-foreground/40">
              <ShoppingCart className="h-8 w-8" />
            </div>
          )}
        </div>
        </div>

        {/* Badges — верхний левый угол (стек) */}
        <div className="absolute top-2 left-2 flex flex-col gap-1 items-start">
          {isDeal && (
            <span className="px-2 py-0.5 rounded-full text-white text-[10px] font-bold shadow" style={{ background: 'linear-gradient(135deg,#FB7185,#F43F5E)' }}>
              Скидка
            </span>
          )}
          {discount > 0 && (
            <span className="px-2 py-0.5 rounded-full text-white text-[10px] font-bold shadow" style={{ background: 'linear-gradient(135deg,#FF3B30,#FF6B5B)' }}>
              −{discount}%
            </span>
          )}
          {product.isNew && (
            <span className="px-2 py-0.5 rounded-full text-white text-[10px] font-bold shadow" style={{ background: 'linear-gradient(135deg,#10B981,#34D399)' }}>
              Новинка
            </span>
          )}
          {product.isPopular && (
            <span className="px-2 py-0.5 rounded-full text-white text-[10px] font-bold shadow" style={{ background: 'linear-gradient(135deg,#F59E0B,#FBBF24)' }}>
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

        {/* v25.17: анимированные сегменты вместо точек — активный сегмент
            растягивается с пружинкой, как в нативных галереях iOS/Android. */}
        {product.images.length > 1 && (
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1 px-1.5 h-4 rounded-full bg-black/25 backdrop-blur-sm">
            {product.images.map((_, i) => (
              <button
                key={i}
                onClick={(e) => { e.stopPropagation(); setImgIndex(i) }}
                aria-label={`Фото ${i + 1}`}
                className="grid place-items-center h-full"
              >
                <span
                  className="block rounded-full transition-all duration-300"
                  style={{
                    width: i === imgIndex ? 12 : 4,
                    height: 3,
                    background: i === imgIndex ? '#ffffff' : 'rgba(255,255,255,0.55)',
                    transitionTimingFunction: 'cubic-bezier(0.34, 1.3, 0.44, 1)',
                  }}
                />
              </button>
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
            {/* v25.14: gradient price — premium accent that stays readable
                on every theme via bg-clip-text. */}
            <div
              className="text-base md:text-lg font-extrabold bg-clip-text text-transparent"
              style={{ backgroundImage: 'var(--gradient-brand, linear-gradient(135deg,#A02070,#EC4899))' }}
            >
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
