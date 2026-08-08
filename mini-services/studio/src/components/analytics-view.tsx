'use client'

import { useEffect, useState, useCallback } from 'react'
import { api } from '@/lib/api'
import type { Analytics } from '@/lib/types'
import { cn, formatCompactNumber } from '@/lib/utils'
import { Package, Crown, Image, Eye, ShoppingBag, MessageSquare, Users, RectangleHorizontal, TrendingUp, Calendar, Clock, Globe, ShoppingCart, RefreshCw, UserCheck } from 'lucide-react'
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

// v25.7 (TZ ЭТАП 2.5): types for the new detailed analytics endpoints.
interface UsersAnalytics {
  counts: { today: number; yesterday: number; week: number; month: number; total: number }
  newUsers: Array<{
    id: string; username: string; displayName: string | null; phone: string;
    email: string; avatar: string | null; role: string; isOnline: boolean;
    lastSeen: string; createdAt: string
  }>
  total: number; limit: number; offset: number
}
interface VisitsAnalytics {
  counts: { today: number; yesterday: number; week: number; month: number; total: number }
  onlineNow: number
  onlineUsers: Array<{ id: string; username: string; displayName: string | null; avatar: string | null; role: string; lastSeen: string }>
}
interface CommentsAnalytics {
  counts: { today: number; yesterday: number; week: number; month: number; total: number }
}
interface OrdersAnalytics {
  byStatus: Record<string, number>
  byPeriod: { today: number; yesterday: number; week: number; month: number; total: number }
  summary: { new: number; completed: number; cancelled: number; pending: number }
}

type Tab = 'overview' | 'users' | 'visits' | 'comments' | 'orders'

const TABS: { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: 'overview', label: 'Обзор', icon: TrendingUp },
  { id: 'users', label: 'Пользователи', icon: Users },
  { id: 'visits', label: 'Посещения', icon: Globe },
  { id: 'comments', label: 'Комментарии', icon: MessageSquare },
  { id: 'orders', label: 'Заказы', icon: ShoppingCart },
]

