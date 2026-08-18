'use client'

/**
 * OrdersManager — Studio admin panel for viewing and managing orders.
 *
 * v16.5 features:
 *   - 7 status workflow (Новые → В работе → Производство → Готов →
 *     Передан в доставку → Завершён / Отменён)
 *   - Category filter (Реклама/Подарки/Мебель/Полиграфия/Интерьер)
 *   - Quick text search (name/phone/id/comment)
 *   - Confirmation dialog before ANY status change
 *   - Status history panel + revert to previous status
 *   - Real-time: polls every 60s + socket updates
 */

import { useEffect, useState, useCallback } from 'react'
import {
  ShoppingBag, Clock, Cog, Factory, CheckCircle2, Truck, XCircle,
  ChevronDown, Phone, User, MessageSquare, Ticket, MessageCircle,
  Navigation, Store, Loader2, RefreshCw, Package, Search, History, RotateCcw,
} from 'lucide-react'
import { api, assetUrl } from '@/lib/api'
import { cn, formatPrice, timeAgo } from '@/lib/utils'
import type { Order, OrderStatus } from '@/lib/types'
import { toast } from '@/lib/notifications'

const STATUSES: { id: OrderStatus; label: string; color: string; icon: typeof Clock }[] = [
  { id: 'new', label: 'Новые', color: 'bg-amber-500', icon: Clock },
  { id: 'in_work', label: 'В работе', color: 'bg-blue-500', icon: Cog },
  { id: 'production', label: 'Производство', color: 'bg-purple-500', icon: Factory },
  { id: 'ready', label: 'Готов', color: 'bg-cyan-500', icon: CheckCircle2 },
  { id: 'in_delivery', label: 'В доставке', color: 'bg-indigo-500', icon: Truck },
  { id: 'done', label: 'Завершён', color: 'bg-emerald-500', icon: CheckCircle2 },
  { id: 'cancelled', label: 'Отменён', color: 'bg-rose-500', icon: XCircle },
]

// v16.5: common product categories for the filter dropdown
// v25.11: now loaded dynamically from /api/categories (with fallback)
const FALLBACK_CATEGORIES = ['Реклама', 'Подарки', 'Мебель', 'Полиграфия', 'Интерьер']

interface HistoryEntry {
  id: string
  orderId: string
  fromStatus: string
  toStatus: string
  changedBy: { id: string; username: string; displayName?: string | null } | null
  note: string | null
  createdAt: string
}

