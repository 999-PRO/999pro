'use client'

import { motion } from 'framer-motion'
import { ArrowRight } from 'lucide-react'
import { ProductCard } from '../product-card'
import { cn } from '@/lib/utils'
import type { Product } from '@/lib/types'

// v25.11: SmartSection — universal product section for the home page.
// Replaces the old SmartBlocks (10 separate blocks) and DesktopHome's
// SmartSection (3 hardcoded blocks).
//
// Layout:
//   - Mobile: horizontal scrollable carousel (snap-x)
//   - Desktop (md+): responsive grid (4 cols on lg, 5 on xl, 6 on 2xl)
//
// Header: gradient icon + title + subtitle + optional "Смотреть все" link.
// Used for 4 main sections: Hits, Popular, Deals, New.

interface SmartSectionProps {
  id: string
  title: string
  subtitle?: string
  icon?: React.ReactNode
  iconBg?: string
  items: Product[]
  loading?: boolean
  onOpenProduct: (id: string) => void
  onViewAll?: () => void
}

export function SmartSection({
  title,
  subtitle,
  icon,
  iconBg,
  items,
  loading,
  onOpenProduct,
  onViewAll,
}: SmartSectionProps) {
  if (!loading && items.length === 0) return null

  return (
    // v25.13: section has NO horizontal padding — the parent home-view.tsx
    // container provides px-4/md:px-6/lg:px-8 + max-w-7xl. Adding px-* here
    // would cause double-padding (visible gap inside the section).
    <section className="py-1 md:py-2">
      {/* Header */}
      <div className="flex items-end justify-between gap-4 mb-1.5 md:mb-2">
        <div className="flex items-center gap-3 min-w-0">
          {icon && (
            <div className={cn(
              'h-10 w-10 md:h-12 md:w-12 rounded-2xl grid place-items-center shrink-0 shadow-lg',
              iconBg || 'bg-gradient-to-br from-blue-500 to-indigo-500 shadow-blue-500/30',
            )}>
              {icon}
            </div>
          )}
          <div className="min-w-0">
            <h2 className="text-lg md:text-2xl font-bold tracking-tight truncate">
              {title}
            </h2>
            {subtitle && (
              <p className="text-xs md:text-sm text-muted-foreground mt-0.5 truncate">
                {subtitle}
              </p>
            )}
          </div>
        </div>
        {onViewAll && (items.length > 0 || loading) && (
          <button
            onClick={onViewAll}
            className="shrink-0 inline-flex items-center gap-1 text-xs md:text-sm font-semibold text-primary hover:underline"
          >
            Смотреть все
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Loading skeleton */}
      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-xl overflow-hidden glass">
              <div className="aspect-[3/4] skeleton" />
              <div className="p-3 space-y-2">
                <div className="h-4 w-3/4 rounded skeleton" />
                <div className="h-3 w-1/2 rounded skeleton" />
                <div className="h-8 w-full rounded-full skeleton" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* v25.13 (desktop redesign): tighter column count for premium feel.
           Old grid was 2/4/5/6 cols — felt crowded on desktop with 6 cols
           at 1920px width. New: 2 mobile / 3 tablet / 4 desktop / 5 xl.
           Cards stay readable with generous whitespace between them. */
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 md:gap-4">
          {items.map((p) => (
            <ProductCard key={p.id} product={p} onOpen={onOpenProduct} />
          ))}
        </div>
      )}
    </section>
  )
}
