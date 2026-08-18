'use client'

// v25.12: MoreSheet — переделан с 3 крупными hero-блоками сверху (Чат/Медиа/Лента)
// + красивые карточки с градиентами для остальных разделов + новый раздел «Прайс».

import {
  LayoutDashboard, Settings, Info, Star, Truck, CreditCard, Bell,
  Palette, Globe, Shield, LogOut, Share2, MessageSquare, Bookmark,
  FileText, Cookie, UserCheck, Mail, HelpCircle, Building2, Phone, Lock, BookOpen, AlertCircle,
  ArrowLeft, ShieldCheck, Music2, User, Film, FileSpreadsheet,
} from 'lucide-react'
import { useAuthStore } from '@/lib/auth-store'
import { useTheme } from 'next-themes'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { toast } from '@/lib/notifications'
import { useState, useEffect } from 'react'
import { api } from '@/lib/api'
import { haptic } from '@/lib/haptic'

interface MoreSheetProps {
  open: boolean
  onOpenChange: (v: boolean) => void
  onNavigate: (v: string) => void
  onNavigateToInfoPage?: (slug: string) => void
}

const ICON_MAP: Record<string, typeof FileText> = {
  FileText, Info, Shield, Cookie, UserCheck, Mail,
  HelpCircle, Building2, Phone, Lock, BookOpen, AlertCircle,
}

interface MenuInfoPage {
  id: string
  slug: string
  title: string
  subtitle?: string | null
  icon: string
  order: number
}

type MoreItem = { id: string; label: string; icon: any; desc: string; gradient: string }
type MoreSection = { title: string; items: MoreItem[] }

const buildSections = (isAdmin: boolean): MoreSection[] => {
  const sections: MoreSection[] = []
  if (isAdmin) {
    sections.push({
      title: 'Управление',
      items: [
        { id: 'studio', label: 'Студия', icon: LayoutDashboard, desc: 'Админ-панель', gradient: 'from-[#A02070] to-[#9333EA]' },
      ],
    })
  }
  sections.push({
    title: 'Покупки',
    items: [
      { id: 'cart', label: 'Мои заявки', icon: CreditCard, desc: 'Список товаров и отправка', gradient: 'from-[#EC4899] to-[#DB2777]' },
      { id: 'favorites', label: 'Избранное', icon: Bookmark, desc: 'Сохранённые товары', gradient: 'from-[#F43F5E] to-[#E11D48]' },
      { id: 'orders', label: 'Мои заказы', icon: Truck, desc: 'История и статус', gradient: 'from-[#F59E0B] to-[#D97706]' },
      { id: 'price', label: 'Прайс-листы', icon: FileSpreadsheet, desc: 'PDF, Word, картинки', gradient: 'from-[#10B981] to-[#059669]' },
    ],
  })
  sections.push({
    title: 'Контент',
    items: [
      { id: 'reviews', label: 'Отзывы', icon: Star, desc: 'Чужие отзывы на товары', gradient: 'from-[#FBBF24] to-[#F59E0B]' },
      { id: 'contacts', label: 'Контакты', icon: Phone, desc: 'Связаться с нами', gradient: 'from-[#8B5CF6] to-[#7C3AED]' },
      { id: 'profile', label: 'Профиль', icon: User, desc: 'Личные данные', gradient: 'from-[#A855F7] to-[#9333EA]' },
    ],
  })
  sections.push({
    title: 'Приложение',
    items: [
      { id: 'settings', label: 'Настройки', icon: Settings, desc: 'Уведомления, язык, тема', gradient: 'from-[#64748B] to-[#475569]' },
      { id: 'share', label: 'Поделиться', icon: Share2, desc: 'Рассказать друзьям', gradient: 'from-[#0EA5E9] to-[#0284C7]' },
    ],
  })
  return sections
}

