'use client'

import { Home, LayoutGrid, MessageCircle, User, MoreHorizontal, Search, ShoppingBag, Heart, Sparkles, Clapperboard } from 'lucide-react'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/lib/auth-store'
import { useCartStore, useFavoritesStore } from '@/lib/cart-store'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { initials } from '@/lib/format'
import { useClubStore } from '@/modules/999-club'
import { useAudioPlayer } from '@/lib/audio-player-manager'
import { MediaHubIcon } from '@/components/icons/media-hub-icon'
// v25.5 (TZ-3 task #10): module access filtering — sidebar now respects
// the same module-access settings as the mobile bottom-nav. Hidden sections
// don't appear, and the remaining items redistribute naturally (the sidebar
// uses flex-col with gap, so items just stack closer when some are hidden).
import { useModuleAccess, isModuleEnabled } from '@/lib/use-module-access'

interface SidebarProps {
  view: string
  onNavigate: (v: string) => void
  onMore: () => void
  onOpenSearch: () => void
}

// v39: CLUB moved to the top section (next to Search + Media Hub) as a
// prominent CTA. Media Hub moved DOWN into the nav stack as a regular item.
// v25.10 (Task #3): NavItem type — 'feed' has an optional customEvent
// field that dispatches a window event instead of switching to a real view.
type NavItem = {
  id: string
  label: string
  icon: typeof Home | typeof MediaHubIcon
  customEvent?: string
}
const NAV: NavItem[] = [
  { id: 'home', label: 'Главная', icon: Home },
  { id: 'catalog', label: 'Каталог', icon: LayoutGrid },
  // v25.10 (Task #3): fullscreen vertical product feed (Reels-style).
  // Opens the ProductFeed overlay via window event (not a real view).
  { id: 'feed', label: 'Лента', icon: Clapperboard, customEvent: 'open-feed' },
  { id: 'media-hub', label: 'Media Hub', icon: MediaHubIcon },
  { id: 'chat', label: 'Чат', icon: MessageCircle },
  { id: 'profile', label: 'Профиль', icon: User },
]

/**
 * Premium compact rail navigation — 72px wide, icon-only with hover tooltips.
 * Inspired by Linear / Arc Browser / Raycast sidebar.
 *
 * Active state: 3px accent bar on the left + soft primary glow + icon fill.
 * Inactive: muted icon, hover lifts to foreground color with subtle bg.
 *
 * Mobile uses MobileHeader + BottomNav — this rail is desktop-only.
 *
 * v18.10: expand/collapse feature removed — back to the original fixed 76px
 * rail (user feedback: expanded mode looked unaesthetic). Only the colorful
 * gradient logo was kept.
 */
