'use client'

import { useEffect, useState } from 'react'
import { Flame, ArrowRight } from 'lucide-react'
import { api } from '@/lib/api'
import { ProductCard } from '../product-card'
import { NeuroReveal } from '../neuro-reveal'
import { haptic } from '@/lib/haptic'

// v25.13 (desktop redesign): simplified Hot Deals section.
//
// Problems with the old Hot Deals section (per user feedback):
//   • Big rounded pink/peach gradient card — looked like a "promo box"
//     floating on the page, visually heavy.
//   • The countdown timer (Часы : Минуты : Секунды) felt childish and
//     scammy ("HURRY! Only today!"). Premium e-commerce doesn't do this.
//   • Horizontal-scroll carousel — on desktop with 1920px width, the
//     carousel wasted 80% of horizontal space showing only 5-6 products
//     at a time with hidden scroll buttons.
//   • Hard-coded `-33%` badge in the header — irrelevant if no product
//     actually has a 33% discount.
//
// New design:
//   • NO gradient background, NO timer, NO fixed discount badge.
//   • Header is a simple inline: icon + title + "Все скидки →" link.
//   • Products are shown in the SAME responsive grid as SmartSection
//     (2 cols mobile / 3 tablet / 4 desktop / 5 xl). The "-X%" red badge
//     on each ProductCard itself carries the urgency — no need for a
//     screaming countdown.
//   • Looks like a natural section of the home page, not a separate
//     "promo block".

interface Product {
  id: string
  title: string
  price: number
  oldPrice?: number | null
  currency?: string
  images: string[]
  [k: string]: any
}

interface HotDealsSectionProps {
  onOpenProduct: (id: string) => void
  onViewAll?: () => void
}

export function HotDealsSection({ onOpenProduct, onViewAll }: HotDealsSectionProps) {
  const [items, setItems] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)

  // Load discounted products
  useEffect(() => {
    api.get<{ items: Product[]; total: number }>('/api/products', {
      query: { hasDiscount: 'true', sort: 'popular', limit: 12 },
    })
      .then((d) => setItems(d.items || []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false))
  }, [])

  // Live-refresh when products change in Studio OR on pull-to-refresh
  useEffect(() => {
    const refresh = () => {
      api.get<{ items: Product[]; total: number }>('/api/products', {
        query: { hasDiscount: 'true', sort: 'popular', limit: 12, shuffle: 1, seed: Math.floor(Math.random() * 1000000) },
      })
        .then((d) => setItems(d.items || []))
        .catch(() => {})
    }
    window.addEventListener('999pro:products-changed', refresh as EventListener)
    window.addEventListener('999pro:refresh', refresh as EventListener)
    return () => {
      window.removeEventListener('999pro:products-changed', refresh as EventListener)
      window.removeEventListener('999pro:refresh', refresh as EventListener)
    }
  }, [])

  if (!loading && items.length === 0) return null

  return (
    <section>
      {/* Header — inline, no decorative card */}
      <div className="flex items-end justify-between gap-4 mb-3 md:mb-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-10 w-10 md:h-11 md:w-11 rounded-2xl bg-gradient-to-br from-[#FF5722] to-[#FF3B30] grid place-items-center shadow-lg shadow-orange-500/30 shrink-0">
            <Flame className="h-5 w-5 text-white" />
          </div>
          <div className="min-w-0">
            <h2 className="text-lg md:text-xl lg:text-2xl font-bold tracking-tight text-foreground">
              Горячие скидки
            </h2>
            <p className="text-xs md:text-sm text-muted-foreground mt-0.5">
              Только сегодня — успейте купить выгодно
            </p>
          </div>
        </div>
        {onViewAll && (items.length > 0 || loading) && (
          <button
            onClick={() => { haptic.tap(); onViewAll() }}
            className="shrink-0 inline-flex items-center gap-1 text-xs md:text-sm font-semibold text-primary hover:underline"
          >
            Все скидки
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Loading skeleton — matches grid layout */}
      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 md:gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="rounded-xl overflow-hidden bg-card border border-border/40">
              <div className="aspect-[3/4] skeleton" />
              <div className="p-3 space-y-2">
                <div className="h-4 w-3/4 rounded skeleton" />
                <div className="h-3 w-1/2 rounded skeleton" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* v25.13: same responsive grid as SmartSection — consistency across
           all product sections on the home page. */
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 md:gap-4">
          {/* v25.19: «нейро-генерация» при скролле */}
          {items.map((p, i) => (
            <NeuroReveal key={p.id} delay={(i % 10) * 0.04}>
              <ProductCard product={p as any} onOpen={onOpenProduct} variant="deal" />
            </NeuroReveal>
          ))}
        </div>
      )}
    </section>
  )
}
