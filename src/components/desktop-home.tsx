'use client'

import { useEffect, useState, useCallback } from 'react'
import Image from 'next/image'
import { motion } from 'framer-motion'
import {
  Search, ArrowRight, Sparkles, TrendingUp, Zap,
  ChevronRight, Flame, Crown, Heart,
} from 'lucide-react'
// v12.3.1: Stories component RESTORED (standalone module — not Feed).
import { Stories } from './stories'
import { api, assetUrl } from '@/lib/api'
import { useSmartBlock } from '@/lib/use-smart-blocks'
import type { Banner, HeroBlockSetting } from '@/lib/types'
import { cn } from '@/lib/utils'
import { formatCompactNumber } from '@/lib/format'
import { ProductCard } from './product-card'
import { usePullToRefreshSubscription } from './pull-to-refresh'

// ============================================================================
//  DesktopHome — Premium bento layout for desktop.
//
//  Composition (top to bottom):
//    1. Bento Hero — editorial welcome card (large) + 2 small feature cards
//    2. Stories strip — horizontal pill cards (compact)
//    3. Banner bento — 1 large + 2 small banner grid (asymmetric)
//    4. Smart blocks — section title + 4-col product grid (uses existing ProductCard)
//    5. Editorial split — catalog CTA + feed preview (magazine layout)
//
//  Mobile uses the original HomeView — this component is desktop-only.
// ============================================================================

interface DesktopHomeProps {
  onNavigate: (v: string) => void
  onOpenProduct: (id: string) => void
  onOpenSearch: () => void
}