export function Sidebar({ view, onNavigate, onMore, onOpenSearch }: SidebarProps) {
  const user = useAuthStore((s) => s.user)
  const favoritesCount = useFavoritesStore((s) => s.ids.length)
  const cartCount = useCartStore((s) => s.count())
  const clubHasUnread = useClubStore((s) => s.hasUnread)
  const audioIsPlaying = useAudioPlayer((s) => s.isPlaying)
  // v25.5: module access — filter nav items the same way as bottom-nav.
  const modules = useModuleAccess()
  const visibleNav = NAV.filter((item) => isModuleEnabled(modules, item.id))

  return (
    <aside className="hidden md:flex w-[76px] xl:w-[88px] shrink-0 fixed top-0 left-0 h-screen flex-col items-center z-50 premium-rail">
      {/* Brand mark — TRI999 wordmark (gradient). */}
      <button
        onClick={() => onNavigate('home')}
        className="mt-6 mb-8 px-1 py-2 group flex flex-col items-center"
        aria-label="TRI999 — на главную"
      >
        <span
          className="block font-extrabold text-base leading-none tracking-tight"
          style={{
            backgroundImage: 'linear-gradient(135deg, #3b82f6 0%, #6366f1 50%, #8b5cf6 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
            filter: 'drop-shadow(0 2px 8px rgba(99,102,241,0.4))',
          }}
        >
          TRI999
        </span>
      </button>

      {/* Search — diamond-shaped command button */}
      <button
        onClick={onOpenSearch}
        className={cn(
          'h-11 w-11 rounded-2xl grid place-items-center transition-all duration-300 group relative premium-tooltip-host',
          view === 'search' ? 'premium-rail-active' : 'premium-rail-item',
        )}
        aria-label="Поиск"
      >
        <Search className="h-[18px] w-[18px]" strokeWidth={2.2} />
        <span className="premium-tooltip">Поиск · ⌘K</span>
      </button>

      {/* v39: 999 CLUB button — moved to the top section (replaces Media Hub).
          Media Hub moved into the nav stack below.
          v25.5: conditional on module access (club). */}
      {isModuleEnabled(modules, 'club') && (
      <button
        onClick={() => onNavigate('club')}
        className={cn(
          'h-11 w-11 rounded-2xl grid place-items-center transition-all duration-300 group relative premium-tooltip-host',
          view === 'club' ? 'premium-rail-active' : 'premium-rail-item',
        )}
        aria-label="999 CLUB"
        style={
          view !== 'club'
            ? {
                backgroundImage:
                  'linear-gradient(135deg, rgba(245,158,11,0.18) 0%, rgba(236,72,153,0.14) 50%, rgba(139,92,246,0.18) 100%)',
              }
            : undefined
        }
      >
        {/* Crown icon — uses lucide Crown (re-imported locally to keep this
            section self-contained). Tinted amber to match the CLUB brand. */}
        <svg
          className="h-[18px] w-[18px]"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={view === 'club' ? 2.4 : 2}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={view !== 'club' ? { color: '#f59e0b' } : undefined}
        >
          <path d="M2 4l3 12h14l3-12-6 7-4-7-4 7-6-7z" />
          <path d="M5 20h14" />
        </svg>
        <span className="premium-tooltip">{clubHasUnread ? 'CLUB · Новое' : '999 CLUB'}</span>
        {/* CLUB unread badge — amber pulsing dot */}
        {clubHasUnread && (
          <span
            className="absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full animate-pulse"
            style={{
              background: 'linear-gradient(135deg, #f59e0b 0%, #ec4899 100%)',
              boxShadow: '0 0 8px rgba(245, 158, 11, 0.6)',
            }}
          />
        )}
      </button>
      )}

      {/* Divider */}
      <div className="my-5 h-px w-7 bg-border/60" />

      {/* Nav — vertical icon stack.
          v25.5: uses `visibleNav` (filtered by module access) instead of `NAV`.
          The sidebar uses flex-col with gap, so when items are hidden the
          remaining items naturally stack closer — no gaps, no empty cells. */}
      <nav className="flex-1 flex flex-col items-center gap-1.5">
        {visibleNav.map((item) => {
          const Icon = item.icon
          // v39: Media Hub is now a nav item — its "active" state is virtual
          // (no view behind it; it just opens an overlay). Treat it as
          // never-active so the icon stays in its idle premium-rail-item style.
          const active = item.id === 'media-hub' ? false : view === item.id
          // v39: Media Hub gets a brand-gradient wash to stand out (replaces
          // the old CLUB treatment that was moved to the top section).
          const isMediaHub = item.id === 'media-hub'
          return (
            <button
              key={item.id}
              onClick={() => {
                if (isMediaHub) {
                  if (typeof window !== 'undefined') {
                    window.dispatchEvent(new CustomEvent('open-media-hub'))
                  }
                } else if (item.customEvent && typeof window !== 'undefined') {
                  // v25.10: 'feed' dispatches a custom event (overlay, not a view).
                  window.dispatchEvent(new CustomEvent(item.customEvent))
                } else {
                  onNavigate(item.id)
                }
              }}
              className={cn(
                'h-11 w-11 rounded-2xl grid place-items-center transition-all duration-300 relative premium-tooltip-host',
                active ? 'premium-rail-active' : 'premium-rail-item',
              )}
              aria-label={item.label}
              aria-current={active ? 'page' : undefined}
              style={
                isMediaHub
                  ? {
                      backgroundImage:
                        'linear-gradient(135deg, rgba(124,58,237,0.18) 0%, rgba(236,72,153,0.12) 50%, rgba(59,130,246,0.18) 100%)',
                    }
                  : undefined
              }
            >
              {/* Media Hub icon needs `size` prop + animation; other icons use className */}
              {isMediaHub ? (
                <MediaHubIcon size={22} animated={audioIsPlaying} />
              ) : (
                <Icon
                  className="h-[18px] w-[18px]"
                  strokeWidth={active ? 2.4 : 2}
                />
              )}
              <span className="premium-tooltip">
                {isMediaHub && audioIsPlaying ? 'Media Hub · Играет' : item.label}
              </span>
              {/* Equalizer indicator when playing */}
              {isMediaHub && audioIsPlaying && (
                <div className="absolute -bottom-0.5 -right-0.5 flex items-end gap-[1px] h-3 px-0.5 rounded-full bg-background/80">
                  {[0, 1, 2].map((i) => (
                    <motion.span
                      key={i}
                      className="w-[2px] rounded-full"
                      style={{ background: '#a855f7', height: '100%', transformOrigin: 'bottom' }}
                      animate={{ scaleY: [0.3, 1, 0.5, 0.3] }}
                      transition={{
                        duration: 0.6 + i * 0.15,
                        repeat: Infinity,
                        ease: 'easeInOut',
                        delay: i * 0.1,
                      }}
                    />
                  ))}
                </div>
              )}
              {/* Notification badge for profile (favorites) */}
              {item.id === 'profile' && favoritesCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 h-4 min-w-4 px-1 rounded-full bg-primary text-white text-[9px] font-bold grid place-items-center">
                  {favoritesCount > 9 ? '9+' : favoritesCount}
                </span>
              )}
              {/* Chat badge placeholder (would show unread count) */}
              {item.id === 'chat' && (
                <span className="absolute top-2 right-2 h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]" />
              )}
            </button>
          )
        })}

        {/* More */}
        <button
          onClick={onMore}
          className="h-11 w-11 rounded-2xl grid place-items-center premium-rail-item transition-all duration-300 relative premium-tooltip-host mt-auto"
          aria-label="Ещё"
        >
          <MoreHorizontal className="h-[18px] w-[18px]" strokeWidth={2.2} />
          <span className="premium-tooltip">Ещё</span>
        </button>
      </nav>

      {/* Cart + Favorites quick access (above avatar) */}
      <div className="mt-4 mb-3 flex flex-col items-center gap-1.5">
        {/* v18.11: AI Assistant button — premium glassmorphism design.
            Replaced the heavy gradient fill with a frosted-glass look:
            - backdrop-blur for the glass effect
            - subtle white border (1px) for the glass edge
            - inner highlight (top) for depth
            - soft outer glow that pulses gently
            - Sparkles icon with a smooth rotation + scale breathing animation
              (replaced the pulsing ring which looked too aggressive).
            v25.9: button now respects the Studio module-access toggle
            (admins can disable AI assistant globally) and the user's own
            on/off toggle (Power icon in the AI header). */}
        {isModuleEnabled(modules, 'ai-assistant') && (
        <button
          onClick={() => typeof window !== 'undefined' && window.dispatchEvent(new CustomEvent('open-ai-assistant'))}
          className="relative h-11 w-11 rounded-2xl grid place-items-center transition-all duration-300 group premium-tooltip-host hover:scale-105 active:scale-95 overflow-hidden"
          aria-label="AI-ассистент"
          style={{
            background: 'rgba(255, 255, 255, 0.08)',
            backdropFilter: 'blur(20px) saturate(180%)',
            WebkitBackdropFilter: 'blur(20px) saturate(180%)',
            border: '1px solid rgba(255, 255, 255, 0.18)',
            boxShadow:
              'inset 0 1px 0 0 rgba(255, 255, 255, 0.25), ' +
              'inset 0 -1px 0 0 rgba(0, 0, 0, 0.1), ' +
              '0 4px 16px -4px rgba(99, 102, 241, 0.35)',
          }}
        >
          {/* Top gloss highlight — gives the glass a "shiny" look */}
          <span
            aria-hidden
            className="absolute inset-x-1 top-0.5 h-1/2 rounded-t-2xl pointer-events-none"
            style={{
              background: 'linear-gradient(180deg, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.04) 60%, transparent 100%)',
            }}
          />
          {/* Soft glow that breathes — replaces the aggressive pulsing ring */}
          <motion.span
            aria-hidden
            className="absolute inset-0 rounded-2xl pointer-events-none"
            animate={{
              boxShadow: [
                '0 0 0px 0px rgba(99, 102, 241, 0.0)',
                '0 0 18px 2px rgba(99, 102, 241, 0.4)',
                '0 0 0px 0px rgba(99, 102, 241, 0.0)',
              ],
            }}
            transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
          />
          {/* Sparkles icon with gentle rotation + scale breathing animation */}
          <motion.div
            animate={{
              rotate: [0, 8, -8, 0],
              scale: [1, 1.12, 1],
            }}
            transition={{
              duration: 4,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
            className="relative z-10"
            style={{ filter: 'drop-shadow(0 0 6px rgba(139, 92, 246, 0.5))' }}
          >
            <Sparkles
              className="h-[18px] w-[18px]"
              strokeWidth={2.3}
              style={{
                color: '#a78bfa',
              }}
            />
          </motion.div>
          <span className="premium-tooltip">AI-ассистент</span>
        </button>
        )}
        {cartCount > 0 && (
          <button
            onClick={() => typeof window !== 'undefined' && window.dispatchEvent(new CustomEvent('open-cart'))}
            className="h-10 w-10 rounded-xl grid place-items-center premium-rail-item transition-all duration-300 relative premium-tooltip-host"
            aria-label={`Корзина: ${cartCount}`}
          >
            <ShoppingBag className="h-4 w-4" strokeWidth={2.2} />
            <span className="absolute -top-0.5 -right-0.5 h-4 min-w-4 px-1 rounded-full bg-primary text-white text-[9px] font-bold grid place-items-center">
              {cartCount > 9 ? '9+' : cartCount}
            </span>
            <span className="premium-tooltip">Корзина · {cartCount}</span>
          </button>
        )}
        {favoritesCount > 0 && (
          <button
            onClick={() => onNavigate('profile')}
            className="h-10 w-10 rounded-xl grid place-items-center premium-rail-item transition-all duration-300 relative premium-tooltip-host"
            aria-label={`Избранное: ${favoritesCount}`}
          >
            <Heart className="h-4 w-4" strokeWidth={2.2} fill="currentColor" />
            <span className="premium-tooltip">Избранное · {favoritesCount}</span>
          </button>
        )}
      </div>

      {/* Avatar — bottom, premium ring */}
      <button
        onClick={() => onNavigate('profile')}
        className="mb-6 mt-2 group relative"
        aria-label={user?.displayName || 'Профиль'}
      >
        <Avatar className="h-11 w-11 ring-2 ring-border group-hover:ring-primary/60 transition-all duration-300 group-hover:scale-105">
          <AvatarImage src={user?.avatar || undefined} alt={user?.displayName || 'user'} />
          <AvatarFallback className="gradient-brand text-white text-xs font-bold">
            {initials(user?.displayName || user?.username) || <User className="h-4 w-4" />}
          </AvatarFallback>
        </Avatar>
        {/* Online indicator */}
        <span className="absolute bottom-0.5 right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-background" />
      </button>
    </aside>
  )
}