// v25.12: 4 крупных hero-блока для Чата, Медиа, Ленты и Прайса
const HERO_BLOCKS = [
  {
    id: 'chat',
    label: 'Чат',
    desc: 'Диалоги с продавцами\nи поддержкой',
    icon: MessageSquare,
    gradient: 'from-[#10B981] via-[#059669] to-[#047857]',
    glow: 'rgba(16,185,129,0.4)',
  },
  {
    id: 'media-hub',
    label: 'Media Hub',
    desc: 'Музыка и фильмы\nв одном месте',
    icon: Music2,
    gradient: 'from-[#06B6D4] via-[#0891B2] to-[#0E7490]',
    glow: 'rgba(6,182,212,0.4)',
  },
  {
    id: 'feed',
    label: 'Лента',
    desc: 'Товары в стиле\nReels — листайте!',
    icon: Film,
    gradient: 'from-[#EC4899] via-[#A855F7] to-[#9333EA]',
    glow: 'rgba(236,72,153,0.4)',
  },
  {
    id: 'price',
    label: 'Прайс',
    desc: 'PDF, Word, картинки\nскачать и смотреть',
    icon: FileSpreadsheet,
    gradient: 'from-[#10B981] via-[#059669] to-[#047857]',
    glow: 'rgba(16,185,129,0.4)',
  },
]