export function DesktopHome({ onNavigate, onOpenProduct, onOpenSearch }: DesktopHomeProps) {
  return (
    <div className="hidden md:block page-top-padding-md">
      {/* v25.4 (home redesign): removed the always-on `premium-ambient` fixed
          background — modern premium = generous whitespace, no decorative
          blur orbs. Kept a very subtle one for depth. */}
      <div className="fixed inset-0 pointer-events-none -z-10 premium-ambient opacity-40" />

      <div className="max-w-[1440px] mx-auto px-8 lg:px-12 xl:px-16 py-6 lg:py-8 space-y-10 lg:space-y-14">
        {/* ── 1. HERO ─────────────────────────────────────────────────── */}
        <BentoHero onNavigate={onNavigate} onOpenSearch={onOpenSearch} />

        {/* ── 2. STORIES ──────────────────────────────────────────────── */}
        <Stories />

        {/* ── 3. SMART BLOCKS — Trending ──────────────────────────────── */}
        <SmartSection
          blockId="trending"
          title="Сейчас в тренде"
          subtitle="На основе просмотров и активности"
          icon={<Flame className="h-5 w-5" />}
          accent="orange"
          onOpenProduct={onOpenProduct}
          onNavigate={onNavigate}
        />

        {/* ── 4. SMART BLOCKS — Recommended ──────────────────────────── */}
        <SmartSection
          blockId="recommended"
          title="Рекомендуем вам"
          subtitle="Подобрано под ваши интересы"
          icon={<Heart className="h-5 w-5" />}
          accent="pink"
          onOpenProduct={onOpenProduct}
          onNavigate={onNavigate}
        />

        {/* ── 5. FEATURED — Best rating ──────────────────────────────── */}
        <SmartSection
          blockId="best-rating"
          title="Лучший рейтинг"
          subtitle="Отзывы покупателей"
          icon={<Crown className="h-5 w-5" />}
          accent="amber"
          onOpenProduct={onOpenProduct}
          onNavigate={onNavigate}
        />

        {/* v25.4: removed BannerBento, EditorialSplit, ClosingCTA — they
            duplicated CTAs already in the hero and added visual noise.
            The page now ends cleanly with the last product grid. */}

        {/* ── QUIET FOOTER LINK ──────────────────────────────────────── */}
        <div className="pt-4 pb-8 text-center">
          <button
            onClick={() => onNavigate('catalog')}
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Смотреть весь каталог
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
//  BENTO HERO — large editorial card + 2 small feature cards
//  v12.6: cleaned up per Phase 6 spec — no LIVE badge, no marketing subtitle
//  on the small card. Just the brand title and primary CTA.
// ═══════════════════════════════════════════════════════════════════════════

function BentoHero({ onNavigate, onOpenSearch }: { onNavigate: (v: string) => void; onOpenSearch: () => void }) {
  const [hero, setHero] = useState<HeroBlockSetting | null>(null)
  const [stats, setStats] = useState({ products: 0, posts: 0 })

  const fetchHero = useCallback(async () => {
    try {
      const d = await api.get<{ value: HeroBlockSetting | null }>('/api/settings/heroBlock')
      setHero(d.value || null)
    } catch {
      /* keep existing */
    }
  }, [])

  const fetchStats = useCallback(async () => {
    try {
      const d = await api.get<{ total: number }>('/api/products', { query: { limit: 1 } })
      setStats((s) => ({ ...s, products: d.total || 0 }))
    } catch {
      /* keep existing */
    }
  }, [])

  useEffect(() => {
    fetchHero()
    fetchStats()
  }, [fetchHero, fetchStats])

  // v25.6 (Hero Block fix): instantly refresh when Studio saves the hero block.
  // Previously BentoHero had no listener for '999pro:settings-changed' — admins
  // had to refresh the page to see their changes. Now the hero updates the
  // moment Studio broadcasts the save.
  useEffect(() => {
    const onSettingsChanged = (e: Event) => {
      const detail = (e as CustomEvent).detail as { key?: string } | undefined
      if (detail?.key === 'heroBlock') {
        void fetchHero()
      }
    }
    window.addEventListener('999pro:settings-changed', onSettingsChanged as EventListener)
    return () => window.removeEventListener('999pro:settings-changed', onSettingsChanged as EventListener)
  }, [fetchHero])

  // v12.6: Pull To Refresh subscription — refetch hero + stats.
  usePullToRefreshSubscription(async () => {
    await Promise.all([fetchHero(), fetchStats()])
  }, [fetchHero, fetchStats])

  return (
    <section className="grid grid-cols-12 gap-5 lg:gap-6">
      {/* ─── Large editorial card (8 cols) ─── */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className="col-span-12 lg:col-span-8 relative overflow-hidden rounded-[28px] premium-hero-card group"
      >
        {/* v12.6.4: image-only mode + object-fit support */}
        {hero?.image ? (
          <Image
            src={assetUrl(hero.image)}
            alt=""
            fill
            priority
            sizes="(max-width: 1024px) 100vw, 66vw"
            className={cn(
              hero?.objectFit === 'contain' ? 'object-contain' : 'object-cover',
              'transition-transform duration-700 group-hover:scale-105',
            )}
          />
        ) : (
          <div className="absolute inset-0 premium-hero-gradient" />
        )}
        {/* Dark overlay for legibility — only in image-text mode */}
        {hero?.mode !== 'image-only' && (
          <div className="absolute inset-0 bg-gradient-to-tr from-slate-950/80 via-slate-900/40 to-transparent" />
        )}

        {/* Content — v12.6: clean, minimal. Only the title + CTAs.
            v12.6.4: hidden in image-only mode. Only rendered if at least
            one text/button field is non-empty. */}
        {hero?.mode !== 'image-only' && (hero?.badge || hero?.title || hero?.description) && (
          <div className="relative h-[360px] lg:h-[420px] p-10 lg:p-12 flex flex-col justify-between text-white">
            <div className="flex items-center gap-2">
              {hero?.badge && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 backdrop-blur-md text-xs font-medium border border-white/20">
                  <Sparkles className="h-3 w-3" />
                  {hero.badge}
                </span>
              )}
            </div>

            <div className="max-w-xl space-y-5">
              {hero?.title && (
                <h1 className="text-4xl lg:text-5xl font-bold tracking-tight leading-[1.05]">
                  {hero.title}
                </h1>
              )}
              {hero?.description && (
                <p className="text-base lg:text-lg text-white/80 leading-relaxed max-w-md">
                  {hero.description}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-3 pt-2">
                {/* v25.6 (Hero Block fix): use config-driven buttons when admin
                    has configured them; fall back to sensible defaults otherwise. */}
                {hero?.primaryButton ? (
                  <button
                    onClick={() => {
                      if (hero.primaryButton?.view) onNavigate(hero.primaryButton.view)
                      else if (hero.primaryButton?.link) window.open(hero.primaryButton.link, '_blank', 'noopener,noreferrer')
                    }}
                    className="group/btn inline-flex items-center gap-2 px-6 py-3.5 rounded-full bg-white text-slate-900 text-sm font-semibold shadow-2xl shadow-white/20 hover:scale-[1.03] active:scale-95 transition-all duration-300"
                  >
                    {hero.primaryButton.text}
                    <ArrowRight className="h-4 w-4 group-hover/btn:translate-x-0.5 transition-transform" />
                  </button>
                ) : (
                  <button
                    onClick={() => onNavigate('catalog')}
                    className="group/btn inline-flex items-center gap-2 px-6 py-3.5 rounded-full bg-white text-slate-900 text-sm font-semibold shadow-2xl shadow-white/20 hover:scale-[1.03] active:scale-95 transition-all duration-300"
                  >
                    Открыть каталог
                    <ArrowRight className="h-4 w-4 group-hover/btn:translate-x-0.5 transition-transform" />
                  </button>
                )}
                {hero?.secondaryButton ? (
                  <button
                    onClick={() => {
                      if (hero.secondaryButton?.view) onNavigate(hero.secondaryButton.view)
                      else if (hero.secondaryButton?.link) window.open(hero.secondaryButton.link, '_blank', 'noopener,noreferrer')
                    }}
                    className="inline-flex items-center gap-2 px-6 py-3.5 rounded-full bg-white/10 backdrop-blur-md text-white text-sm font-semibold border border-white/20 hover:bg-white/15 transition-all duration-300"
                  >
                    {hero.secondaryButton.text}
                  </button>
                ) : (
                  <button
                    onClick={() => onNavigate('club')}
                    className="inline-flex items-center gap-2 px-6 py-3.5 rounded-full bg-white/10 backdrop-blur-md text-white text-sm font-semibold border border-white/20 hover:bg-white/15 transition-all duration-300"
                  >
                    999 CLUB
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Decorative glow */}
        <div className="absolute -top-20 -right-20 h-64 w-64 rounded-full bg-blue-500/30 blur-3xl pointer-events-none" />
      </motion.div>

      {/* ─── Small cards column (4 cols, 2 stacked) ─── */}
      <div className="col-span-12 lg:col-span-4 grid grid-rows-2 gap-5 lg:gap-6">
        {/* Search / Command card */}
        <motion.button
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
          onClick={onOpenSearch}
          className="relative overflow-hidden rounded-[28px] premium-glass-card p-8 text-left group hover:scale-[1.02] transition-transform duration-300"
        >
          <div className="flex items-start justify-between mb-6">
            <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 grid place-items-center shadow-lg shadow-blue-500/30">
              <Search className="h-5 w-5 text-white" strokeWidth={2.4} />
            </div>
            <kbd className="px-2 py-1 rounded-md bg-foreground/5 text-[10px] font-mono font-medium text-muted-foreground border border-border/60">
              ⌘K
            </kbd>
          </div>
          <h3 className="text-xl font-bold tracking-tight mb-1">Найти товар</h3>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Поиск по каталогу, ленте и авторам
          </p>
          <div className="absolute -bottom-8 -right-8 h-32 w-32 rounded-full bg-blue-500/10 blur-2xl group-hover:bg-blue-500/20 transition-colors" />
        </motion.button>

        {/* Stats card — v12.6: removed "LIVE" badge per Phase 6 spec. Just
            the product count, clean. */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
          className="relative overflow-hidden rounded-[28px] premium-glass-card p-8 group"
        >
          <div className="flex items-start justify-between mb-6">
            <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-500 grid place-items-center shadow-lg shadow-emerald-500/30">
              <TrendingUp className="h-5 w-5 text-white" strokeWidth={2.4} />
            </div>
          </div>
          <div className="space-y-1">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold tracking-tight tabular-nums">
                {stats.products > 0 ? formatCompactNumber(stats.products) : '—'}
              </span>
              <span className="text-sm text-muted-foreground">товаров</span>
            </div>
            <p className="text-sm text-muted-foreground">в каталоге прямо сейчас</p>
          </div>
          <button
            onClick={() => onNavigate('catalog')}
            className="mt-5 inline-flex items-center gap-1 text-xs font-semibold text-foreground/80 hover:text-foreground transition-colors group/link"
          >
            Смотреть все
            <ChevronRight className="h-3 w-3 group-hover/link:translate-x-0.5 transition-transform" />
          </button>
        </motion.div>
      </div>
    </section>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
//  STORIES STRIP — REMOVED (Phase 1.3): dead code. DesktopHome renders
//  <Stories /> (the mobile component with md: variants) instead. This
//  duplicate fetch of /api/stories was never mounted.
// ═══════════════════════════════════════════════════════════════════════════
//  BANNER BENTO — 1 large + 2 small asymmetric grid
// ═══════════════════════════════════════════════════════════════════════════

function BannerBento() {
  const [banners, setBanners] = useState<Banner[]>([])

  const fetchBanners = useCallback(async () => {
    try {
      const d = await api.get<{ items: Banner[] }>('/api/banners')
      setBanners(d.items.slice(0, 3))
    } catch {
      /* keep existing */
    }
  }, [])

  useEffect(() => {
    fetchBanners()
  }, [fetchBanners])

  // v24.3: Listen for banner changes broadcast via Socket.IO. When an admin
  // saves a banner in Studio, the backend emits `banners:changed` which
  // use-socket.ts converts to a `999pro:banners-changed` window event.
  // Without this, the desktop BannerBento never refreshed after Studio edits
  // (only mobile promo-banner.tsx had this listener).
  useEffect(() => {
    const handler = () => fetchBanners()
    window.addEventListener('999pro:banners-changed', handler)
    return () => window.removeEventListener('999pro:banners-changed', handler)
  }, [fetchBanners])

  // v12.6: Pull To Refresh subscription — refetch banners.
  usePullToRefreshSubscription(fetchBanners, [fetchBanners])

  if (banners.length === 0) return null

  return (
    <section>
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-xl font-bold tracking-tight">Акции и предложения</h2>
        <span className="text-xs text-muted-foreground">{banners.length} активных</span>
      </div>
      <div className="grid grid-cols-12 gap-5 lg:gap-6">
        {/* Large banner (left, 7 cols) */}
        {banners[0] && (
          <BannerCard banner={banners[0]} className="col-span-12 lg:col-span-7 h-[280px]" large />
        )}
        {/* Two stacked small banners (right, 5 cols) */}
        <div className="col-span-12 lg:col-span-5 grid grid-rows-2 gap-5 lg:gap-6">
          {banners[1] && <BannerCard banner={banners[1]} className="h-[130px] lg:h-auto" />}
          {banners[2] && <BannerCard banner={banners[2]} className="h-[130px] lg:h-auto" />}
        </div>
      </div>
    </section>
  )
}

function BannerCard({ banner, className, large = false }: { banner: Banner; className?: string; large?: boolean }) {
  return (
    <a
      href={banner.link || '#'}
      target={banner.link ? '_blank' : undefined}
      rel="noopener noreferrer"
      className={cn(
        'relative overflow-hidden rounded-[24px] group block',
        className,
      )}
    >
      {banner.image && (
        // F-CRIT-001: next/image fill. Parent <a> already has `relative
        // overflow-hidden` — no extra wrapper needed.
        <Image
          src={assetUrl(banner.image)}
          alt=""
          fill
          sizes="(max-width: 1024px) 100vw, 58vw"
          className="object-cover transition-transform duration-700 group-hover:scale-105"
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-tr from-slate-950/80 via-slate-900/40 to-transparent" />
      <div className="relative h-full p-6 lg:p-7 flex flex-col justify-end text-white">
        <h3 className={cn('font-bold tracking-tight mb-1', large ? 'text-2xl lg:text-3xl' : 'text-lg')}>
          {banner.title}
        </h3>
        {banner.subtitle && (
          <p className={cn('text-white/80 mb-3', large ? 'text-sm' : 'text-xs')}>{banner.subtitle}</p>
        )}
        <span className="inline-flex items-center gap-1 text-xs font-semibold opacity-90 group-hover:gap-2 transition-all">
          {banner.cta}
          <ArrowRight className="h-3 w-3" />
        </span>
      </div>
    </a>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
//  SMART SECTION — title + product grid (uses existing ProductCard)
// ═══════════════════════════════════════════════════════════════════════════

const ACCENT_STYLES: Record<string, { bg: string; ring: string; text: string }> = {
  orange: { bg: 'from-orange-500 to-red-500', ring: 'shadow-orange-500/30', text: 'text-orange-600' },
  pink: { bg: 'from-pink-500 to-rose-500', ring: 'shadow-pink-500/30', text: 'text-pink-600' },
  amber: { bg: 'from-amber-500 to-yellow-500', ring: 'shadow-amber-500/30', text: 'text-amber-600' },
  blue: { bg: 'from-blue-500 to-indigo-500', ring: 'shadow-blue-500/30', text: 'text-blue-600' },
  emerald: { bg: 'from-emerald-500 to-teal-500', ring: 'shadow-emerald-500/30', text: 'text-emerald-600' },
}

function SmartSection({
  blockId,
  title,
  subtitle,
  icon,
  accent,
  onOpenProduct,
  onNavigate,
}: {
  blockId: string
  title: string
  subtitle: string
  icon: React.ReactNode
  accent: keyof typeof ACCENT_STYLES
  onOpenProduct: (id: string) => void
  onNavigate?: (v: string) => void
}) {
  // F-CRIT-002 fix: use shared cache via useSmartBlock. Previously each
  // SmartSection independently called api.get('/api/products/smart/blocks')
  // in its own useEffect — desktop home fired 3 identical requests on mount
  // (plus mobile SmartBlocks = 4 total per home load). Now all SmartSection
  // instances share one fetch via the useSmartBlocks() cache (60s TTL).
  const { items, loading } = useSmartBlock(blockId, 8)

  const a = ACCENT_STYLES[accent]

  return (
    <section>
      {/* v25.4 (home redesign): simplified section header — neutral title,
          thin "Смотреть все" link. Removed the gradient icon bubble to reduce
          visual noise (3 competing chromatic accents was too busy). */}
      <div className="flex items-end justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className={cn('h-10 w-10 rounded-xl bg-gradient-to-br grid place-items-center shadow-sm', a.bg)}>
            <div className="text-white">{icon}</div>
          </div>
          <div>
            <h2 className="text-xl lg:text-2xl font-bold tracking-tight">{title}</h2>
            <p className="text-xs lg:text-sm text-muted-foreground mt-0.5">{subtitle}</p>
          </div>
        </div>
        {onNavigate && (
          <button
            onClick={() => onNavigate('catalog')}
            className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors group"
          >
            Смотреть все
            <ArrowRight className="h-4 w-4 group-hover:translate-x-0.5 transition-transform" />
          </button>
        )}
      </div>

      {/* Product grid — uses existing ProductCard, unchanged sizes */}
      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="rounded-xl overflow-hidden premium-glass-card">
              <div className="aspect-[3/4] skeleton" />
              <div className="p-4 space-y-2">
                <div className="h-4 w-3/4 rounded skeleton" />
                <div className="h-3 w-1/2 rounded skeleton" />
              </div>
            </div>
          ))}
        </div>
      ) : items.length === 0 ? null : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
          {items.map((p) => (
            <ProductCard key={p.id} product={p} onOpen={onOpenProduct} />
          ))}
        </div>
      )}
    </section>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
//  EDITORIAL SPLIT — Catalog CTA + Feed preview
// ═══════════════════════════════════════════════════════════════════════════

function EditorialSplit({ onNavigate }: { onNavigate: (v: string) => void }) {
  return (
    <section className="grid grid-cols-12 gap-5 lg:gap-6">
      {/* Catalog CTA — wide gradient card */}
      <div className="col-span-12 lg:col-span-7 relative overflow-hidden rounded-[28px] premium-gradient-card p-10 lg:p-12 flex flex-col justify-between min-h-[260px]">
        <div className="relative z-10">
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/15 backdrop-blur-md text-xs font-medium text-white border border-white/20 mb-4">
            <Zap className="h-3 w-3" />
            Полный каталог
          </span>
          <h3 className="text-3xl lg:text-4xl font-bold tracking-tight text-white mb-2 max-w-md">
            Сотни товаров в одном месте
          </h3>
          <p className="text-white/80 text-sm lg:text-base max-w-md">
            Большие фото, цены, отзывы и быстрая покупка в один клик
          </p>
        </div>
        <button
          onClick={() => onNavigate('catalog')}
          className="relative z-10 self-start inline-flex items-center gap-2 px-6 py-3.5 rounded-full bg-white text-slate-900 text-sm font-semibold shadow-2xl hover:scale-[1.03] active:scale-95 transition-all duration-300"
        >
          Открыть каталог
          <ArrowRight className="h-4 w-4" />
        </button>
        <div className="absolute -bottom-16 -right-16 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
      </div>

      {/* v12.3: Feed preview card replaced by 999 CLUB preview card. */}
      <button
        onClick={() => onNavigate('club')}
        className="col-span-12 lg:col-span-5 relative overflow-hidden rounded-[28px] premium-glass-card p-10 group text-left hover:scale-[1.02] transition-transform duration-300"
      >
        <div className="flex items-start justify-between mb-8">
          <div
            className="h-12 w-12 rounded-2xl grid place-items-center shadow-lg"
            style={{ backgroundImage: 'linear-gradient(135deg, #f59e0b 0%, #ec4899 50%, #8b5cf6 100%)' }}
          >
            <Crown className="h-5 w-5 text-white" strokeWidth={2.4} />
          </div>
          <ArrowRight className="h-5 w-5 text-muted-foreground group-hover:text-foreground group-hover:translate-x-0.5 transition-all" />
        </div>
        <h3 className="text-2xl font-bold tracking-tight mb-2">999 CLUB</h3>
        <p className="text-sm text-muted-foreground leading-relaxed mb-6">
          VIP-зона привилегий: подарки, акции, розыгрыши, бонусы и эксклюзивные офферы
        </p>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5 text-amber-500" />
          <span>привилегии для участников</span>
        </div>
      </button>
    </section>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
//  CLOSING CTA
// ═══════════════════════════════════════════════════════════════════════════

function ClosingCTA({ onNavigate }: { onNavigate: (v: string) => void }) {
  return (
    <section className="relative overflow-hidden rounded-[28px] premium-closing-card p-12 lg:p-16 text-center">
      <div className="relative z-10 max-w-xl mx-auto">
        <Sparkles className="h-8 w-8 mx-auto mb-4 text-primary" />
        <h2 className="text-3xl lg:text-4xl font-bold tracking-tight mb-3">
          Готовы начать?
        </h2>
        <p className="text-muted-foreground text-base mb-8">
          Создайте аккаунт за минуту и получите доступ ко всем возможностям 999PRO
        </p>
        <div className="flex items-center justify-center gap-3 flex-wrap">
          <button
            onClick={() => onNavigate('catalog')}
            className="inline-flex items-center gap-2 px-6 py-3.5 rounded-full gradient-brand text-white text-sm font-semibold shadow-glow hover:scale-[1.03] active:scale-95 transition-all duration-300"
          >
            Начать покупки
            <ArrowRight className="h-4 w-4" />
          </button>
          <button
            onClick={() => onNavigate('chat')}
            className="inline-flex items-center gap-2 px-6 py-3.5 rounded-full premium-glass-card text-sm font-semibold hover:scale-[1.03] active:scale-95 transition-all duration-300"
          >
            Открыть чат
          </button>
        </div>
      </div>
    </section>
  )
}
