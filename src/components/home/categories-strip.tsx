'use client'

import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Folder } from 'lucide-react'

// v25.11: CategoriesStrip — horizontal scrollable category pills.
// Replaces the old PROJECT_CATEGORIES chips in ProductsGrid.
// Reads from /api/categories (DB-backed, admin-managed).

interface Category {
  id: string
  name: string
  slug: string
  icon: string
  productsCount?: number
}

interface CategoriesStripProps {
  onSelect: (category: string) => void
  selected?: string
}

export function CategoriesStrip({ onSelect, selected }: CategoriesStripProps) {
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    api.get<{ items: Category[] }>('/api/categories')
      .then((d) => {
        if (alive) setCategories(d.items || [])
      })
      .catch(() => {
        if (alive) setCategories([])
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => { alive = false }
  }, [])

  // Live refresh
  useEffect(() => {
    const onCatsChanged = () => {
      api.get<{ items: Category[] }>('/api/categories')
        .then((d) => setCategories(d.items || []))
        .catch(() => {})
    }
    window.addEventListener('999pro:categories-changed', onCatsChanged as EventListener)
    return () => window.removeEventListener('999pro:categories-changed', onCatsChanged as EventListener)
  }, [])

  if (loading) {
    return (
      <div className="px-4 md:px-6 py-1.5">
        <div className="flex gap-2 overflow-x-auto no-scrollbar">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-10 w-24 rounded-full skeleton shrink-0" />
          ))}
        </div>
      </div>
    )
  }

  if (categories.length === 0) return null

  return (
    <div className="px-4 md:px-6 py-1.5">
      <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1">
        {categories.map((cat) => {
          const isActive = selected === cat.name
          return (
            <button
              key={cat.id}
              onClick={() => onSelect(cat.name)}
              className={cn(
                'shrink-0 inline-flex items-center gap-2 h-10 px-4 rounded-full text-sm font-medium transition-all',
                isActive
                  ? 'gradient-brand text-white shadow-glow'
                  : 'glass text-muted-foreground hover:text-foreground hover:bg-foreground/5',
              )}
            >
              <Folder className="h-4 w-4 opacity-70" />
              {cat.name}
              {cat.productsCount !== undefined && cat.productsCount > 0 && (
                <span className="text-[10px] opacity-60 tabular-nums">
                  {cat.productsCount}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
