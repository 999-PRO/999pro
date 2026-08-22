'use client'

import { useState, useCallback } from 'react'
import { Star, Sparkles, LayoutGrid, ArrowRight } from 'lucide-react'
import { HeroEditorial } from './hero-editorial'
import { CategoryCards } from './category-cards'
import { HotDealsSection } from './hot-deals-section'
import { RecentlyViewed } from './recently-viewed'
import { SmartSection } from './smart-section'
import { Stories } from '../stories'
import { PromoBannerCarousel } from '../promo-banner'
import { useSmartBlocks } from '@/lib/use-smart-blocks'
import { useHomeLayout } from '@/lib/home-layout'
import { haptic } from '@/lib/haptic'
import { Button } from '@/components/ui/button'

// v25.13 (desktop redesign): Premium Apple/SSENSE-inspired layout.
//
// Problems with the old home page (per user feedback):
//   1. Banner block at top looked like an awkward wide/narrow strip on
//      desktop — too much empty space around it.
//   2. The promo-top-bar block above the hero was visual noise.
//   3. Everything was squeezed into mobile-width containers even on 1920px
//      screens — the desktop home felt like a mobile mock-up scaled up.
//
// New layout principles:
//   • One cohesive max-width container (1280px) — content doesn't sprawl
//     across the entire 1920px screen, but uses comfortable whitespace.
//   • Generous vertical rhythm between sections (py-8 md:py-12).
//   • Hero is full-width INSIDE the container, not a rounded card floating
//     on a coloured background — looks like an editorial spread, not a banner.
//   • Categories as a compact icon grid (App Store launchpad style).
//   • Product grids use 2 cols mobile / 3 tablet / 4 desktop / 5 xl —
//     cards stay readable, lots of breathing room.
//   • Stories + Promo banner moved BELOW the hero (not above) so the
//     first thing the user sees is the brand + CTA, not secondary content.
//   • Hot Deals simplified — no timer, no pink background, just a header
//     + product grid. The "deals" badge on each card carries the urgency.
//   • Final CTA is a quiet, centered text link — not a giant button.
//
// Mobile is unchanged in spirit (single column, big touch targets) but
// inherits the cleaner rhythm.

interface HomeViewProps {
  onNavigate: (v: string) => void
  onOpenProduct: (id: string) => void
  onOpenSearch: () => void
  onOpenCategory?: (category: string) => void
}

export function HomeView({ onNavigate, onOpenProduct }: HomeViewProps) {
  const { data, loading } = useSmartBlocks()
  const { isVisible } = useHomeLayout()
  const [, setSelectedCategory] = useState<string | undefined>(undefined)

  const handleCategorySelect = useCallback((cat: string) => {
    haptic.tap()
    setSelectedCategory(cat)
    onNavigate('catalog')
  }, [onNavigate])

  const blocks = data?.blocks || []
  const getBlock = (id: string) => blocks.find((b) => b.id === id)?.items || []
  const popularItems = getBlock('popular').slice(0, 12)
  const newItems = getBlock('new').slice(0, 12)

  return (
    // v25.13: single max-width container — content stays centered and
    // readable on 1920px+ screens. On mobile the container is full-width
    // (px-4) and the max-w-7xl only kicks in at md+.
    <div className="px-4 md:px-6 lg:px-8 max-w-7xl mx-auto pb-28 md:pb-16 page-top-padding">
      {/* ─── 1. HERO ─────────────────────────────────────────────────── */}
      {isVisible('hero') && <HeroEditorial onNavigate={onNavigate} />}

      {/* ─── 2. CATEGORIES (App Store launchpad style) ───────────────── */}
      {isVisible('categories') && (
        <div className="mt-8 md:mt-12">
          <CategoryCards
            onSelect={handleCategorySelect}
            onOpenPrice={() => onNavigate('price')}
          />
        </div>
      )}

      {/* ─── 3. STORIES (compact horizontal strip) ───────────────────── */}
      {isVisible('stories') && (
        <div className="mt-8 md:mt-12">
          <Stories />
        </div>
      )}

      {/* ─── 4. PROMO BANNER (after stories, not before hero) ─────────── */}
      {isVisible('banner') && (
        <div className="mt-8 md:mt-12">
          <PromoBannerCarousel />
        </div>
      )}

      {/* ─── 5. HOT DEALS ─────────────────────────────────────────────── */}
      {isVisible('deals') && (
        <div className="mt-8 md:mt-12">
          <HotDealsSection
            onOpenProduct={onOpenProduct}
            onViewAll={() => onNavigate('catalog')}
          />
        </div>
      )}

      {/* ─── 6. RECENTLY VIEWED ───────────────────────────────────────── */}
      <div className="mt-8 md:mt-12">
        <RecentlyViewed onOpenProduct={onOpenProduct} />
      </div>

      {/* ─── 7. POPULAR ──────────────────────────────────────────────── */}
      {isVisible('popular') && (
        <div className="mt-8 md:mt-12">
          <SmartSection
            id="popular"
            title="Популярные товары"
            subtitle="Лучшие предложения месяца"
            icon={<Star className="h-5 w-5 md:h-6 md:w-6 text-white" strokeWidth={2.4} fill="currentColor" />}
            iconBg="bg-gradient-to-br from-[#F06292] to-[#EC407A] shadow-pink-500/30"
            items={popularItems}
            loading={loading}
            onOpenProduct={onOpenProduct}
            onViewAll={() => onNavigate('catalog')}
          />
        </div>
      )}

      {/* ─── 8. NEW ──────────────────────────────────────────────────── */}
      {isVisible('new') && (
        <div className="mt-8 md:mt-12">
          <SmartSection
            id="new"
            title="Новинки"
            subtitle="Свежее поступление товаров"
            icon={<Sparkles className="h-5 w-5 md:h-6 md:w-6 text-white" strokeWidth={2.4} />}
            iconBg="bg-gradient-to-br from-[#34D399] to-[#10B981] shadow-emerald-500/30"
            items={newItems}
            loading={loading}
            onOpenProduct={onOpenProduct}
            onViewAll={() => onNavigate('catalog')}
          />
        </div>
      )}

      {/* ─── 9. QUIET FOOTER LINK ────────────────────────────────────── */}
      {/* v25.13: replaced the loud gradient CTA button with a quiet
          centered text link — matches the editorial / premium feel of
          the new layout. The button was visually competing with the
          hero CTA above. */}
      <div className="mt-10 md:mt-14 text-center">
        <button
          onClick={() => { haptic.tap(); onNavigate('catalog') }}
          className="inline-flex items-center gap-2 text-sm md:text-base font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <LayoutGrid className="h-4 w-4" />
          Смотреть весь каталог
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
