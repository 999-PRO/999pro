'use client'

// v25.12: MoreSheet — переделан с 3 крупными hero-блоками сверху (Чат/Медиа/Лента)
// + красивые карточки с градиентами для остальных разделов + новый раздел «Прайс».

import {
  LayoutDashboard, Settings, Info, Star, Truck, CreditCard, Bell,
  Palette, Globe, Shield, LogOut, Share2, MessageSquare, Bookmark,
  FileText, Cookie, UserCheck, Mail, HelpCircle, Building2, Phone, Lock, BookOpen, AlertCircle,
  ArrowLeft, ShieldCheck, Music2, User, Film, FileSpreadsheet, Users, Check, Gamepad2,
} from 'lucide-react'
import { motion } from 'framer-motion'
import { useAuthStore } from '@/lib/auth-store'
import { useTheme } from 'next-themes'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { toast } from '@/lib/notifications'
import { useState, useEffect } from 'react'
import { api } from '@/lib/api'
import { haptic } from '@/lib/haptic'
import { cn } from '@/lib/utils'

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
      // v25.16: история своих комментариев (товары + объявления)
      { id: 'my-comments', label: 'Мои комментарии', icon: MessageSquare, desc: 'Всё, что вы написали', gradient: 'from-[#14B8A6] to-[#0D9488]' },
    ],
  })
  sections.push({
    title: 'Контент',
    items: [
      // v25.23: ИГРОВОЙ КЛУБ — вход из «Ещё»
      { id: 'games', label: 'Игровой клуб', icon: Gamepad2, desc: '15 игр: онлайн, нарды, детские', gradient: 'from-[#8B5CF6] to-[#6D28D9]' },
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

// v25.14: 5 крупных hero-блока — добавлены «Сообщества» (публичные
// объявления + закрытый оптовый клуб). Премиальные плитки с орбами.
const HERO_BLOCKS = [
  {
    id: 'chat',
    label: 'Чат',
    desc: 'Диалоги с продавцом\nи покупателями',
    icon: MessageSquare,
    gradient: 'from-[#10B981] via-[#059669] to-[#047857]',
    glow: 'rgba(16,185,129,0.4)',
  },
  {
    id: 'community',
    label: 'Сообщества',
    desc: 'Объявления и закрытый\nоптовый клуб',
    icon: Users,
    gradient: 'from-[#8B5CF6] via-[#7C3AED] to-[#6D28D9]',
    glow: 'rgba(139,92,246,0.4)',
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
    gradient: 'from-[#F59E0B] via-[#D97706] to-[#B45309]',
    glow: 'rgba(245,158,11,0.4)',
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
      // v25.14: communities view
      case 'community': onNavigate('community'); onOpenChange(false); break
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
      case 'games': onNavigate('games'); onOpenChange(false); break
      case 'reviews': onNavigate('reviews'); onOpenChange(false); break
      // v25.16: «Мои комментарии» — глобальный экран истории
      case 'my-comments': window.dispatchEvent(new CustomEvent('open-my-comments')); onOpenChange(false); break
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

        {/* === БЫСТРЫЙ ДОСТУП: Чат / Сообщества / Media / Лента / Прайс === */}
        <div>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-1">
            Быстрый доступ
          </h3>
          {/* v25.15 (owner: плитки были слишком большие + острые тени):
              компактные горизонтальные плитки (иконка + подпись), мягкая
              diffuse-тень вместо жёсткого цветного свечения. */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
            {HERO_BLOCKS.map((block, bi) => {
              const Icon = block.icon
              const shortDesc = block.desc.split('\n')[0]
              return (
                <motion.button
                  key={block.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.32, delay: bi * 0.045, ease: [0.22, 1, 0.36, 1] }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => handleHeroAction(block.id)}
                  className={`relative overflow-hidden rounded-[20px] pl-3 pr-2 py-3 bg-gradient-to-br ${block.gradient} text-white transition-shadow text-left flex items-center gap-3 min-h-[72px]`}
                  style={{
                    // v25.15: мягкая тень — большой blur, отрицательный spread
                    boxShadow: `0 14px 30px -20px ${block.glow}, 0 2px 10px -6px rgba(15,23,42,0.12)`,
                  }}
                >
                  {/* decorative orb (мягкий, только один) */}
                  <span aria-hidden className="absolute -top-7 -right-7 h-16 w-16 rounded-full bg-white/15 blur-lg pointer-events-none" />
                  <span className="relative h-9 w-9 shrink-0 rounded-[13px] bg-white/20 backdrop-blur-md grid place-items-center ring-1 ring-white/25">
                    <Icon className="h-[17px] w-[17px]" strokeWidth={2.2} />
                  </span>
                  <span className="relative min-w-0">
                    <span className="block text-[13px] font-bold leading-tight truncate">{block.label}</span>
                    <span className="block text-[10px] opacity-85 mt-0.5 leading-tight truncate">{shortDesc}</span>
                  </span>
                </motion.button>
              )
            })}
          </div>
        </div>

        {/* Quick toggles — theme + notifications */}
        <div className="glass rounded-3xl p-4 space-y-3">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-[#A02070] to-[#9333EA] grid place-items-center">
              <Palette className="h-5 w-5 text-white" />
            </div>
            <div>
              <Label className="text-sm font-semibold cursor-pointer">Тема оформления</Label>
              <p className="text-xs text-muted-foreground">Выберите стиль приложения</p>
            </div>
          </div>

          {/* v25.18 (owner): «раздел темы тоже сделай красивый, современный,
              стильный» — вместо трёх маленьких кнопок теперь карточки с
              живыми мини-превью каждой темы. */}
          <div className="grid grid-cols-3 gap-2.5 pt-1">
            {([
              {
                id: 'light' as const,
                label: 'Светлая',
                card: '#FFFFFF',
                bar: '#F1F5F9',
                accent: '#A02070',
                text: '#0F172A',
              },
              {
                id: 'dark' as const,
                label: 'Тёмная',
                card: '#1E293B',
                bar: '#0F172A',
                accent: '#EC4899',
                text: '#F8FAFC',
              },
              {
                id: 'neon' as const,
                label: 'Neon',
                card: '#12102A',
                bar: '#1C1740',
                accent: '#22D3EE',
                text: '#E0F2FE',
              },
            ]).map((t) => {
              const active = (theme ?? 'light') === t.id
              return (
                <button
                  key={t.id}
                  onClick={() => { haptic.select(); setTheme(t.id) }}
                  aria-pressed={active}
                  className={cn(
                    'relative rounded-2xl p-2 text-left transition-all active:scale-95',
                    active
                      ? 'ring-2 ring-primary/70 shadow-[0_10px_26px_-12px_rgba(160,32,112,0.55)]'
                      : 'ring-1 ring-border/60 hover:ring-primary/35',
                  )}
                  style={{ background: 'color-mix(in oklch, var(--card) 72%, transparent)' }}
                >
                  {/* Мини-превью: окно приложения в цветах темы */}
                  <div
                    className="rounded-xl overflow-hidden border border-black/10 dark:border-white/10"
                    style={{ background: t.card }}
                  >
                    <div className="h-2.5 flex items-center gap-0.5 px-1.5" style={{ background: t.bar }}>
                      <span className="h-1 w-1 rounded-full" style={{ background: t.accent }} />
                      <span className="h-1 w-3 rounded-full opacity-40" style={{ background: t.text }} />
                    </div>
                    <div className="p-1.5 space-y-1">
                      <div className="h-4 rounded-md" style={{ background: t.accent, opacity: 0.9 }} />
                      <div className="flex gap-1">
                        <div className="h-3 flex-1 rounded-md" style={{ background: t.bar }} />
                        <div className="h-3 flex-1 rounded-md" style={{ background: t.bar }} />
                      </div>
                      <div className="h-1.5 w-3/4 rounded-full opacity-30" style={{ background: t.text }} />
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-1.5 pl-0.5 pr-0.5">
                    <span className="text-[11px] font-bold">{t.label}</span>
                    <span
                      className={cn(
                        'h-4 w-4 rounded-full grid place-items-center transition-all',
                        active ? 'gradient-brand text-white' : 'border border-border',
                      )}
                    >
                      {active && <Check className="h-2.5 w-2.5" strokeWidth={3.5} />}
                    </span>
                  </div>
                </button>
              )
            })}
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
          TRI999 · версия 25.28
        </div>
      </div>
    </div>
  )
}
