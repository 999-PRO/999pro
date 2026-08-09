'use client'

import { useEffect, useState, useMemo } from 'react'
import { api } from '@/lib/api'
import type { Product } from '@/lib/types'
import { ProductCard } from './product-card'
import { cn } from '@/lib/utils'
import { Search } from 'lucide-react'
import { usePullToRefreshSubscription } from './pull-to-refresh'

// Project categories (always visible, never disappear after selection).
export const PROJECT_CATEGORIES = [
  'Реклама',
  'Подарки',
  'Мебель',
  'Печать',
  'Дизайн',
  'Интерьер',
  'Наружная реклама',
  'Полиграфия',
] as const

export function ProductsGrid({
  endpoint = '/api/products',
  limit = 12,
  title = 'Популярные товары',
  subtitle,
  showCategories = false,
  initialCategory,
  limitToProjectCategories = false,
  onOpenProduct,
  hideWhenEmpty = false,
  // "Live" mode: when true, the grid uses a session-seed that rotates every
  // few minutes. The seed is appended to the endpoint URL as
  // ?shuffle=1&seed=N — the backend uses a deterministic PRNG (Mulberry32)
  // so the same seed always yields the same order.
  live = false,
  // Optional seed offset — different sections on the same page use different
  // offsets so they don't all shuffle identically.
  seedOffset = 0,
}: {
  endpoint?: string
  limit?: number
  title?: string
  subtitle?: string
  showCategories?: boolean
  initialCategory?: string
  /** When true, products that don't match any of PROJECT_CATEGORIES are hidden. */
  limitToProjectCategories?: boolean
  onOpenProduct?: (id: string) => void
  /** When true, the whole section is hidden if no products match (used for
      curated blocks like Акция/Новинка/Рекомендуем — empty block shouldn't
      show a placeholder). */
  hideWhenEmpty?: boolean
  /** Enable live shuffle mode (rotating seed). */
  live?: boolean
  /** Seed offset so multiple live grids on the same page don't shuffle identically. */
  seedOffset?: number
}) {
  const [items, setItems] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [category, setCategory] = useState<string | undefined>(initialCategory)
  // v12.7: sort + search
  const [sortBy, setSortBy] = useState<'newest' | 'price-asc' | 'price-desc' | 'popular'>('newest')
  const [searchQuery, setSearchQuery] = useState('')

  // ----- "Live" seed management -----
  // The seed is generated ONCE per page load (via useState initializer) so:
  //   - Every page reload → new random seed → DIFFERENT product order
  //   - Within a single session (scrolling, navigating) → same seed → stable order
  //   - Pull To Refresh → new seed → new order on demand
  // v12.6: the manual shuffle button has been removed. Refresh is now via
  // Pull To Refresh, which calls `setManualSeed` to force a new shuffle.
  const [manualSeed, setManualSeed] = useState<number>(0)
  // Generate a per-page-load random seed. The initializer function runs
  // only once when the component first mounts, so the seed stays stable
  // for the lifetime of the page session.
  const [pageSeed] = useState<number>(() => Math.floor(Math.random() * 1_000_000_000))
  const sessionSeed = useMemo(() => {
    return pageSeed + seedOffset + manualSeed
  }, [pageSeed, seedOffset, manualSeed])

  // Fetch the exact number we need. Backend handles filtering + shuffle.
  useEffect(() => {
    let alive = true
    setLoading(true)
    const fetchLimit = showCategories ? 100 : Math.max(limit, 12)
    const query: Record<string, string | number | boolean | undefined> = {
      limit: fetchLimit,
    }
    if (live) {
      query.shuffle = 1
      query.seed = sessionSeed
    }
    api
      .get<{ items: Product[] }>(endpoint, { query })
      .then((d) => alive && setItems(d.items))
      .catch(() => alive && setItems([]))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [endpoint, limit, showCategories, live, sessionSeed])

  // v12.6: Pull To Refresh subscription. Regenerates the manual seed (which
  // changes sessionSeed, which triggers the useEffect above to refetch with
  // a new shuffle order). The PTR indicator stays visible until the fetch
  // resolves. We wait for the fetch via a small Promise that resolves after
  // the next render cycle when `items` updates.
  usePullToRefreshSubscription(async () => {
    setManualSeed((s) => s + Math.floor(Math.random() * 1_000_000) + 1)
    // Wait one tick for the new seed to trigger the fetch, then a short
    // delay so the spinner is visible for at least a moment.
    await new Promise((r) => setTimeout(r, 350))
  }, [])

  // v25.9 fix: listen for Studio-driven product changes. When the backend
  // broadcasts `products:changed` (after a Studio save), `use-socket.ts`
  // forwards it as a `999pro:products-changed` window event. Bump the seed
  // so the useEffect above refetches with fresh data. Previously this grid
  // only refreshed on manual pull-to-refresh.
  useEffect(() => {
    const handler = () => {
      setManualSeed((s) => s + Math.floor(Math.random() * 1_000_000) + 1)
    }
    window.addEventListener('999pro:products-changed', handler)
    return () => window.removeEventListener('999pro:products-changed', handler)
  }, [])

  // Client-side category filter + search + sort (when showCategories is true).
  const filtered = useMemo(() => {
    let out = items
    if (limitToProjectCategories) {
      const allowed = new Set<string>(PROJECT_CATEGORIES)
      out = out.filter((p) => p.category && allowed.has(p.category))
    }
    if (category) {
      out = out.filter((p) => p.category === category)
    }
    // v12.7: search filter
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase()
      out = out.filter((p) =>
        p.title.toLowerCase().includes(q) ||
        (p.description || '').toLowerCase().includes(q) ||
        (p.category || '').toLowerCase().includes(q),
      )
    }
    // v12.7: sort
    const sorted = [...out]
    switch (sortBy) {
      case 'price-asc':
        sorted.sort((a, b) => a.price - b.price)
        break
      case 'price-desc':
        sorted.sort((a, b) => b.price - a.price)
        break
      case 'popular':
        sorted.sort((a, b) => (b.purchases || 0) - (a.purchases || 0) || (b.isPopular ? 1 : 0) - (a.isPopular ? 1 : 0))
        break
      case 'newest':
      default:
        sorted.sort((a, b) => {
          const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0
          const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0
          return bTime - aTime
        })
        break
    }
    return sorted.slice(0, limit)
  }, [items, category, limit, limitToProjectCategories, searchQuery, sortBy])

  // Available categories — intersection of project categories and what's in DB
  const availableCategories = useMemo(() => {
    const present = new Set(items.map((p) => p.category).filter(Boolean) as string[])
    return PROJECT_CATEGORIES.filter((c) => present.has(c))
  }, [items])

  // Hide the whole section if hideWhenEmpty is set and there are no products
  // (and we're not loading).
  if (hideWhenEmpty && !loading && filtered.length === 0) return null

  return (
    <section className="px-4 md:px-6 py-6 pb-28 md:pb-6">
      <div className="flex items-end justify-between gap-4 mb-4">
        <div>
          <h2 className="text-xl md:text-2xl font-bold tracking-tight flex items-center gap-2">
            {title}
          </h2>
          {subtitle && <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
      </div>

      {/* Categories — always visible, stays put after selection */}
      {showCategories && (
        <div className="no-scrollbar flex gap-2 overflow-x-auto pb-3 -mx-1 px-1 sticky z-10" style={{ top: 'calc(env(safe-area-inset-top, 0px) + 4.5rem + 1px)' }}>
          <button
            onClick={() => setCategory(undefined)}
            className={cn(
              'shrink-0 px-4 py-2 rounded-full text-sm font-medium transition-all',
              !category
                ? 'gradient-brand text-white shadow-glow'
                : 'glass text-muted-foreground hover:text-foreground',
            )}
          >
            Все
          </button>
          {PROJECT_CATEGORIES.map((c) => {
            const disabled = availableCategories.length > 0 && !availableCategories.includes(c)
            return (
              <button
                key={c}
                onClick={() => !disabled && setCategory(c)}
                disabled={disabled}
                className={cn(
                  'shrink-0 px-4 py-2 rounded-full text-sm font-medium transition-all',
                  category === c
                    ? 'gradient-brand text-white shadow-glow'
                    : 'glass text-muted-foreground hover:text-foreground',
                  disabled && 'opacity-40 cursor-not-allowed',
                )}
                title={disabled ? 'В этой категории пока нет товаров' : c}
              >
                {c}
              </button>
            )
          })}
        </div>
      )}

      {/* v12.7: Search + Sort bar */}
      {showCategories && (
        <div className="flex gap-2 mb-3">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Поиск товаров…"
              className="w-full h-10 rounded-xl glass border border-border/40 pl-9 pr-3 text-sm"
            />
          </div>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            className="h-10 rounded-xl glass border border-border/40 px-3 text-sm font-medium"
          >
            <option value="newest">Новинки</option>
            <option value="price-asc">Сначала дешевле</option>
            <option value="price-desc">Сначала дороже</option>
            <option value="popular">Популярные</option>
          </select>
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3 md:gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="rounded-3xl overflow-hidden glass">
              <div className="aspect-square skeleton" />
              <div className="p-4 space-y-2">
                <div className="h-4 w-3/4 rounded skeleton" />
                <div className="h-3 w-1/2 rounded skeleton" />
                <div className="h-8 w-full rounded-full skeleton" />
              </div>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-16 text-center">
          <div className="text-4xl mb-2">🛍️</div>
          <p className="text-muted-foreground">
            {category ? `В категории «${category}» пока нет товаров` : 'Товары не найдены'}
          </p>
          {category && (
            <button
              onClick={() => setCategory(undefined)}
              className="mt-3 text-sm text-primary font-semibold hover:underline"
            >
              Показать все товары
            </button>
          )}
        </div>
      ) : (
        <div
          key={live ? sessionSeed : 'static'}
          className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3 md:gap-4"
        >
          {filtered.map((p) => (
            <ProductCard key={p.id} product={p} onOpen={onOpenProduct} />
          ))}
        </div>
      )}
    </section>
  )
}
