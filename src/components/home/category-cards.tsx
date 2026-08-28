'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import Image from 'next/image'
import { useTheme } from 'next-themes'
import { motion } from 'framer-motion'
import {
  Megaphone, Gift, Armchair, Printer, Palette, Home,
  Package, Trophy, Sparkles, FileSpreadsheet, ArrowUpRight,
  Layers, ShoppingBag, Wrench, Star, ChevronLeft, ChevronRight, Gamepad2,
  Presentation, Newspaper, Box, Gem,
  type LucideIcon,
} from 'lucide-react'
import { api, assetUrl } from '@/lib/api'
import { haptic } from '@/lib/haptic'
import { cn } from '@/lib/utils'
// ============================================================================
// v25.22 (owner) — «слишком большие, хочу на мобильном ровно 3 карточки и
//   одинаковые отступы по краям»:
//     • Ширина карточки на мобиле = calc((100% - 16px) / 3): РОВНО 3 плитки
//       в видимой области при любых размерах экрана, отступы слева/справа
//       одинаковые (px-4 контейнера home-view), зазор между карточками 8px.
//     • Высота 108px (мобайл) / 156px (десктоп), контент уплотнён:
//       диск иконки 40px, имя 12px, счётчик 9.5px — ничего не липнет.
//   • v25.21 сохранено: touch-action pan-x, wheel→горизонталь на десктопе,
//     cover-изображения из Студии, стрелки в шапке секции.
//
// v25.21 (owner) — ПОЛНЫЙ РЕДИЗАЙН категории на главной:
//   • touch-action: pan-x (вертикальный скролл не перехватывает свайп);
//   • на десктопе колесо мыши крутит ЛЕНТУ по горизонтали (passive:false);
//   • премиум-плитки: стеклянный диск иконки, счётчик в капсуле,
//     блик-shine при hover.
// ============================================================================

interface Category {
  id: string
  name: string
  slug: string
  icon: string
  description?: string | null
  productsCount?: number
}

const ICONS: Record<string, LucideIcon> = {
  Megaphone, Gift, Armchair, Printer, Palette, Home,
  Package, Trophy, Layers, ShoppingBag,
  Wrench, Star, Sparkles,
  Presentation, Newspaper, Box, Gem,
}

function iconFor(cat: Category): LucideIcon {
  return ICONS[cat.icon] || ICONS[`${cat.name.charAt(0).toUpperCase()}${cat.name.slice(1)}`] || Sparkles
}

interface Palette { from: string; to: string; solid: string }

const PALETTES_LIGHT: Record<string, Palette> = {
  'Реклама':            { from: '#FFEDD5', to: '#FDBA74', solid: '#9A3412' },
  'Подарки':            { from: '#FFE4E6', to: '#FDA4AF', solid: '#9F1239' },
  'Мебель':             { from: '#CCFBF1', to: '#5EEAD4', solid: '#115E59' },
  'Печать':             { from: '#EDE9FE', to: '#C4B5FD', solid: '#5B21B6' },
  'Дизайн':             { from: '#FAE8FF', to: '#F0ABFC', solid: '#86198F' },
  'Интерьер':           { from: '#E0F2FE', to: '#7DD3FC', solid: '#075985' },
  'Наружная реклама':   { from: '#FEF9C3', to: '#FDE047', solid: '#854D0E' },
  'Полиграфия':         { from: '#D1FAE5', to: '#6EE7B7', solid: '#065F46' },
  'Упаковка':           { from: '#DCFCE7', to: '#86EFAC', solid: '#166534' },
  'Сувениры':           { from: '#FEF3C7', to: '#FCD34D', solid: '#92400E' },
}
const PALETTES_DARK: Record<string, Palette> = {
  'Реклама':            { from: '#7C2D12', to: '#EA580C', solid: '#FFFFFF' },
  'Подарки':            { from: '#831843', to: '#DB2777', solid: '#FFFFFF' },
  'Мебель':             { from: '#134E4A', to: '#0D9488', solid: '#FFFFFF' },
  'Печать':             { from: '#4C1D95', to: '#7C3AED', solid: '#FFFFFF' },
  'Дизайн':             { from: '#701A75', to: '#C026D3', solid: '#FFFFFF' },
  'Интерьер':           { from: '#0C4A6E', to: '#0284C7', solid: '#FFFFFF' },
  'Наружная реклама':   { from: '#713F12', to: '#D97706', solid: '#FFFFFF' },
  'Полиграфия':         { from: '#064E3B', to: '#059669', solid: '#FFFFFF' },
  'Упаковка':           { from: '#14532D', to: '#16A34A', solid: '#FFFFFF' },
  'Сувениры':           { from: '#78350F', to: '#CA8A04', solid: '#FFFFFF' },
}
const DEFAULT_LIGHT: Palette = { from: '#EEF2F7', to: '#C7D2E4', solid: '#334155' }
const DEFAULT_DARK: Palette = { from: '#1E293B', to: '#334155', solid: '#FFFFFF' }

