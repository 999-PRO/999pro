'use client'

// ============================================================================
//  v25.15 TOP BAR — полное обновление десктопной шапки.
//
//  Новое в этом редизайне:
//    • Активный пункт подсвечен «плавающей» градиентной пилюлей, которая
//      ПЕРЕЕЗЖАЕТ между кнопками через framer-motion layoutId (spring) —
//      живая тактильная анимация вместо мгновенной смены классов.
//    • Логотип слева, навигация по центру, действия справа — честная
//      трёхзонная сетка вместо «всё в одной куче».
//    • В навигацию добавлены Сообщества (v25.14 фича — раньше была только
//      через «Ещё»).
//    • Правый кластер унифицирован: круглые стеклянные кнопки одного
//      размера, бейджи поверх колец, мягкий hover-подъём.
//    • Кнопка «Ещё» открывает прежний more-sheet (сохранили поведение).
//
//  Mobile uses MobileHeader + BottomNav — this bar is desktop-only (md+).
// ============================================================================

import { Home, LayoutGrid, Film, MessageCircle, User, Search, ShoppingBag, Heart, Sparkles, MoreHorizontal, Users, Gamepad2 } from 'lucide-react'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/lib/auth-store'
import { useCartStore, useFavoritesStore } from '@/lib/cart-store'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { initials } from '@/lib/format'
import { useClubStore } from '@/modules/999-club'
import { useAudioPlayer } from '@/lib/audio-player-manager'
import { useModuleAccess, isModuleEnabled } from '@/lib/use-module-access'

interface TopBarProps {
  view: string
  onNavigate: (v: string) => void
  onMore: () => void
  onOpenSearch: () => void
}

const NAV = [
  { id: 'home', label: 'Главная', icon: Home },
  { id: 'catalog', label: 'Каталог', icon: LayoutGrid },
  { id: 'feed', label: 'Лента', icon: Film, isFeed: true },
  { id: 'community', label: 'Сообщества', icon: Users },
  { id: 'games', label: 'Игры', icon: Gamepad2 },
  { id: 'chat', label: 'Чат', icon: MessageCircle },
  { id: 'profile', label: 'Профиль', icon: User },
] as const