export function AnalyticsView() {
  const [data, setData] = useState<Analytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // v25.7: active tab in the detailed analytics section.
  const [tab, setTab] = useState<Tab>('overview')
  const [usersData, setUsersData] = useState<UsersAnalytics | null>(null)
  const [visitsData, setVisitsData] = useState<VisitsAnalytics | null>(null)
  const [commentsData, setCommentsData] = useState<CommentsAnalytics | null>(null)
  const [ordersData, setOrdersData] = useState<OrdersAnalytics | null>(null)
  const [tabLoading, setTabLoading] = useState(false)

  const refresh = useCallback(() => {
    setLoading(true)
    setError(null)
    api.get<Analytics>('/api/analytics', { auth: true })
      .then((d) => setData(d))
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : 'Не удалось загрузить аналитику'
        setError(msg)
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  // v25.7: lazy-load the selected tab's data. Only fetches when the user
  // switches to that tab (avoids 4 parallel requests on initial load).
  useEffect(() => {
    if (tab === 'overview') return
    setTabLoading(true)
    const endpoint = `/api/analytics/${tab}`
    api.get<UsersAnalytics | VisitsAnalytics | CommentsAnalytics | OrdersAnalytics>(endpoint, { auth: true })
      .then((d) => {
        if (tab === 'users') setUsersData(d as UsersAnalytics)
        else if (tab === 'visits') setVisitsData(d as VisitsAnalytics)
        else if (tab === 'comments') setCommentsData(d as CommentsAnalytics)
        else if (tab === 'orders') setOrdersData(d as OrdersAnalytics)
      })
      .catch(() => {
        // Tab data is non-critical — leave the previous data in place.
      })
      .finally(() => setTabLoading(false))
  }, [tab])

  return (
    <div className="px-4 md:px-6 py-6 pb-28 page-top-padding">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">Аналитика</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Обзор контента и активности в приложении TRI999.</p>
        </div>
        <button
          onClick={refresh}
          className="h-9 w-9 rounded-full grid place-items-center bg-foreground/5 hover:bg-foreground/10 transition-colors"
          aria-label="Обновить"
          title="Обновить"
        >
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
        </button>
      </div>

      {/* Online-now badge — always visible at the top, regardless of tab. */}
      {data?.onlineNow !== undefined && (
        <div className="mb-4 rounded-2xl glass p-4 flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-emerald-500/15 grid place-items-center text-emerald-500">
            <UserCheck className="h-5 w-5" />
          </div>
          <div>
            <div className="text-2xl font-extrabold leading-none">{data.onlineNow}</div>
            <div className="text-xs text-muted-foreground mt-1">пользователей онлайн сейчас</div>
          </div>
        </div>
      )}

      {/* Tabbed sections — v25.7 (TZ ЭТАП 2.5) */}
      <div className="mb-4 flex gap-1 overflow-x-auto no-scrollbar">
        {TABS.map((t) => {
          const Icon = t.icon
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-semibold transition-colors whitespace-nowrap',
                tab === t.id
                  ? 'gradient-brand text-white shadow-md'
                  : 'bg-foreground/5 text-muted-foreground hover:bg-foreground/10',
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          )
        })}
      </div>

      {/* Tab content */}
      {tab === 'overview' && (
        <>
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
                    className={cn('relative rounded-2xl glass p-4 overflow-hidden animate-fade-in-up')}
                    style={{ animationDelay: `${i * 30}ms` }}
                  >
                    <div className={cn('absolute inset-0 bg-gradient-to-br opacity-50', s.gradient)} />
                    <div className="relative">
                      <div className={cn('h-10 w-10 rounded-xl bg-background/60 backdrop-blur-sm grid place-items-center mb-3', s.color)}>
                        <Icon className="h-5 w-5" />
                      </div>
                      <div className="text-2xl font-extrabold tracking-tight">{formatCompactNumber(typeof value === 'number' ? value : 0)}</div>
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
              <QuickAction label="Создать сторис" href="#stories" icon={Image} />
              <QuickAction label="999 CLUB" href="#club" icon={Crown} />
            </div>
          </div>
        </>
      )}

      {/* Users tab */}
      {tab === 'users' && (
        <div className="space-y-4">
          {tabLoading && !usersData ? (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-24 rounded-2xl skeleton" />)}
            </div>
          ) : usersData ? (
            <>
              <PeriodCounts counts={usersData.counts} label="новых пользователей" />
              <div>
                <h3 className="text-sm font-bold mb-2">Новые пользователи</h3>
                <div className="rounded-2xl glass overflow-hidden divide-y divide-border/30">
                  {usersData.newUsers.map((u) => (
                    <div key={u.id} className="flex items-center gap-3 p-3">
                      <div className="h-9 w-9 rounded-full bg-gradient-to-br from-sky-400/30 to-indigo-500/20 grid place-items-center text-xs font-bold">
                        {(u.displayName || u.username || '?').slice(0, 1).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold truncate">{u.displayName || u.username}</div>
                        <div className="text-xs text-muted-foreground truncate">{u.phone}</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-xs text-muted-foreground">{new Date(u.createdAt).toLocaleDateString('ru-RU')}</div>
                        {u.isOnline && (
                          <div className="text-[10px] font-bold text-emerald-500 mt-0.5">● онлайн</div>
                        )}
                      </div>
                    </div>
                  ))}
                  {usersData.newUsers.length === 0 && (
                    <div className="p-6 text-center text-sm text-muted-foreground">Новых пользователей за период нет.</div>
                  )}
                </div>
              </div>
            </>
          ) : null}
        </div>
      )}

      {/* Visits tab */}
      {tab === 'visits' && (
        <div className="space-y-4">
          {tabLoading && !visitsData ? (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-24 rounded-2xl skeleton" />)}
            </div>
          ) : visitsData ? (
            <>
              <PeriodCounts counts={visitsData.counts} label="посещений" />
              <div className="rounded-2xl glass p-4 flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-emerald-500/15 grid place-items-center text-emerald-500">
                  <UserCheck className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-2xl font-extrabold leading-none">{visitsData.onlineNow}</div>
                  <div className="text-xs text-muted-foreground mt-1">онлайн сейчас</div>
                </div>
              </div>
              {visitsData.onlineUsers.length > 0 && (
                <div>
                  <h3 className="text-sm font-bold mb-2">Кто онлайн (топ-50)</h3>
                  <div className="rounded-2xl glass overflow-hidden divide-y divide-border/30">
                    {visitsData.onlineUsers.map((u) => (
                      <div key={u.id} className="flex items-center gap-3 p-3">
                        <div className="h-8 w-8 rounded-full bg-gradient-to-br from-emerald-400/30 to-teal-500/20 grid place-items-center text-xs font-bold">
                          {(u.displayName || u.username || '?').slice(0, 1).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold truncate">{u.displayName || u.username}</div>
                          {u.role === 'admin' && (
                            <span className="text-[10px] font-bold text-primary">АДМИН</span>
                          )}
                        </div>
                        <div className="text-[10px] text-emerald-500 font-bold shrink-0">● онлайн</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : null}
        </div>
      )}

      {/* Comments tab */}
      {tab === 'comments' && (
        <div className="space-y-4">
          {tabLoading && !commentsData ? (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-24 rounded-2xl skeleton" />)}
            </div>
          ) : commentsData ? (
            <PeriodCounts counts={commentsData.counts} label="комментариев и отзывов" />
          ) : null}
        </div>
      )}

      {/* Orders tab */}
      {tab === 'orders' && (
        <div className="space-y-4">
          {tabLoading && !ordersData ? (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-24 rounded-2xl skeleton" />)}
            </div>
          ) : ordersData ? (
            <>
              {/* Status summary cards (new / completed / cancelled / pending) */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <SummaryCard label="Новые" value={ordersData.summary.new} color="text-sky-500" gradient="from-sky-400/20 to-blue-500/10" />
                <SummaryCard label="Выполненные" value={ordersData.summary.completed} color="text-emerald-500" gradient="from-emerald-400/20 to-teal-500/10" />
                <SummaryCard label="Отменённые" value={ordersData.summary.cancelled} color="text-rose-500" gradient="from-rose-400/20 to-red-500/10" />
                <SummaryCard label="Ожидают" value={ordersData.summary.pending} color="text-amber-500" gradient="from-amber-400/20 to-orange-500/10" />
              </div>
              <PeriodCounts counts={ordersData.byPeriod} label="заказов всего" />
              {/* Status breakdown */}
              <div>
                <h3 className="text-sm font-bold mb-2">По статусам</h3>
                <div className="rounded-2xl glass p-4 space-y-2">
                  {Object.entries(ordersData.byStatus).sort((a, b) => b[1] - a[1]).map(([status, count]) => (
                    <div key={status} className="flex items-center justify-between">
                      <span className="text-sm">{ORDER_STATUS_LABELS[status] || status}</span>
                      <span className="text-sm font-bold">{count}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : null}
        </div>
      )}
    </div>
  )
}

const ORDER_STATUS_LABELS: Record<string, string> = {
  new: 'Новые',
  in_work: 'В работе',
  production: 'В производстве',
  ready: 'Готов к выдаче',
  in_delivery: 'В доставке',
  done: 'Выполненные',
  cancelled: 'Отменённые',
}

function PeriodCounts({
  counts,
  label,
}: {
  counts: { today: number; yesterday: number; week: number; month: number; total: number }
  label: string
}) {
  const cards = [
    { key: 'today', label: 'Сегодня', value: counts.today, icon: Clock },
    { key: 'yesterday', label: 'Вчера', value: counts.yesterday, icon: Calendar },
    { key: 'week', label: 'За неделю', value: counts.week, icon: Calendar },
    { key: 'month', label: 'За месяц', value: counts.month, icon: Calendar },
    { key: 'total', label: 'Всего', value: counts.total, icon: TrendingUp },
  ] as const
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      {cards.map((c) => {
        const CardIcon = c.icon
        return (
          <div key={c.key} className="rounded-2xl glass p-3">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1.5">
              <CardIcon className="h-3 w-3" />
              {c.label}
            </div>
            <div className="text-2xl font-extrabold tracking-tight">{formatCompactNumber(c.value)}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">{label}</div>
          </div>
        )
      })}
    </div>
  )
}

function SummaryCard({
  label, value, gradient,
}: {
  label: string; value: number; color: string; gradient: string
}) {
  return (
    <div className={cn('relative rounded-2xl glass p-4 overflow-hidden')}>
      <div className={cn('absolute inset-0 bg-gradient-to-br opacity-50', gradient)} />
      <div className="relative">
        <div className="text-2xl font-extrabold tracking-tight">{formatCompactNumber(value)}</div>
        <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
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