export function MoreSheet({ open, onOpenChange, onNavigate, onNavigateToInfoPage }: MoreSheetProps) {
  const { theme, setTheme } = useTheme()
  const [notif, setNotif] = useState(true)
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)

  const [infoPages, setInfoPages] = useState<MenuInfoPage[]>([])
  useEffect(() => {
    if (!open) return
    api.get<{ items: MenuInfoPage[] }>('/api/info-pages/menu')
      .then((d) => setInfoPages(d.items))
      .catch(() => setInfoPages([]))
  }, [open])

  useEffect(() => {
    const onInfoPagesChanged = () => {
      api.get<{ items: MenuInfoPage[] }>('/api/info-pages/menu')
        .then((d) => setInfoPages(d.items))
        .catch(() => {})
    }
    window.addEventListener('999pro:info-pages-changed', onInfoPagesChanged as EventListener)
    return () => window.removeEventListener('999pro:info-pages-changed', onInfoPagesChanged as EventListener)
  }, [])

  useEffect(() => {
    if (!open) return
    if (typeof window === 'undefined') return
    window.history.pushState({ moreOverlay: true }, '')
    const onPopState = () => onOpenChange(false)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onOpenChange(false) }
    window.addEventListener('popstate', onPopState)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('popstate', onPopState)
      window.removeEventListener('keydown', onKey)
      if (typeof window !== 'undefined' && window.history.state?.moreOverlay) window.history.back()
    }
  }, [open, onOpenChange])

  const handleClose = () => { haptic.tap(); onOpenChange(false) }

  const handleHeroAction = (id: string) => {
    haptic.tap()
    switch (id) {
      case 'chat': onNavigate('chat'); onOpenChange(false); break
      case 'media-hub': window.dispatchEvent(new CustomEvent('open-media-hub')); onOpenChange(false); break
      case 'feed': window.dispatchEvent(new CustomEvent('open-feed')); onOpenChange(false); break
      case 'price': onNavigate('price'); onOpenChange(false); break
    }
  }

  const handleAction = async (id: string) => {
    haptic.tap()
    switch (id) {
      case 'studio': onNavigate('studio'); onOpenChange(false); break
      case 'favorites': onNavigate('profile'); onOpenChange(false); break
      case 'cart': window.dispatchEvent(new CustomEvent('open-cart')); onOpenChange(false); break
      case 'orders': onNavigate('orders'); onOpenChange(false); break
      case 'price': onNavigate('price'); onOpenChange(false); break
      case 'reviews': onNavigate('reviews'); onOpenChange(false); break
      case 'contacts': case 'support': onNavigate('contacts'); onOpenChange(false); break
      case 'profile': onNavigate('profile'); onOpenChange(false); break
      case 'settings': onNavigate('settings'); onOpenChange(false); break
      case 'share':
        if (typeof navigator !== 'undefined' && navigator.share) {
          try {
            await navigator.share({ title: 'TRI999', text: 'Современный маркетплейс нового поколения с голосовым AI-агентом', url: window.location.origin })
          } catch {}
        } else if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
          try {
            await navigator.clipboard.writeText(window.location.origin)
            toast.success('Ссылка скопирована')
          } catch { toast.error('Не удалось скопировать ссылку') }
        }
        break
      default:
        toast.info('Раздел скоро появится')
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[400] bg-background overflow-y-auto overscroll-contain" style={{ overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch' }}>
      {/* Sticky top bar */}
      <div
        className="sticky top-0 z-20 flex items-center gap-2 px-4 py-3 backdrop-blur-xl bg-background/85 border-b border-border/40"
        style={{ paddingTop: 'max(env(safe-area-inset-top, 0px), 0.625rem)' }}
      >
        <button onClick={handleClose} aria-label="Назад" className="h-10 w-10 rounded-full grid place-items-center bg-foreground/5 hover:bg-foreground/10 active:scale-95 transition-all shrink-0">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="text-xs text-muted-foreground">Меню</div>
          <div className="text-sm font-semibold">Ещё</div>
        </div>
      </div>

      {/* Content */}
      <div className="px-4 pt-4 pb-28 space-y-5 max-w-2xl mx-auto">
        {/* Header */}
        <div className="text-left">
          <h1 className="text-2xl font-extrabold">Ещё</h1>
          <p className="text-sm text-muted-foreground">Дополнительные разделы и настройки TRI999</p>
        </div>

        {/* User card (если авторизован) */}
        {user && (
          <button
            onClick={() => { haptic.tap(); onNavigate('profile'); onOpenChange(false) }}
            className="w-full flex items-center gap-3 p-3 rounded-2xl bg-gradient-to-br from-[#FFF5F7] to-[#FFE4EC] border border-[#FFD0DC]/40 hover:shadow-md transition-all text-left"
          >
            <div className="h-12 w-12 rounded-full bg-gradient-to-br from-[#EC4899] to-[#9333EA] grid place-items-center text-white font-bold shrink-0">
              {(user.displayName || user.username || '?').charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold truncate">{user.displayName || user.username}</div>
              <div className="text-xs text-[#666666] truncate">{user.email}</div>
            </div>
            <ArrowLeft className="h-4 w-4 text-[#666666] rotate-180" />
          </button>
        )}

        {/* === 3 КРУПНЫХ HERO-БЛОКА: Чат / Media Hub / Лента === */}
        <div>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-1">
            Быстрый доступ
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
            {HERO_BLOCKS.map((block) => {
              const Icon = block.icon
              return (
                <button
                  key={block.id}
                  onClick={() => handleHeroAction(block.id)}
                  className={`relative overflow-hidden rounded-2xl p-3 bg-gradient-to-br ${block.gradient} text-white shadow-lg hover:scale-[1.02] active:scale-95 transition-all text-left aspect-[3/4] flex flex-col justify-between`}
                  style={{ boxShadow: `0 8px 24px -8px ${block.glow}` }}
                >
                  {/* Decorative big icon top-right */}
                  <Icon className="h-7 w-7 md:h-8 md:w-8 opacity-90 self-end" />
                  <div>
                    <div className="text-sm md:text-base font-bold leading-tight">{block.label}</div>
                    <p className="text-[10px] md:text-[11px] opacity-90 mt-1 leading-tight whitespace-pre-line">
                      {block.desc}
                    </p>
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* Quick toggles — theme + notifications */}
        <div className="glass rounded-3xl p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-[#A02070] to-[#9333EA] grid place-items-center">
                <Palette className="h-5 w-5 text-white" />
              </div>
              <div>
                <Label className="text-sm font-semibold cursor-pointer">Тема оформления</Label>
                <p className="text-xs text-muted-foreground">Светлая · Тёмная · Neon</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {(['light', 'dark', 'neon'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTheme(t)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors ${theme === t ? 'gradient-brand text-white' : 'text-muted-foreground hover:bg-accent/40'}`}
                >
                  {t === 'light' ? 'Светлая' : t === 'dark' ? 'Тёмная' : 'Neon'}
                </button>
              ))}
            </div>
          </div>

          <div className="h-px bg-border/40" />

          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-[#F59E0B] to-[#D97706] grid place-items-center">
                <Bell className="h-5 w-5 text-white" />
              </div>
              <div>
                <Label className="text-sm font-semibold cursor-pointer">Уведомления</Label>
                <p className="text-xs text-muted-foreground">Заказы, чаты, лента</p>
              </div>
            </div>
            <Switch checked={notif} onCheckedChange={setNotif} aria-label="Уведомления" />
          </div>
        </div>

        {/* Sections — card grid */}
        {buildSections(user?.role === 'admin').map((section) => (
          <div key={section.title}>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-1">
              {section.title}
            </h3>
            <div className="grid grid-cols-2 gap-2.5">
              {section.items.map((item) => {
                const Icon = item.icon
                return (
                  <button
                    key={item.id}
                    onClick={() => handleAction(item.id)}
                    className="relative overflow-hidden rounded-2xl p-3 bg-card border border-border/40 hover:border-primary/30 hover:shadow-md transition-all text-left group"
                  >
                    <div className={`h-10 w-10 rounded-xl bg-gradient-to-br ${item.gradient} grid place-items-center shadow-md mb-2`}>
                      <Icon className="h-5 w-5 text-white" />
                    </div>
                    <div className="text-sm font-semibold leading-tight">{item.label}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{item.desc}</div>
                  </button>
                )
              })}
            </div>
          </div>
        ))}

        {/* DB-backed info pages */}
        {infoPages.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-1">Информация</h3>
            <div className="grid grid-cols-2 gap-2.5">
              {infoPages.map((p) => {
                const Icon = ICON_MAP[p.icon] || FileText
                return (
                  <button
                    key={p.id}
                    onClick={() => {
                      haptic.tap()
                      if (onNavigateToInfoPage) onNavigateToInfoPage(p.slug)
                      else if (p.slug === 'about') onNavigate('about')
                      else if (p.slug === 'privacy') onNavigate('privacy')
                      else toast.info('Откройте через основное меню')
                      onOpenChange(false)
                    }}
                    className="rounded-2xl p-3 bg-card border border-border/40 hover:border-primary/30 hover:shadow-md transition-all text-left"
                  >
                    <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-[#64748B] to-[#475569] grid place-items-center shadow-md mb-2">
                      <Icon className="h-5 w-5 text-white" />
                    </div>
                    <div className="text-sm font-semibold leading-tight">{p.title}</div>
                    {p.subtitle && <div className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{p.subtitle}</div>}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Footer: language + privacy */}
        <div className="glass rounded-3xl overflow-hidden divide-y divide-border/30">
          <button
            onClick={() => { haptic.tap(); onNavigate('settings'); onOpenChange(false) }}
            className="w-full flex items-center gap-3 p-3.5 hover:bg-accent/40 active:bg-accent/60 transition-colors text-left"
          >
            <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-[#0EA5E9] to-[#0284C7] grid place-items-center shrink-0">
              <Globe className="h-5 w-5 text-white" />
            </div>
            <div className="flex-1">
              <div className="text-sm font-semibold">Язык</div>
              <div className="text-xs text-muted-foreground">Русский</div>
            </div>
          </button>
          <button
            onClick={() => {
              haptic.tap()
              const privacyPage = infoPages.find((p) => p.slug === 'privacy')
              if (privacyPage && onNavigateToInfoPage) onNavigateToInfoPage('privacy')
              else onNavigate('privacy')
              onOpenChange(false)
            }}
            className="w-full flex items-center gap-3 p-3.5 hover:bg-accent/40 active:bg-accent/60 transition-colors text-left"
          >
            <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-[#475569] to-[#334155] grid place-items-center shrink-0">
              <Shield className="h-5 w-5 text-white" />
            </div>
            <div className="flex-1">
              <div className="text-sm font-semibold">Конфиденциальность</div>
              <div className="text-xs text-muted-foreground">Политика и данные</div>
            </div>
          </button>
        </div>

        {user && (
          <Button
            variant="outline"
            className="w-full rounded-2xl h-12 text-destructive hover:text-destructive hover:bg-destructive/5"
            onClick={async () => {
              haptic.tap()
              toast.success('Вы вышли из аккаунта')
              onOpenChange(false)
              onNavigate('home')
              void logout()
            }}
          >
            <LogOut className="h-4 w-4 mr-2" /> Выйти из аккаунта
          </Button>
        )}

        <div className="text-center text-xs text-muted-foreground pt-1 pb-1">
          TRI999 · версия 25.12
        </div>
      </div>
    </div>
  )
}
