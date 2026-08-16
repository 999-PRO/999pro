'use client'

import { useEffect, useState } from 'react'
import {
  Home, LayoutGrid, Clapperboard, MessageCircle, User, Search,
  ShoppingBag, Package, Shield, Moon, Sun, Sparkles, MoreHorizontal,
} from 'lucide-react'
import { useTheme } from 'next-themes'
import { cn } from '@/lib/utils'
import { BrandLogo } from '@/components/brand-logo'
import { CountBadge } from '@/components/ui/count-badge'
import { useAuthStore } from '@/lib/auth-store'
import { useCartStore } from '@/lib/cart-store'
import { useOrdersBadgeStore } from '@/lib/orders-badge-store'
import { useNotificationsStore } from '@/lib/use-notifications'
import { useAudioPlayer } from '@/lib/audio-player-manager'
import { useModuleAccess, isModuleEnabled } from '@/lib/use-module-access'
import { MediaHubIcon } from '@/components/icons/media-hub-icon'

interface DesktopHeaderProps {
  view: string
  onNavigate: (v: string) => void
  onMore: () => void
  onOpenSearch: () => void
}

const MAIN_NAV = [
  { id: 'home', label: 'Главная', icon: Home },
  { id: 'catalog', label: 'Каталог', icon: LayoutGrid },
  { id: 'feed', label: 'Лента', icon: Clapperboard, customEvent: 'open-feed' },
  { id: 'chat', label: 'Чаты', icon: MessageCircle },
  { id: 'profile', label: 'Профиль', icon: User },
] as const

export function DesktopHeader({ view, onNavigate, onMore, onOpenSearch }: DesktopHeaderProps) {
  const user = useAuthStore((s) => s.user)
  const cartCount = useCartStore((s) => s.count())
  const ordersBadge = useOrdersBadgeStore((s) => s.unseenCount)
  const unreadTotal = useNotificationsStore((s) => s.unread.total)
  const audioIsPlaying = useAudioPlayer((s) => s.isPlaying)
  const modules = useModuleAccess()
  const { theme, resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  const cycleTheme = () => {
    const current = theme === 'system' ? resolvedTheme : theme
    setTheme(current === 'light' ? 'dark' : current === 'dark' ? 'neon' : 'light')
  }

  const visibleNav = MAIN_NAV.filter((item) => isModuleEnabled(modules, item.id))
  const isAdmin = user?.role === 'admin'

  return (
    <header className="hidden md:block sticky top-0 z-40 px-5 lg:px-8 pt-3">
      <div className="max-w-[1480px] mx-auto h-16 px-3.5 lg:px-4 rounded-[24px] premium-glass-card flex items-center gap-3">
        <button
          type="button"
          onClick={() => onNavigate('home')}
          className="h-11 px-3 rounded-2xl hover:bg-foreground/5 transition-colors shrink-0 flex items-center"
          aria-label="999PRO — на главную"
        >
          <BrandLogo size="sm" variant="gradient" />
        </button>

        <nav className="flex items-center gap-1 min-w-0" aria-label="Основная навигация">
          {visibleNav.map((item) => {
            const Icon = item.icon
            const active = view === item.id
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  if ('customEvent' in item && item.customEvent) {
                    window.dispatchEvent(new CustomEvent(item.customEvent))
                  } else {
                    onNavigate(item.id)
                  }
                }}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'h-10 px-3 rounded-2xl inline-flex items-center gap-2 text-sm font-semibold transition-all',
                  active
                    ? 'bg-primary/12 text-primary shadow-[0_6px_18px_-12px_rgba(37,99,235,0.6)]'
                    : 'text-muted-foreground hover:text-foreground hover:bg-foreground/5',
                )}
              >
                <Icon className="h-4 w-4" strokeWidth={active ? 2.4 : 2} />
                <span>{item.label}</span>
                {item.id === 'chat' && unreadTotal > 0 && (
                  <span className="ml-0.5 min-w-4 h-4 px-1 rounded-full bg-emerald-500 text-white text-[10px] font-bold grid place-items-center">
                    {unreadTotal > 9 ? '9+' : unreadTotal}
                  </span>
                )}
              </button>
            )
          })}

          {isAdmin && isModuleEnabled(modules, 'studio') && (
            <button
              type="button"
              onClick={() => onNavigate('studio')}
              aria-current={view === 'studio' ? 'page' : undefined}
              className={cn(
                'h-10 px-3 rounded-2xl inline-flex items-center gap-2 text-sm font-semibold transition-all',
                view === 'studio'
                  ? 'bg-primary/12 text-primary shadow-[0_6px_18px_-12px_rgba(37,99,235,0.6)]'
                  : 'text-muted-foreground hover:text-foreground hover:bg-foreground/5',
              )}
            >
              <Shield className="h-4 w-4" strokeWidth={view === 'studio' ? 2.4 : 2} />
              <span>Админ</span>
            </button>
          )}
        </nav>

        <div className="flex-1" />

        <div className="flex items-center gap-1.5 shrink-0">
          <IconButton label="Поиск" onClick={onOpenSearch}>
            <Search className="h-4.5 w-4.5" />
          </IconButton>

          {isModuleEnabled(modules, 'media-hub') && (
            <IconButton
              label={audioIsPlaying ? 'Media Hub играет' : 'Media Hub'}
              onClick={() => window.dispatchEvent(new CustomEvent('open-media-hub'))}
              className="relative"
            >
              <MediaHubIcon size={20} animated={audioIsPlaying} />
            </IconButton>
          )}

          {isModuleEnabled(modules, 'ai-assistant') && (
            <IconButton
              label="AI-ассистент"
              onClick={() => window.dispatchEvent(new CustomEvent('open-ai-assistant'))}
            >
              <Sparkles className="h-4.5 w-4.5 text-violet-500" />
            </IconButton>
          )}

          {mounted && (
            <IconButton
              label="Переключить тему"
              onClick={cycleTheme}
            >
              {resolvedTheme === 'dark' || theme === 'neon'
                ? <Sun className="h-4.5 w-4.5" />
                : <Moon className="h-4.5 w-4.5" />}
            </IconButton>
          )}

          <IconButton label="Мои заявки" onClick={() => onNavigate('orders')} className="relative">
            <Package className="h-4.5 w-4.5" />
            {ordersBadge > 0 && <CountBadge count={ordersBadge} className="-top-1 -right-1" />}
          </IconButton>

          <IconButton label="Корзина" onClick={() => window.dispatchEvent(new CustomEvent('open-cart'))} className="relative">
            <ShoppingBag className="h-4.5 w-4.5" />
            {cartCount > 0 && <CountBadge count={cartCount} className="-top-1 -right-1" />}
          </IconButton>

          <IconButton label="Ещё" onClick={onMore}>
            <MoreHorizontal className="h-4.5 w-4.5" />
          </IconButton>
        </div>
      </div>
    </header>
  )
}

function IconButton({
  label,
  onClick,
  children,
  className,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        'h-10 w-10 rounded-2xl grid place-items-center text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-all active:scale-95',
        className,
      )}
    >
      {children}
    </button>
  )
}
