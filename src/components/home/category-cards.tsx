'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { api } from '@/lib/api'
import { haptic } from '@/lib/haptic'
import { cn } from '@/lib/utils'
import { FileSpreadsheet } from 'lucide-react'

// v25.13 (horizontal category cards + 3D hover): App Store-style
// horizontal scrollable tiles with premium 3D tilt on hover.
//
// Problems with the old vertical CategoryCards:
//   • Vertical 4:3 cards with text at the bottom — wasted vertical space
//     and didn't match the new editorial home page rhythm.
//
// New design:
//   • Horizontal cards (wide aspect-ratio 16/9) — each card is a wide tile
//     with the icon + name + count inline. Cards scroll horizontally on
//     both mobile (touch swipe) and desktop (overflow-x-auto with
//     scroll buttons on hover).
//   • 3D tilt + parallax on hover (desktop only — touch devices skip).
//   • Clean glass background + accent-coloured icon pill + subtle gradient
//     on hover.
//   • Cards maintain a consistent height so the scroll lane looks tidy.

interface Category {
  id: string
  name: string
  slug: string
  icon: string
  description?: string | null
  productsCount?: number
}

// v25.13: pill colours per category — same as before but used for the
// small icon pill, not the full-tile background.
const CARD_STYLES: Record<string, { pill: string; text: string }> = {
  'Реклама':   { pill: 'bg-orange-500/10',  text: 'text-orange-600 dark:text-orange-400' },
  'Подарки':   { pill: 'bg-pink-500/10',   text: 'text-pink-600 dark:text-pink-400' },
  'Мебель':   { pill: 'bg-teal-500/10',    text: 'text-teal-600 dark:text-teal-400' },
  'Печать':   { pill: 'bg-violet-500/10',  text: 'text-violet-600 dark:text-violet-400' },
  'Дизайн':   { pill: 'bg-purple-500/10',  text: 'text-purple-600 dark:text-purple-400' },
  'Интерьер': { pill: 'bg-sky-500/10',     text: 'text-sky-600 dark:text-sky-400' },
  'Наружная реклама': { pill: 'bg-amber-500/10', text: 'text-amber-600 dark:text-amber-400' },
  'Полиграфия': { pill: 'bg-emerald-500/10', text: 'text-emerald-600 dark:text-emerald-400' },
}

const PRICE_CARD = {
  pill: 'bg-emerald-500/10',
  text: 'text-emerald-600 dark:text-emerald-400',
}

interface CategoryCardsProps {
  onSelect: (category: string) => void
  onOpenPrice?: () => void
}

// 3D tilt hook (similar to hero, but tighter feel for small cards).
interface TiltState { rotateX: number; rotateY: number; px: number; py: number }
const IDLE: TiltState = { rotateX: 0, rotateY: 0, px: 0, py: 0 }

function useCardTilt() {
  const [tilt, setTilt] = useState<TiltState>(IDLE)
  const rafRef = useRef<number | null>(null)

  const onMove = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    if ((e as any).pointerType && (e as any).pointerType !== 'mouse') return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    const y = (e.clientY - rect.top) / rect.height
    const cx = x - 0.5
    const cy = y - 0.5
    // Tighter tilt for small cards: 6° max, parallax 4px.
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => {
      setTilt({
        rotateX: -cy * 6,
        rotateY: cx * 6,
        px: cx * 4,
        py: cy * 4,
      })
    })
  }, [])

  const onLeave = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    setTilt(IDLE)
  }, [])

  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }, [])
  return { tilt, onMove, onLeave }
}

