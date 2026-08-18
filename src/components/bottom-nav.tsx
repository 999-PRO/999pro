'use client'

import { useEffect } from 'react'
import { Home, LayoutGrid, Film, Sparkles, MoreHorizontal, ClipboardList } from 'lucide-react'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { useCartStore } from '@/lib/cart-store'
import { haptic } from '@/lib/haptic'
import { setAppBadge, clearAppBadge } from '@/lib/badge'
import { useNotificationsStore } from '@/lib/use-notifications'
import { useModuleAccess, isModuleEnabled } from '@/lib/use-module-access'

// v25.12: bottom-nav with 6 items — added "Лента" (Reels) as a separate tab.
// Layout: [Главная] [Каталог] [Лента] [AI — центр] [Заявки] [Ещё]
// (6 items, AI in center with gradient)

const NAV = [
  { id: 'home', label: 'Главная', icon: Home },
  { id: 'catalog', label: 'Каталог', icon: LayoutGrid },
  { id: 'feed', label: 'Лента', icon: Film, isFeed: true },
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
  const modules = useModuleAccess()

  const visibleNav = NAV.filter((item) => isModuleEnabled(modules, item.id))
  const showAI = isModuleEnabled(modules, 'ai-assistant')

  useEffect(() => {
    if (unreadTotal > 0) setAppBadge(unreadTotal)
    else clearAppBadge()
  }, [unreadTotal])

  const openFeed = () => {
    haptic.tap()
    window.dispatchEvent(new CustomEvent('open-feed'))
  }

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
      <div
        aria-hidden
        className="absolute -top-10 -left-10 h-32 w-32 rounded-full bg-white/20 blur-3xl pointer-events-none"
      />
      <div
        aria-hidden
        className="absolute -bottom-12 -right-12 h-40 w-40 rounded-full bg-[#EC4899]/30 blur-3xl pointer-events-none"
      />

      <div className="relative px-2 py-2">
        <div className="flex items-center justify-around">
          {/* Left: Home + Catalog */}
          {visibleNav.filter((i) => !i.isFeed).map((item) => {
            const Icon = item.icon
            const active = view === item.id
            return (
              <button
                key={item.id}
                onClick={() => { haptic.tap(); onNavigate(item.id) }}
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
                </span>
                <span className="font-medium leading-none">{item.label}</span>
              </button>
            )
          })}

          {/* Лента — отдельный пункт (как в Instagram) */}
          <button
            onClick={openFeed}
            className="relative flex flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] transition-colors mobile-nav-item flex-1 min-w-0"
            aria-label="Лента товаров"
          >
            <span className="relative grid place-items-center h-8 w-11 rounded-full transition-all">
              <Film className="h-5 w-5" strokeWidth={2} />
            </span>
            <span className="font-medium leading-none">Лента</span>
          </button>

          {/* Center: AI — prominent gradient button */}
          {showAI && (
            <button
              onClick={() => { haptic.tap(); window.dispatchEvent(new CustomEvent('open-ai-assistant')) }}
              className="relative flex flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] transition-colors flex-1 min-w-0"
              aria-label="AI Агент"
            >
              <motion.span
                className="relative grid place-items-center h-10 w-12 rounded-2xl transition-all"
                style={{
                  background: 'linear-gradient(135deg, #EC4899 0%, #A855F7 50%, #9333EA 100%)',
                  boxShadow: '0 4px 14px -2px rgba(160, 32, 112, 0.5)',
                }}
                whileTap={{ scale: 0.92 }}
              >
                <Sparkles className="h-5 w-5 text-white" strokeWidth={2.4} />
              </motion.span>
              <span className="font-medium leading-none">AI</span>
            </button>
          )}

          {/* Right: Orders + More */}
          <button
            onClick={() => { haptic.tap(); onNavigate('orders') }}
            className={cn(
              'relative flex flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] transition-colors mobile-nav-item flex-1 min-w-0',
              view === 'orders' && 'mobile-nav-item-active',
            )}
            aria-current={view === 'orders' ? 'page' : undefined}
            aria-label="Мои заявки"
          >
            <span
              className={cn(
                'relative grid place-items-center h-8 w-11 rounded-full transition-all',
                view === 'orders' && 'mobile-nav-pill-active',
              )}
            >
              <ClipboardList className="h-5 w-5" strokeWidth={view === 'orders' ? 2.4 : 2} />
              {cartCount > 0 && (
                <span className="absolute -top-1 -right-1 h-4 min-w-4 px-1 rounded-full gradient-brand text-white text-[10px] font-bold grid place-items-center shadow-[0_2px_8px_-1px_rgba(37,99,235,0.45)] ring-2 ring-white/90 dark:ring-white/15">
                  {cartCount > 9 ? '9+' : cartCount}
                </span>
              )}
            </span>
            <span className="font-medium leading-none">Заявки</span>
          </button>

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