function paletteFor(name: string, dark: boolean): Palette {
  const map = dark ? PALETTES_DARK : PALETTES_LIGHT
  const fb = dark ? DEFAULT_DARK : DEFAULT_LIGHT
  if (map[name]) return map[name]
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  const keys = Object.keys(map)
  return map[keys[h % keys.length]] || fb
}

const PRICE_TILE: Palette = { from: '#D1FAE5', to: '#34D399', solid: '#065F46' }
// v25.23: плитка «Игры» — вход в игровой клуб
const GAMES_TILE: Palette = { from: '#C7D2FE', to: '#A78BFA', solid: '#4C1D95' }

interface CategoryCardsProps {
  onSelect: (category: string) => void
  onOpenPrice?: () => void
  onOpenGames?: () => void
}

export function CategoryCards({ onSelect, onOpenPrice, onOpenGames }: CategoryCardsProps) {
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [canLeft, setCanLeft] = useState(false)
  const [canRight, setCanRight] = useState(false)

  // Refresh when Studio changes categories.
  useEffect(() => {
    const fetch = () => {
      api.get<{ items: Category[] }>('/api/categories')
        .then((d) => setCategories((d.items || []).slice(0, 12)))
        .catch(() => {})
        .finally(() => setLoading(false))
    }
    fetch()
    window.addEventListener('999pro:categories-changed', fetch as EventListener)
    return () => window.removeEventListener('999pro:categories-changed', fetch as EventListener)
  }, [])

  const updateArrows = useCallback(() => {
    const el = scrollerRef.current
    if (!el) return
    setCanLeft(el.scrollLeft > 8)
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 8)
  }, [])
  useEffect(() => {
    updateArrows()
    const el = scrollerRef.current
    if (!el) return
    el.addEventListener('scroll', updateArrows, { passive: true })
    window.addEventListener('resize', updateArrows)
    return () => {
      el.removeEventListener('scroll', updateArrows)
      window.removeEventListener('resize', updateArrows)
    }
  }, [updateArrows, categories, loading])

  // v25.21: колесо мыши над лентой = горизонтальная прокрутка ЛЕНТЫ
  // (а не страницы). Нативный listener с passive:false — иначе браузер
  // проигнорирует preventDefault и страница всё равно уедет вверх.
  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return // трекпад-горизонталь уже ок
      if (el.scrollWidth <= el.clientWidth + 4) return // листать некуда — не мешаем странице
      e.preventDefault()
      el.scrollLeft += e.deltaY
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [categories, loading])

  const scrollByAmount = (dir: 1 | -1) => {
    haptic.tap()
    const el = scrollerRef.current
    if (!el) return
    el.scrollBy({ left: dir * Math.max(el.clientWidth * 0.7, 260), behavior: 'smooth' })
  }

  if (loading) {
    return (
      <section>
        <SectionHeader onCanLeft={false} onCanRight={false} />
        <div className="flex gap-2 md:gap-4 overflow-hidden">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="shrink-0 w-[calc((100%-16px)/3)] md:w-[200px] h-[108px] md:h-[156px] rounded-[18px] md:rounded-[24px] skeleton" />
          ))}
        </div>
      </section>
    )
  }

  if (categories.length === 0) return null

  return (
    <section>
      <SectionHeader
        onCanLeft={canLeft}
        onCanRight={canRight}
        onScrollLeft={() => scrollByAmount(-1)}
        onScrollRight={() => scrollByAmount(1)}
      />
      <div
        ref={scrollerRef}
        className="flex gap-2 md:gap-4 overflow-x-auto no-scrollbar pb-2 snap-x snap-proximity"
        // v25.21: ТОЛЬКО pan-x — вертикальный жест, начатый на карточках,
        // больше не срывает ленту вверх/вниз. Страница скроллится мимо ленты
        // (свыше 140px высоты вокруг) — как у витринных каруселей в Avito/Яндекс.Услугах.
        style={{ touchAction: 'pan-x' }}
      >
        {categories.map((cat, i) => (
          <CategoryCard key={cat.id} cat={cat} idx={i} onSelect={onSelect} />
        ))}

        {onOpenPrice && (
          <motion.button
            initial={{ opacity: 0, y: 14 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.35, delay: 0.06 * Math.min(categories.length, 8), ease: [0.22, 1, 0.36, 1] }}
            onClick={() => { haptic.tap(); onOpenPrice?.() }}
            whileTap={{ scale: 0.96 }}
            className="cat-shine group relative shrink-0 w-[calc((100%-16px)/3)] md:w-[200px] h-[108px] md:h-[156px] rounded-[18px] md:rounded-[24px] overflow-hidden text-left snap-start"
            style={{
              background: `linear-gradient(145deg, ${PRICE_TILE.from} 0%, ${PRICE_TILE.to} 100%)`,
              boxShadow: '0 24px 48px -28px rgba(6,95,70,0.45), 0 6px 18px -12px rgba(15,23,42,0.1), inset 0 1px 0 rgba(255,255,255,.7)',
            }}
          >
            <TileInner>
              <IconDisc>
                <FileSpreadsheet className="h-[16px] w-[16px] md:h-[20px] md:w-[20px]" strokeWidth={2.1} style={{ color: PRICE_TILE.solid }} />
              </IconDisc>
              <CardFooter title="Прайс-листы" subtitle="PDF · Word · фото" color={PRICE_TILE.solid} />
            </TileInner>
          </motion.button>
        )}

        {/* v25.23: ИГРОВОЙ КЛУБ — плитка «Игры» в конце ленты категорий */}
        {onOpenGames && (
          <motion.button
            initial={{ opacity: 0, y: 14 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.35, delay: 0.06 * Math.min(categories.length + 1, 8), ease: [0.22, 1, 0.36, 1] }}
            onClick={() => { haptic.tap(); onOpenGames?.() }}
            whileTap={{ scale: 0.96 }}
            className="cat-shine group relative shrink-0 w-[calc((100%-16px)/3)] md:w-[200px] h-[108px] md:h-[156px] rounded-[18px] md:rounded-[24px] overflow-hidden text-left snap-start"
            style={{
              background: `linear-gradient(145deg, ${GAMES_TILE.from} 0%, ${GAMES_TILE.to} 100%)`,
              boxShadow: '0 24px 48px -28px rgba(76,29,149,0.5), 0 6px 18px -12px rgba(15,23,42,0.1), inset 0 1px 0 rgba(255,255,255,.7)',
            }}
          >
            <TileInner>
              <IconDisc>
                <Gamepad2 className="h-[16px] w-[16px] md:h-[20px] md:w-[20px]" strokeWidth={2.1} style={{ color: GAMES_TILE.solid }} />
              </IconDisc>
              <CardFooter title="Игры" subtitle="26 игр · клуб" color={GAMES_TILE.solid} />
            </TileInner>
          </motion.button>
        )}
      </div>
    </section>
  )
}

