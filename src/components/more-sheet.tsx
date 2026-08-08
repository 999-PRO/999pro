'use client'

// ============================================================================
//  MoreSheet — full-screen "Ещё" page (v25.5, TZ-3 task #9)
//  ----------------------------------------------------------------------------
//  Previously a bottom-sheet modal (Sheet component). That caused the same
//  cross-browser issues as the old ProductPage modal:
//    - couldn't be closed reliably (swipe-down gesture didn't work in all browsers)
//    - Back button didn't close it
//    - in some browsers the sheet "went up" (escaped the viewport)
//    - user could get stuck with no way back
//
//  v25.5 redesign: render as a NATIVE full-screen page — same pattern as
//  the new ProductPage and CheckoutSheet:
//    - position: fixed; inset: 0 — covers the viewport
//    - overflow-y: auto — native browser scrolling (Safari/Chrome/Yandex/Android)
//    - sticky top bar with explicit "Назад" button
//    - system Back gesture support (pushState + popstate + Esc)
//    - z-[400] — above bottom-nav (z-40) and below product page (z-350)
//               and share sheet (z-9999)
//
//  ALL existing functionality is preserved: theme toggle, notifications toggle,
//  sections (Studio/Cart/Favorites/Orders/Reviews/Support/Settings/Share),
//  DB-backed info pages, language, privacy, logout.
// ============================================================================

