'use client'

import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { motion } from 'framer-motion'
import { Flame, Star, Heart, Sparkles, TrendingUp, MessageCircle, Crown, Gift, Diamond, Zap } from 'lucide-react'
import { api } from '@/lib/api'
import type { Product } from '@/lib/types'
import { ProductCard } from './product-card'
import { cn } from '@/lib/utils'
import { usePullToRefreshSubscription } from './pull-to-refresh'

// ============================================================================
//  SmartBlocks — fetches all 10 home-page smart blocks in ONE API call and
//  renders each as its own carousel section. Replaces the old HomeView
//  pattern of 5 separate <ProductsGrid> components, each making its own
//  network request.
//
//  Why one call instead of 10?
//    - Fewer round-trips (1 vs 10) → faster first paint on slow 3G.
//    - The backend can compute all blocks against a single shared pool of
//      in-stock products (one SQL query), then slice & dice in JS — much
//      cheaper than 10 separate queries with their own filters.
//    - Personalization (user's top categories) is computed once on the
//      server and folded into the "Recommended for you" block.
//
//  Each block has:
//    { id, title, icon, items: Product[] }
//
//  v12.6: the per-block round "999" shuffle button has been removed.
//  Refresh is now triggered by Pull To Refresh on the home page — pulling
//  down regenerates the session seed and refetches all blocks in one call.
//  The PTR dispatches `999pro:refresh`, which this component subscribes to
//  via usePullToRefreshSubscription.
// ============================================================================

interface SmartBlock {
  id: string
  title: string
  icon: string
  items: Product[]
}

interface Props {
  onOpenProduct: (id: string) => void
  /** Number of items per block. Default 12, max 24 (server enforces). */
  limit?: number
}