/* ---------- building blocks ---------- */

function TileInner({ children }: { children: React.ReactNode }) {
  return <div className="relative z-10 h-full flex flex-col justify-between p-2.5 md:p-4">{children}</div>
}

// v25.22: диск иконки компактнее на мобиле (40px), на десктопе — прежние 56px.
function IconDisc({ children, light }: { children: React.ReactNode; light?: boolean }) {
  return (
    <span
      className={cn(
        'h-10 w-10 md:h-14 md:w-14 rounded-full grid place-items-center backdrop-blur-md transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-6',
        light ? 'bg-white/25 border border-white/35' : 'bg-white/65 border border-white/70',
      )}
      style={{ boxShadow: 'inset 0 1.5px 0 rgba(255,255,255,.9), 0 10px 22px -10px rgba(0,0,0,.25)' }}
    >
      {children}
    </span>
  )
}

function CardFooter({ title, subtitle, color }: { title: string; subtitle: string; color: string }) {
  return (
    <div className="min-w-0 relative">
      <h3 className="text-[12px] md:text-base font-extrabold leading-tight tracking-tight line-clamp-1" style={{ color }}>
        {title}
      </h3>
      <p className="text-[9.5px] md:text-[11px] font-semibold mt-0.5 md:mt-1 line-clamp-1 inline-flex max-w-full items-center rounded-full px-1.5 md:px-2 py-0.5 -ml-0.5"
        style={{ color, background: 'rgba(255,255,255,0.55)', backdropFilter: 'blur(6px)' }}
      >
        {subtitle}
      </p>
      <span
        aria-hidden
        className="absolute right-0 bottom-0 h-8 w-8 rounded-full grid place-items-center opacity-0 transition-all duration-300 group-hover:opacity-100 group-hover:translate-x-0.5"
        style={{ background: 'rgba(255,255,255,0.65)', backdropFilter: 'blur(6px)' }}
      >
        <ArrowUpRight className="h-4 w-4" style={{ color }} />
      </span>
    </div>
  )
}

function pluralizeProducts(n: number): string {
  const last = n % 10
  const lastTwo = n % 100
  if (lastTwo >= 11 && lastTwo <= 14) return 'товаров'
  if (last === 1) return 'товар'
  if (last >= 2 && last <= 4) return 'товара'
  return 'товаров'
}

