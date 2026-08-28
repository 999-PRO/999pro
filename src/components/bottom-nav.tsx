'use client'

import { useEffect } from 'react'
import { Home, LayoutGrid, Film, MessagesSquare, MoreHorizontal, ClipboardList } from 'lucide-react'
import { cn } from '@/lib/utils'
import { haptic } from '@/lib/haptic'
import { setAppBadge, clearAppBadge } from '@/lib/badge'
import { useNotificationsStore } from '@/lib/use-notifications'
// v25.23 (owner): «на Заявках бейдж, хотя там пусто» — бейдж на кнопке
// «Заявки» показывал количество КОРЗИНЫ (cartCount). Теперь на «Заявках»
// — только реальные непросмотренные события по заказам (orders-badge-store),
// а корзина живёт на своей плитке в меню шапки.
import { useOrdersBadgeStore } from '@/lib/orders-badge-store'
import { useModuleAccess, isModuleEnabled } from '@/lib/use-module-access'

// v25.12: bottom-nav with 6 items — added "Лента" (Reels) as a separate tab.
// Layout: [Главная] [Каталог] [Лента] [AI — центр] [Заявки] [Ещё]
// (6 items, AI in center with gradient)
// v25.18 (owner): AI переехал из навигации на ПЛАВАЮЩУЮ кнопку
// (floating-ai-button.tsx), а в центр тапбара встали «Сообщества» —
// площадка объявлений теперь доступна в один тап.
// v25.19 (owner): «почта, чат и сообщество — одну кнопку: нажимаешь —
// выбор между чатом и сообществом». Пункт «Общение» открывает красивый
// bottom-sheet выбора (communication-chooser.tsx).

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
  const unreadTotal = useNotificationsStore((s) => s.unread.total)
  // v25.23: бейдж «Заявки» = непросмотренные события по заказам (НЕ корзина)
  const ordersUnseen = useOrdersBadgeStore((s) => s.unseenCount)
  const modules = useModuleAccess()

  const visibleNav = NAV.filter((item) => isModuleEnabled(modules, item.id))

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
          {visibleNav.filter((i) => !(i as any).isFeed).map((item) => {
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

          {/* v25.19: Общение — одна кнопка, выбор «Сообщества / Чат» */}
          <button
            onClick={() => {
              haptic.tap()
              window.dispatchEvent(new CustomEvent('open-communication-chooser'))
            }}
            className={cn(
              'relative flex flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] transition-colors mobile-nav-item flex-1 min-w-0',
              (view === 'community' || view === 'chat') && 'mobile-nav-item-active',
            )}
            aria-label="Общение: сообщества или чат"
          >
            <span
              className={cn(
                'relative grid place-items-center h-8 w-11 rounded-full transition-all',
                (view === 'community' || view === 'chat') && 'mobile-nav-pill-active',
              )}
            >
              <MessagesSquare className="h-5 w-5" strokeWidth={(view === 'community' || view === 'chat') ? 2.4 : 2} />
              {/* v25.21 (owner): «бейджики как в настоящих мессенджерах» —
                  счётчик непрочитанных сообщений чата на кнопке «Общение».
                  Красная пилюля с числом (99+), скрывается когда всё прочитано. */}
              {unreadTotal > 0 ? (
                <span
                  key={unreadTotal}
                  className="absolute -top-1 -right-0.5 min-w-[17px] h-[17px] px-1 rounded-full grid place-items-center text-[10px] font-extrabold text-white ring-2 ring-white/90 dark:ring-white/20 animate-[badge-pop_0.3s_ease-out]"
                  style={{
                    background: 'linear-gradient(135deg,#F43F5E,#E11D48)',
                    boxShadow: '0 2px 8px -1px rgba(225,29,72,0.55)',
                  }}
                >
                  {unreadTotal > 99 ? '99+' : unreadTotal}
                </span>
              ) : (
                /* Маленький «хвостик»-бейдж когда мы в одном из разделов */
                (view === 'community' || view === 'chat') && (
                  <span aria-hidden className="absolute -top-0.5 -right-1 h-2 w-2 rounded-full bg-primary ring-2 ring-white/80 dark:ring-white/20" />
                )
              )}
            </span>
            <span className="font-medium leading-none">Общение</span>
          </button>

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
              {ordersUnseen > 0 && (
                <span className="absolute -top-1 -right-1 h-4 min-w-4 px-1 rounded-full gradient-brand text-white text-[10px] font-bold grid place-items-center shadow-[0_2px_8px_-1px_rgba(37,99,235,0.45)] ring-2 ring-white/90 dark:ring-white/15">
                  {ordersUnseen > 9 ? '9+' : ordersUnseen}
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
