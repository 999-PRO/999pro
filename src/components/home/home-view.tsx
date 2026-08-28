'use client'

import { useCallback, useMemo } from 'react'
import { Star, Sparkles, LayoutGrid, ArrowRight } from 'lucide-react'
import type { Product } from '@/lib/types'
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

// ============================================================================
// v25.16 — ГЛАВНАЯ РЕНДЕРИТСЯ В ПОРЯДКЕ ИЗ СТУДИИ.
//
// Owner bug report: «в студии некоторые функции не работают — я когда
// переставляю местами блоки и так далее». Раньше home-view рендерил секции
// в ЖЁСТКО зашитом порядке (hero → categories → …), а из настроек бралась
// только видимость (isVisible) — порядок из Студии игнорировался полностью,
// а блок «ИИ-агент» вообще нигде не рендерился.
//
// Теперь:
//   • Порядок секций = сохранённый layout (пиновые — первыми, затем по order).
//   • Каждый блок id имеет свой компонент в BLOCK_RENDERERS ниже.
//   • Правки порядка/видимости в Студии применяются мгновенно (см.
//     999pro:settings-changed → fetchLayout в use-home-layout.ts).
//
// Layout structure: полнокрайние band'ы (сторис/баннеры) остаются
// full-bleed на мобиле независимо от позиции в порядке; остальное — в
// ритме max-w-7xl с внутренними отступами.
// ============================================================================

interface HomeViewProps {
  onNavigate: (v: string) => void
  onOpenProduct: (id: string) => void
  onOpenSearch: () => void
  onOpenCategory?: (category: string) => void
}

/** ID блоков, которые должны рендериться full-bleed (без px-колонки). */
const FULL_BLEED_IDS = new Set(['stories', 'banner'])

// v25.20 (owner): «блок ИИ-агента между товарами на главной — убрать
// полностью» (кнопка справа над навигацией остаётся). Если в сохранённом
// layout он ещё есть — не рендерим и его.
const REMOVED_BLOCK_IDS = new Set(['ai-assistant'])

export function HomeView({ onNavigate, onOpenProduct, onOpenCategory }: HomeViewProps) {
  const { data, loading } = useSmartBlocks()
  // v25.16: полный layout (не только isVisible) — сортированный порядок блоков.
  const { layout } = useHomeLayout()

  const handleCategorySelect = useCallback((cat: string) => {
    haptic.tap()
    if (onOpenCategory) {
      onOpenCategory(cat)
    } else {
      onNavigate('catalog')
    }
  }, [onNavigate, onOpenCategory])

  const blocks = data?.blocks || []
  const getBlock = (id: string) => blocks.find((b) => b.id === id)?.items || []
  const popularItems = getBlock('popular').slice(0, 12)
  const newItems = getBlock('new').slice(0, 12)

  // Порядок отображения: pinned-блоки всегда первее, внутри групп — по order.
  const orderedIds = useMemo(() => {
    const visible = layout.filter((b) => b.visible && !REMOVED_BLOCK_IDS.has(b.id))
    return [...visible].sort((a, b) => Number(b.pinned ?? false) - Number(a.pinned ?? false) || a.order - b.order).map((b) => b.id)
  }, [layout])

  return (
    <div className="pb-28 md:pb-16 page-top-padding">
      {/* ═══ ДИНАМИЧЕСКИЙ ПОРЯДОК БЛОКОВ (управляется в Студии) ═══ */}
      {orderedIds.map((id) => {
        if (FULL_BLEED_IDS.has(id)) {
          return (
            <div key={id} className="mt-6 md:mt-10 md:max-w-7xl md:mx-auto">
              <BandRenderer id={id} />
            </div>
          )
        }
        // v25.17 (owner: «убрал совсем все отступы по краям товара… в
        // каталоге должны быть отступы по краям»): px-контейнер применялся
        // ТОЛЬКО к первой секции — все последующие (категории, товары,
        // скидки) прилипали к краям экрана. Теперь КАЖДАЯ column-секция
        // рендерится в одном и том же px + max-w контейнере, вертикальный
        // ритм между секциями сохранён.
        return (
          <div
            key={id}
            className="px-4 md:px-6 lg:px-8 max-w-7xl mx-auto mt-8 first:mt-0 md:mt-12 md:first:mt-0"
          >
            <ColumnRenderer
              id={id}
              onNavigate={onNavigate}
              onOpenProduct={onOpenProduct}
              onCategorySelect={handleCategorySelect}
              popularItems={popularItems}
              newItems={newItems}
              loading={loading}
            />
          </div>
        )
      })}

      {/* QUIET FOOTER LINK */}
      <div className="px-4 md:px-6 lg:px-8 max-w-7xl mx-auto mt-10 md:mt-14 text-center">
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

/* ---------- band (full-bleed) sections ---------- */

function BandRenderer({ id }: { id: string }) {
  if (id === 'stories') return <Stories />
  if (id === 'banner') return <PromoBannerCarousel />
  return null
}

/* ---------- column (padded) sections ---------- */

function ColumnRenderer({
  id,
  onNavigate,
  onOpenProduct,
  onCategorySelect,
  popularItems,
  newItems,
  loading,
}: {
  id: string
  onNavigate: (v: string) => void
  onOpenProduct: (id: string) => void
  onCategorySelect: (cat: string) => void
  popularItems: Product[]
  newItems: Product[]
  loading: boolean
}) {
  switch (id) {
    case 'hero':
      return <HeroEditorial onNavigate={onNavigate} />

    case 'categories':
      return <CategoryCards onSelect={onCategorySelect} onOpenPrice={() => onNavigate('price')} onOpenGames={() => onNavigate('games')} />

    case 'deals':
      return (
        <HotDealsSection
          onOpenProduct={onOpenProduct}
          onViewAll={() => onNavigate('catalog')}
        />
      )

    case 'recently-viewed':
      return <RecentlyViewed onOpenProduct={onOpenProduct} />

    case 'popular':
      return popularItems.length > 0 || loading ? (
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
      ) : null

    case 'new':
      return newItems.length > 0 || loading ? (
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
      ) : null

    default:
      return null
  }
}
