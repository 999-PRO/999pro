'use client'

import { useEffect } from 'react'
import { Home, LayoutGrid, User, MoreHorizontal, MessageCircle } from 'lucide-react'
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

// v39: CLUB moved to the mobile header (replaces Media Hub button there).
// Media Hub now lives in the bottom-nav center slot (replaces ClubNavBadge).

const NAV = [
  { id: 'home', label: 'Главная', icon: Home },
  { id: 'catalog', label: 'Каталог', icon: LayoutGrid },
  // v18.11: chat moved back to bottom-nav (was using a floating button).
  { id: 'chat', label: 'Чат', icon: MessageCircle },
] as const

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
  // v39: track audio playback for the Media Hub nav-item animation.
  const audioIsPlaying = useAudioPlayer((s) => s.isPlaying)
  // v19.0: module access
  const modules = useModuleAccess()
  const visibleNav = NAV.filter((item) => isModuleEnabled(modules, item.id))

  // v10-native: update the app icon badge when unread count changes.
  // Shows a red number on the app icon (like Telegram/WhatsApp) on
  // Chrome/Edge Android + Safari iOS 16.4+ (when installed as PWA).
  // No-op on browsers without the Badging API.
  useEffect(() => {
    if (unreadTotal > 0) {
      setAppBadge(unreadTotal)
    } else {
      clearAppBadge()
    }
  }, [unreadTotal])

  // Fixed bottom nav: pinned to bottom: 0, no gap. Top corners are rounded,
  // bottom corners are square so it visually merges with the bottom edge.
  //
  // Same visual language as the header: translucent glassmorphism + soft
  // blue gradient + white text. Forms a unified design system with the header.
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
        {/* v18.11: 6 columns = 3 standard nav items (home, catalog, chat) +
            Media Hub + Profile button + More button. Chat moved from floating
            button back to the bottom-nav per user request. */}
        <div className="grid grid-cols-6 items-center">
          {visibleNav.map((item) => {
            const Icon = item.icon
            const active = view === item.id
            return (
              <button
                key={item.id}
                onClick={() => {
                  haptic.tap() // v10-native: haptic on tab switch
                  onNavigate(item.id)
                }}
                className={cn(
                  'relative flex flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] transition-colors mobile-nav-item',
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
                  {/* v18.11: unread badge on chat icon (was on the floating button before). */}
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

          {/* v39: Media Hub now sits in the CENTER of the nav (replaces CLUB).
              CLUB was moved to the mobile header. The center slot keeps the
              most visually distinct entry — Media Hub with brand gradient + animated equalizer when playing. */}
          {/* v19.0: hide Media Hub if module disabled */}
          {isModuleEnabled(modules, 'media-hub') && (
          <button
            onClick={() => {
              haptic.tap()
              if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('open-media-hub'))
              }
            }}
            className="relative flex flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] transition-colors mobile-nav-item"
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
              {/* Equalizer indicator when playing */}
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

          {/* Profile — moved to 4th position (was 4th before, but with chat
              removed it's now visually right-of-center, the conventional
              "me" position in mobile apps). Keeps cart badge for quick access. */}
          {/* v19.0: hide Profile if module disabled */}
          {isModuleEnabled(modules, 'profile') && (
          <button
            onClick={() => {
              haptic.tap()
              onNavigate('profile')
            }}
            className={cn(
              'relative flex flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] transition-colors mobile-nav-item',
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

          {/* More button */}
          <button
            onClick={onMore}
            className={cn(
              'relative flex flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] transition-colors mobile-nav-item',
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
