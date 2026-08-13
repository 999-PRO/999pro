'use client'

import { useEffect } from 'react'
import { Home, LayoutGrid, User, MoreHorizontal, MessageCircle, Sparkles, Clapperboard } from 'lucide-react'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { useCartStore } from '@/lib/cart-store'
import { haptic } from '@/lib/haptic'
import { setAppBadge, clearAppBadge } from '@/lib/badge'
import { useNotificationsStore } from '@/lib/use-notifications'
import { useAudioPlayer } from '@/lib/audio-player-manager'
import { MediaHubIcon } from '@/components/icons/media-hub-icon'
// v19.0: module access filtering
import { useModuleAccess, isModuleEnabled } from '@/lib/use-module-access'
// v25.9.10: removed useAISession import — no longer needed since the Power
// toggle was removed from the AI header.

// ============================================================================
//  BottomNav — mobile primary navigation (v25.5, TZ-3 task #10)
//  ----------------------------------------------------------------------------
//  v25.5: FULLY DYNAMIC LAYOUT. Previously used `grid grid-cols-6` which left
//  gaps when sections were hidden via Studio's module-access settings. Now
//  uses `flex` with `flex-1` on each item — when a section is hidden, the
//  remaining items automatically redistribute to fill the space evenly,
//  always centered, with consistent spacing. No gaps, no empty cells.
//
//  The visual design is UNCHANGED — same icon sizes, same pill shapes, same
//  active states, same badges. Only the layout container changed from
//  fixed-grid to dynamic-flex.
// ============================================================================

// Standard nav items (left side) — filtered by module access.
// v25.10 (Task #3): 'feed' has a `customEvent` field — instead of switching
// to a real view, it dispatches a window event that opens the ProductFeed
// overlay. Other items navigate normally via `onNavigate(viewId)`.
type NavItem = {
  id: string
  label: string
  icon: typeof Home
  customEvent?: string
}
const NAV: NavItem[] = [
  { id: 'home', label: 'Главная', icon: Home },
  { id: 'catalog', label: 'Каталог', icon: LayoutGrid },
  // v25.10 (Task #3): ProductFeed — fullscreen vertical feed (Reels-style).
  // Rendered as a NAV button that dispatches 'open-feed' window event.
  // The feed itself is mounted globally in AppShell.
  { id: 'feed', label: 'Лента', icon: Clapperboard, customEvent: 'open-feed' },
  { id: 'chat', label: 'Чат', icon: MessageCircle },
]