export function SmartBlocks({ onOpenProduct, limit = 12 }: Props) {
  const [blocks, setBlocks] = useState<SmartBlock[]>([])
  const [loading, setLoading] = useState(true)
  const [personalized, setPersonalized] = useState(false)
  // Per-mount random seed — kept stable for the lifetime of the page so the
  // user doesn't see the order change on every re-render. Regenerated when
  // the user pulls-to-refresh or when the component remounts (page refresh,
  // route change, app re-open).
  const [seed, setSeed] = useState<number>(() => Math.floor(Math.random() * 1_000_000))
  const lastFetchIdRef = useRef(0)

  const refresh = useCallback(async () => {
    const fetchId = ++lastFetchIdRef.current
    setLoading(true)
    try {
      const d = await api.get<{ blocks: SmartBlock[]; personalized: boolean }>(
        '/api/products/smart/blocks',
        { query: { limit, seed } },
      )
      // Race guard: discard stale responses.
      if (fetchId !== lastFetchIdRef.current) return
      setBlocks(d.blocks || [])
      setPersonalized(!!d.personalized)
    } catch {
      if (fetchId !== lastFetchIdRef.current) return
      setBlocks([])
    } finally {
      if (fetchId === lastFetchIdRef.current) setLoading(false)
    }
  }, [limit, seed])

  useEffect(() => {
    refresh()
  }, [refresh])

  // v12.6: Pull To Refresh subscription. When the user pulls down on the
  // home page, this handler regenerates the seed (new shuffle order) and
  // refetches all smart blocks in one API call. The PTR indicator stays
  // visible until this Promise resolves.
  usePullToRefreshSubscription(async () => {
    setSeed(Math.floor(Math.random() * 1_000_000))
    await refresh()
  }, [refresh])

  // v16.5: Instant refresh — when Studio saves products, refetch smart blocks.
  useEffect(() => {
    const onProductsChanged = () => refresh()
    window.addEventListener('999pro:products-changed', onProductsChanged as EventListener)
    return () => window.removeEventListener('999pro:products-changed', onProductsChanged as EventListener)
  }, [refresh])

  // Client-side deterministic shuffle — applied when seed changes (initial
  // mount or pull-to-refresh). Uses the same Mulberry32 PRNG pattern as the
  // backend for consistency.
  const displayBlocks = useMemo(() => {
    if (blocks.length === 0) return []
    // v22: filter out blocks with no items — don't show empty sections.
    return blocks
      .filter((block) => block.items && block.items.length > 0)
      .map((block) => ({
        ...block,
        items: shuffleArray(block.items, seed),
      }))
  }, [blocks, seed])

  // Loading skeleton — show 3 placeholder blocks.
  if (loading && blocks.length === 0) {
    return (
      <>
        {Array.from({ length: 3 }).map((_, blockIdx) => (
          <section key={blockIdx} className="px-4 md:px-6 py-3">
            <div className="flex items-end justify-between gap-4 mb-4">
              <div className="space-y-2">
                <div className="h-6 w-48 rounded skeleton" />
                <div className="h-3 w-32 rounded skeleton" />
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="rounded-xl overflow-hidden glass">
                  <div className="aspect-[3/4] skeleton" />
                  <div className="p-4 space-y-2">
                    <div className="h-4 w-3/4 rounded skeleton" />
                    <div className="h-3 w-1/2 rounded skeleton" />
                    <div className="h-8 w-full rounded-full skeleton" />
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </>
    )
  }

  if (blocks.length === 0) return null

  return (
    <>
      {/* Personalization indicator — shown above the first block when the
          user's recent activity influenced the recommendations. */}
      {personalized && (
        <div className="px-4 md:px-6 pt-4">
          <div className="rounded-full inline-flex items-center gap-1.5 px-3 py-1 bg-primary/10 text-primary text-xs font-medium">
            <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
            Подобрано под ваши интересы
          </div>
        </div>
      )}

      {displayBlocks.map((block) => (
        <section key={block.id} className="px-4 md:px-6 py-3 pb-28 md:pb-3">
          {/* ─────────────────────────────────────────────────────────────
              Section header — clean, no card wrapper. Just the icon + title
              + subtitle in a simple flex row. v12.6: the round "999" shuffle
              button has been removed — refresh is now via Pull To Refresh. */}
          <div className="mb-5 flex items-center gap-3 md:gap-4">
            {/* Premium gradient icon */}
            <div className={cn(
              'h-11 w-11 md:h-12 md:w-12 rounded-2xl grid place-items-center shrink-0 shadow-lg',
              getBlockIconBg(block.id),
            )}>
              {getBlockIcon(block.id)}
            </div>
            {/* Title + subtitle */}
            <div className="flex-1 min-w-0">
              <h2 className="text-xl md:text-2xl font-bold tracking-tight flex items-center gap-2 whitespace-nowrap">
                <span className="truncate">{block.title}</span>
              </h2>
              <p className="text-xs md:text-sm text-muted-foreground mt-1 truncate">
                {getSubtitle(block.id, personalized)}
              </p>
            </div>
          </div>

          {/* Product grid — smooth fade + slide when seed changes (pull to
              refresh). key={seed} causes React to remount the grid when the
              seed changes, triggering the enter animation. The subtle y-offset
              (12px) gives a premium slide-up feel without being distracting.
              Duration 0.35s with a material-design ease curve ensures a
              smooth, flicker-free transition. */}
          <motion.div
            key={seed}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
            className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4"
          >
            {block.items.map((p) => (
              <ProductCard key={p.id} product={p} onOpen={onOpenProduct} />
            ))}
          </motion.div>
        </section>
      ))}
    </>
  )
}

// ─────────────────────────────────────────────────────────────────
//  Mulberry32 — small, fast, deterministic PRNG. Same algorithm as the
//  backend uses. Seeded by `seed` so the same seed always produces the
//  same order, and a different seed produces a different order.
// ─────────────────────────────────────────────────────────────────
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Deterministic Fisher-Yates shuffle — same seed → same order.
function shuffleArray<T>(arr: T[], seed: number): T[] {
  const out = arr.slice()
  const rand = mulberry32(seed)
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

// ─────────────────────────────────────────────────────────────────
//  getSubtitle — returns a calm, gray descriptive subtitle for each
//  smart block. Shown below the title inside the glass header card.
//  For the "recommended" block, the subtitle adapts to whether the
//  user's personalization signals influenced the selection.
// ─────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────
//  getBlockIcon / getBlockIconBg — premium gradient icons for each
//  smart block. Replaces the old emoji icons with Lucide icons inside
//  gradient circles. Same look on mobile and desktop.
// ─────────────────────────────────────────────────────────────────
function getBlockIcon(blockId: string): React.ReactNode {
  const cls = 'h-5 w-5 md:h-6 md:w-6 text-white'
  switch (blockId) {
    case 'trending': return <Flame className={cls} strokeWidth={2.4} />
    case 'popular': return <Star className={cls} strokeWidth={2.4} fill="currentColor" />
    case 'recommended': return <Heart className={cls} strokeWidth={2.4} fill="currentColor" />
    case 'new': return <Sparkles className={cls} strokeWidth={2.4} />
    case 'buying-now': return <TrendingUp className={cls} strokeWidth={2.4} />
    case 'discussed': return <MessageCircle className={cls} strokeWidth={2.4} />
    case 'best-rating': return <Crown className={cls} strokeWidth={2.4} />
    case 'deals': return <Gift className={cls} strokeWidth={2.4} />
    case 'premium': return <Diamond className={cls} strokeWidth={2.4} fill="currentColor" />
    case 'fast-selling': return <Zap className={cls} strokeWidth={2.4} fill="currentColor" />
    default: return <Sparkles className={cls} />
  }
}

function getBlockIconBg(blockId: string): string {
  switch (blockId) {
    case 'trending': return 'bg-gradient-to-br from-orange-500 to-red-500 shadow-orange-500/30'
    case 'popular': return 'bg-gradient-to-br from-amber-400 to-orange-500 shadow-amber-500/30'
    case 'recommended': return 'bg-gradient-to-br from-pink-500 to-rose-500 shadow-pink-500/30'
    case 'new': return 'bg-gradient-to-br from-emerald-400 to-teal-500 shadow-emerald-500/30'
    case 'buying-now': return 'bg-gradient-to-br from-blue-500 to-indigo-500 shadow-blue-500/30'
    case 'discussed': return 'bg-gradient-to-br from-cyan-400 to-blue-500 shadow-cyan-500/30'
    case 'best-rating': return 'bg-gradient-to-br from-yellow-400 to-amber-500 shadow-yellow-500/30'
    case 'deals': return 'bg-gradient-to-br from-violet-500 to-purple-500 shadow-violet-500/30'
    case 'premium': return 'bg-gradient-to-br from-fuchsia-500 to-pink-500 shadow-fuchsia-500/30'
    case 'fast-selling': return 'bg-gradient-to-br from-sky-400 to-blue-500 shadow-sky-500/30'
    default: return 'bg-gradient-to-br from-blue-500 to-indigo-500 shadow-blue-500/30'
  }
}

function getSubtitle(blockId: string, personalized: boolean): string {
  switch (blockId) {
    case 'trending': return 'На основе просмотров и активности'
    case 'popular': return 'На основе рейтинга и отзывов'
    case 'new': return 'Свежее поступление'
    case 'recommended': return personalized ? 'Подобрано под ваши интересы' : 'Рекомендуется специально для вас'
    case 'buying-now': return 'Сейчас покупают другие пользователи'
    case 'discussed': return 'Самые обсуждаемые товары'
    case 'best-rating': return 'Лучший рейтинг по отзывам'
    case 'deals': return 'Выгодные предложения со скидкой'
    case 'premium': return 'Премиальные товары высокого класса'
    case 'fast-selling': return 'Быстро раскупают'
    default: return ''
  }
}

// REMOVED (Phase 1.3): pluralizeProducts — dead code, never called.