export function TopBar({ view, onNavigate, onMore, onOpenSearch }: TopBarProps) {
  const user = useAuthStore((s) => s.user)
  const favoritesCount = useFavoritesStore((s) => s.ids.length)
  const cartCount = useCartStore((s) => s.count())
  const clubHasUnread = useClubStore((s) => s.hasUnread)
  const audioIsPlaying = useAudioPlayer((s) => s.isPlaying)
  const modules = useModuleAccess()
  const visibleNav = NAV.filter((item) => isModuleEnabled(modules, item.id))

  return (
    <header
      className={cn(
        // v25.16: h-[68px] для воздухообразности, тонкий нижний хейрлайн
        'hidden md:flex sticky top-0 z-30 h-[68px] items-center px-4 lg:px-8 relative',
        'backdrop-blur-2xl bg-background/78',
      )}
    >
      {/* ═══ v25.16: премиальный верхний акцентный штрих — тонкая градиентная
          линия по верхней кромке шапки (брендовая подпись окна) ═══ */}
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 h-[2px] pointer-events-none opacity-80"
        style={{ background: 'linear-gradient(90deg,#EC4899 0%,#A855F7 45%,#6366F1 75%,#FB923C 100%)' }}
      />
      {/* нижний хейрлайн */}
      <span
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-px pointer-events-none"
        style={{ background: 'var(--border)' }}
      />
      {/* ── Лево: логотип ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 shrink-0">
        <button
          onClick={() => onNavigate('home')}
          className="group flex items-center gap-2.5"
          aria-label="TRI999 — на главную"
        >
          {/* v25.16: брендовый квадрат со скруглением, градиентной рамкой и
              тремя точками внутри; при наведении точки «оживают» */}
          <span
            className="relative grid grid-cols-3 gap-[3px] p-[7px] rounded-2xl transition-transform duration-300 group-hover:scale-105 group-active:scale-95"
            style={{
              background: 'linear-gradient(135deg, rgba(236,72,153,0.14), rgba(168,85,247,0.12), rgba(251,146,60,0.14))',
              boxShadow: 'inset 0 0 0 1px rgba(236,72,153,0.22)',
            }}
          >
            {[0, 1, 2].map((i) => (
              <motion.span
                key={i}
                className="h-[5px] w-[5px] rounded-full self-center justify-self-center"
                style={{
                  background:
                    i === 0 ? '#EC4899' : i === 1 ? '#A855F7' : '#FB923C',
                }}
                animate={audioIsPlaying ? { scale: [1, 1.35, 1] } : { scale: 1 }}
                transition={{ duration: 1 + i * 0.2, repeat: audioIsPlaying ? Infinity : 0, ease: 'easeInOut' }}
              />
            ))}
          </span>
          <span
            className="font-extrabold text-lg tracking-tight transition-opacity group-hover:opacity-85"
            style={{
              backgroundImage: 'linear-gradient(135deg, #EC4899 0%, #A855F7 50%, #9333EA 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            TRI999
          </span>
        </button>
      </div>

      {/* ── Центр: навигация с плавающей активной пилюлей ─────────────── */}
      <nav className="absolute left-1/2 -translate-x-1/2 hidden lg:flex items-center gap-0.5 rounded-full p-1 bg-foreground/[0.04] ring-1 ring-black/[0.03] dark:ring-white/[0.05]">
        {visibleNav.map((item) => {
          const Icon = item.icon
          const isFeed = (item as any).isFeed === true
          const active = isFeed ? false : view === item.id

          const inner = (
            <>
              {active && (
                <motion.span
                  layoutId="topbar-nav-pill"
                  className="absolute inset-0 rounded-full gradient-brand shadow-glow"
                  transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                />
              )}
              <span
                className={cn(
                  'relative z-10 inline-flex items-center gap-1.5 text-sm font-medium',
                  active ? 'text-white' : 'text-muted-foreground group-hover:text-foreground',
                )}
              >
                <Icon className="h-4 w-4" strokeWidth={active ? 2.4 : 2} />
                {item.label}
                {item.id === 'chat' && !active && (
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]" />
                )}
              </span>
            </>
          )

          if (isFeed) {
            return (
              <button
                key={item.id}
                onClick={() => window.dispatchEvent(new CustomEvent('open-feed'))}
                className="group relative h-8 pl-3 pr-3.5 rounded-full text-sm font-medium transition-all"
                aria-label="Лента товаров"
              >
                {inner}
              </button>
            )
          }
          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              className="group relative h-8 px-3.5 rounded-full transition-all"
              aria-current={active ? 'page' : undefined}
            >
              {inner}
            </button>
          )
        })}
      </nav>

      {/* Центр для md (узкий десктоп/планшет) — простые текстовые пункты */}
      <nav className="hidden md:flex lg:hidden items-center gap-0.5 mx-auto">
        {visibleNav.map((item) => {
          const isFeed = (item as any).isFeed === true
          const active = isFeed ? false : view === item.id
          if (isFeed) {
            return (
              <button
                key={item.id}
                onClick={() => window.dispatchEvent(new CustomEvent('open-feed'))}
                className="h-9 px-2.5 rounded-full text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-all"
              >
                <item.icon className="h-4 w-4 inline mr-1" />
                {item.label}
              </button>
            )
          }
          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              className={cn(
                'h-9 px-2.5 rounded-full text-xs font-medium transition-all',
                active
                  ? 'gradient-brand text-white shadow-glow'
                  : 'text-muted-foreground hover:text-foreground hover:bg-foreground/5',
              )}
              aria-current={active ? 'page' : undefined}
            >
              <item.icon className="h-4 w-4 inline mr-1" />
              {item.label}
            </button>
          )
        })}
      </nav>

      {/* ── Право: действия ───────────────────────────────────────────── */}
      <div className="flex items-center gap-1 ml-auto shrink-0">
        {/* Поиск — единственная «широкая» пилюля справа */}
        <button
          onClick={onOpenSearch}
          className={cn(
            'inline-flex items-center gap-1.5 h-9 pl-3 pr-3.5 rounded-full text-sm font-medium transition-all',
            view === 'search'
              ? 'gradient-brand text-white shadow-glow'
              : 'bg-foreground/[0.05] hover:bg-foreground/[0.09] text-muted-foreground hover:text-foreground',
          )}
          aria-label="Поиск · ⌘K"
        >
          <Search className="h-4 w-4" strokeWidth={2.2} />
          <kbd className="hidden xl:inline-block text-[10px] px-1.5 py-0.5 rounded bg-background/60 text-muted-foreground border border-border/50">⌘K</kbd>
        </button>

        <div className="w-px h-6 bg-border/70 mx-1" />

        {/* CLUB */}
        {isModuleEnabled(modules, 'club') && (
          <IconAction
            onClick={() => onNavigate('club')}
            label="999 CLUB"
            active={view === 'club'}
            amber={view !== 'club'}
          >
            <svg
              className="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M2 4l3 12h14l3-12-6 7-4-7-4 7-6-7z" />
              <path d="M5 20h14" />
            </svg>
            {clubHasUnread && <BadgeDot className="bg-amber-500 animate-pulse" />}
          </IconAction>
        )}

        {/* AI */}
        {isModuleEnabled(modules, 'ai-assistant') && (
          <IconAction
            onClick={() => window.dispatchEvent(new CustomEvent('open-ai-assistant'))}
            label="AI-ассистент"
          >
            <Sparkles className="h-4 w-4" />
          </IconAction>
        )}

        {/* Избранное */}
        {favoritesCount > 0 && (
          <IconAction onClick={() => onNavigate('profile')} label={`Избранное: ${favoritesCount}`}>
            <Heart className="h-4 w-4 fill-current" />
            <CountPill>{favoritesCount > 9 ? '9+' : favoritesCount}</CountPill>
          </IconAction>
        )}

        {/* Корзина / заявки */}
        {cartCount > 0 && (
          <IconAction
            onClick={() => window.dispatchEvent(new CustomEvent('open-cart'))}
            label={`Мои заявки: ${cartCount}`}
          >
            <ShoppingBag className="h-4 w-4" strokeWidth={2.2} />
            <CountPill>{cartCount > 9 ? '9+' : cartCount}</CountPill>
          </IconAction>
        )}

        {/* Ещё */}
        <IconAction onClick={onMore} label="Ещё">
          <MoreHorizontal className="h-4 w-4" strokeWidth={2.2} />
        </IconAction>

        {/* Аватар */}
        <button
          onClick={() => onNavigate('profile')}
          className="ml-1.5 group relative"
          aria-label={user?.displayName || 'Профиль'}
        >
          <Avatar className="h-9 w-9 ring-2 ring-border group-hover:ring-primary/60 transition-all">
            <AvatarImage src={user?.avatar || undefined} alt={user?.displayName || 'user'} />
            <AvatarFallback className="gradient-brand text-white text-xs font-bold">
              {initials(user?.displayName || user?.username) || <User className="h-4 w-4" />}
            </AvatarFallback>
          </Avatar>
          <span className="absolute bottom-0 right-0 h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-background" />
        </button>
      </div>
    </header>
  )
}

/* ---------- маленькие строительные блоки v25.15 ---------- */

function IconAction({
  children,
  onClick,
  label,
  active,
  amber,
}: {
  children: React.ReactNode
  onClick: () => void
  label: string
  active?: boolean
  amber?: boolean
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        'relative inline-flex items-center justify-center h-9 w-9 rounded-full transition-all',
        'hover:-translate-y-0.5 active:scale-95',
        active
          ? 'gradient-brand text-white shadow-glow'
          : amber
            ? 'text-amber-600 hover:bg-amber-500/10 dark:text-amber-400'
            : 'text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06]',
      )}
    >
      {children}
    </button>
  )
}

function CountPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="absolute -top-0.5 -right-0.5 h-4 min-w-4 px-1 rounded-full bg-primary text-white text-[9px] font-bold grid place-items-center ring-2 ring-background">
      {children}
    </span>
  )
}

function BadgeDot({ className }: { className?: string }) {
  return <span className={cn('absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-background', className)} />
}
