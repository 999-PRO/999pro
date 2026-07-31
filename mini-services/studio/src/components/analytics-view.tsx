'use client'

import { useEffect, useState, useCallback } from 'react'
import { api } from '@/lib/api'
import type { Analytics } from '@/lib/types'
import { cn, formatCompactNumber } from '@/lib/utils'
import { Package, Crown, Image, Eye, ShoppingBag, MessageSquare, Users, RectangleHorizontal } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

interface StatCard {
  key: keyof Analytics
  label: string
  icon: LucideIcon
  color: string
  gradient: string
}

const STATS: StatCard[] = [
  { key: 'products', label: 'Товары', icon: Package, color: 'text-sky-500', gradient: 'from-sky-400/20 to-blue-500/10' },
  // v12.3.1: stories + storyViews cards RESTORED (Stories is a standalone module).
  // v12.3: posts / likes / comments cards remain removed with Feed.
  { key: 'stories', label: 'Сторис', icon: Image, color: 'text-fuchsia-500', gradient: 'from-fuchsia-400/20 to-pink-500/10' },
  { key: 'storyViews', label: 'Просмотры сторис', icon: Eye, color: 'text-amber-500', gradient: 'from-amber-400/20 to-orange-500/10' },
  { key: 'orders', label: 'Заказы', icon: ShoppingBag, color: 'text-emerald-500', gradient: 'from-emerald-400/20 to-teal-500/10' },
  { key: 'messages', label: 'Сообщения', icon: MessageSquare, color: 'text-cyan-500', gradient: 'from-cyan-400/20 to-sky-500/10' },
  { key: 'users', label: 'Пользователи', icon: Users, color: 'text-blue-500', gradient: 'from-blue-400/20 to-indigo-500/10' },
  { key: 'banners', label: 'Баннеры', icon: RectangleHorizontal, color: 'text-teal-500', gradient: 'from-teal-400/20 to-emerald-500/10' },
]

export function AnalyticsView() {
  const [data, setData] = useState<Analytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(() => {
    setLoading(true)
    setError(null)
    api.get<Analytics>('/api/analytics', { auth: true })
      .then((d) => setData(d))
      .catch((e: unknown) => {
        // Previously this was `.catch(() => {})` which swallowed the
        // error silently — the skeleton stayed on screen forever with
        // no way for the admin to know what went wrong or retry.
        const msg = e instanceof Error ? e.message : 'Не удалось загрузить аналитику'
        setError(msg)
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return (
    <div className="px-4 md:px-6 py-6 pb-28 page-top-padding">
      <div className="mb-6">
        <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">Аналитика</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Обзор контента и активности в приложении «Три девятки».</p>
      </div>

      {error ? (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6 text-center">
          <p className="text-destructive font-semibold mb-2">⚠ Ошибка загрузки</p>
          <p className="text-sm text-muted-foreground mb-4">{error}</p>
          <button
            onClick={refresh}
            className="inline-flex items-center justify-center h-10 px-5 rounded-full gradient-brand text-white font-semibold text-sm hover:opacity-90 transition-opacity"
          >
            Повторить
          </button>
        </div>
      ) : loading || !data ? (
        // Skeleton count matches STATS.length (10) — was 8, mismatched
        // the actual card count after comments + banners were added.
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {Array.from({ length: STATS.length }).map((_, i) => <div key={i} className="h-28 rounded-2xl skeleton" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {STATS.map((s, i) => {
            const Icon = s.icon
            const value = data[s.key] || 0
            return (
              <div
                key={s.key}
                className={cn(
                  'relative rounded-2xl glass p-4 overflow-hidden animate-fade-in-up',
                )}
                style={{ animationDelay: `${i * 30}ms` }}
              >
                <div className={cn('absolute inset-0 bg-gradient-to-br opacity-50', s.gradient)} />
                <div className="relative">
                  <div className={cn('h-10 w-10 rounded-xl bg-background/60 backdrop-blur-sm grid place-items-center mb-3', s.color)}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="text-2xl font-extrabold tracking-tight">{formatCompactNumber(value)}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{s.label}</div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Quick actions */}
      <div className="mt-8">
        <h2 className="text-lg font-bold mb-3">Быстрые действия</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <QuickAction label="Добавить товар" href="#products" icon={Package} />
          {/* v12.3.1: Stories quick action RESTORED. */}
          <QuickAction label="Создать сторис" href="#stories" icon={Image} />
          {/* v12.3: Feed quick action remains removed. */}
          <QuickAction label="999 CLUB" href="#club" icon={Crown} />
        </div>
      </div>
    </div>
  )
}

function QuickAction({ label, href, icon: Icon }: { label: string; href: string; icon: LucideIcon }) {
  return (
    <a
      href={href}
      className="rounded-2xl glass p-4 flex items-center gap-3 hover:bg-accent/40 transition-colors"
    >
      <div className="h-10 w-10 rounded-xl gradient-brand grid place-items-center text-white">
        <Icon className="h-5 w-5" />
      </div>
      <div className="text-sm font-semibold">{label}</div>
    </a>
  )
}
