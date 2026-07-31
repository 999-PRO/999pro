'use client'
import { useEffect, useMemo, useState } from 'react'
import Image from 'next/image'
import { ArrowLeft, ShoppingBag, Trash2, Minus, Plus, Ticket, Check, Loader2 } from 'lucide-react'
import { api, assetUrl } from '@/lib/api'
import { useCartStore } from '@/lib/cart-store'
import { formatPrice } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { InteractiveSheet } from '@/components/ui/interactive-sheet'
import { clubApi } from '@/modules/999-club'
import { toast } from '@/lib/notifications'
import { haptic } from '@/lib/haptic'
import type { Product } from '@/lib/types'

export function CartSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  // F-CRIT-001: select only the slices the UI reads — CartSheet is mounted
  // globally via AppShell, so a full-store subscription would re-render it
  // on every cart keystroke.
  const items = useCartStore((s) => s.items)
  const decrement = useCartStore((s) => s.decrement)
  const increment = useCartStore((s) => s.increment)
  const remove = useCartStore((s) => s.remove)
  const count = useCartStore((s) => s.count())
  const total = useCartStore((s) => s.total())
  const [products, setProducts] = useState<Record<string, Product>>({})
  const [loading, setLoading] = useState(true)
  // v12.6: coupon state
  const [couponCode, setCouponCode] = useState('')
  const [appliedCoupon, setAppliedCoupon] = useState<{ title: string; discount: number; newTotal: number } | null>(null)
  const [validating, setValidating] = useState(false)
  // v16.1: checkout is now opened via `open-checkout` window event,
  // handled by AppShell. This avoids nesting CheckoutSheet inside
  // InteractiveSheet (which uses transforms that break position:fixed).
  // Dep on the actual list of product IDs (not just count) so the sheet
  // refetches when items are added/removed/replaced — even if count is equal.
  // v13.2 (audit P1-23 fix): useMemo so the string is only recomputed when
  // items actually change, not on every render.
  const idsKey = useMemo(() => items.map((i) => i.productId).join(','), [items])

  useEffect(() => {
    if (!open) return
    let alive = true
    setLoading(true)
    const uniqueIds = [...new Set(items.map((i) => i.productId))]
    if (uniqueIds.length === 0) {
      setProducts({})
      setLoading(false)
      return
    }
    // Single batch request instead of N parallel requests. This is the
    // /api/products/batch endpoint we added to fix the N+1 problem.
    api
      .get<{ items: Product[] }>('/api/products/batch', { query: { ids: uniqueIds.join(',') } })
      .then((res) => {
        if (!alive) return
        const map: Record<string, Product> = {}
        for (const p of res.items) map[p.id] = p
        setProducts(map)
      })
      .catch(() => {
        if (!alive) return
      })
      .finally(() => {
        if (!alive) return
        setLoading(false)
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, idsKey])

  if (!open) return null

  return (
    <InteractiveSheet
      open={open}
      onClose={onClose}
      side="bottom"
      ariaLabel="Корзина"
      // Cart is a near-fullscreen sheet — wide on desktop too.
      desktopWidth={520}
      panelClassName="bg-background border-border/40 max-h-[100vh] md:max-h-full"
      backdropOpacity={0.5}
      // v16.8 final: disable drag-to-dismiss entirely for the cart.
      // The cart has scrollable content + a sticky bottom action bar — dragging
      // the sheet down while trying to scroll felt like the page was slipping.
      // Dismissal is via the back arrow (top-left) or backdrop tap.
      showDragHandle={false}
      // The custom header is now a thin integrated bar (no separate glass
      // background — it inherits the panel's bg so there's no "double layer").
      renderDragHandle={() => (
        <div
          className="flex items-center gap-2 px-3.5 pt-[calc(env(safe-area-inset-top,0px)+8px)] pb-2 border-b border-border/30 shrink-0"
        >
          <button
            onClick={onClose}
            aria-label="Закрыть корзину"
            className="h-8 w-8 -ml-1 rounded-full hover:bg-foreground/5 active:bg-foreground/10 transition-colors shrink-0 grid place-items-center"
          >
            <ArrowLeft className="h-[18px] w-[18px]" strokeWidth={2.2} />
          </button>
          <h2 className="text-[15px] font-semibold tracking-tight flex-1">Корзина</h2>
          <span className="text-xs text-muted-foreground tabular-nums">{count} тов.</span>
        </div>
      )}
    >
      {loading ? (
        <div className="space-y-3 p-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-20 rounded-2xl skeleton" />
          ))}
        </div>
      ) : count === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center px-4">
          <div className="h-20 w-20 rounded-full glass grid place-items-center mb-4">
            <ShoppingBag className="h-10 w-10 text-muted-foreground" />
          </div>
            <h3 className="text-lg font-bold mb-1">Корзина пока пуста</h3>
            <p className="text-sm text-muted-foreground mb-5">Добавьте товары из каталога</p>
            <Button
              onClick={() => {
                const url = new URL(window.location.href)
                url.searchParams.set('view', 'catalog')
                window.history.pushState({}, '', url.toString())
                window.dispatchEvent(new PopStateEvent('popstate'))
                onClose()
              }}
              className="rounded-full gradient-brand text-white font-semibold shadow-glow h-11 px-6"
            >
              Открыть каталог
            </Button>
          </div>
        ) : (
          <div className="space-y-2.5 p-4">
            {items.map((item) => {
              const p = products[item.productId]
              if (!p) return null
              return (
                <div key={item.productId} className="flex items-center gap-3 p-3 rounded-2xl glass">
                  {/* v21: image + title are clickable — opens the product page
                      as an overlay so the user returns to the cart on close. */}
                  <button
                    type="button"
                    onClick={() => window.dispatchEvent(new CustomEvent('999pro:open-product', { detail: { productId: item.productId } }))}
                    className="relative h-16 w-16 rounded-xl overflow-hidden bg-muted/40 shrink-0 cursor-pointer hover:opacity-80 transition-opacity"
                    aria-label={`Открыть товар «${p.title}»`}
                  >
                    {p.images?.[0] && (
                      <Image
                        src={assetUrl(p.images[0])}
                        alt={p.title}
                        fill
                        sizes="64px"
                        className="object-cover"
                      />
                    )}
                  </button>
                  <div className="flex-1 min-w-0">
                    <button
                      type="button"
                      onClick={() => window.dispatchEvent(new CustomEvent('999pro:open-product', { detail: { productId: item.productId } }))}
                      className="text-sm font-semibold truncate text-left hover:text-primary transition-colors w-full"
                    >
                      {p.title}
                    </button>
                    <div className="text-xs text-muted-foreground">{formatPrice(p.price)}</div>
                    <div className="flex items-center gap-2 mt-1.5">
                      <button
                        onClick={() => decrement(item.productId)}
                        aria-label={`Уменьшить количество «${p.title}»`}
                        className="h-9 w-9 -m-1 rounded-full glass-strong grid place-items-center hover:scale-105 active:scale-95 transition-transform"
                      >
                        <Minus className="h-3.5 w-3.5" />
                      </button>
                      <span className="text-sm font-bold w-6 text-center" aria-live="polite">{item.quantity}</span>
                      <button
                        onClick={() => increment(item.productId)}
                        aria-label={`Увеличить количество «${p.title}»`}
                        className="h-9 w-9 -m-1 rounded-full glass-strong grid place-items-center hover:scale-105 active:scale-95 transition-transform"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-bold">{formatPrice(p.price * item.quantity)}</div>
                    <button
                      onClick={() => remove(item.productId)}
                      aria-label={`Удалить «${p.title}» из корзины`}
                      className="mt-1 h-9 w-9 -m-1 rounded-full text-destructive hover:bg-destructive/10 transition-colors grid place-items-center"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      {!loading && count > 0 && (
        <div
          className="sticky bottom-0 left-0 right-0 p-4 border-t border-border/40 glass-strong"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)' }}
        >
          {/* v16.2: Coupon input moved to CheckoutSheet so it shows in BOTH
              cart and buy-now flows. The cart's total below reflects the
              pre-coupon subtotal; the discount is applied at checkout. */}

          {/* Total */}
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-muted-foreground">Итого:</span>
            <div className="text-right">
              {appliedCoupon && (
                <div className="text-xs text-muted-foreground line-through">{formatPrice(total)}</div>
              )}
              <span className="text-xl font-bold">{formatPrice(appliedCoupon ? appliedCoupon.newTotal : total)}</span>
            </div>
          </div>
          <button
            onClick={() => {
              haptic.tap()
              // v16.1: dispatch event — AppShell opens CheckoutSheet as a
              // sibling (not a child of this transformed InteractiveSheet).
              window.dispatchEvent(new CustomEvent('open-checkout', {
                detail: {
                  products,
                  coupon: appliedCoupon ? { ...appliedCoupon, code: couponCode } : null,
                },
              }))
            }}
            className="w-full rounded-full gradient-brand text-white font-bold h-12 shadow-glow hover:scale-[1.02] active:scale-95 transition-transform"
          >
            Оформить заказ
          </button>
        </div>
      )}
    </InteractiveSheet>
  )
}
