'use client'

import { useState, useEffect } from 'react'
import { BarChart3, Package, Image, Crown, RectangleHorizontal, ImagePlus, MoreHorizontal, Phone, X, Sparkles, Activity, Users, UsersRound, Share2, Truck, ShoppingBag, Home, FileText, Shield, Bot, Tag, Coins, Grid3x3, Cpu, MessageSquare, MessagesSquare, Megaphone, FolderTree, FileSpreadsheet, UserPlus, Smartphone, ShieldCheck, Sun, Moon, Search } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { useTheme } from 'next-themes'
import { cn } from '@/lib/utils'

// S-HIGH-006: NAV array previously omitted 'users' and 'share' — both views
// were unreachable on mobile. Added them so they appear in the more-sheet.
// primaryNav (slice 0-5) is kept to 5 + the "Ещё" button = 6 grid cells.
// 'audit' and 'hero' (less frequently used) live in moreNav (slice 5+).
// v12.3.1: Stories RESTORED. v12.3: Feed removed, replaced by 999 CLUB.
// v8: 'managers' added to mobile NAV — was desktop-only before.
// v25.19 (owner): «на мобильном не все функции, не все разделы в студии» —
// мобильный список ДОПОЛНЕН недостающими разделами (categories, communities,
// price-lists, chat-settings, mass-push, departments) и теперь ПОЛНОСТЬЮ
// совпадает с десктопным сайдбаром (32 раздела).
const NAV = [
  { id: 'analytics', label: 'Аналитика', icon: BarChart3 },
  { id: 'home', label: 'Главная', icon: Home },
  { id: 'products', label: 'Товары', icon: Package },
  { id: 'categories', label: 'Категории', icon: FolderTree },
  { id: 'communities', label: 'Сообщества', icon: UsersRound },
  { id: 'orders', label: 'Заказы', icon: ShoppingBag },
  { id: 'delivery', label: 'Доставка', icon: Truck },
  { id: 'stories', label: 'Сторис', icon: Image },
  { id: 'club', label: 'CLUB', icon: Crown },
  { id: 'price-lists', label: 'Прайс-листы', icon: FileSpreadsheet },
  { id: 'contacts', label: 'Контакты', icon: Phone },
  { id: 'users', label: 'Юзеры', icon: Users },
  // v8: Менеджеры — теперь доступны и на мобильном
  { id: 'managers', label: 'Менеджеры', icon: ShieldCheck },
  { id: 'share', label: 'Share', icon: Share2 },
  { id: 'banners', label: 'Баннеры', icon: RectangleHorizontal },
  { id: 'header', label: 'Шапка', icon: ImagePlus },
  { id: 'hero', label: 'Hero блок', icon: Sparkles },
  { id: 'chat-settings', label: 'Настройки чата', icon: MessagesSquare },
  { id: 'mass-push', label: 'Push-рассылка', icon: Megaphone },
  { id: 'departments', label: 'Направления', icon: Phone },
  { id: 'info-pages', label: 'Инфо', icon: FileText },
  // v25.19: SEO
  { id: 'seo', label: 'SEO', icon: Search },
  { id: 'aikb', label: 'AI KB', icon: Bot },
  { id: 'ai-providers', label: 'AI API', icon: Cpu },
  { id: 'promo-codes', label: 'Промо', icon: Tag },
  { id: 'bonus-points', label: 'Баллы', icon: Coins },
  { id: 'module-access', label: 'Модули', icon: Grid3x3 },
  // v20: new sections
  { id: 'registration-settings', label: 'Регистр.', icon: UserPlus },
  { id: 'communication', label: 'Общение', icon: MessageSquare },
  { id: 'splash-screen', label: 'Заставка', icon: Smartphone },
  { id: 'security', label: 'Безоп.', icon: Shield },
  { id: 'moderation', label: 'Модер.', icon: Activity },
  { id: 'audit', label: 'Журнал', icon: Activity },
] as const

