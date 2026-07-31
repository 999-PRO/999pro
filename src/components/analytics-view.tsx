'use client'

// ============================================================================
//  AnalyticsView — admin dashboard showing real analytics from /api/analytics.
//  v22 audit: created so the AI's "open analytics" action has a target view.
//  Pulls real numbers from the backend (orders, revenue, users, products).
// ============================================================================

import { useEffect, useState, useCallback } from 'react'
import { TrendingUp, ShoppingBag, Users, DollarSign, Package, MessageCircle, Star, Activity } from 'lucide-react'
import { api } from '@/lib/api'
import { useAuthStore } from '@/lib/auth-store'

interface AnalyticsData {
  products: number
  activeProducts: number
  stories: number
  storyViews: number
  orders: number
  messages: number
  users: number
  banners: number
  todayOrders: number
  todayRevenue: number
  totalRevenue: number
  statusBreakdown: Record<string, number>
  recentOrders: Array<{
    id: string
    total: number
    status: string
    name: string | null
    createdAt: string
    itemsCount: number
    firstItemTitle: string | null
  }>
}

const STATUS_LABELS: Record<string, string> = {
  new: 'Новые',
  in_work: 'В работе',
  production: 'Производство',
  ready: 'Готов',
  in_delivery: 'Передан в доставку',
  done: 'Завершён',
  cancelled: 'Отменён',
}

const STATUS_COLORS: Record<string, string> = {
  new: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  in_work: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  production: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
  ready: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
  in_delivery: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30',
  done: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  cancelled: 'bg-red-500/15 text-red-400 border-red-500/30',
}

export function AnalyticsView({ onNavigate }: { onNavigate?: (v: string) => void }) {
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const user = useAuthStore((s) => s.user)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const d = await api.get<AnalyticsData>('/api/analytics', { auth: true })
      setData(d)
    } catch (e: any) {
      setError(e?.message || 'Не удалось загрузить аналитику')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) {
    return (
      <div className="px-4 md:px-6 py-6 pb-28 md:pb-6">
        <div className="h-32 rounded-3xl skeleton mb-4" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-28 rounded-3xl skeleton" />
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="px-4 md:px-6 py-6 pb-28 md:pb-6">
        <div className="rounded-3xl glass p-6 text-center">
          <p className="text-red-400 mb-2">{error}</p>
          <button onClick={load} className="px-4 py-2 rounded-full bg-primary text-primary-foreground text-sm">
            Повторить
          </button>
        </div>
      </div>
    )
  }

  if (!data) return null

  const stats = [
    { label: 'Заказы сегодня', value: data.todayOrders, icon: <ShoppingBag className="h-5 w-5" />, color: 'from-blue-500 to-indigo-500' },
    { label: 'Выручка сегодня', value: `${data.todayRevenue.toLocaleString('ru-RU')} ₽`, icon: <DollarSign className="h-5 w-5" />, color: 'from-emerald-500 to-teal-500' },
    { label: 'Всего заказов', value: data.orders, icon: <Package className="h-5 w-5" />, color: 'from-purple-500 to-fuchsia-500' },
    { label: 'Общая выручка', value: `${data.totalRevenue.toLocaleString('ru-RU')} ₽`, icon: <TrendingUp className="h-5 w-5" />, color: 'from-amber-500 to-orange-500' },
    { label: 'Клиенты', value: data.users, icon: <Users className="h-5 w-5" />, color: 'from-cyan-500 to-blue-500' },
    { label: 'Товары', value: data.products, icon: <Package className="h-5 w-5" />, color: 'from-rose-500 to-pink-500' },
    { label: 'Активные товары', value: data.activeProducts, icon: <Star className="h-5 w-5" />, color: 'from-violet-500 to-purple-500' },
    { label: 'Сообщения', value: data.messages, icon: <MessageCircle className="h-5 w-5" />, color: 'from-green-500 to-emerald-500' },
  ]

  return (
    <div className="px-4 md:px-6 py-6 pb-28 md:pb-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="h-11 w-11 rounded-2xl grid place-items-center bg-gradient-to-br from-blue-500 to-indigo-500 shadow-lg shadow-blue-500/30">
          <Activity className="h-6 w-6 text-white" />
        </div>
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Аналитика</h1>
          <p className="text-sm text-muted-foreground">Реальные данные из базы на {new Date().toLocaleDateString('ru-RU')}</p>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-6">
        {stats.map((s) => (
          <div key={s.label} className="rounded-3xl glass p-4 md:p-5">
            <div className={`h-10 w-10 rounded-2xl grid place-items-center bg-gradient-to-br ${s.color} shadow-lg mb-3`}>
              {s.icon}
            </div>
            <div className="text-2xl md:text-3xl font-bold tracking-tight">{s.value}</div>
            <div className="text-xs text-muted-foreground mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Status breakdown */}
      {Object.keys(data.statusBreakdown).length > 0 && (
        <div className="rounded-3xl glass p-5 mb-6">
          <h2 className="text-lg font-semibold mb-4">Заказы по статусам</h2>
          <div className="flex flex-wrap gap-2">
            {Object.entries(data.statusBreakdown).map(([status, count]) => (
              <div key={status} className={`px-3 py-2 rounded-full text-sm border ${STATUS_COLORS[status] || 'bg-muted text-muted-foreground'}`}>
                {STATUS_LABELS[status] || status}: {count}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent orders */}
      <div className="rounded-3xl glass p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Последние заказы</h2>
          {onNavigate && (
            <button
              onClick={() => onNavigate('orders')}
              className="text-xs text-primary hover:underline"
            >
              Все заказы →
            </button>
          )}
        </div>
        {data.recentOrders.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">Заказов пока нет</p>
        ) : (
          <div className="space-y-2">
            {data.recentOrders.map((o) => (
              <div key={o.id} className="flex items-center justify-between p-3 rounded-2xl bg-muted/30 hover:bg-muted/50 transition-colors">
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate">{o.firstItemTitle || `Заказ #${o.id.slice(-6)}`}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {o.name || 'Без имени'} · {new Date(o.createdAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-sm font-semibold">{Number(o.total).toLocaleString('ru-RU')} ₽</span>
                  <span className={`px-2 py-1 rounded-full text-xs border ${STATUS_COLORS[o.status] || 'bg-muted text-muted-foreground'}`}>
                    {STATUS_LABELS[o.status] || o.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Admin-only footer hint */}
      {user?.role !== 'admin' && (
        <div className="mt-6 rounded-3xl bg-amber-500/10 border border-amber-500/30 p-4 text-sm text-amber-400">
          Аналитика доступна только администраторам и менеджерам.
        </div>
      )}
    </div>
  )
}
