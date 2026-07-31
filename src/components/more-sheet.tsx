'use client'

import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { LayoutDashboard,
  Settings, Info, Star, Truck, CreditCard, Bell,
  Palette, Globe, Shield, LogOut, Share2, MessageSquare, Bookmark,
  FileText, Cookie, UserCheck, Mail, HelpCircle, Building2, Phone, Lock, BookOpen, AlertCircle,
} from 'lucide-react'
import { useAuthStore } from '@/lib/auth-store'
import { useTheme } from 'next-themes'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { toast } from '@/lib/notifications'
import { useState, useEffect } from 'react'
import { api } from '@/lib/api'

interface MoreSheetProps {
  open: boolean
  onOpenChange: (v: boolean) => void
  onNavigate: (v: string) => void
  // v16.8: open a DB-backed info page by slug (e.g. 'privacy', 'about').
  onNavigateToInfoPage?: (slug: string) => void
}

// v16.8: lucide icon name → component mapping for info pages from DB.
const ICON_MAP: Record<string, typeof FileText> = {
  FileText, Info, Shield, Cookie, UserCheck, Mail,
  HelpCircle, Building2, Phone, Lock, BookOpen, AlertCircle,
}

// v16.8: type for a menu info page (from GET /api/info-pages/menu)
interface MenuInfoPage {
  id: string
  slug: string
  title: string
  subtitle?: string | null
  icon: string
  order: number
}

// v16.8 (production lockdown): the "Студия" entry is only shown to admins.
// Non-admin users must never see the Studio link, and even if they navigate
// to /?view=studio directly, the studio-view.tsx iframe will load /studio
// which itself enforces admin auth (see studio auth-init + backend gates).
const buildSections = (isAdmin: boolean) => {
  const sections: { title: string; items: { id: string; label: string; icon: any; desc: string }[] }[] = []
  // Studio section — ADMIN ONLY. Hidden entirely from non-admin users so
  // they don't even know the route exists.
  if (isAdmin) {
    sections.push({
      title: 'Управление',
      items: [
        { id: 'studio', label: 'Студия', icon: LayoutDashboard, desc: 'Админ-панель' },
      ],
    })
  }
  sections.push({
    title: 'Покупки',
    items: [
      { id: 'cart', label: 'Корзина', icon: CreditCard, desc: 'Оформление заказа' },
      { id: 'favorites', label: 'Избранное', icon: Bookmark, desc: 'Сохранённые товары' },
      { id: 'orders', label: 'Мои заказы', icon: Truck, desc: 'История и статус' },
    ],
  })
  sections.push({
    title: 'Контент',
    items: [
      // v12.3: Feed removed — 999 CLUB is now in the bottom nav.
      { id: 'reviews', label: 'Отзывы', icon: Star, desc: 'Чужие отзывы на товары' },
      { id: 'support', label: 'Поддержка', icon: MessageSquare, desc: 'Чат с командой «Три девятки»' },
    ],
  })
  sections.push({
    title: 'Приложение',
    items: [
      { id: 'settings', label: 'Настройки', icon: Settings, desc: 'Уведомления, язык, конфиденциальность' },
      // v16.8: 'about' is now a DB-backed info page — added dynamically below
      // from /api/info-pages/menu (see InfoPagesSection).
      { id: 'share', label: 'Поделиться приложением', icon: Share2, desc: 'Рассказать друзьям' },
    ],
  })
  return sections
}