// v25.16: '#RRGGBB' → 'rgba(r,g,b,a)'.
function hexToRgba(hex: string, alpha: number): string {
  const m = hex.replace('#', '')
  const full = m.length === 3 ? m.split('').map((c) => c + c).join('') : m
  const int = parseInt(full.slice(0, 6), 16)
  if (Number.isNaN(int)) return `rgba(15,23,42,${alpha})`
  const r = (int >> 16) & 255
  const g = (int >> 8) & 255
  const b = int & 255
  return `rgba(${r},${g},${b},${alpha})`
}

// v25.17: стрелки в шапке секции (десктоп).
function SectionHeader({
  onCanLeft,
  onCanRight,
  onScrollLeft,
  onScrollRight,
}: {
  onCanLeft?: boolean
  onCanRight?: boolean
  onScrollLeft?: () => void
  onScrollRight?: () => void
}) {
  return (
    <div className="mb-3 md:mb-4 flex items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-lg md:text-xl font-bold tracking-tight text-foreground">Категории</h2>
        <p className="text-xs md:text-sm text-muted-foreground mt-0.5">Выберите направление — от рекламы до мебели</p>
      </div>
      <div className="hidden md:flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          onClick={onScrollLeft}
          disabled={!onCanLeft}
          aria-label="Прокрутить категории влево"
          className={cn(
            'h-9 w-9 rounded-full grid place-items-center ring-1 ring-black/[0.06] dark:ring-white/[0.08] bg-card shadow-[0_4px_14px_-8px_rgba(15,23,42,0.4)] transition-all',
            onCanLeft ? 'text-foreground hover:text-primary hover:ring-primary/40 active:scale-95' : 'opacity-35 pointer-events-none',
          )}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onScrollRight}
          disabled={!onCanRight}
          aria-label="Прокрутить категории вправо"
          className={cn(
            'h-9 w-9 rounded-full grid place-items-center ring-1 ring-black/[0.06] dark:ring-white/[0.08] bg-card shadow-[0_4px_14px_-8px_rgba(15,23,42,0.4)] transition-all',
            onCanRight ? 'text-foreground hover:text-primary hover:ring-primary/40 active:scale-95' : 'opacity-35 pointer-events-none',
          )}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

/* ---------- individual card ---------- */

function CategoryCard({ cat, idx, onSelect }: { cat: Category; idx: number; onSelect: (s: string) => void }) {
  const { resolvedTheme } = useTheme()
  const dark = resolvedTheme === 'dark' || resolvedTheme === 'neon'
  const pal = paletteFor(cat.name, dark)
  const Icon = iconFor(cat)

  // Optional cover image behind the tile (Studio may attach it)
  const cover = (cat as any).imageUrl ? assetUrl((cat as any).imageUrl) : null

  return (
    <motion.button
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.35, delay: Math.min(idx, 8) * 0.05, ease: [0.22, 1, 0.36, 1] }}
      onClick={() => { haptic.tap(); onSelect(cat.name) }}
      whileTap={{ scale: 0.96 }}
      className="cat-shine group relative shrink-0 w-[calc((100%-16px)/3)] md:w-[200px] h-[108px] md:h-[156px] rounded-[18px] md:rounded-[24px] overflow-hidden text-left snap-start"
      style={{
        background: `linear-gradient(145deg, ${pal.from} 0%, ${pal.to} 100%)`,
        boxShadow: dark
          ? '0 24px 48px -26px rgba(0, 0, 0, 0.6), 0 6px 18px -12px rgba(0, 0, 0, 0.35)'
          : `0 26px 50px -30px ${hexToRgba(pal.solid, 0.4)}, 0 6px 18px -12px rgba(15,23,42,0.08), inset 0 1px 0 rgba(255,255,255,.7)`,
      }}
    >
      {cover && (
        <>
          <Image src={cover} alt="" fill sizes="220px" className="object-cover" loading="lazy" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/15 to-transparent" />
        </>
      )}

      {/* v25.22: декоративные кольца уменьшены под компактную плитку */}
      {!cover && (
        <>
          <span aria-hidden className="pointer-events-none absolute -right-8 -top-10 h-24 w-24 rounded-full border-[10px] border-white/25" />
          <span aria-hidden className="pointer-events-none absolute -left-6 -bottom-9 h-20 w-20 rounded-full border-[8px] border-white/20" />
        </>
      )}

      <TileInner>
        <IconDisc light={!!cover}>
          <Icon
            className="h-[16px] w-[16px] md:h-[22px] md:w-[22px]"
            strokeWidth={2.1}
            style={{ color: cover ? '#fff' : pal.solid }}
          />
        </IconDisc>
        <CardFooter
          title={cat.name}
          subtitle={
            typeof cat.productsCount === 'number' && cat.productsCount > 0
              ? `${cat.productsCount} ${pluralizeProducts(cat.productsCount)}`
              : 'Смотреть товары'
          }
          color={cover ? '#FFFFFF' : pal.solid}
        />
      </TileInner>
    </motion.button>
  )
}
