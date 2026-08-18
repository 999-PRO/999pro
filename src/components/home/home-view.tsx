'use client'

import { useState, useCallback } from 'react'
import { Star, Sparkles, LayoutGrid } from 'lucide-react'
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

// v25.12: HomeView — точная реплика дизайна с IMG_3191 + IMG_3192.
//
// Структура (сверху вниз):
//   1. HeroEditorial — светло-розовый hero с AI-бейджем + H1 + 2 CTA + 3 фичи
//   2. CategoryCards — 3 цветные карточки (Реклама/Подарки/Мебель)
//   3. HotDealsSection — "Горячие скидки" с таймером + карусель
//   4. AIAssistantSection — встроенный чат с Зои
//   5. RecentlyViewed — недавно просмотренные
//   6. Stories (если включены)
//   7. PromoBannerCarousel (если включён)
//   8. Smart sections: Популярные + Новинки
//   9. CTA "Смотреть весь каталог"

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
    <div className="pb-28 md:pb-12 page-top-padding">
      {/* 1. Hero */}
      {isVisible('hero') && <HeroEditorial onNavigate={onNavigate} />}

      {/* 2. Promo banner — v25.12: moved to top, right after Hero */}
      {isVisible('banner') && (
        <div className="py-0.5">
          <PromoBannerCarousel />
        </div>
      )}

      {/* 3. Stories — v25.12: moved up, right after banner */}
      {isVisible('stories') && (
        <div className="py-0.5">
          <Stories />
        </div>
      )}

      {/* 4. Categories + Price card */}
      {isVisible('categories') && (
        <CategoryCards
          onSelect={handleCategorySelect}
          onOpenPrice={() => onNavigate('price')}
        />
      )}

      {/* 5. Hot Deals with timer */}
      {isVisible('deals') && (
        <HotDealsSection
          onOpenProduct={onOpenProduct}
          onViewAll={() => onNavigate('catalog')}
        />
      )}

      {/* v25.12: AI Assistant (Зои) removed from home page per user request */}

      {/* 6. Recently viewed */}
      <RecentlyViewed onOpenProduct={onOpenProduct} />

      {/* 8. Smart sections — Популярные + Новинки */}
      {isVisible('popular') && (
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
      )}

      {isVisible('new') && (
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
      )}

      {/* 9. CTA — Open full catalog */}
      <section className="px-4 md:px-6 py-4 md:py-5">
        <Button
          onClick={() => { haptic.tap(); onNavigate('catalog') }}
          className="w-full h-12 md:h-13 rounded-full gradient-brand text-white font-bold shadow-glow hover:scale-[1.01] active:scale-95 transition-transform"
        >
          <LayoutGrid className="h-5 w-5 mr-2" />
          Смотреть весь каталог
        </Button>
      </section>
    </div>
  )
}