export function OrdersManager() {
const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<OrderStatus | 'all'>('all')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  // v25.11: dynamic categories from /api/categories (replaces hardcoded FALLBACK_CATEGORIES)
  const [dbCategories, setDbCategories] = useState<string[]>(FALLBACK_CATEGORIES)
  useEffect(() => {
    api.get<{ items: { name: string }[] }>('/api/categories')
      .then((d) => {
        if (d.items && d.items.length > 0) setDbCategories(d.items.map((c) => c.name))
      })
      .catch(() => {})
  }, [])
  // v16.5: confirm dialog state
  const [confirmDialog, setConfirmDialog] = useState<{ orderId: string; status: OrderStatus; label: string } | null>(null)
  // v16.5: history panel state
  const [historyOrderId, setHistoryOrderId] = useState<string | null>(null)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  // v16.8 (AUDIT-2 C8/Y6): server-side pagination — previously the studio
  // loaded ALL orders via ?all=true with no limit, which would crash the
  // browser at ~1000+ orders. Now we paginate server-side (50/page) with a
  // "load more" button, and the search/filter is also pushed to the server
  // for the q parameter (status/category filters stay client-side on the
  // current page to keep the UX snappy).
  const [page, setPage] = useState(0) // 0-indexed
  const [total, setTotal] = useState(0)
  const PAGE_SIZE = 50
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const load = useCallback(async (pageNum = page) => {
    setLoading(true)
    try {
      // v16.8: pass limit + offset + q to the server. status/category filters
      // stay client-side for now (they're cheap on a 50-row page).
      const params = new URLSearchParams({
        all: 'true',
        limit: String(PAGE_SIZE),
        offset: String(pageNum * PAGE_SIZE),
      })
      if (searchQuery.trim()) params.set('q', searchQuery.trim())
      const res = await api.get<{ items: Order[]; total: number }>(`/api/orders?${params}`, { auth: true })
      setOrders(res.items)
      setTotal(res.total)
    } catch (e: any) {
      toast.error('Ошибка загрузки заказов', { description: e?.message })
    } finally {
      setLoading(false)
    }
  }, [toast, page, searchQuery])

  useEffect(() => {
    load(0)
    // v16.8: poll only when tab is visible — avoids wasted requests in background.
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') load(page)
    }, 60_000)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // v16.8: reload when search query changes (debounced).
  useEffect(() => {
    const t = setTimeout(() => {
      setPage(0)
      load(0)
    }, 400)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery])

  // v16.6: client-side filtering (status + category + search)
  // Category falls back to first item's product.category when order.category
  // is null (legacy orders created before v16.5).
  const filtered = orders.filter((o) => {
    if (statusFilter !== 'all' && o.status !== statusFilter) return false
    if (categoryFilter !== 'all') {
      const orderCategory = o.category || o.items?.[0]?.product?.category || null
      if (orderCategory !== categoryFilter) return false
    }
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase()
      // v16.6: universal search — product title, article, customer name,
      // phone, order number, category, comment, delivery address.
      const itemMatch = o.items.some((it: any) =>
        it.product?.title?.toLowerCase().includes(q) ||
        it.product?.article?.toLowerCase().includes(q) ||
        it.product?.category?.toLowerCase().includes(q)
      )
      const matches =
        o.name?.toLowerCase().includes(q) ||
        o.phone?.toLowerCase().includes(q) ||
        o.id.toLowerCase().includes(q) ||
        o.comment?.toLowerCase().includes(q) ||
        o.address?.toLowerCase().includes(q) ||
        o.category?.toLowerCase().includes(q) ||
        itemMatch
      if (!matches) return false
    }
    return true
  })

  const updateStatus = async (id: string, status: OrderStatus) => {
    setUpdatingId(id)
    try {
      await api.patch(`/api/orders/${id}`, { json: { status }, auth: true })
      setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, status } : o)))
      toast.success('Статус обновлён')
    } catch (e: any) {
      toast.error('Ошибка', { description: e?.message })
    } finally {
      setUpdatingId(null)
    }
  }

  // v16.5: confirm before status change
  const requestStatusChange = (orderId: string, status: OrderStatus) => {
    const cfg = STATUSES.find((s) => s.id === status)
    setConfirmDialog({ orderId, status, label: cfg?.label || status })
  }

  // v16.5: load history for an order
  const loadHistory = async (orderId: string) => {
    setHistoryLoading(true)
    try {
      const res = await api.get<{ items: HistoryEntry[] }>(`/api/orders/${orderId}/history`, { auth: true })
      setHistory(res.items)
      setHistoryOrderId(orderId)
    } catch (e: any) {
      toast.error('Ошибка загрузки истории', { description: e?.message })
    } finally {
      setHistoryLoading(false)
    }
  }

  // v16.5: revert to previous status
  const revertStatus = async (orderId: string) => {
    setUpdatingId(orderId)
    try {
      const updated = await api.post<Order>(`/api/orders/${orderId}/revert`, { auth: true })
      setOrders((prev) => prev.map((o) => (o.id === orderId ? updated : o)))
      toast.success('Статус возвращён')
      loadHistory(orderId) // refresh history
    } catch (e: any) {
      toast.error('Ошибка отката', { description: e?.message })
    } finally {
      setUpdatingId(null)
    }
  }

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="h-12 w-12 rounded-2xl grid place-items-center bg-gradient-to-br from-violet-500 to-fuchsia-600 text-white shadow-lg">
          <ShoppingBag className="h-6 w-6" />
        </div>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight">Заказы</h1>
          <p className="text-sm text-muted-foreground">
            {total} всего · стр. {page + 1} из {totalPages}
          </p>
        </div>
        <button
          onClick={() => load(page)}
          disabled={loading}
          className="h-10 w-10 rounded-xl bg-foreground/5 hover:bg-foreground/10 grid place-items-center transition-colors"
        >
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
        </button>
      </div>

      {/* v16.5: Search + category filter */}
      <div className="space-y-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Поиск: имя, телефон, № заказа, комментарий…"
            className="w-full h-10 rounded-xl bg-foreground/5 border border-border/40 pl-9 pr-3 text-sm"
          />
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
          <FilterChip
            active={categoryFilter === 'all'}
            onClick={() => setCategoryFilter('all')}
            label="Все категории"
          />
          {dbCategories.map((cat) => (
            <FilterChip
              key={cat}
              active={categoryFilter === cat}
              onClick={() => setCategoryFilter(cat)}
              label={cat}
            />
          ))}
        </div>
      </div>

      {/* Status filter chips */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        <FilterChip
          active={statusFilter === 'all'}
          onClick={() => setStatusFilter('all')}
          label="Все"
          count={orders.length}
        />
        {STATUSES.map((s) => {
          const count = orders.filter((o) => o.status === s.id).length
          return (
            <FilterChip
              key={s.id}
              active={statusFilter === s.id}
              onClick={() => setStatusFilter(s.id)}
              label={s.label}
              count={count}
              color={s.color}
            />
          )
        })}
      </div>

      {/* Orders list */}
      {loading && orders.length === 0 ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/40 p-8 text-center text-muted-foreground">
          <Package className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">Заказов не найдено.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((order) => {
            const expanded = expandedId === order.id
            const statusConfig = STATUSES.find((s) => s.id === order.status) || STATUSES[0]
            return (
              <div key={order.id} className="rounded-2xl border border-border/40 bg-card overflow-hidden">
                <button
                  onClick={() => setExpandedId(expanded ? null : order.id)}
                  className="w-full p-4 flex items-center gap-3 text-left hover:bg-foreground/[0.02] transition-colors"
                >
                  <div className={cn('h-10 w-10 rounded-xl grid place-items-center text-white shrink-0', statusConfig.color)}>
                    <statusConfig.icon className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm">#{order.id.slice(-6).toUpperCase()}</span>
                      <span className="text-xs text-muted-foreground">· {timeAgo(order.createdAt)}</span>
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {order.name || 'Гость'} · {order.items.length} тов.
                      {order.deliveryMethod && (
                        <> · {order.deliveryMethod === 'delivery' ? '🚚 Доставка' : '🏬 Самовывоз'}</>
                      )}
                      {order.category && <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-foreground/10">{order.category}</span>}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-bold text-sm">{formatPrice(order.total)}</div>
                    <div className="text-[10px] text-muted-foreground">{statusConfig.label}</div>
                  </div>
                  <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', expanded && 'rotate-180')} />
                </button>

                {expanded && (
                  <div className="px-4 pb-4 border-t border-border/30 space-y-3">
                    {/* Items */}
                    <div className="space-y-2 pt-3">
                      {order.items.map((item) => (
                        <div key={item.id} className="flex items-center gap-3 p-2 rounded-xl bg-foreground/5">
                          <div className="h-10 w-10 rounded-lg overflow-hidden shrink-0 bg-foreground/10 grid place-items-center">
                            {item.product?.images?.[0] ? (
                              <img src={assetUrl(item.product.images[0])} alt={item.product.title} className="w-full h-full object-cover" />
                            ) : (
                              <Package className="h-4 w-4 text-muted-foreground" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium truncate">{item.product?.title || 'Товар удалён'}</div>
                            <div className="text-xs text-muted-foreground">{item.quantity} × {formatPrice(item.price)}</div>
                          </div>
                          <div className="text-sm font-semibold">{formatPrice(item.price * item.quantity)}</div>
                        </div>
                      ))}
                    </div>

                    {/* Contact + delivery details */}
                    <div className="pt-3 border-t border-border/30 space-y-1.5 text-xs">
                      {order.name && (
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <User className="h-3 w-3" /> <span className="text-foreground font-medium">{order.name}</span>
                        </div>
                      )}
                      {order.phone && (
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Phone className="h-3 w-3" />
                          <a href={`tel:${order.phone.replace(/[^0-9+]/g, '')}`} className="text-foreground font-medium hover:text-blue-600 transition-colors">
                            {order.phone}
                          </a>
                          {/* v24.5: WhatsApp link */}
                          <a
                            href={`https://wa.me/${order.phone.replace(/[^0-9]/g, '')}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-green-600 hover:text-green-700 transition-colors ml-1"
                            title="Написать в WhatsApp"
                          >
                            <MessageCircle className="h-3 w-3" /> WhatsApp
                          </a>
                        </div>
                      )}
                      {order.deliveryMethod && (
                        <div className="flex items-start gap-2 text-muted-foreground">
                          {order.deliveryMethod === 'delivery' ? <Truck className="h-3 w-3 mt-0.5" /> : <Store className="h-3 w-3 mt-0.5" />}
                          <div className="flex-1 min-w-0">
                            <span className="text-foreground">{order.deliveryMethod === 'delivery' ? 'Доставка' : 'Самовывоз'}</span>
                            {order.deliveryMethod === 'delivery' && order.deliveryZone && (
                              <span className="text-muted-foreground"> · {order.deliveryZone.name}</span>
                            )}
                            {order.deliveryMethod === 'delivery' && order.deliveryFee != null && order.deliveryFee > 0 && (
                              <span className="text-muted-foreground"> · +{formatPrice(order.deliveryFee)}</span>
                            )}
                            {order.address && (
                              <div className="text-muted-foreground mt-0.5 break-words">{order.address}</div>
                            )}
                            {order.deliveryMethod === 'delivery' && (order.mapUrl || (order.lat != null && order.lng != null)) && (
                              <div className="mt-2 space-y-1.5">
                                {/* v24.5: Inline map preview — admin can see the client's
                                    pin directly without opening a new tab. Uses Yandex Maps
                                    embed (free, no API key needed for basic embed). */}
                                {order.lat != null && order.lng != null && (
                                  <div className="relative rounded-xl overflow-hidden border border-border/40" style={{ height: '180px' }}>
                                    <iframe
                                      src={`https://yandex.ru/map-widget/v1/?ll=${order.lng}%2C${order.lat}&z=16&pt=${order.lng}%2C${order.lat}%2Cpm2rdm`}
                                      width="100%"
                                      height="100%"
                                      frameBorder="0"
                                      allowFullScreen
                                      style={{ border: 0 }}
                                      title="Карта доставки"
                                    />
                                  </div>
                                )}
                                <a
                                  href={order.mapUrl || `https://yandex.ru/maps/?ll=${order.lng}%2C${order.lat}&z=16&pt=${order.lng}%2C${order.lat}%2Cpm2rdm`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => {
                                    e.preventDefault()
                                    const url = order.mapUrl || `https://yandex.ru/maps/?ll=${order.lng}%2C${order.lat}&z=16&pt=${order.lng}%2C${order.lat}%2Cpm2rdm`
                                    window.open(url, '_blank', 'noopener,noreferrer')
                                  }}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-primary/10 hover:bg-primary/15 text-primary font-medium text-[11px] transition-colors"
                                >
                                  <Navigation className="h-3 w-3" /> Открыть на Яндекс.Карте
                                </a>
                                <a
                                  href={`https://www.google.com/maps/search/?api=1&query=${order.lat},${order.lng}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-500/10 hover:bg-blue-500/15 text-blue-600 font-medium text-[11px] transition-colors ml-1"
                                >
                                  <Navigation className="h-3 w-3" /> Google Maps
                                </a>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                      {order.comment && (
                        <div className="flex items-start gap-2 text-muted-foreground">
                          <MessageSquare className="h-3 w-3 mt-0.5" /> <span>{order.comment}</span>
                        </div>
                      )}
                      {order.couponCode && (
                        <div className="flex items-center gap-2 text-emerald-500">
                          <Ticket className="h-3 w-3" /> <span className="font-medium">{order.couponCode}</span>
                          {order.discount != null && order.discount > 0 && (
                            <span>−{formatPrice(order.discount)}</span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Total + status actions */}
                    <div className="pt-3 border-t border-border/30 flex items-center justify-between gap-3 flex-wrap">
                      <div>
                        <div className="text-xs text-muted-foreground">Итого</div>
                        <div className="text-lg font-bold">{formatPrice(order.total)}</div>
                      </div>
                      {/* v24.5: Show ALL status buttons — current status is highlighted.
                          Previously the current status was hidden, so the admin couldn't
                          see which status was active. Now ALL statuses are shown, with
                          the current one highlighted in its color. */}
                      <div className="flex gap-1.5 flex-wrap">
                        {STATUSES.map((s) => {
                          const isCurrent = order.status === s.id
                          return (
                            <button
                              key={s.id}
                              onClick={() => !isCurrent && requestStatusChange(order.id, s.id)}
                              disabled={updatingId === order.id || isCurrent}
                              className={cn(
                                'h-9 px-3 rounded-lg text-xs font-medium transition-all disabled:opacity-50 flex items-center gap-1.5',
                                isCurrent
                                  ? `${s.color} text-white shadow-md ring-2 ring-offset-1 ring-offset-background ring-current/30`
                                  : 'bg-foreground/5 hover:bg-foreground/10',
                                s.id === 'cancelled' && !isCurrent && 'bg-destructive/10 hover:bg-destructive/15 text-destructive',
                              )}
                            >
                              <s.icon className="h-3 w-3" />
                              {s.label}
                            </button>
                          )
                        })}
                      </div>
                      {/* v16.5: history + revert buttons */}
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => loadHistory(order.id)}
                          className="h-9 px-3 rounded-lg text-xs font-medium bg-foreground/5 hover:bg-foreground/10 flex items-center gap-1 transition-colors"
                        >
                          <History className="h-3.5 w-3.5" /> История
                        </button>
                        <button
                          onClick={() => revertStatus(order.id)}
                          disabled={updatingId === order.id}
                          className="h-9 px-3 rounded-lg text-xs font-medium bg-foreground/5 hover:bg-foreground/10 flex items-center gap-1 transition-colors disabled:opacity-50"
                        >
                          <RotateCcw className="h-3.5 w-3.5" /> Откатить
                        </button>
                      </div>
                      {updatingId === order.id && (
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* v16.8 (Y6): Server-side pagination controls */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-4">
          <button
            onClick={() => { const p = Math.max(0, page - 1); setPage(p); load(p) }}
            disabled={page === 0 || loading}
            className="h-9 px-3 rounded-lg bg-foreground/5 hover:bg-foreground/10 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-medium transition-colors"
          >
            ← Назад
          </button>
          <span className="text-sm text-muted-foreground px-2">
            {page + 1} / {totalPages}
          </span>
          <button
            onClick={() => { const p = Math.min(totalPages - 1, page + 1); setPage(p); load(p) }}
            disabled={page >= totalPages - 1 || loading}
            className="h-9 px-3 rounded-lg bg-foreground/5 hover:bg-foreground/10 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-medium transition-colors"
          >
            Вперёд →
          </button>
        </div>
      )}

      {/* v16.5: Confirm dialog */}
      {confirmDialog && (
        <div
          className="fixed inset-0 z-[70] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setConfirmDialog(null)}
        >
          <div
            className="bg-background w-full max-w-md rounded-3xl p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold mb-2">Изменить статус?</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Заказ #{confirmDialog.orderId.slice(-6).toUpperCase()} → <span className="font-medium text-foreground">{confirmDialog.label}</span>
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmDialog(null)}
                className="flex-1 h-11 rounded-xl bg-foreground/5 hover:bg-foreground/10 text-sm font-medium transition-colors"
              >
                Отмена
              </button>
              <button
                onClick={() => {
                  updateStatus(confirmDialog.orderId, confirmDialog.status)
                  setConfirmDialog(null)
                }}
                className="flex-1 h-11 rounded-xl gradient-brand text-white text-sm font-bold"
              >
                Изменить
              </button>
            </div>
          </div>
        </div>
      )}

      {/* v16.5: History panel */}
      {historyOrderId && (
        <div
          className="fixed inset-0 z-[70] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => { setHistoryOrderId(null); setHistory([]) }}
        >
          <div
            className="bg-background w-full max-w-md rounded-3xl p-6 shadow-2xl max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
              <History className="h-5 w-5" /> История статусов
            </h3>
            {historyLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
            ) : history.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">История пуста</p>
            ) : (
              <div className="space-y-3">
                {history.map((h) => {
                  const fromCfg = STATUSES.find((s) => s.id === h.fromStatus)
                  const toCfg = STATUSES.find((s) => s.id === h.toStatus)
                  return (
                    <div key={h.id} className="flex items-center gap-3 p-3 rounded-xl bg-foreground/5">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium">
                          {fromCfg?.label || h.fromStatus} → {toCfg?.label || h.toStatus}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {h.changedBy?.displayName || h.changedBy?.username || 'Система'} · {timeAgo(h.createdAt)}
                        </div>
                        {h.note && <div className="text-xs text-muted-foreground mt-0.5">{h.note}</div>}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
            <button
              onClick={() => { setHistoryOrderId(null); setHistory([]) }}
              className="w-full mt-4 h-11 rounded-xl bg-foreground/5 hover:bg-foreground/10 text-sm font-medium transition-colors"
            >
              Закрыть
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function FilterChip({
  active, onClick, label, count, color,
}: {
  active: boolean
  onClick: () => void
  label: string
  count?: number
  color?: string
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'shrink-0 h-9 px-3 rounded-full text-xs font-medium flex items-center gap-1.5 transition-all',
        active ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-foreground/5 hover:bg-foreground/10 text-muted-foreground',
      )}
    >
      {color && <span className={cn('h-2 w-2 rounded-full', color)} />}
      {label}
      {count !== undefined && (
        <span className={cn('text-[10px]', active ? 'opacity-80' : 'opacity-60')}>{count}</span>
      )}
    </button>
  )
}