export function BottomNav({
  view,
  onNavigate,
}: {
  view: string
  onNavigate: (v: string) => void
}) {
  // 5 primary items + "Ещё" — keep icons big enough to tap easily.
  const primaryNav = NAV.slice(0, 5)
  const moreNav = NAV.slice(5)
  const [moreOpen, setMoreOpen] = useState(false)

  // v8: theme toggle для мобильной Studio (раньше был только в desktop sidebar)
  const { setTheme, resolvedTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  // S-HIGH-007: previously this handler called onMore() in addition to
  // setMoreOpen(true). onMore() was wired to navigate to the 'header' view,
  // which caused the bottom sheet AND a navigation to fire simultaneously.
  // Now the sheet is the only effect — the user picks an item via handlePick.
  const handleMoreClick = () => {
    setMoreOpen(true)
  }

  const handlePick = (id: string) => {
    setMoreOpen(false)
    onNavigate(id)
  }

  return (
    <>
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-40"
        style={{
          borderTopLeftRadius: '28px',
          borderTopRightRadius: '28px',
          borderBottomLeftRadius: '0',
          borderBottomRightRadius: '0',
          paddingBottom: 'env(safe-area-inset-bottom)',
          backgroundImage:
            'linear-gradient(135deg, rgba(56,189,248,0.55) 0%, rgba(37,99,235,0.55) 50%, rgba(124,58,237,0.55) 100%)',
          backdropFilter: 'blur(24px) saturate(180%)',
          WebkitBackdropFilter: 'blur(24px) saturate(180%)',
          boxShadow: '0 -12px 32px -10px rgba(37,99,235,0.45), 0 0 0 1px rgba(255,255,255,0.18) inset',
          overflow: 'visible',
        }}
        aria-label="Primary navigation"
      >
        <div className="relative px-2 py-2">
          <div className="grid grid-cols-6 items-center">
            {primaryNav.map((item) => {
              const Icon = item.icon
              const active = view === item.id
              return (
                <button
                  key={item.id}
                  onClick={() => onNavigate(item.id)}
                  className={cn(
                    'relative flex flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] transition-colors',
                    active ? 'text-white' : 'text-white/70',
                  )}
                  aria-current={active ? 'page' : undefined}
                >
                  <span
                    className={cn(
                      'relative grid place-items-center h-8 w-11 rounded-full transition-all',
                      active && 'bg-white/25 backdrop-blur-sm',
                    )}
                  >
                    <Icon className="h-5 w-5" strokeWidth={active ? 2.4 : 2} />
                  </span>
                  <span className="font-medium leading-none">{item.label}</span>
                </button>
              )
            })}

            {/* More button — opens bottom sheet with hidden items */}
            <button
              onClick={handleMoreClick}
              className={cn(
                'relative flex flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] transition-colors',
                moreOpen || moreNav.some((n) => n.id === view) ? 'text-white' : 'text-white/70',
              )}
              aria-label="Ещё"
            >
              <span
                className={cn(
                  'relative grid place-items-center h-8 w-11 rounded-full transition-all',
                  (moreOpen || moreNav.some((n) => n.id === view)) && 'bg-white/25 backdrop-blur-sm',
                )}
              >
                <MoreHorizontal className="h-5 w-5" strokeWidth={moreOpen ? 2.4 : 2} />
              </span>
              <span className="font-medium leading-none">Ещё</span>
            </button>
          </div>
        </div>
      </nav>

      {/* More sheet — slides up from the bottom with the remaining sections */}
      <AnimatePresence>
        {moreOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="md:hidden fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm"
              onClick={() => setMoreOpen(false)}
            />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 280 }}
              className="md:hidden fixed bottom-0 left-0 right-0 z-[61] rounded-t-3xl bg-background border-t border-border/60 p-4 pb-safe"
              style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)' }}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-lg">Ещё</h3>
                <button
                  onClick={() => setMoreOpen(false)}
                  className="h-8 w-8 rounded-full grid place-items-center hover:bg-accent transition-colors"
                  aria-label="Закрыть"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {moreNav.map((item) => {
                  const Icon = item.icon
                  const active = view === item.id
                  return (
                    <button
                      key={item.id}
                      onClick={() => handlePick(item.id)}
                      className={cn(
                        'flex flex-col items-center justify-center gap-1.5 p-3 rounded-2xl transition-all',
                        active
                          ? 'gradient-brand text-white shadow-glow'
                          : 'glass text-muted-foreground hover:text-foreground',
                      )}
                    >
                      <Icon className="h-6 w-6" strokeWidth={active ? 2.4 : 2} />
                      <span className="text-xs font-medium text-center">{item.label}</span>
                    </button>
                  )
                })}
              </div>

              {/* v8: Theme toggle — переключатель темы для мобильной Studio.
                  Раньше был только в desktop Sidebar (hidden md:flex). */}
              {mounted && (
                <div className="mt-4 pt-4 border-t border-border/60">
                  <div className="text-xs text-muted-foreground mb-2 px-1">Тема оформления</div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setTheme('light')}
                      className={cn(
                        'flex items-center justify-center gap-2 p-3 rounded-2xl text-sm font-medium transition-all',
                        resolvedTheme === 'light'
                          ? 'gradient-brand text-white shadow-glow'
                          : 'glass text-muted-foreground hover:text-foreground',
                      )}
                    >
                      <Sun className="h-4 w-4" />
                      Светлая
                    </button>
                    <button
                      onClick={() => setTheme('dark')}
                      className={cn(
                        'flex items-center justify-center gap-2 p-3 rounded-2xl text-sm font-medium transition-all',
                        resolvedTheme === 'dark'
                          ? 'gradient-brand text-white shadow-glow'
                          : 'glass text-muted-foreground hover:text-foreground',
                      )}
                    >
                      <Moon className="h-4 w-4" />
                      Тёмная
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  )
}
