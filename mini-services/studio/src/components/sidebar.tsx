'use client'

import { useState, useEffect } from 'react'
import { BarChart3, Package, Image, Crown, RectangleHorizontal, ImagePlus, Search, LogOut, KeyRound, Phone, Sparkles, Activity, Share2, Users, Sun, Moon, Truck, ShoppingBag, Home, FileText, Shield, ShieldCheck, Bot, Tag, Coins, Grid3x3, Cpu, MessageSquare, UserPlus, Smartphone, Megaphone, MessagesSquare, FolderTree, FileSpreadsheet } from 'lucide-react'
import { useTheme } from 'next-themes'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/lib/auth-store'
import { Button } from '@/components/ui/button'
import { ChangePasswordDialog } from '@/components/change-password-dialog'

interface SidebarProps {
  view: string
  onNavigate: (v: string) => void
  onOpenSearch: () => void
  onLogout: () => void
}

const NAV = [
  { id: 'analytics', label: 'Аналитика', icon: BarChart3 },
  { id: 'home', label: 'Главная', icon: Home },
  { id: 'share', label: 'Smart Share', icon: Share2 },
  { id: 'products', label: 'Товары', icon: Package },
  { id: 'categories', label: 'Категории', icon: FolderTree },
  { id: 'price-lists', label: 'Прайс-листы', icon: FileSpreadsheet },
  { id: 'orders', label: 'Заказы', icon: ShoppingBag },
  { id: 'delivery', label: 'Доставка', icon: Truck },
  { id: 'users', label: 'Пользователи', icon: Users },
  { id: 'managers', label: 'Админы и менеджеры', icon: ShieldCheck },
  { id: 'chat-settings', label: 'Настройки чата', icon: MessagesSquare },
  { id: 'contacts', label: 'Контакты', icon: Phone },
  // v24.4: Mass push + departments (contacts by direction)
  { id: 'mass-push', label: 'Push-рассылка', icon: Megaphone },
  { id: 'departments', label: 'Контакты направлений', icon: Phone },
  // v12.3.1: Stories RESTORED (standalone module). v12.3: Feed remain removed.
  { id: 'stories', label: 'Сторис', icon: Image },
  { id: 'club', label: 'CLUB', icon: Crown },
  { id: 'banners', label: 'Баннеры', icon: RectangleHorizontal },
  { id: 'hero', label: 'Hero блок', icon: Sparkles },
  { id: 'header', label: 'Шапка', icon: ImagePlus },
  { id: 'info-pages', label: 'Инфо-страницы', icon: FileText },
  { id: 'aikb', label: 'AI Knowledge Base', icon: Bot },
  // v19.0: New admin sections
  { id: 'ai-providers', label: 'AI API', icon: Cpu },
  { id: 'promo-codes', label: 'Промокоды', icon: Tag },
  { id: 'bonus-points', label: 'Бонусные баллы', icon: Coins },
  { id: 'module-access', label: 'Доступ к модулям', icon: Grid3x3 },
  // v20: New registration + communication + splash screen settings
  { id: 'registration-settings', label: 'Настройки регистрации', icon: UserPlus },
  { id: 'communication', label: 'Настройки общения', icon: MessageSquare },
  { id: 'splash-screen', label: 'Стартовый экран', icon: Smartphone },
  { id: 'security', label: 'Безопасность', icon: Shield },
  { id: 'moderation', label: 'Модерация', icon: Activity },
  { id: 'audit', label: 'Журнал', icon: Activity },
] as const

export function Sidebar({ view, onNavigate, onOpenSearch, onLogout }: SidebarProps) {
  const user = useAuthStore((s) => s.user)
  const [changePwdOpen, setChangePwdOpen] = useState(false)
  // v13.0 (audit P0 dark/light): theme toggle. The dark theme CSS existed
  // but no UI to switch. Mounts the theme from next-themes.
  const { setTheme, resolvedTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  return (
    <aside className="hidden md:flex w-72 lg:w-80 shrink-0 sticky top-0 h-screen flex-col border-r border-border/60 glass">
      <div className="p-6">
        <button onClick={() => onNavigate('analytics')} className="flex items-center gap-3" aria-label="TRI999 Studio — на аналитику">
          <div className="h-10 w-10 rounded-xl gradient-brand grid place-items-center shadow-glow">
            <ImagePlus className="h-5 w-5 text-white" />
          </div>
          <div className="flex flex-col leading-tight">
            <span className="font-extrabold text-lg leading-none tracking-tight">TRI999</span>
            <span className="text-xs text-muted-foreground leading-tight mt-0.5">Studio</span>
          </div>
        </button>
      </div>

      <div className="px-3 pb-2">
        <button
          onClick={onOpenSearch}
          className={cn(
            'w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all hover:bg-accent/70',
            view === 'search' ? 'bg-primary/10 text-primary shadow-soft' : 'text-muted-foreground',
          )}
        >
          <Search className="h-5 w-5" />
          <span>Поиск</span>
        </button>
      </div>

      <nav className="px-3 flex-1 space-y-1">
        {NAV.map((item) => {
          const Icon = item.icon
          const active = view === item.id
          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              className={cn(
                'w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all hover:bg-accent/70',
                active ? 'bg-primary/10 text-primary shadow-soft' : 'text-muted-foreground',
              )}
            >
              <Icon className="h-5 w-5" strokeWidth={active ? 2.4 : 2} />
              <span>{item.label}</span>
            </button>
          )
        })}
      </nav>

      <div className="m-3 p-3 rounded-xl glass">
        <div className="flex items-center gap-3 mb-2">
          <div className="h-9 w-9 rounded-full gradient-brand grid place-items-center text-white text-xs font-bold shrink-0">
            {(user?.username || 'A').slice(0, 2).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold truncate">{user?.displayName || user?.username || 'Гость'}</div>
            <div className="text-xs text-muted-foreground truncate">{user ? `@${user.username}` : ''}</div>
          </div>
          {/* v13.0: theme toggle button */}
          {mounted && (
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full h-8 w-8 shrink-0"
              aria-label={resolvedTheme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'}
              onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
            >
              {resolvedTheme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
          )}
        </div>
        <div className="flex gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            className="flex-1 rounded-full h-8 text-xs"
            onClick={() => setChangePwdOpen(true)}
          >
            <KeyRound className="h-3.5 w-3.5 mr-1" />
            Пароль
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full h-8 w-8"
            aria-label="Выйти"
            onClick={onLogout}
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <ChangePasswordDialog open={changePwdOpen} onOpenChange={setChangePwdOpen} />
    </aside>
  )
}
