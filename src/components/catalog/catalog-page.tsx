'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Search, SlidersHorizontal, X, ChevronLeft, ChevronRight, Grid2x2, List, Heart } from 'lucide-react'
import { api } from '@/lib/api'
import { ProductCard } from '../product-card'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { haptic } from '@/lib/haptic'
// v25.12: favorites store for "Избранное" filter
import { useFavoritesStore } from '@/lib/cart-store'
import type { Product } from '@/lib/types'

// v25.12: CatalogPage — точная реплика с IMG_3194.
// Промо-баннер + H1 + поиск + чипы категорий + панель (Фильтры/grid-list/Избранное) + grid 2 колонки.

interface CatalogPageProps {
  onOpenProduct: (id: string) => void
  initialCategory?: string
}

type SortOption = 'newest' | 'price-asc' | 'price-desc' | 'popular' | 'rating'

const SORT_LABELS: Record<SortOption, string> = {
  'newest': 'Новинки',
  'price-asc': 'Сначала дешевле',
  'price-desc': 'Сначала дороже',
  'popular': 'Популярные',
  'rating': 'По рейтингу',
}

const PAGE_SIZE = 24

interface Category {
  id: string
  name: string
  icon: string
  productsCount?: number
}

export function CatalogPage({ onOpenProduct, initialCategory }: CatalogPageProps) {
  const [products, setProducts] = useState<Product[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(0)
  const [categories, setCategories] = useState<Category[]>([])

  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<string | undefined>(initialCategory)
  const [sort, setSort] = useState<SortOption>('newest')
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [showFiltersMobile, setShowFiltersMobile] = useState(false)
  const [showFavorites, setShowFavorites] = useState(false)
  // v25.12: favorites store — when showFavorites is true, only show favorited products
  const favoriteIds = useFavoritesStore((s) => s.ids)

  // Filters state
  const [minPrice, setMinPrice] = useState('')
  const [maxPrice, setMaxPrice] = useState('')
  const [inStockOnly, setInStockOnly] = useState(false)
  const [hasDiscount, setHasDiscount] = useState(false)

  useEffect(() => {
    api.get<{ items: Category[] }>('/api/categories')
      .then((d) => setCategories(d.items || []))
      .catch(() => {})
  }, [])

  const [debouncedSearch, setDebouncedSearch] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 350)
    return () => clearTimeout(t)
  }, [search])

  // v25.12: random seed on initial load — products are shuffled differently each time
  const [refreshSeed, setRefreshSeed] = useState(() => Math.floor(Math.random() * 1000000))

  const query = useMemo(() => ({
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
    q: debouncedSearch || undefined,
    category,
    sort,
    minPrice: minPrice || undefined,
    maxPrice: maxPrice || undefined,
    inStockOnly: inStockOnly ? 'true' : undefined,
    hasDiscount: hasDiscount ? 'true' : undefined,
    // v25.12: shuffle seed rotates on pull-to-refresh so products change order
    ...(refreshSeed > 0 ? { shuffle: 1, seed: refreshSeed } : {}),
  }), [page, debouncedSearch, category, sort, minPrice, maxPrice, inStockOnly, hasDiscount, refreshSeed])

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const d = await api.get<{ items: Product[]; total: number }>('/api/products', { query })
      setProducts(d.items || [])
      setTotal(d.total || 0)
    } catch {
      setProducts([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [query])

  useEffect(() => { refresh() }, [refresh])
  useEffect(() => { setPage(0) }, [debouncedSearch, category, sort, minPrice, maxPrice, inStockOnly, hasDiscount])

  // v25.12: pull-to-refresh — new shuffle seed so products change order
  useEffect(() => {
    const onRefresh = () => { setRefreshSeed(Math.floor(Math.random() * 1000000)) }
    window.addEventListener('999pro:refresh', onRefresh as EventListener)
    return () => window.removeEventListener('999pro:refresh', onRefresh as EventListener)
  }, [])

  const totalPages = Math.ceil(total / PAGE_SIZE)
  const hasActiveFilters = !!(search || category || minPrice || maxPrice || inStockOnly || hasDiscount)

  // v25.12: when showFavorites is true, filter products to only favorited ones
  const displayProducts = showFavorites
    ? products.filter((p) => favoriteIds.includes(p.id))
    : products

  const clearFilters = () => {
    haptic.tap()
    setSearch('')
    setCategory(undefined)
    setMinPrice('')
    setMaxPrice('')
    setInStockOnly(false)
    setHasDiscount(false)
    setSort('newest')
  }

  const FiltersContent = () => (
    <div className="space-y-5">
      <div>
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 block">Поиск</label>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Название, артикул, описание…"
            className="w-full h-10 pl-9 pr-3 rounded-full bg-muted border border-transparent outline-none focus:border-primary/40 focus:bg-card transition-all text-sm"
          />
        </div>
      </div>

      <div>
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 block">Цена</label>
        <div className="flex items-center gap-2">
          <input type="number" value={minPrice} onChange={(e) => setMinPrice(e.target.value)} placeholder="от" className="w-full h-10 px-3 rounded-lg bg-muted border border-transparent outline-none focus:border-primary/40 focus:bg-card transition-all text-sm" />
          <span className="text-muted-foreground">—</span>
          <input type="number" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} placeholder="до" className="w-full h-10 px-3 rounded-lg bg-muted border border-transparent outline-none focus:border-primary/40 focus:bg-card transition-all text-sm" />
        </div>
      </div>

      <div className="space-y-2">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={inStockOnly} onChange={(e) => setInStockOnly(e.target.checked)} className="h-4 w-4 rounded accent-[#A02070]" />
          <span className="text-sm">Только в наличии</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={hasDiscount} onChange={(e) => setHasDiscount(e.target.checked)} className="h-4 w-4 rounded accent-[#A02070]" />
          <span className="text-sm">Со скидкой</span>
        </label>
      </div>

      {hasActiveFilters && (
        <Button variant="outline" onClick={clearFilters} className="w-full rounded-full">
          <X className="h-4 w-4 mr-1" /> Сбросить фильтры
        </Button>
      )}
    </div>
  )

  return (
    <div className="pb-28 md:pb-12 page-top-padding">
      {/* H1 Header */}
      <div className="px-4 md:px-6 pt-4 md:pt-6 pb-3">
        <div className="max-w-[1440px] mx-auto">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
            <Grid2x2 className="h-3.5 w-3.5" />
            <span>Каталог</span>
          </div>
          <h1 className="text-2xl md:text-4xl font-extrabold tracking-tight text-foreground">
            Все товары
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {total > 0 ? `${total} ${pluralize(total, 'товар', 'товара', 'товаров')}` : 'Загрузка…'}
          </p>
        </div>
      </div>

      {/* Search bar */}
      <div className="px-4 md:px-6 pb-3">
        <div className="max-w-[1440px] mx-auto">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск по названию, артикулу, описанию"
              className="w-full h-12 pl-11 pr-4 rounded-full bg-muted border border-transparent outline-none focus:border-primary/40 focus:bg-card transition-all text-sm"
            />
          </div>
        </div>
      </div>

      {/* Categories chips */}
      <div className="pb-3">
        <div className="max-w-[1440px] mx-auto px-4 md:px-6">
          <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1">
            <button
              onClick={() => setCategory(undefined)}
              className={cn(
                'shrink-0 inline-flex items-center gap-1.5 h-9 px-4 rounded-full text-sm font-medium transition-all border',
                !category
                  ? 'bg-primary text-primary-foreground border-primary shadow-md'
                  : 'bg-card text-card-foreground border-border hover:border-primary/40',
              )}
            >
              <Grid2x2 className="h-3.5 w-3.5" />
              Все
            </button>
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setCategory(cat.name)}
                className={cn(
                  'shrink-0 inline-flex items-center gap-1.5 h-9 px-4 rounded-full text-sm font-medium transition-all border',
                  category === cat.name
                    ? 'bg-primary text-primary-foreground border-primary shadow-md'
                    : 'bg-card text-card-foreground border-border hover:border-primary/40',
                )}
              >
                {cat.name}
                {cat.productsCount !== undefined && cat.productsCount > 0 && (
                  <span className="text-[10px] opacity-70 tabular-nums">{cat.productsCount}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Filter bar: Фильтры / grid-list toggle / Избранное */}
      <div className="px-4 md:px-6 pb-3">
        <div className="max-w-[1440px] mx-auto flex items-center justify-between gap-3">
          <button
            onClick={() => setShowFiltersMobile(true)}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-full bg-card border border-border text-sm font-medium text-foreground hover:border-primary/40"
          >
            <SlidersHorizontal className="h-4 w-4" />
            <span className="hidden sm:inline">Фильтры</span>
            {hasActiveFilters && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
          </button>

          {/* Desktop sort */}
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortOption)}
            className="hidden md:block h-9 px-3 rounded-full bg-card border border-border text-sm font-medium outline-none cursor-pointer"
          >
            {(Object.keys(SORT_LABELS) as SortOption[]).map((s) => (
              <option key={s} value={s}>{SORT_LABELS[s]}</option>
            ))}
          </select>

          <div className="flex items-center gap-2">
            {/* View mode toggle */}
            <div className="flex items-center bg-card border border-border rounded-full p-0.5">
              <button
                onClick={() => setViewMode('grid')}
                className={cn('h-8 w-8 rounded-full grid place-items-center transition-all', viewMode === 'grid' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}
                aria-label="Сетка"
              >
                <Grid2x2 className="h-4 w-4" />
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={cn('h-8 w-8 rounded-full grid place-items-center transition-all', viewMode === 'list' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}
                aria-label="Список"
              >
                <List className="h-4 w-4" />
              </button>
            </div>

            {/* Favorites button */}
            <button
              onClick={() => { haptic.tap(); setShowFavorites(!showFavorites) }}
              className={cn(
                'inline-flex items-center gap-1.5 h-9 px-3 rounded-full border text-sm font-medium transition-all',
                showFavorites
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-card text-card-foreground border-border hover:border-primary/40',
              )}
            >
              <Heart className="h-4 w-4" fill={showFavorites ? 'currentColor' : 'none'} />
              <span className="hidden sm:inline">Избранное</span>
            </button>
          </div>
        </div>
      </div>

      {/* Grid */}
      <div className="px-4 md:px-6">
        <div className="max-w-[1440px] mx-auto">
          {loading ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="rounded-xl bg-card shadow-sm overflow-hidden">
                  <div className="aspect-[3/4] skeleton" />
                  <div className="p-3 space-y-2">
                    <div className="h-3 w-3/4 rounded skeleton" />
                    <div className="h-3 w-1/2 rounded skeleton" />
                    <div className="h-5 w-1/3 rounded skeleton" />
                  </div>
                </div>
              ))}
            </div>
          ) : displayProducts.length === 0 ? (
            <div className="py-20 text-center">
              <div className="h-20 w-20 rounded-full bg-muted grid place-items-center mx-auto mb-4">
                {showFavorites ? (
                  <Heart className="h-10 w-10 text-muted-foreground" />
                ) : (
                  <Search className="h-10 w-10 text-muted-foreground" />
                )}
              </div>
              <h3 className="text-lg font-bold mb-1">
                {showFavorites ? 'В избранном пока пусто' : 'Ничего не найдено'}
              </h3>
              <p className="text-sm text-muted-foreground mb-4">
                {showFavorites
                  ? 'Нажмите ♥ на товаре, чтобы добавить его в избранное'
                  : 'Попробуйте изменить фильтры или поисковый запрос'}
              </p>
              {showFavorites ? (
                <Button onClick={() => setShowFavorites(false)} variant="outline" className="rounded-full">
                  Показать все товары
                </Button>
              ) : hasActiveFilters ? (
                <Button onClick={clearFilters} variant="outline" className="rounded-full">Сбросить фильтры</Button>
              ) : null}
            </div>
          ) : viewMode === 'grid' ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4">
              {displayProducts.map((p) => (
                <ProductCard key={p.id} product={p} onOpen={onOpenProduct} />
              ))}
            </div>
          ) : (
            /* v25.12: list view — 1 col on mobile, 2-3 cols on desktop (not huge single col) */
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
              {displayProducts.map((p) => (
                <ProductCard key={p.id} product={p} onOpen={onOpenProduct} variant="compact" />
              ))}
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-8">
              <button
                onClick={() => { haptic.tap(); setPage((p) => Math.max(0, p - 1)); window.scrollTo({ top: 0, behavior: 'smooth' }) }}
                disabled={page === 0}
                className="h-10 w-10 rounded-full bg-card border border-border grid place-items-center disabled:opacity-30 hover:border-primary/40 transition-colors"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="text-sm font-medium tabular-nums px-3">{page + 1} / {totalPages}</span>
              <button
                onClick={() => { haptic.tap(); setPage((p) => Math.min(totalPages - 1, p + 1)); window.scrollTo({ top: 0, behavior: 'smooth' }) }}
                disabled={page >= totalPages - 1}
                className="h-10 w-10 rounded-full bg-card border border-border grid place-items-center disabled:opacity-30 hover:border-primary/40 transition-colors"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Mobile filters modal */}
      {showFiltersMobile && (
        <div className="fixed inset-0 z-[400] md:hidden flex items-end">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowFiltersMobile(false)} />
          <div className="relative w-full bg-card rounded-t-3xl max-h-[85vh] overflow-y-auto">
            <div className="sticky top-0 bg-card px-4 py-3 border-b border-border flex items-center justify-between">
              <h3 className="font-semibold">Фильтры</h3>
              <button onClick={() => setShowFiltersMobile(false)} className="h-8 w-8 rounded-full hover:bg-muted grid place-items-center">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-4">
              <FiltersContent />
              {/* Mobile sort */}
              <div className="mt-5">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 block">Сортировка</label>
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as SortOption)}
                  className="w-full h-10 px-3 rounded-lg bg-muted border border-transparent outline-none focus:border-primary/40 focus:bg-card text-sm font-medium"
                >
                  {(Object.keys(SORT_LABELS) as SortOption[]).map((s) => (
                    <option key={s} value={s}>{SORT_LABELS[s]}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="sticky bottom-0 bg-card p-4 border-t border-border">
              <Button onClick={() => setShowFiltersMobile(false)} className="w-full bg-primary hover:bg-primary/90 text-primary-foreground rounded-full h-11">
                Показать {total} {pluralize(total, 'товар', 'товара', 'товаров')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function pluralize(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few
  return many
}
