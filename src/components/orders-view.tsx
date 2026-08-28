'use client'

import { useEffect, useState, useCallback } from 'react'
import { api, assetUrl } from '@/lib/api'
import type { Order, OrderStatus } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Avatar } from '@/components/ui/avatar'
import { AvatarFallback, AvatarImage } from '@radix-ui/react-avatar'
import { formatPrice, timeAgo } from '@/lib/format'
import { toast } from '@/lib/notifications'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuthStore } from '@/lib/auth-store'
import { useOrdersBadgeStore } from '@/lib/orders-badge-store'
// v16.8 final: unified auth-required screen for non-authenticated users.
import { AuthRequiredView } from '@/components/auth-required-view'
import {
  Package, Clock, CheckCircle2, Truck, XCircle, CreditCard,
  ChevronRight, ArrowLeft, ShoppingBag, RefreshCw,
  Phone, MapPin, MessageCircle, FileText,
  User, Store, MessageSquare, Ticket, Navigation, Wallet,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// ============================================================================
// OrdersView — full "My Orders" page.
//
// v16.6: Leads tab removed — all requests now go through Orders only.
//
// Features:
// - Orders list with real-time status updates via Socket.IO
//   (`order:status-changed` event) + 60s polling fallback.
// - Expanded order card shows items — tap a product to open its ProductPage
//   (photos, specs, description, reviews).
// - Empty state with CTA to browse catalog.
// ============================================================================

const STATUS_CONFIG: Record<OrderStatus, {
  label: string
  icon: typeof Clock
  color: string
  bg: string
}> = {
  new: {
    label: 'Новые',
    icon: Clock,
    color: 'text-amber-600 dark:text-amber-400',
    bg: 'bg-amber-500/15',
  },
  in_work: {
    label: 'В работе',
    icon: CreditCard,
    color: 'text-blue-600 dark:text-blue-400',
    bg: 'bg-blue-500/15',
  },
  production: {
    label: 'Производство',
    icon: CreditCard,
    color: 'text-purple-600 dark:text-purple-400',
    bg: 'bg-purple-500/15',
  },
  ready: {
    label: 'Готов',
    icon: CheckCircle2,
    color: 'text-cyan-600 dark:text-cyan-400',
    bg: 'bg-cyan-500/15',
  },
  in_delivery: {
    label: 'Передан в доставку',
    icon: Truck,
    color: 'text-indigo-600 dark:text-indigo-400',
    bg: 'bg-indigo-500/15',
  },
  done: {
    label: 'Завершён',
    icon: CheckCircle2,
    color: 'text-emerald-600 dark:text-emerald-400',
    bg: 'bg-emerald-500/15',
  },
  cancelled: {
    label: 'Отменён',
    icon: XCircle,
    color: 'text-rose-600 dark:text-rose-400',
    bg: 'bg-rose-500/15',
  },
}

export function OrdersView({
  onNavigate,
  onOpenProduct,
}: {
  onNavigate: (v: string) => void
  onOpenProduct?: (id: string) => void
}) {
  const user = useAuthStore((s) => s.user)
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)

  // ========================================================================
  //  Orders state
  // ========================================================================
  const [orders, setOrders] = useState<Order[]>([])
  const [ordersLoading, setOrdersLoading] = useState(true)
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null)
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  // Phase 10: custom confirm dialog state
  const [cancelOrderId, setCancelOrderId] = useState<string | null>(null)

  const refreshOrders = useCallback(() => {
    if (!isAuthenticated) {
      setOrdersLoading(false)
      return
    }
    api
      .get<{ items: Order[] }>('/api/orders', { auth: true })
      .then((d) => setOrders(d.items))
      .catch(() => setOrders([]))
      .finally(() => setOrdersLoading(false))
  }, [isAuthenticated])

  useEffect(() => {
    refreshOrders()
  }, [refreshOrders])

  // v16.2: Real-time order status updates now arrive via the
  // `order:status-changed` socket event (see useEffect below). This 60s
  // poll is the FALLBACK for missed socket events (e.g. if the socket was
  // disconnected when the admin changed the status — socket.io does NOT
  // redeliver missed events). v13.1 reduced it from 15s → 60s to cut
  // server load; with the socket event now wired up, 60s is plenty.
  useEffect(() => {
    if (!isAuthenticated) return
    let intervalId: ReturnType<typeof setInterval> | null = null
    const start = () => {
      if (intervalId) return
      intervalId = setInterval(() => {
        // Only refresh if the tab is visible AND the user isn't actively
        // scrolling/interacting (requestIdleCallback with timeout fallback).
        if (document.visibilityState !== 'visible') return
        if ('requestIdleCallback' in window) {
          ;(window as any).requestIdleCallback(() => refreshOrders(), { timeout: 5000 })
        } else {
          refreshOrders()
        }
      }, 60000)
    }
    const stop = () => {
      if (intervalId) {
        clearInterval(intervalId)
        intervalId = null
      }
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        refreshOrders()
        start()
      } else {
        stop()
      }
    }
    if (document.visibilityState === 'visible') start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      stop()
    }
  }, [isAuthenticated, refreshOrders])

  const handleCancelOrder = async (orderId: string) => {
    // Phase 10: use custom confirm dialog
    setCancelOrderId(orderId)
  }

  const confirmCancelOrder = async () => {
    const orderId = cancelOrderId
    if (!orderId) return
    setCancelOrderId(null)
    setCancellingId(orderId)
    try {
      const updated = await api.delete<Order>(`/api/orders/${orderId}`, { auth: true })
      setOrders((cur) => cur.map((o) => (o.id === orderId ? updated : o)))
      toast.success('Заказ отменён')
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Не удалось отменить заказ'
      toast.error(msg)
    } finally {
      setCancellingId(null)
    }
  }

  // v16.2: Order status changes (admin → user real-time notifications).
  // When the admin changes an order's status in Studio (e.g. marks it paid),
  // the backend emits an `order:status-changed` socket event. use-socket.ts
  // forwards it as a window CustomEvent. We update the matching order in
  // local state + show a toast so the user sees the change immediately
  // (previously the client only learned about status changes via 60s polling).
  useEffect(() => {
    if (!isAuthenticated) return
    const onOrderStatus = (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        orderId: string
        status: OrderStatus
        updatedAt?: string
      }
      if (!detail?.orderId) return
      setOrders((cur) =>
        cur.map((o) =>
          o.id === detail.orderId
            ? { ...o, status: detail.status }
            : o,
        ),
      )
      const cfg = STATUS_CONFIG[detail.status]
      if (cfg) {
        toast.success(`Заказ #${detail.orderId.slice(-6)}: ${cfg.label}`, {
          description: 'Статус обновлён администратором',
        })
      }
    }
    window.addEventListener('order:status-changed', onOrderStatus as EventListener)
    return () => window.removeEventListener('order:status-changed', onOrderStatus as EventListener)
  }, [isAuthenticated])

  // v16.3: Clear the orders notification badge when the user opens this view.
  // Also increment the badge from ANYWHERE in the app when an order status
  // changes (not just while this view is open) — handled in AppShell so the
  // badge updates even if the user is on the Home page.
  const clearOrdersBadge = useOrdersBadgeStore((s) => s.clear)
  useEffect(() => {
    if (isAuthenticated) clearOrdersBadge()
  }, [isAuthenticated, clearOrdersBadge])

  if (!isAuthenticated) {
    // v16.8 final: unified auth screen (replaces the old "На главную" stub).
    // The user needs to understand that the issue is auth, not the network.
    return <AuthRequiredView />
  }

  return (
    <div className="page-top-padding pb-28 md:pb-6">
      <div className="px-4 md:px-6 max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <div className="h-11 w-11 rounded-2xl gradient-brand grid place-items-center shadow-glow shrink-0">
            <Package className="h-5 w-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">Мои заказы</h1>
            <p className="text-sm text-muted-foreground">
              История ваших заказов
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => refreshOrders()}
            className="rounded-full shrink-0"
            aria-label="Обновить"
          >
            <RefreshCw className={cn('h-4 w-4', ordersLoading && 'animate-spin')} />
          </Button>
        </div>

        {/* v25.19: сводка-статистика — мягкие стеклянные чипы */}
        {!ordersLoading && orders.length > 0 && (() => {
          const totalSum = orders.reduce((s, o) => s + (o.total || 0), 0)
          const inWork = orders.filter((o) => ['new', 'in_work', 'production'].includes(o.status)).length
          return (
            <div className="grid grid-cols-3 gap-2 mb-4">
              {[
                { label: 'Всего', value: String(orders.length), icon: Package, grad: 'from-[#EC4899] to-[#A855F7]' },
                { label: 'В работе', value: String(inWork), icon: Clock, grad: 'from-[#F59E0B] to-[#EA580C]' },
                { label: 'Сумма', value: formatPrice(totalSum), icon: Wallet, grad: 'from-[#10B981] to-[#059669]' },
              ].map((s) => (
                <div
                  key={s.label}
                  className="relative overflow-hidden rounded-2xl bg-card ring-1 ring-black/[0.04] dark:ring-white/[0.06] p-3"
                  style={{ boxShadow: '0 10px 26px -18px rgba(15,23,42,0.35)' }}
                >
                  <span aria-hidden className={cn('absolute -top-4 -right-4 h-14 w-14 rounded-full opacity-15 bg-gradient-to-br blur-xl', s.grad)} />
                  <s.icon className="h-4 w-4 text-muted-foreground mb-1.5" />
                  <div className="text-sm font-extrabold tracking-tight truncate">{s.value}</div>
                  <div className="text-[10px] text-muted-foreground font-medium">{s.label}</div>
                </div>
              ))
              }
            </div>
          )
        })()}

        {/* Content */}
        <OrdersList
          orders={orders}
          loading={ordersLoading}
          expandedId={expandedOrderId}
          setExpandedId={setExpandedOrderId}
          onCancel={handleCancelOrder}
          cancellingId={cancellingId}
          onNavigate={onNavigate}
          onOpenProduct={onOpenProduct}
        />
      </div>

      {/* Phase 10: custom confirm dialog for cancel order */}
      <ConfirmDialog
        open={cancelOrderId !== null}
        title="Отменить заказ?"
        message="Это действие нельзя отменить."
        confirmLabel="Отменить заказ"
        cancelLabel="Не отменять"
        variant="danger"
        onConfirm={confirmCancelOrder}
        onCancel={() => setCancelOrderId(null)}
      />
    </div>
  )
}