export function MoreSheet({ open, onOpenChange, onNavigate, onNavigateToInfoPage }: MoreSheetProps) {
  const { theme, setTheme } = useTheme()
  const [notif, setNotif] = useState(true)
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)

  // v16.8: fetch DB-backed info pages for the menu.
  const [infoPages, setInfoPages] = useState<MenuInfoPage[]>([])
  useEffect(() => {
    if (!open) return // only fetch when sheet is opened
    api.get<{ items: MenuInfoPage[] }>('/api/info-pages/menu')
      .then((d) => setInfoPages(d.items))
      .catch((e) => {
        console.error('[more-sheet] failed to load info pages:', e)
        setInfoPages([])
      })
  }, [open])

  // Live-refresh: when Studio saves, refetch info pages.
  useEffect(() => {
    const onInfoPagesChanged = () => {
      api.get<{ items: MenuInfoPage[] }>('/api/info-pages/menu')
        .then((d) => setInfoPages(d.items))
        .catch(() => {})
    }
    window.addEventListener('999pro:info-pages-changed', onInfoPagesChanged as EventListener)
    return () => window.removeEventListener('999pro:info-pages-changed', onInfoPagesChanged as EventListener)
  }, [])

  const handleAction = (id: string) => {
    switch (id) {
      case 'studio':
        onNavigate('studio')
        onOpenChange(false)
        break
      // v12.3: 'feed' case removed — Feed module deleted.
      case 'favorites':
        onNavigate('profile')
        onOpenChange(false)
        break
      case 'cart':
        // QW5 (F-BUG-007): dispatch open-cart event (matches MobileHeader/Sidebar/Profile pattern)
        // instead of misleading navigation to profile + wrong toast.
        window.dispatchEvent(new CustomEvent('open-cart'))
        onOpenChange(false)
        break
      case 'orders':
        onNavigate('orders')
        onOpenChange(false)
        break
      case 'reviews':
        onNavigate('reviews')
        onOpenChange(false)
        break
      case 'support':
        onNavigate('support')
        onOpenChange(false)
        break
      case 'settings':
        onNavigate('settings')
        onOpenChange(false)
        break
      // v16.8: 'about' and 'privacy' are now DB-backed info pages.
      // They are handled by the InfoPagesSection below (calls onNavigateToInfoPage).
      case 'share':
        if (typeof navigator !== 'undefined' && navigator.share) {
          navigator
            .share({
              title: '999 — Три девятки',
              text: 'Современный маркетплейс нового поколения с голосовым AI-агентом',
              url: window.location.origin,
            })
            .catch(() => {})
        } else {
          navigator.clipboard?.writeText(window.location.origin).then(
            () => toast.success('Ссылка скопирована'),
            () => toast.error('Не удалось скопировать'),
          )
        }
        break
      default:
        toast.info('Раздел скоро появится')
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        // v9-final-fix: showCloseButton={false} — the sheet closes via
        // swipe-down (drag handle). No X button needed.
        showCloseButton={false}
        // v9-final-fix: showDragHandle={true} (default) — the SheetContent
        // renders ONE drag handle. Removed the duplicate from MoreSheet.
        className="rounded-t-[32px] p-0 gap-0 max-h-[88vh] md:max-w-md md:mx-auto md:mb-8 md:rounded-[32px]"
      >
        {/* Scrollable content wrapper — v9-final-fix: this is the ONLY
            scroll container. It has touch-action: pan-y so the user can
            scroll the list on mobile, and overscroll-behavior: contain so
            the scroll doesn't chain to the body when reaching the boundary. */}
        <div
          className="overflow-y-auto overscroll-contain"
          style={{ touchAction: 'pan-y', WebkitOverflowScrolling: 'touch' }}
          data-scroll-lock-ignore
        >

        <SheetHeader className="px-5 pt-2 pb-3 text-left">
          <SheetTitle className="text-2xl font-extrabold">Ещё</SheetTitle>
          <SheetDescription className="text-sm">
            Дополнительные разделы и настройки «Три девятки»
          </SheetDescription>
        </SheetHeader>

        {/* Quick toggles */}
        <div className="px-5 pb-4">
          <div className="glass rounded-3xl p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-2xl gradient-soft grid place-items-center">
                  <Palette className="h-5 w-5 text-primary" />
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
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors ${
                      theme === t ? 'gradient-brand text-white' : 'text-muted-foreground hover:bg-accent/40'
                    }`}
                  >
                    {t === 'light' ? 'Светлая' : t === 'dark' ? 'Тёмная' : 'Neon'}
                  </button>
                ))}
              </div>
            </div>

            <div className="h-px bg-border/40" />

            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-2xl gradient-soft grid place-items-center">
                  <Bell className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <Label className="text-sm font-semibold cursor-pointer">Уведомления</Label>
                  <p className="text-xs text-muted-foreground">Заказы, чаты, лента</p>
                </div>
              </div>
              <Switch
                checked={notif}
                onCheckedChange={setNotif}
                aria-label="Уведомления"
              />
            </div>
          </div>
        </div>

        {/* Sections */}
        <div className="px-5 pb-5 space-y-5">
          {buildSections(user?.role === 'admin').map((section) => (
            <div key={section.title}>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-1">
                {section.title}
              </h3>
              <div className="glass rounded-3xl overflow-hidden divide-y divide-border/30">
                {section.items.map((item) => {
                  const Icon = item.icon
                  return (
                    <button
                      key={item.id}
                      onClick={() => handleAction(item.id)}
                      className="w-full flex items-center gap-3 p-3.5 hover:bg-accent/40 active:bg-accent/60 transition-colors text-left"
                    >
                      <div className="h-10 w-10 rounded-2xl gradient-soft grid place-items-center shrink-0">
                        <Icon className="h-5 w-5 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold">{item.label}</div>
                        <div className="text-xs text-muted-foreground truncate">{item.desc}</div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}

          {/* v16.8: DB-backed info pages section (about, privacy, terms, etc.) */}
          {infoPages.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-1">
                Информация
              </h3>
              <div className="glass rounded-3xl overflow-hidden divide-y divide-border/30">
                {infoPages.map((p) => {
                  const Icon = ICON_MAP[p.icon] || FileText
                  return (
                    <button
                      key={p.id}
                      onClick={() => {
                        if (onNavigateToInfoPage) {
                          onNavigateToInfoPage(p.slug)
                        } else {
                          // Fallback: legacy hard view if handler not provided.
                          if (p.slug === 'about') onNavigate('about')
                          else if (p.slug === 'privacy') onNavigate('privacy')
                          else toast.info('Откройте через основное меню')
                        }
                        onOpenChange(false)
                      }}
                      className="w-full flex items-center gap-3 p-3.5 hover:bg-accent/40 active:bg-accent/60 transition-colors text-left"
                    >
                      <div className="h-10 w-10 rounded-2xl gradient-soft grid place-items-center shrink-0">
                        <Icon className="h-5 w-5 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold">{p.title}</div>
                        {p.subtitle && (
                          <div className="text-xs text-muted-foreground truncate">{p.subtitle}</div>
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Footer: language + logout */}
          <div className="glass rounded-3xl overflow-hidden divide-y divide-border/30">
            <button
              onClick={() => { onNavigate('settings'); onOpenChange(false) }}
              className="w-full flex items-center gap-3 p-3.5 hover:bg-accent/40 active:bg-accent/60 transition-colors text-left"
            >
              <div className="h-10 w-10 rounded-2xl gradient-soft grid place-items-center shrink-0">
                <Globe className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1">
                <div className="text-sm font-semibold">Язык</div>
                <div className="text-xs text-muted-foreground">Русский</div>
              </div>
            </button>
            {/* v16.8: privacy button now uses the DB-backed info page.
                If onNavigateToInfoPage is provided and a 'privacy' page exists
                in infoPages, we route through it; otherwise fall back to the
                legacy static PrivacyView. */}
            <button
              onClick={() => {
                const privacyPage = infoPages.find((p) => p.slug === 'privacy')
                if (privacyPage && onNavigateToInfoPage) {
                  onNavigateToInfoPage('privacy')
                } else {
                  onNavigate('privacy')
                }
                onOpenChange(false)
              }}
              className="w-full flex items-center gap-3 p-3.5 hover:bg-accent/40 active:bg-accent/60 transition-colors text-left"
            >
              <div className="h-10 w-10 rounded-2xl gradient-soft grid place-items-center shrink-0">
                <Shield className="h-5 w-5 text-primary" />
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
                toast.success('Вы вышли из аккаунта')
                onOpenChange(false)
                onNavigate('home')
                // Fire-and-forget the async unsubscribe — the UI already
                // reflects the logged-out state immediately.
                void logout()
              }}
            >
              <LogOut className="h-4 w-4 mr-2" /> Выйти из аккаунта
            </Button>
          )}

          <div className="text-center text-xs text-muted-foreground pt-1 pb-1">
            999 · Три девятки · версия 1.0.0
          </div>
        </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
