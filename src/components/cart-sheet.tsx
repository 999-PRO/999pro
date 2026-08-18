'use client'
import { useEffect, useMemo, useState } from 'react'
import Image from 'next/image'
import { ArrowLeft, ShoppingBag, Trash2, Minus, Plus, Check, Loader2, Send } from 'lucide-react'
import { api, assetUrl } from '@/lib/api'
import { useCartStore } from '@/lib/cart-store'
import { formatPrice } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { InteractiveSheet } from '@/components/ui/interactive-sheet'
import { toast } from '@/lib/notifications'
import { haptic } from '@/lib/haptic'
import { useAuthStore } from '@/lib/auth-store'
import type { Product } from '@/lib/types'

// v25.11: Cart is now a "leads cart" — items are submitted as leads (not orders).
// The old CheckoutSheet (with delivery/payment/coupons) is removed.
// Submit button sends all items via POST /api/leads/bulk.

type ContactMethod = 'whatsapp' | 'telegram' | 'phone'

export function CartSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const items = useCartStore((s) => s.items)
  const decrement = useCartStore((s) => s.decrement)
  const increment = useCartStore((s) => s.increment)
  const remove = useCartStore((s) => s.remove)
  const clearCart = useCartStore((s) => s.clear)
  const count = useCartStore((s) => s.count())
  const total = useCartStore((s) => s.total())
  const [products, setProducts] = useState<Record<string, Product>>({})
  const [loading, setLoading] = useState(true)
  // v25.11: lead form state (replaces checkout)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [comment, setComment] = useState('')
  const [contactMethod, setContactMethod] = useState<ContactMethod>('whatsapp')
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)
  const user = useAuthStore((s) => s.user)

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
    api
      .get<{ items: Product[] }>('/api/products/batch', { query: { ids: uniqueIds.join(',') } })
      .then((res) => {
        if (!alive) return
        const map: Record<string, Product> = {}
        for (const p of res.items) map[p.id] = p
        setProducts(map)
      })
      .catch(() => { if (alive) {} })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, idsKey])

  // Pre-fill name + phone from logged-in user
  useEffect(() => {
    if (open && user) {
      setName((prev) => prev || user.displayName || user.username || '')
      setPhone((prev) => prev || user.phone || '')
    }
  }, [open, user])

  // Reset success state when cart changes or sheet closes
  useEffect(() => {
    if (!open) {
      setSuccess(false)
      setComment('')
    }
  }, [open])

  const handleSubmitLeads = async () => {
    if (!name.trim()) {
      toast.error('Введите имя')
      return
    }
    if (!phone.trim()) {
      toast.error('Введите телефон')
      return
    }
    if (items.length === 0) return
    setSubmitting(true)
    haptic.tap()
    try {
      await api.post('/api/leads/bulk', {
        json: {
          name: name.trim(),
          phone: phone.trim(),
          comment: comment.trim() || undefined,
          contactMethod,
          items: items.map((it) => ({ productId: it.productId, quantity: it.quantity })),
        },
        // v25.12: no auth: true — /api/leads/bulk uses optionalAuth on backend.
        // Guests can submit leads without an account.
      })
      haptic.success()
      setSuccess(true)
      clearCart()
      toast.success(`Отправлено ${items.length} ${items.length === 1 ? 'заявка' : 'заявок'}!`)
      setTimeout(() => {
        onClose()
        setSuccess(false)
      }, 1500)
    } catch (err: any) {
      haptic.error()
      toast.error(err?.message || 'Не удалось отправить заявки')
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) return null

  return (
    <InteractiveSheet
      open={open}
      onClose={onClose}
      side="bottom"
      ariaLabel="Корзина"
      desktopWidth={520}
      panelClassName="bg-background border-border/40 max-h-[100vh] md:max-h-full"
      backdropOpacity={0.5}
      showDragHandle={false}
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
          <h2 className="text-[15px] font-semibold tracking-tight flex-1">Мои заявки</h2>
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
          <h3 className="text-lg font-bold mb-1">Список заявок пуст</h3>
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
      ) : success ? (
        <div className="flex flex-col items-center justify-center py-20 text-center px-4">
          <div className="h-20 w-20 rounded-full bg-emerald-500/15 grid place-items-center mb-4">
            <Check className="h-10 w-10 text-emerald-500" />
          </div>
          <h3 className="text-lg font-bold mb-1">Заявки отправлены!</h3>
          <p className="text-sm text-muted-foreground">Мы свяжемся с вами в ближайшее время.</p>
        </div>
      ) : (
        <div className="space-y-2.5 p-4">
          {items.map((item) => {
            const p = products[item.productId]
            if (!p) return null
            return (
              <div key={item.productId} className="flex items-center gap-3 p-3 rounded-2xl glass">
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
                    aria-label={`Удалить «${p.title}» из списка`}
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
      {!loading && count > 0 && !success && (
        <div
          className="sticky bottom-0 left-0 right-0 p-4 border-t border-border/40 glass-strong space-y-3"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)' }}
        >
          {/* Lead form — name, phone, contact method, comment */}
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Имя"
                className="h-10 px-3 rounded-lg bg-muted/40 border border-border/40 outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20 transition-all text-sm"
                maxLength={80}
              />
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Телефон"
                className="h-10 px-3 rounded-lg bg-muted/40 border border-border/40 outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20 transition-all text-sm"
                maxLength={32}
              />
            </div>
            <div className="grid grid-cols-3 gap-2">
              {(['whatsapp', 'telegram', 'phone'] as ContactMethod[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setContactMethod(m)}
                  className={`h-9 rounded-lg text-xs font-semibold border transition-all ${
                    contactMethod === m
                      ? 'bg-primary text-primary-foreground border-primary shadow-md'
                      : 'bg-muted/40 border-border/40 hover:bg-muted/60'
                  }`}
                >
                  {m === 'whatsapp' ? 'WhatsApp' : m === 'telegram' ? 'Telegram' : 'Звонок'}
                </button>
              ))}
            </div>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Комментарий (необязательно)"
              rows={2}
              maxLength={500}
              className="w-full px-3 py-2 rounded-lg bg-muted/40 border border-border/40 outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20 transition-all text-sm resize-none"
            />
          </div>

          {/* Total */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Сумма (справочно):</span>
            <span className="text-lg font-bold">{formatPrice(total)}</span>
          </div>

          <button
            onClick={handleSubmitLeads}
            disabled={submitting}
            className="w-full rounded-full gradient-brand text-white font-bold h-12 shadow-glow hover:scale-[1.02] active:scale-95 transition-transform disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Отправляем…
              </>
            ) : (
              <>
                <Send className="h-4 w-4" /> Отправить {count} {count === 1 ? 'заявку' : 'заявок'}
              </>
            )}
          </button>
          <p className="text-[11px] text-muted-foreground text-center">
            Нажимая «Отправить», вы соглашаетесь на обработку персональных данных.
          </p>
        </div>
      )}
    </InteractiveSheet>
  )
}
