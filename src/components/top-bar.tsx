'use client'

import { Home, LayoutGrid, Film, MessageCircle, User, Search, ShoppingBag, Heart, Sparkles, MoreHorizontal } from 'lucide-react'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/lib/auth-store'
import { useCartStore, useFavoritesStore } from '@/lib/cart-store'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { initials } from '@/lib/format'
import { useClubStore } from '@/modules/999-club'
import { useAudioPlayer } from '@/lib/audio-player-manager'
import { useModuleAccess, isModuleEnabled } from '@/lib/use-module-access'

// v25.11: TopBar — replaces the left vertical Sidebar on desktop.
// Sticky horizontal bar at the top with text labels (not icon-only).
//
// Layout:
//   [Logo TRI999] [Home] [Catalog] [Media Hub] [Chat] [Profile] ... [Search] [Cart] [AI] [CLUB] [Avatar]
//
// Mobile uses MobileHeader + BottomNav — this bar is desktop-only (md+).

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
        'hidden md:flex sticky top-0 z-30 h-16 items-center justify-center px-4 lg:px-6 relative',
        'backdrop-blur-xl bg-background/85 border-b border-border/40',
      )}
    >
      {/* v25.12: logo + nav CENTERED together as one group */}

      {/* Center group: logo + nav */}
      <div className="flex items-center gap-4">
        {/* Logo */}
        <button
          onClick={() => onNavigate('home')}
          className="shrink-0 flex items-center"
          aria-label="TRI999 — на главную"
        >
          <span
            className="font-extrabold text-xl tracking-tight"
            style={{
              backgroundImage: 'linear-gradient(135deg, #EC4899 0%, #A855F7 50%, #9333EA 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
              filter: 'drop-shadow(0 2px 8px rgba(160,32,112,0.4))',
            }}
          >
            TRI999
          </span>
        </button>

        {/* Nav items — right of logo, centered as a group */}
        <nav className="flex items-center gap-0.5">
          {visibleNav.map((item) => {
            const Icon = item.icon
            const isFeed = (item as any).isFeed === true
            const active = isFeed ? false : view === item.id
            if (isFeed) {
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    if (typeof window !== 'undefined') {
                      window.dispatchEvent(new CustomEvent('open-feed'))
                    }
                  }}
                  className={cn(
                    'inline-flex items-center gap-1.5 h-9 px-3 rounded-full text-sm font-medium transition-all',
                    'text-muted-foreground hover:text-foreground hover:bg-foreground/5',
                  )}
                  aria-label="Лента товаров"
                >
                  <Film className="h-4 w-4" />
                  Лента
                </button>
              )
            }
            return (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                className={cn(
                  'inline-flex items-center gap-1.5 h-9 px-3 rounded-full text-sm font-medium transition-all',
                  active
                    ? 'gradient-brand text-white shadow-glow'
                    : 'text-muted-foreground hover:text-foreground hover:bg-foreground/5',
                )}
                aria-current={active ? 'page' : undefined}
              >
                {Icon && <Icon className="h-4 w-4" strokeWidth={active ? 2.4 : 2} />}
                {item.label}
                {item.id === 'chat' && (
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]" />
                )}
              </button>
            )
          })}
        </nav>
      </div>

      {/* Right side — absolute right */}
      <div className="flex items-center gap-1 absolute right-4 lg:right-6">
        {/* Search */}
        <button
          onClick={onOpenSearch}
          className={cn(
            'inline-flex items-center gap-1.5 h-9 px-3 rounded-full text-sm font-medium transition-all',
            view === 'search'
              ? 'gradient-brand text-white shadow-glow'
              : 'text-muted-foreground hover:text-foreground hover:bg-foreground/5',
          )}
          aria-label="Поиск · ⌘K"
        >
          <Search className="h-4 w-4" strokeWidth={2.2} />
          <span className="hidden lg:inline">Поиск</span>
          <kbd className="hidden lg:inline-block text-[10px] px-1.5 py-0.5 rounded bg-foreground/5 text-muted-foreground">⌘K</kbd>
        </button>

        {/* CLUB */}
        {isModuleEnabled(modules, 'club') && (
          <button
            onClick={() => onNavigate('club')}
            className={cn(
              'inline-flex items-center gap-1.5 h-9 px-3 rounded-full text-sm font-semibold transition-all',
              view === 'club'
                ? 'gradient-brand text-white shadow-glow'
                : 'text-amber-600 hover:bg-amber-500/10',
            )}
            aria-label="999 CLUB"
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
            <span className="hidden lg:inline">CLUB</span>
            {clubHasUnread && (
              <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
            )}
          </button>
        )}

        {/* AI */}
        {isModuleEnabled(modules, 'ai-assistant') && (
          <button
            onClick={() => typeof window !== 'undefined' && window.dispatchEvent(new CustomEvent('open-ai-assistant'))}
            className="inline-flex items-center justify-center h-9 w-9 rounded-full text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-all"
            aria-label="AI-ассистент"
          >
            <Sparkles className="h-4 w-4" />
          </button>
        )}

        {/* Favorites (only if user has favorites) */}
        {favoritesCount > 0 && (
          <button
            onClick={() => onNavigate('profile')}
            className="relative inline-flex items-center justify-center h-9 w-9 rounded-full text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-all"
            aria-label={`Избранное: ${favoritesCount}`}
          >
            <Heart className="h-4 w-4" fill="currentColor" />
            <span className="absolute -top-0.5 -right-0.5 h-4 min-w-4 px-1 rounded-full bg-primary text-white text-[9px] font-bold grid place-items-center">
              {favoritesCount > 9 ? '9+' : favoritesCount}
            </span>
          </button>
        )}

        {/* Cart */}
        {cartCount > 0 && (
          <button
            onClick={() => typeof window !== 'undefined' && window.dispatchEvent(new CustomEvent('open-cart'))}
            className="relative inline-flex items-center justify-center h-9 w-9 rounded-full text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-all"
            aria-label={`Мои заявки: ${cartCount}`}
          >
            <ShoppingBag className="h-4 w-4" strokeWidth={2.2} />
            <span className="absolute -top-0.5 -right-0.5 h-4 min-w-4 px-1 rounded-full bg-primary text-white text-[9px] font-bold grid place-items-center">
              {cartCount > 9 ? '9+' : cartCount}
            </span>
          </button>
        )}

        {/* More */}
        <button
          onClick={onMore}
          className="inline-flex items-center justify-center h-9 w-9 rounded-full text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-all"
          aria-label="Ещё"
        >
          <MoreHorizontal className="h-4 w-4" strokeWidth={2.2} />
        </button>

        {/* Avatar */}
        <button
          onClick={() => onNavigate('profile')}
          className="ml-2 group relative"
          aria-label={user?.displayName || 'Профиль'}
        >
          <Avatar className="h-9 w-9 ring-2 ring-border group-hover:ring-primary/60 transition-all">
            <AvatarImage src={user?.avatar || undefined} alt={user?.displayName || 'user'} />
            <AvatarFallback className="gradient-brand text-white text-xs font-bold">
              {initials(user?.displayName || user?.username) || <User className="h-4 w-4" />}
            </AvatarFallback>
          </Avatar>
          <span className="absolute bottom-0.5 right-0.5 h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-background" />
        </button>
      </div>
    </header>
  )
}