import {
  LayoutDashboard,
  Settings, Info, Star, Truck, CreditCard, Bell,
  Palette, Globe, Shield, LogOut, Share2, MessageSquare, Bookmark,
  FileText, Cookie, UserCheck, Mail, HelpCircle, Building2, Phone, Lock, BookOpen, AlertCircle,
  ArrowLeft, ShieldCheck,
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
// v25.7 (TZ ЭТАП 2.1): also expose "Вход для администратора" to NON-authed
// users so they can reach the proper 2FA login flow. Without this entry,
// admins had to know the direct URL /?view=admin-login — making the proper
// login flow effectively undiscoverable.
const buildSections = (isAdmin: boolean, isAuthed: boolean) => {
  const sections: { title: string; items: { id: string; label: string; icon: any; desc: string }[] }[] = []
  // Studio section — ADMIN ONLY (when authed).
  if (isAdmin) {
    sections.push({
      title: 'Управление',
      items: [
        { id: 'studio', label: 'Студия', icon: LayoutDashboard, desc: 'Админ-панель' },
      ],
    })
  } else if (!isAuthed) {
    // Not authed → surface the admin login entry so 2FA login is reachable.
    sections.push({
      title: 'Управление',
      items: [
        { id: 'admin-login', label: 'Вход для администратора', icon: ShieldCheck, desc: 'Двухфакторная авторизация' },
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
      { id: 'reviews', label: 'Отзывы', icon: Star, desc: 'Чужие отзывы на товары' },
      // v25.6 (Task #2 + #7): replaced "Поддержка / Чат с поддержкой" with
      // "Контакты" — routes to the new ContactsView which pulls all 6
      // contact fields dynamically from Studio → Контакты.
      { id: 'contacts', label: 'Контакты', icon: Phone, desc: 'Связаться с нами' },
    ],
  })
  sections.push({
    title: 'Приложение',
    items: [
      { id: 'settings', label: 'Настройки', icon: Settings, desc: 'Уведомления, язык, конфиденциальность' },
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
    if (!open) return // only fetch when opened
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

  // v25.5 (TZ-3 task #9): System Back gesture + Esc key support.
  // Push a sentinel history state when the More page opens — when the user
  // presses the system Back button/gesture (Android) or Esc (desktop), we
  // intercept it and close the More page (instead of navigating away).
  useEffect(() => {
    if (!open) return
    if (typeof window === 'undefined') return
    // Push a sentinel state so Back doesn't navigate away from the page.
    window.history.pushState({ moreOverlay: true }, '')
    const onPopState = () => {
      // Back was pressed — close the More page (don't navigate away).
      onOpenChange(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false)
    }
    window.addEventListener('popstate', onPopState)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('popstate', onPopState)
      window.removeEventListener('keydown', onKey)
      // If we added a history state and the More page is closing without
      // Back being pressed, pop it so the history stack stays clean.
      if (typeof window !== 'undefined' && window.history.state?.moreOverlay) {
        window.history.back()
      }
    }
  }, [open, onOpenChange])

  const handleClose = () => {
    haptic.tap()
    onOpenChange(false)
  }

  const handleAction = async (id: string) => {
    haptic.tap()
    switch (id) {
      case 'studio':
        onNavigate('studio')
        onOpenChange(false)
        break
      case 'admin-login':
        // v25.7 (TZ ЭТАП 2.1): take the user to the proper 2FA login flow.
        onNavigate('admin-login')
        onOpenChange(false)
        break
      case 'favorites':
        onNavigate('profile')
        onOpenChange(false)
        break
      case 'cart':
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
      // v25.6 (Task #2 + #7): 'contacts' replaces 'support' in the menu.
      // Old 'support' case kept as a fallback for any code path that still
      // dispatches it (both now route to ContactsView via app/page.tsx).
      case 'contacts':
      case 'support':
        onNavigate('contacts')
        onOpenChange(false)
        break
      case 'settings':
        onNavigate('settings')
        onOpenChange(false)
        break
      case 'share':
        // v25.6 (Task #4): Web Share API with proper clipboard fallback.
        // Notification "Ссылка скопирована" is shown ONLY after a successful
        // copy — not when Web Share API is cancelled or fails.
        if (typeof navigator !== 'undefined' && navigator.share) {
          try {
            await navigator.share({
              title: 'TRI999',
              text: 'Современный маркетплейс нового поколения с голосовым AI-агентом',
              url: window.location.origin,
            })
          } catch {
            // User cancelled — non-critical, no toast.
          }
        } else if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
          try {
            await navigator.clipboard.writeText(window.location.origin)
            toast.success('Ссылка скопирована')
          } catch {
            toast.error('Не удалось скопировать ссылку')
          }
        } else {
          // Final fallback: legacy execCommand on a hidden textarea.
          try {
            const ta = document.createElement('textarea')
            ta.value = window.location.origin
            ta.style.position = 'fixed'
            ta.style.opacity = '0'
            document.body.appendChild(ta)
            ta.select()
            const ok = document.execCommand('copy')
            ta.remove()
            if (ok) toast.success('Ссылка скопирована')
            else toast.error('Не удалось скопировать ссылку')
          } catch {
            toast.error('Не удалось скопировать ссылку')
          }
        }
        break
      default:
        toast.info('Раздел скоро появится')
    }
  }

  if (!open) return null

  // v25.5: Full-screen page — same pattern as ProductPage.
  // position: fixed; inset: 0 covers the viewport.
  // overflow-y: auto for native scrolling.
  // z-[400] — above bottom-nav (z-40), below product page (z-350) and
  // share sheet (z-9999).
  return (
    <div
      className="fixed inset-0 z-[400] bg-background overflow-y-auto overscroll-contain"
      style={{
        overscrollBehavior: 'contain',
        WebkitOverflowScrolling: 'touch',
      }}
    >
      {/* Sticky top bar — back button + title. Always visible at the top. */}
      <div
        className="sticky top-0 z-20 flex items-center gap-2 px-3 py-2.5 backdrop-blur-xl bg-background/85 border-b border-border/40"
        style={{
          paddingTop: 'max(env(safe-area-inset-top, 0px), 0.625rem)',
        }}
      >
        <button
          onClick={handleClose}
          aria-label="Назад"
          className="h-10 w-10 rounded-full grid place-items-center bg-foreground/5 hover:bg-foreground/10 active:scale-95 transition-all shrink-0"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="text-xs text-muted-foreground">Меню</div>
          <div className="text-sm font-semibold">Ещё</div>
        </div>
      </div>

      {/* Content — scrollable, in normal document flow. */}
      <div className="px-5 pt-4 pb-28 space-y-5">

        {/* Header */}
        <div className="text-left">
          <h1 className="text-2xl font-extrabold">Ещё</h1>
          <p className="text-sm text-muted-foreground">
            Дополнительные разделы и настройки TRI999
          </p>
        </div>

        {/* Quick toggles */}
        <div>
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
        {buildSections(user?.role === 'admin', !!user).map((section) => (
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

        {/* DB-backed info pages section */}
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
                      haptic.tap()
                      if (onNavigateToInfoPage) {
                        onNavigateToInfoPage(p.slug)
                      } else {
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
            onClick={() => { haptic.tap(); onNavigate('settings'); onOpenChange(false) }}
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
          <button
            onClick={() => {
              haptic.tap()
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
          999 · Три девятки · версия 1.0.0
        </div>
      </div>
    </div>
  )
}
