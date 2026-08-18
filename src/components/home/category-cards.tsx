'use client'

import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { haptic } from '@/lib/haptic'
import { cn } from '@/lib/utils'
import { FileSpreadsheet } from 'lucide-react'

// v25.12: CategoryCards — 3 крупные карточки категорий + 1 карточка "Прайс".
// Layout: grid-cols-4 на мобильном (3 категории + прайс), grid-cols-4 на десктопе.
// Карточка "Прайс" открывает /?view=price.

interface Category {
  id: string
  name: string
  slug: string
  icon: string
  description?: string | null
  productsCount?: number
}

const CARD_STYLES: Record<string, { gradient: string; emoji: string; subtitle: string }> = {
  'Реклама': { gradient: 'from-[#FF8A65] to-[#FF7043]', emoji: '📣', subtitle: 'Брендирование от 10 шт' },
  'Подарки': { gradient: 'from-[#F06292] to-[#EC407A]', emoji: '🎁', subtitle: 'Эмоции в коробке' },
  'Мебель': { gradient: 'from-[#4DB6AC] to-[#26A69A]', emoji: '🪑', subtitle: '3D и AR-просмотр' },
  'Печать': { gradient: 'from-[#7C3AED] to-[#5B21B6]', emoji: '🖨️', subtitle: 'Полиграфия и печать' },
  'Дизайн': { gradient: 'from-[#A855F7] to-[#9333EA]', emoji: '🎨', subtitle: 'Графика и брендинг' },
  'Интерьер': { gradient: 'from-[#0EA5E9] to-[#0284C7]', emoji: '🏠', subtitle: 'Декор и интерьер' },
  'Наружная реклама': { gradient: 'from-[#F59E0B] to-[#D97706]', emoji: '🪧', subtitle: 'Биллборды и вывески' },
  'Полиграфия': { gradient: 'from-[#10B981] to-[#059669]', emoji: '📄', subtitle: 'Печать тиражей' },
}

// v25.12: Price card — always last in the grid
const PRICE_CARD = {
  gradient: 'from-[#10B981] to-[#059669]',
  emoji: '📊',
  subtitle: 'PDF, Word, картинки',
}

interface CategoryCardsProps {
  onSelect: (category: string) => void
  onOpenPrice?: () => void
}

export function CategoryCards({ onSelect, onOpenPrice }: CategoryCardsProps) {
  const [categories, setCategories] = useState<Category[]>([])

  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get<{ items: Category[] }>('/api/categories')
      .then((d) => setCategories((d.items || []).slice(0, 3)))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const showPriceCard = !!onOpenPrice

  // v25.12: don't render anything while loading — prevents the "Price card
  // flashes alone before categories load" issue at app startup.
  if (loading || categories.length === 0) return null

  return (
    <section className="px-4 pt-1">
      <div className={cn(
        'grid gap-2 md:gap-2.5',
        // v25.12: compact on desktop — many small cards, not few huge ones
        categories.length === 3 && showPriceCard
          ? 'grid-cols-4 md:grid-cols-8'
          : 'grid-cols-3 md:grid-cols-6'
      )}>
        {categories.map((cat) => {
          const style = CARD_STYLES[cat.name] || { gradient: 'from-[#9333EA] to-[#A02070]', emoji: '🏷️', subtitle: cat.description || 'Смотреть товары' }
          return (
            <button
              key={cat.id}
              onClick={() => { haptic.tap(); onSelect(cat.name) }}
              className={cn(
                'relative aspect-[4/3] rounded-xl p-2 text-left overflow-hidden',
                'bg-gradient-to-br text-white shadow-md hover:shadow-lg hover:-translate-y-0.5 transition-all',
                style.gradient,
              )}
            >
              <span className="absolute -top-1 -right-1 text-3xl md:text-3xl opacity-30 select-none">
                {style.emoji}
              </span>
              <div className="relative flex flex-col h-full justify-end">
                <h3 className="text-[11px] md:text-xs font-bold leading-tight">{cat.name}</h3>
                <p className="text-[7px] md:text-[8px] opacity-90 mt-0.5 line-clamp-1">{style.subtitle}</p>
              </div>
            </button>
          )
        })}

        {/* v25.12: Price card — same compact style */}
        {showPriceCard && (
          <button
            onClick={() => { haptic.tap(); onOpenPrice?.() }}
            className={cn(
              'relative aspect-[4/3] rounded-xl p-2 text-left overflow-hidden',
              'bg-gradient-to-br text-white shadow-md hover:shadow-lg hover:-translate-y-0.5 transition-all',
              PRICE_CARD.gradient,
            )}
          >
            <span className="absolute -top-1 -right-1 text-3xl md:text-3xl opacity-30 select-none">
              {PRICE_CARD.emoji}
            </span>
            <div className="relative flex flex-col h-full justify-end">
              <h3 className="text-[11px] md:text-xs font-bold leading-tight">Прайс</h3>
              <p className="text-[7px] md:text-[8px] opacity-90 mt-0.5 line-clamp-1">{PRICE_CARD.subtitle}</p>
            </div>
          </button>
        )}
      </div>
    </section>
  )
}