// ============================================================================
//  OrdersList — renders the user's orders.
// ============================================================================
function OrdersList({
  orders,
  loading,
  expandedId,
  setExpandedId,
  onCancel,
  cancellingId,
  onNavigate,
  onOpenProduct,
}: {
  orders: Order[]
  loading: boolean
  expandedId: string | null
  setExpandedId: (id: string | null) => void
  onCancel: (id: string) => void
  cancellingId: string | null
  onNavigate: (v: string) => void
  onOpenProduct?: (id: string) => void
}) {
  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-3xl glass p-4">
            <div className="flex gap-3">
              <div className="h-16 w-16 rounded-2xl skeleton" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-1/3 rounded skeleton" />
                <div className="h-3 w-1/2 rounded skeleton" />
                <div className="h-3 w-1/4 rounded skeleton" />
              </div>
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (orders.length === 0) {
    return (
      <div className="py-16 text-center">
        <div className="h-20 w-20 rounded-full gradient-soft mx-auto mb-4 grid place-items-center">
          <ShoppingBag className="h-10 w-10 text-muted-foreground" />
        </div>
        <h3 className="font-semibold mb-1">Заказов пока нет</h3>
        <p className="text-sm text-muted-foreground mb-5">
          Откройте каталог и сделайте первый заказ
        </p>
        <Button
          onClick={() => onNavigate('catalog')}
          className="rounded-full gradient-brand text-white font-semibold shadow-glow h-11 px-6"
        >
          В каталог
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <AnimatePresence mode="popLayout">
        {orders.map((order) => {
          const cfg = STATUS_CONFIG[order.status]
          const StatusIcon = cfg.icon
          const expanded = expandedId === order.id
          const canCancel = order.status === 'new' || order.status === 'in_work' || order.status === 'production' || order.status === 'ready'
          return (
            <motion.div
              key={order.id}
              layout
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 380, damping: 30 }}
              // v25.19: карточка-карточка: bg-card + кольцо + мягкая тень +
              // ЦВЕТНАЯ полоска статуса слева (мгновенно считывается состояние)
              className="relative rounded-3xl overflow-hidden bg-card ring-1 ring-black/[0.04] dark:ring-white/[0.06]"
              style={{ boxShadow: '0 14px 38px -26px rgba(15,23,42,0.4)' }}
            >
              {/* Акцентная полоска статуса слева */}
              <span aria-hidden className={cn('absolute left-0 top-0 bottom-0 w-1', cfg.bg.replace('/15', '/70'))} />
              <button
                onClick={() => setExpandedId(expanded ? null : order.id)}
                className="w-full p-4 pl-5 flex items-center gap-3 hover:bg-accent/30 transition-colors text-left"
              >
                <div className="relative h-14 w-14 shrink-0">
                  {order.items.slice(0, 2).map((item, i) => {
                    const img = item.product?.images?.[0]
                    return (
                      <Avatar key={item.id} className={`absolute rounded-xl border-2 border-background overflow-hidden ${i === 0 ? 'h-14 w-14' : 'h-10 w-10 bottom-0 right-0'}`}>
                        {img ? (
                          <AvatarImage src={assetUrl(img)} alt={item.product?.title || ''} />
                        ) : null}
                        <AvatarFallback className="rounded-xl gradient-soft">
                          <Package className="h-5 w-5 text-muted-foreground" />
                        </AvatarFallback>
                      </Avatar>
                    )
                  })}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[11px] font-mono text-muted-foreground">
                      #{order.id.slice(-8).toUpperCase()}
                    </span>
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${cfg.bg} ${cfg.color}`}>
                      <StatusIcon className="h-3 w-3" />
                      {cfg.label}
                    </span>
                  </div>
                  <div className="text-sm font-semibold truncate">
                    {order.items.length === 1
                      ? order.items[0].product?.title || 'Товар'
                      : `${order.items.length} товара`}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {timeAgo(new Date(order.createdAt))}
                  </div>
                </div>
                {/* v25.19: сумма — крупно справа, градиентный акцент */}
                <div className="shrink-0 text-right">
                  <div
                    className="text-[15px] font-extrabold tracking-tight bg-clip-text text-transparent"
                    style={{ backgroundImage: 'linear-gradient(135deg,#A02070,#EC4899)' }}
                  >
                    {formatPrice(order.total)}
                  </div>
                  <ChevronRight className={cn('h-5 w-5 text-muted-foreground ml-auto transition-transform', expanded ? 'rotate-90' : '')} />
                </div>
              </button>

              <AnimatePresence initial={false}>
                {expanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="px-4 pb-4 pt-1 border-t border-border/30">
                      <div className="space-y-2 mt-3">
                        {order.items.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            disabled={!item.product}
                            onClick={() => {
                              if (!item.product) return
                              // v21: dispatch with product data so ProductPage
                              // can render soft-deleted products from orders.
                              window.dispatchEvent(new CustomEvent('999pro:open-product', {
                                detail: { productId: item.productId, initialProduct: item.product },
                              }))
                            }}
                            className="flex w-full items-center gap-3 p-2 rounded-2xl bg-accent/20 hover:bg-accent/40 transition-colors text-left disabled:cursor-default disabled:hover:bg-accent/20"
                          >
                            <Avatar className="h-12 w-12 rounded-xl shrink-0">
                              {item.product?.images?.[0] ? (
                                <AvatarImage src={assetUrl(item.product.images[0])} alt={item.product.title} />
                              ) : null}
                              <AvatarFallback className="rounded-xl gradient-soft">
                                <Package className="h-5 w-5 text-muted-foreground" />
                              </AvatarFallback>
                            </Avatar>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium truncate">
                                {item.product?.title || 'Товар удалён'}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {item.quantity} × {formatPrice(item.price)}
                              </div>
                            </div>
                            <div className="text-sm font-semibold shrink-0">
                              {formatPrice(item.price * item.quantity)}
                            </div>
                          </button>
                        ))}
                      </div>

                      {/* v12.7: Order details — delivery info + coupon */}
                      {(order.name || order.phone || order.address || order.deliveryMethod || order.couponCode) && (
                        <div className="mt-3 pt-3 border-t border-border/30 space-y-1.5 text-xs">
                          {order.name && (
                            <div className="flex items-center gap-2 text-muted-foreground">
                              <User className="h-3 w-3" /> <span className="text-foreground font-medium">{order.name}</span>
                            </div>
                          )}
                          {order.phone && (
                            <div className="flex items-center gap-2 text-muted-foreground">
                              <Phone className="h-3 w-3" /> <span className="text-foreground">{order.phone}</span>
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
                                  <a
                                    href={order.mapUrl || `https://www.google.com/maps/search/?api=1&query=${order.lat},${order.lng}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => {
                                      e.preventDefault()
                                      const url = order.mapUrl || `https://www.google.com/maps/search/?api=1&query=${order.lat},${order.lng}`
                                      window.open(url, '_blank', 'noopener,noreferrer')
                                    }}
                                    className="inline-flex items-center gap-1 mt-1.5 px-2.5 py-1 rounded-lg bg-primary/10 hover:bg-primary/15 text-primary font-medium text-[11px] transition-colors"
                                  >
                                    <Navigation className="h-3 w-3" /> Открыть на карте
                                  </a>
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
                              <Ticket className="h-3 w-3" /> <span className="font-medium">Купон {order.couponCode}</span>
                              {order.discount != null && order.discount > 0 && (
                                <span className="text-xs">−{formatPrice(order.discount)}</span>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      <div className="mt-3 pt-3 border-t border-border/30 flex items-center justify-between gap-3">
                        <div>
                          <div className="text-xs text-muted-foreground">Итого</div>
                          {order.discount != null && order.discount > 0 && (
                            <div className="text-[10px] text-muted-foreground line-through">{formatPrice(order.total + order.discount)}</div>
                          )}
                          <div className="text-lg font-bold">{formatPrice(order.total)}</div>
                        </div>
                        {canCancel && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => onCancel(order.id)}
                            disabled={cancellingId === order.id}
                            className="rounded-full text-destructive hover:text-destructive hover:bg-destructive/5 h-9"
                          >
                            {cancellingId === order.id ? 'Отмена…' : 'Отменить заказ'}
                          </Button>
                        )}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}