export function BottomNav({
  view,
  onNavigate,
  onMore,
}: {
  view: string
  onNavigate: (v: string) => void
  onMore: () => void
}) {
  const cartCount = useCartStore((s) => s.count())
  const unreadTotal = useNotificationsStore((s) => s.unread.total)
  const audioIsPlaying = useAudioPlayer((s) => s.isPlaying)
  const modules = useModuleAccess()
  // v25.9.10: removed `aiEnabled` check — the AI should always be accessible
  // from the nav button. The Power toggle was removed from the AI header.

  // v25.5: Build the COMPLETE list of nav items dynamically, then filter by
  // module access. Each item gets `flex-1` so they redistribute evenly when
  // some are hidden. The "More" button is always last and always visible.
  const visibleNav = NAV.filter((item) => isModuleEnabled(modules, item.id))
  const showMediaHub = isModuleEnabled(modules, 'media-hub')
  const showProfile = isModuleEnabled(modules, 'profile')
  // v25.9: AI button respects both the module-access setting (Studio can
  // disable AI assistant globally) and the user's on/off toggle.
  const showAI = isModuleEnabled(modules, 'ai-assistant')

  // v10-native: update the app icon badge when unread count changes.
  useEffect(() => {
    if (unreadTotal > 0) {
      setAppBadge(unreadTotal)
    } else {
      clearAppBadge()
    }
  }, [unreadTotal])

  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 z-40 mobile-nav-bar"
      style={{
        borderTopLeftRadius: '28px',
        borderTopRightRadius: '28px',
        borderBottomLeftRadius: '0',
        borderBottomRightRadius: '0',
        paddingBottom: 'env(safe-area-inset-bottom)',
        overflow: 'visible',
      }}
      aria-label="Primary navigation"
    >
      {/* Decorative soft glow blobs */}
      <div
        aria-hidden
        className="absolute -top-10 -left-10 h-32 w-32 rounded-full bg-white/20 blur-3xl pointer-events-none"
      />
      <div
        aria-hidden
        className="absolute -bottom-12 -right-12 h-40 w-40 rounded-full bg-sky-300/30 blur-3xl pointer-events-none"
      />

      <div className="relative px-2 py-2">
        {/*
          v25.5 (TZ-3 task #10): DYNAMIC FLEX LAYOUT.
          Each nav item has `flex-1` so they take equal space and redistribute
          automatically when items are hidden. `justify-around` as a fallback
          ensures even spacing even if `flex-1` is overridden by content width.
          No more `grid-cols-6` — no more empty cells when sections are hidden.
        */}
        <div className="flex items-center justify-around">
          {/* Standard nav items (home, catalog, chat) — filtered by module access */}
          {visibleNav.map((item) => {
            const Icon = item.icon
            const active = view === item.id
            return (
              <button
                key={item.id}
                onClick={() => {
                  haptic.tap()
                  // v25.10: 'feed' is not a real view — it opens the
                  // fullscreen ProductFeed overlay via window event.
                  if (item.customEvent && typeof window !== 'undefined') {
                    window.dispatchEvent(new CustomEvent(item.customEvent))
                  } else {
                    onNavigate(item.id)
                  }
                }}
                className={cn(
                  'relative flex flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] transition-colors mobile-nav-item flex-1 min-w-0',
                  active && 'mobile-nav-item-active',
                )}
                aria-current={active ? 'page' : undefined}
              >
                <span
                  className={cn(
                    'relative grid place-items-center h-8 w-11 rounded-full transition-all',
                    active && 'mobile-nav-pill-active',
                  )}
                >
                  <Icon className="h-5 w-5" strokeWidth={active ? 2.4 : 2} />
                  {item.id === 'chat' && unreadTotal > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 h-3.5 min-w-3.5 px-1 rounded-full bg-emerald-500 text-white text-[9px] font-bold grid place-items-center">
                      {unreadTotal > 9 ? '9+' : unreadTotal}
                    </span>
                  )}
                </span>
                <span className="font-medium leading-none">{item.label}</span>
              </button>
            )
          })}

          {/* Media Hub — conditional on module access */}
          {showMediaHub && (
            <button
              onClick={() => {
                haptic.tap()
                if (typeof window !== 'undefined') {
                  window.dispatchEvent(new CustomEvent('open-media-hub'))
                }
              }}
              className="relative flex flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] transition-colors mobile-nav-item flex-1 min-w-0"
              aria-label="Media Hub — музыка и фильмы"
            >
              <motion.span
                className="relative grid place-items-center h-9 w-11 rounded-full transition-all"
                style={{
                  background:
                    'linear-gradient(135deg, rgba(124,58,237,0.25) 0%, rgba(236,72,153,0.18) 50%, rgba(59,130,246,0.25) 100%)',
                }}
                animate={
                  audioIsPlaying
                    ? {
                        boxShadow: [
                          '0 0 0px 0px rgba(168,85,247,0)',
                          '0 0 14px 3px rgba(168,85,247,0.6)',
                          '0 0 0px 0px rgba(168,85,247,0)',
                        ],
                      }
                    : {}
                }
                transition={
                  audioIsPlaying
                    ? { duration: 1.8, repeat: Infinity, ease: 'easeInOut' }
                    : {}
                }
              >
                <MediaHubIcon size={22} animated={audioIsPlaying} />
                {audioIsPlaying && (
                  <span className="absolute -bottom-0.5 -right-0.5 flex items-end gap-[1px] h-3 px-0.5 rounded-full bg-background/80">
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
                  </span>
                )}
              </motion.span>
              <span className="font-medium leading-none">Media</span>
            </button>
          )}

          {/* v25.9: AI Agent — separate, prominent button. Available on mobile
              (was previously desktop-only, which is why "AI missing on mobile"
              was reported). Respects module-access + user on/off toggle. */}
          {showAI && (
            <button
              onClick={() => {
                haptic.tap()
                if (typeof window !== 'undefined') {
                  window.dispatchEvent(new CustomEvent('open-ai-assistant'))
                }
              }}
              className="relative flex flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] transition-colors mobile-nav-item flex-1 min-w-0"
              aria-label="AI Агент"
            >
              <span
                className="relative grid place-items-center h-9 w-11 rounded-full transition-all"
                style={{
                  background:
                    'linear-gradient(135deg, rgba(99,102,241,0.35) 0%, rgba(168,85,247,0.30) 50%, rgba(217,70,239,0.35) 100%)',
                }}
              >
                <Sparkles className="h-5 w-5 text-indigo-500 dark:text-indigo-300" />
              </span>
              <span className="font-medium leading-none">AI</span>
            </button>
          )}

          {/* Profile — conditional on module access */}
          {showProfile && (
            <button
              onClick={() => {
                haptic.tap()
                onNavigate('profile')
              }}
              className={cn(
                'relative flex flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] transition-colors mobile-nav-item flex-1 min-w-0',
                view === 'profile' && 'mobile-nav-item-active',
              )}
              aria-current={view === 'profile' ? 'page' : undefined}
              aria-label="Профиль"
            >
              <span
                className={cn(
                  'relative grid place-items-center h-8 w-11 rounded-full transition-all',
                  view === 'profile' && 'mobile-nav-pill-active',
                )}
              >
                <User className="h-5 w-5" strokeWidth={view === 'profile' ? 2.4 : 2} />
                {cartCount > 0 && (
                  <span className="absolute -top-1 -right-1 h-4 min-w-4 px-1 rounded-full gradient-brand text-white text-[10px] font-bold grid place-items-center shadow-[0_2px_8px_-1px_rgba(37,99,235,0.45)] ring-2 ring-white/90 dark:ring-white/15">
                    {cartCount}
                  </span>
                )}
              </span>
              <span className="font-medium leading-none">Профиль</span>
            </button>
          )}

          {/* More button — always visible, always last */}
          <button
            onClick={onMore}
            className={cn(
              'relative flex flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] transition-colors mobile-nav-item flex-1 min-w-0',
              view === 'more' && 'mobile-nav-item-active',
            )}
            aria-label="Ещё"
          >
            <span
              className={cn(
                'relative grid place-items-center h-8 w-11 rounded-full transition-all',
                view === 'more' && 'mobile-nav-pill-active',
              )}
            >
              <MoreHorizontal className="h-5 w-5" strokeWidth={view === 'more' ? 2.4 : 2} />
            </span>
            <span className="font-medium leading-none">Ещё</span>
          </button>
        </div>
      </div>
    </nav>
  )
}