export function CategoryCards({ onSelect, onOpenPrice }: CategoryCardsProps) {
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get<{ items: Category[] }>('/api/categories')
      .then((d) => setCategories((d.items || []).slice(0, 8)))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const showPriceCard = !!onOpenPrice

  if (loading) {
    return (
      <section>
        <SectionHeader />
        <div className="flex gap-3 md:gap-4 overflow-hidden">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="shrink-0 w-[180px] md:w-[220px] h-[110px] md:h-[120px] rounded-2xl border border-border/40 bg-card skeleton"
            />
          ))}
        </div>
      </section>
    )
  }

  if (categories.length === 0) return null

  return (
    <section>
      <SectionHeader />

      {/* Horizontal scroll container.
          On mobile: native touch swipe.
          On desktop: horizontal scroll with mouse wheel + drag (no scrollbar
          thanks to no-scrollbar class). Cards are fixed-width so the lane
          feels tidy. */}
      <div className="flex gap-3 md:gap-4 overflow-x-auto no-scrollbar -mx-4 px-4 md:mx-0 md:px-0 pb-2">
        {categories.map((cat) => (
          <CategoryCard
            key={cat.id}
            cat={cat}
            onSelect={onSelect}
          />
        ))}

        {/* Price tile — last, different colour */}
        {showPriceCard && (
          <button
            onClick={() => { haptic.tap(); onOpenPrice?.() }}
            className={cn(
              'group shrink-0 text-left p-4 rounded-2xl border border-emerald-500/30',
              'bg-emerald-500/5',
              'hover:border-emerald-500/60 hover:shadow-lg transition-all',
              'w-[180px] md:w-[220px] h-[110px] md:h-[120px]',
              'flex items-center gap-3',
            )}
          >
            <div className={cn(
              'h-10 w-10 rounded-lg grid place-items-center shrink-0',
              PRICE_CARD.pill,
            )}>
              <FileSpreadsheet className={cn('h-5 w-5', PRICE_CARD.text)} />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm md:text-base font-semibold leading-tight text-foreground truncate">
                Прайс-листы
              </h3>
              <p className="text-[11px] md:text-xs text-muted-foreground mt-0.5 truncate">
                PDF, Word, картинки
              </p>
            </div>
          </button>
        )}
      </div>
    </section>
  )
}

// v25.13: individual category card with 3D hover tilt.
function CategoryCard({ cat, onSelect }: { cat: Category; onSelect: (s: string) => void }) {
  const { tilt, onMove, onLeave } = useCardTilt()
  const style = CARD_STYLES[cat.name] || { pill: 'bg-primary/10', text: 'text-primary' }

  return (
    <button
      onClick={() => { haptic.tap(); onSelect(cat.name) }}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      style={{
        // 3D tilt — applied to the card container. Perspective on the
        // parent (scroll container) would clip, so we put perspective
        // directly on the card via the transform-style + perspective.
        perspective: '800px',
      }}
      className={cn(
        'group shrink-0 text-left p-4 rounded-2xl border border-border/40 bg-card',
        'hover:border-primary/40 hover:shadow-lg transition-[border,box-shadow] duration-300',
        'w-[180px] md:w-[220px] h-[110px] md:h-[120px]',
        'flex items-center gap-3',
      )}
    >
      {/* Inner tilt layer — rotates based on mouse position */}
      <div
        style={{
          transform: `rotateX(${tilt.rotateX}deg) rotateY(${tilt.rotateY}deg)`,
          transformStyle: 'preserve-3d',
          transition: 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
        className="flex items-center gap-3 w-full"
      >
        {/* Icon pill */}
        <div
          className={cn(
            'h-10 w-10 rounded-lg grid place-items-center shrink-0 transition-transform duration-300',
            style.pill,
          )}
          style={{
            // Subtle parallax — icon moves slightly more than the card body
            transform: `translate3d(${tilt.px}px, ${tilt.py}px, 30px)`,
          }}
        >
          <span className={cn('text-base font-bold', style.text)}>
            {cat.name.charAt(0)}
          </span>
        </div>
        {/* Name + count */}
        <div
          className="min-w-0"
          style={{
            transform: `translate3d(${tilt.px * 0.5}px, ${tilt.py * 0.5}px, 20px)`,
          }}
        >
          <h3 className="text-sm md:text-base font-semibold leading-tight text-foreground line-clamp-2">
            {cat.name}
          </h3>
          <p className="text-[11px] md:text-xs text-muted-foreground mt-0.5">
            {typeof cat.productsCount === 'number' && cat.productsCount > 0
              ? `${cat.productsCount} ${pluralizeProducts(cat.productsCount)}`
              : 'Смотреть товары'}
          </p>
        </div>
      </div>
    </button>
  )
}

function SectionHeader() {
  return (
    <div className="mb-3 md:mb-4">
      <h2 className="text-lg md:text-xl font-bold tracking-tight text-foreground">
        Категории
      </h2>
      <p className="text-xs md:text-sm text-muted-foreground mt-0.5">
        Выберите направление — от рекламы до мебели
      </p>
    </div>
  )
}

function pluralizeProducts(n: number): string {
  const last = n % 10
  const lastTwo = n % 100
  if (lastTwo >= 11 && lastTwo <= 14) return 'товаров'
  if (last === 1) return 'товар'
  if (last >= 2 && last <= 4) return 'товара'
  return 'товаров'
}
