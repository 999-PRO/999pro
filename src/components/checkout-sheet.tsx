'use client'

/**
 * CheckoutSheet v16 — full checkout form for cart orders.
 *
 * Flow (single scrollable sheet, glassmorphism style):
 *   1. Order summary (items + discount + delivery fee + total)
 *   2. Contact data (name + phone, pre-filled from auth)
 *   3. Fulfillment (pickup | delivery)
 *      - pickup: store address + working hours + "open in maps" button
 *      - delivery: zone chips (city/republic/Russia) + address (map | manual)
 *   4. Contact method (whatsapp/telegram/phone/email)
 *   5. Comment (optional)
 *
 * Submits to POST /api/orders with new delivery fields
 * (lat, lng, mapUrl, deliveryZoneId).
 */

import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X, ShoppingBag, User, Phone, MapPin, MessageSquare,
  Truck, Store, Check, Loader2, Star, Navigation, Clock, Search, Ticket,
  MailCheck, ArrowRight, RefreshCw,
} from 'lucide-react'
import { api, assetUrl } from '@/lib/api'
import { useCartStore } from '@/lib/cart-store'
import { useAuthStore } from '@/lib/auth-store'
import { useDeliveryStore, type DeliveryZone } from '@/lib/delivery-store'
import { useScrollLock } from '@/lib/use-scroll-lock'
import { formatPrice } from '@/lib/format'
import { haptic } from '@/lib/haptic'
import { buildMapUrl } from '@/lib/map-utils'
import { toast } from '@/lib/notifications'
import { clubApi } from '@/modules/999-club'
import { cn } from '@/lib/utils'
import type { Product } from '@/lib/types'
import { MapPicker, type MapPickerResult } from './map-picker'

interface CheckoutSheetProps {
  open: boolean
  onClose: () => void
  products: Record<string, Product>
  onOrderCreated?: () => void
  onNavigate?: (view: string) => void
  // v16.1: when set, the sheet checks out THESE items instead of the cart.
  // Used by the "Купить" button on product pages — bypasses the cart entirely
  // so the user's existing cart is not polluted or cleared.
  itemsOverride?: { productId: string; quantity: number }[]
  skipCartClear?: boolean
}

type AddressMode = 'map' | 'manual'

export function CheckoutSheet({
  open,
  onClose,
  products,
  onOrderCreated = () => {},
  onNavigate = () => {},
  itemsOverride,
  skipCartClear = false,
}: CheckoutSheetProps) {
  const cartItems = useCartStore((s) => s.items)
  const cartTotal = useCartStore((s) => s.total())
  const clearCart = useCartStore((s) => s.clear)
  const user = useAuthStore((s) => s.user)

  // Delivery store
  const deliverySettings = useDeliveryStore((s) => s.settings)
  const deliveryZones = useDeliveryStore((s) => s.zones)
  const fetchDelivery = useDeliveryStore((s) => s.fetch)

  // Form state
  const [name, setName] = useState(user?.displayName || user?.username || '')
  const [phone, setPhone] = useState(user?.phone || '')
  const [deliveryMethod, setDeliveryMethod] = useState<'pickup' | 'delivery'>('delivery')
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null)
  const [addressMode, setAddressMode] = useState<AddressMode>('map')
  const [address, setAddress] = useState('')
  const [mapPoint, setMapPoint] = useState<MapPickerResult | null>(null)
  const [mapPickerOpen, setMapPickerOpen] = useState(false)
  const [contactMethod, setContactMethod] = useState<'whatsapp' | 'telegram' | 'phone' | 'email'>('phone')
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)
  const successTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // v16.2: Coupon is owned by CheckoutSheet (NOT the parent) so it works
  // in BOTH flows — cart checkout AND buy-now. Previously the coupon input
  // lived in CartSheet, which buy-now bypassed entirely.
  const [couponCode, setCouponCode] = useState('')
  const [appliedCoupon, setAppliedCoupon] = useState<{ title: string; discount: number; newTotal: number; code: string } | null>(null)
  const [validating, setValidating] = useState(false)

  // v19.0: Promo code + bonus points
  const [promoCode, setPromoCode] = useState('')
  const [appliedPromo, setAppliedPromo] = useState<{ code: string; discount: number; discountType: string; discountValue: number } | null>(null)
  const [validatingPromo, setValidatingPromo] = useState(false)
  const [bonusSettings, setBonusSettings] = useState<{ enabled: boolean; pointValue: number; minOrderTotalToSpend: number; maxPercentOfOrder: number; earnRate: number; earnPerCurrencyUnit: number } | null>(null)
  const [userPoints, setUserPoints] = useState(0)
  const [pointsToSpend, setPointsToSpend] = useState(0)
  const [pointsDiscount, setPointsDiscount] = useState(0)

  // Reset coupon state when sheet closes so a reopened sheet starts fresh
  useEffect(() => {
    if (!open) {
      setCouponCode('')
      setAppliedCoupon(null)
      setValidating(false)
      // v19.0: reset promo + points
      setPromoCode('')
      setAppliedPromo(null)
      setValidatingPromo(false)
      setPointsToSpend(0)
      setPointsDiscount(0)
    }
  }, [open])

  // v19.0: fetch bonus settings + user balance when sheet opens
  useEffect(() => {
    if (!open || !user) return
    Promise.all([
      api.get<{ settings: { enabled: boolean; pointValue: number; minOrderTotalToSpend: number; maxPercentOfOrder: number; earnRate: number; earnPerCurrencyUnit: number } }>('/api/promo-codes/bonus-settings').catch(() => null),
      api.get<{ balance: number }>('/api/promo-codes/bonus-balance', { auth: true }).catch(() => null),
    ]).then(([s, b]) => {
      if (s?.settings) setBonusSettings(s.settings)
      if (b?.balance != null) setUserPoints(b.balance)
    })
  }, [open, user])

  // v16.2: lock background scroll when the checkout sheet is open. The
  // scrollable body has `data-scroll-lock-ignore` so wheel/touch events
  // inside it work normally, while the background page stays put.
  useScrollLock(open)

  // Fetch delivery settings + zones when sheet opens
  useEffect(() => {
    if (open) fetchDelivery()
  }, [open, fetchDelivery])

  // Default deliveryMethod based on what's enabled
  useEffect(() => {
    if (!open) return
    if (deliverySettings) {
      if (!deliverySettings.deliveryEnabled && deliverySettings.pickupEnabled) {
        setDeliveryMethod('pickup')
      } else if (deliverySettings.deliveryEnabled && !deliverySettings.pickupEnabled) {
        setDeliveryMethod('delivery')
      }
    }
  }, [open, deliverySettings])

  // Auto-select first active zone when switching to delivery
  useEffect(() => {
    if (deliveryMethod === 'delivery' && !selectedZoneId && deliveryZones.length > 0) {
      setSelectedZoneId(deliveryZones[0].id)
    }
  }, [deliveryMethod, selectedZoneId, deliveryZones])

  useEffect(() => {
    return () => {
      if (successTimeoutRef.current) clearTimeout(successTimeoutRef.current)
    }
  }, [])

  // v20: Email verification gate — if SecuritySettings.emailVerificationRequired
  // is ON and the user's email is not verified, block checkout and show a
  // premium modal asking them to verify. Hooks MUST be above the early return
  // to respect React's rules of hooks (otherwise the hook count changes
  // between renders when `open` toggles, crashing the app).
  const [emailVerificationRequired, setEmailVerificationRequired] = useState(false)
  const [showEmailGate, setShowEmailGate] = useState(false)
  useEffect(() => {
    if (!open) return
    api.get<{ settings: { emailVerificationRequired: boolean } }>('/api/security-settings')
      .then((d) => setEmailVerificationRequired(!!d.settings?.emailVerificationRequired))
      .catch(() => setEmailVerificationRequired(false))
  }, [open])

  if (!open) return null

  // v16.1: effective items + total — either from override (buy-now) or cart.
  const items = itemsOverride ?? cartItems
  const total = itemsOverride
    ? itemsOverride.reduce((sum, i) => sum + (products[i.productId]?.price ?? 0) * i.quantity, 0)
    : cartTotal

  const discount = appliedCoupon?.discount || 0
  const promoDiscount = appliedPromo?.discount || 0
  const pointsDiscountValue = pointsDiscount
  const subtotalAfterDiscount = Math.max(0, total - discount - promoDiscount - pointsDiscountValue)
  const selectedZone = deliveryZones.find((z) => z.id === selectedZoneId) || null
  const deliveryFee = deliveryMethod === 'delivery' && selectedZone ? selectedZone.cost : 0
  const grandTotal = subtotalAfterDiscount + deliveryFee

  // v16.2: Coupon validation — works in both cart and buy-now flows because
  // `total` is already flow-aware (uses itemsOverride if present).
  const handleApplyCoupon = async () => {
    if (!couponCode.trim()) return
    haptic.tap()
    setValidating(true)
    try {
      const result = await clubApi.validateCoupon(couponCode.trim(), total)
      setAppliedCoupon({ ...result, code: couponCode.trim() })
      toast.success('Купон применён!', { description: `Скидка: −${formatPrice(result.discount)}` })
      haptic.success()
    } catch (e: any) {
      toast.error(e?.message || 'Неверный купон')
      haptic.error()
    } finally {
      setValidating(false)
    }
  }

  // v19.0: Promo code validation
  const handleApplyPromo = async () => {
    if (!promoCode.trim()) return
    haptic.tap()
    setValidatingPromo(true)
    try {
      const result = await api.post<{ valid: boolean; code?: string; discount?: number; discountType?: string; discountValue?: number; error?: string }>(
        '/api/promo-codes/validate',
        { json: { code: promoCode.trim(), orderTotal: total } },
      )
      if (!result.valid) {
        toast.error(result.error || 'Промокод недействителен')
        haptic.error()
        setAppliedPromo(null)
        return
      }
      setAppliedPromo({
        code: result.code!,
        discount: result.discount!,
        discountType: result.discountType!,
        discountValue: result.discountValue!,
      })
      toast.success('Промокод применён!', { description: `Скидка: −${formatPrice(result.discount!)}` })
      haptic.success()
    } catch (e: any) {
      toast.error(e?.message || 'Не удалось проверить промокод')
      haptic.error()
    } finally {
      setValidatingPromo(false)
    }
  }

  // v19.0: Bonus points slider — recomputes discount as user moves it
  const handlePointsChange = (value: number) => {
    if (!bonusSettings || !bonusSettings.enabled) return
    const clamped = Math.min(value, userPoints)
    const computedDiscount = clamped * bonusSettings.pointValue
    const maxPercent = bonusSettings.maxPercentOfOrder
    const maxDiscount = (total * maxPercent) / 100
    const finalDiscount = Math.min(computedDiscount, maxDiscount)
    const finalPoints = Math.floor(finalDiscount / bonusSettings.pointValue)
    setPointsToSpend(finalPoints)
    setPointsDiscount(finalDiscount)
  }

  // Validation
  const hasAddress = deliveryMethod === 'pickup' || (addressMode === 'map' ? !!mapPoint : !!address.trim())
  // v16.2: phone must be at least 6 chars to match backend Zod schema
  // (z.string().min(6).max(20)). Previously only checked non-empty, which
  // let short numbers through and caused "Invalid payload" 400 errors.
  const canSubmit = items.length > 0 && !!name.trim() && phone.trim().length >= 6 && hasAddress && !submitting

  const handleSubmit = async () => {
    if (!canSubmit) return
    // v20: email verification gate
    if (emailVerificationRequired && !user?.emailVerified) {
      setShowEmailGate(true)
      haptic.error()
      return
    }
    haptic.heavy()
    setSubmitting(true)
    try {
      const payload: Record<string, unknown> = {
        items: items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
        name: name.trim(),
        phone: phone.trim(),
        deliveryMethod,
        contactMethod,
        comment: comment.trim() || undefined,
        couponCode: appliedCoupon?.code || undefined,
        // v19.0: promo + bonus points
        promoCode: appliedPromo?.code || undefined,
        pointsToSpend: pointsToSpend > 0 ? pointsToSpend : undefined,
      }
      if (deliveryMethod === 'delivery') {
        if (selectedZone) payload.deliveryZoneId = selectedZone.id
        if (addressMode === 'map' && mapPoint) {
          payload.lat = mapPoint.lat
          payload.lng = mapPoint.lng
          // v16.2: use undefined (not null) — Zod address schema is
          // `.nullable().optional()` now, but undefined is cleaner.
          payload.address = mapPoint.address || address.trim() || undefined
          payload.mapUrl = buildMapUrl(mapPoint.lat, mapPoint.lng, 'Доставка')
        } else {
          payload.address = address.trim()
        }
      }
      await api.post('/api/orders', { json: payload, auth: true })
      haptic.success()
      setSuccess(true)
      if (!skipCartClear) clearCart()
      if (successTimeoutRef.current) clearTimeout(successTimeoutRef.current)
      successTimeoutRef.current = setTimeout(() => {
        successTimeoutRef.current = null
        setSuccess(false)
        onClose()
        onOrderCreated()
        onNavigate('orders')
        toast.success('🛒 Заказ оформлен!', { description: 'Мы свяжемся с вами для подтверждения', sound: 'order' })
      }, 1500)
    } catch (e: any) {
      haptic.error()
      toast.error(e?.message || 'Не удалось оформить заказ')
    } finally {
      setSubmitting(false)
    }
  }

  const storeHasCoords = deliverySettings?.storeLat != null && deliverySettings?.storeLng != null

  return (
    <>
      <MapPicker
        open={mapPickerOpen}
        onClose={() => setMapPickerOpen(false)}
        onPick={(r) => setMapPoint(r)}
        initialLat={mapPoint?.lat}
        initialLng={mapPoint?.lng}
        storeLat={deliverySettings?.storeLat}
        storeLng={deliverySettings?.storeLng}
      />
      <AnimatePresence>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[450] flex items-end md:items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)' }}
          onClick={onClose}
        >
          <motion.div
            initial={{ y: '100%', opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: '100%', opacity: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 30 }}
            className="relative w-full md:max-w-lg max-h-[92vh] flex flex-col rounded-t-[32px] md:rounded-[32px] overflow-hidden glass-strong border border-border/40 shadow-glow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Success overlay */}
            {success && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="absolute inset-0 z-50 grid place-items-center bg-background/95 backdrop-blur-md"
              >
                <div className="text-center">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', stiffness: 260, damping: 15 }}
                    className="h-20 w-20 rounded-full bg-emerald-500 grid place-items-center mx-auto mb-4"
                  >
                    <Check className="h-10 w-10 text-white" strokeWidth={3} />
                  </motion.div>
                  <h3 className="text-xl font-bold mb-1">Заказ оформлен!</h3>
                  <p className="text-sm text-muted-foreground">Перенаправляем в заказы…</p>
                </div>
              </motion.div>
            )}

            {/* Header */}
            <div className="shrink-0 p-5 pb-4 border-b border-border/30 flex items-center gap-3">
              <div className="h-10 w-10 rounded-2xl grid place-items-center shrink-0 gradient-brand shadow-glow">
                <ShoppingBag className="h-5 w-5 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-lg font-bold tracking-tight">Оформление заказа</h2>
                <p className="text-xs text-muted-foreground">{items.length} товаров · {formatPrice(grandTotal)}</p>
              </div>
              <button onClick={onClose} aria-label="Закрыть" className="h-9 w-9 rounded-full grid place-items-center hover:bg-foreground/10 transition-colors shrink-0">
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Body */}
            <div
              data-scroll-lock-ignore
              className="flex-1 overflow-y-auto p-5 space-y-5 overscroll-contain"
              style={{ WebkitOverflowScrolling: 'touch' }}
            >
              {/* Order summary */}
              <div className="rounded-2xl glass border border-border/40 p-4">
                <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-3">Ваш заказ</h3>
                <div className="space-y-2">
                  {items.map((item) => {
                    const product = products[item.productId]
                    return (
                      <div key={item.productId} className="flex items-center gap-2 text-sm">
                        <div className="h-10 w-10 rounded-lg overflow-hidden shrink-0 bg-foreground/5">
                          {product?.images?.[0] && (
                            <img src={assetUrl(product.images[0])} alt="" className="w-full h-full object-cover" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate text-xs">{product?.title || 'Товар'}</div>
                          <div className="text-[10px] text-muted-foreground">{item.quantity} × {formatPrice(product?.price || 0)}</div>
                        </div>
                        <div className="text-xs font-bold">{formatPrice((product?.price || 0) * item.quantity)}</div>
                      </div>
                    )
                  })}
                </div>
                <div className="border-t border-border/30 mt-3 pt-3 space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Сумма:</span>
                    <span className="font-medium">{formatPrice(total)}</span>
                  </div>
                  {discount > 0 && (
                    <div className="flex justify-between text-xs text-emerald-500">
                      <span>Скидка ({appliedCoupon?.code}):</span>
                      <span className="font-medium">−{formatPrice(discount)}</span>
                    </div>
                  )}
                  {/* v19.0: Promo code discount */}
                  {promoDiscount > 0 && (
                    <div className="flex justify-between text-xs text-emerald-500">
                      <span>Промокод ({appliedPromo?.code}):</span>
                      <span className="font-medium">−{formatPrice(promoDiscount)}</span>
                    </div>
                  )}
                  {/* v19.0: Bonus points discount */}
                  {pointsDiscountValue > 0 && (
                    <div className="flex justify-between text-xs text-amber-500">
                      <span>Баллы (−{pointsToSpend}):</span>
                      <span className="font-medium">−{formatPrice(pointsDiscountValue)}</span>
                    </div>
                  )}
                  {deliveryFee > 0 && (
                    <div className="flex justify-between text-xs text-sky-500">
                      <span>Доставка ({selectedZone?.name}):</span>
                      <span className="font-medium">+{formatPrice(deliveryFee)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm font-bold pt-1">
                    <span>Итого:</span>
                    <span>{formatPrice(grandTotal)}</span>
                  </div>
                  {/* v19.0: show bonus points to be earned */}
                  {grandTotal >= 100 && bonusSettings?.enabled && (
                    <div className="flex items-center gap-1 text-[10px] text-amber-500 pt-1">
                      <Star className="h-3 w-3" fill="currentColor" />
                      +{bonusSettings && bonusSettings.earnPerCurrencyUnit > 0
                        ? Math.floor((subtotalAfterDiscount / bonusSettings.earnPerCurrencyUnit) * bonusSettings.earnRate)
                        : Math.floor(subtotalAfterDiscount / 100)} баллов будет начислено
                    </div>
                  )}
                </div>

                {/* v19.0: Promo code input (separate from club coupon) */}
                <div className="mt-3 pt-3 border-t border-border/30">
                  {appliedPromo ? (
                    <div className="flex items-center justify-between rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-3 py-2">
                      <div className="flex items-center gap-2">
                        <Check className="h-4 w-4 text-emerald-500" />
                        <div>
                          <div className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">{appliedPromo.code}</div>
                          <div className="text-[10px] text-muted-foreground">Скидка: −{formatPrice(appliedPromo.discount)}</div>
                        </div>
                      </div>
                      <button
                        onClick={() => { setAppliedPromo(null); setPromoCode(''); haptic.tap() }}
                        className="text-xs text-muted-foreground hover:text-foreground"
                      >Убрать</button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <div className="flex-1 relative">
                        <Ticket className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <input
                          type="text"
                          value={promoCode}
                          onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                          onKeyDown={(e) => { if (e.key === 'Enter') handleApplyPromo() }}
                          placeholder="Промокод"
                          className="w-full h-10 rounded-xl bg-foreground/5 border border-border/40 pl-9 pr-3 text-sm font-mono uppercase"
                        />
                      </div>
                      <button
                        onClick={handleApplyPromo}
                        disabled={!promoCode.trim() || validatingPromo}
                        className="h-10 px-4 rounded-xl gradient-brand text-white text-sm font-bold disabled:opacity-50 flex items-center gap-1"
                      >
                        {validatingPromo ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Применить'}
                      </button>
                    </div>
                  )}
                </div>

                {/* v19.0: Bonus points slider */}
                {bonusSettings?.enabled && userPoints > 0 && (
                  <div className="mt-3 pt-3 border-t border-border/30">
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs font-semibold flex items-center gap-1">
                        <Star className="h-3 w-3 text-amber-500" fill="currentColor" />
                        Бонусные баллы
                      </label>
                      <span className="text-xs text-muted-foreground">
                        Доступно: {userPoints} • Скидка: −{formatPrice(pointsDiscount)}
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max={userPoints}
                      value={pointsToSpend}
                      onChange={(e) => handlePointsChange(Number(e.target.value))}
                      className="w-full h-2 rounded-full bg-foreground/10 appearance-none cursor-pointer accent-amber-500"
                    />
                    <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                      <span>0</span>
                      <span>1 балл = {formatPrice(bonusSettings.pointValue)}</span>
                      <span>{userPoints}</span>
                    </div>
                    {pointsToSpend > 0 && (
                      <button
                        onClick={() => { setPointsToSpend(0); setPointsDiscount(0); haptic.tap() }}
                        className="text-[10px] text-muted-foreground hover:text-foreground mt-1"
                      >Не использовать баллы</button>
                    )}
                  </div>
                )}

                {/* v16.2: Coupon input — owned by CheckoutSheet so it shows
                    in BOTH cart AND buy-now flows. Previously only CartSheet
                    had a coupon field, which buy-now bypassed. */}
                <div className="mt-3 pt-3 border-t border-border/30">
                  {appliedCoupon ? (
                    <div className="flex items-center justify-between rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-3 py-2">
                      <div className="flex items-center gap-2">
                        <Check className="h-4 w-4 text-emerald-500" />
                        <div>
                          <div className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">{appliedCoupon.title}</div>
                          <div className="text-[10px] text-muted-foreground">Скидка: −{formatPrice(appliedCoupon.discount)}</div>
                        </div>
                      </div>
                      <button
                        onClick={() => { setAppliedCoupon(null); setCouponCode(''); haptic.tap() }}
                        className="text-xs text-muted-foreground hover:text-foreground"
                      >Убрать</button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <div className="flex-1 relative">
                        <Ticket className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <input
                          type="text"
                          value={couponCode}
                          onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                          onKeyDown={(e) => { if (e.key === 'Enter') handleApplyCoupon() }}
                          placeholder="Купон CLUB"
                          className="w-full h-10 rounded-xl bg-foreground/5 border border-border/40 pl-9 pr-3 text-sm font-mono uppercase"
                        />
                      </div>
                      <button
                        onClick={handleApplyCoupon}
                        disabled={!couponCode.trim() || validating}
                        className="h-10 px-4 rounded-xl gradient-brand text-white text-sm font-bold disabled:opacity-50 flex items-center gap-1"
                      >
                        {validating ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Применить'}
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Contact info */}
              <div className="space-y-3">
                <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Контактные данные</h3>
                <div>
                  <label className="text-xs text-muted-foreground flex items-center gap-1 mb-1">
                    <User className="h-3 w-3" /> Имя *
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Ваше имя"
                    className="w-full h-11 rounded-xl bg-foreground/5 border border-border/40 px-3 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground flex items-center gap-1 mb-1">
                    <Phone className="h-3 w-3" /> Телефон *
                  </label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+7 (999) 123-45-67"
                    className="w-full h-11 rounded-xl bg-foreground/5 border border-border/40 px-3 text-sm"
                  />
                </div>
              </div>

              {/* Fulfillment method */}
              <div className="space-y-3">
                <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Способ получения</h3>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => { haptic.tap(); setDeliveryMethod('delivery') }}
                    disabled={!deliverySettings?.deliveryEnabled}
                    className={cn(
                      'flex flex-col items-center gap-1.5 p-4 rounded-2xl border-2 transition-all relative overflow-hidden',
                      deliveryMethod === 'delivery' ? 'border-primary bg-primary/5 shadow-glow' : 'border-border/40',
                      !deliverySettings?.deliveryEnabled && 'opacity-40 cursor-not-allowed',
                    )}
                  >
                    <Truck className={cn('h-6 w-6', deliveryMethod === 'delivery' && 'text-primary')} />
                    <span className="text-xs font-semibold">Доставка</span>
                  </button>
                  <button
                    onClick={() => { haptic.tap(); setDeliveryMethod('pickup') }}
                    disabled={!deliverySettings?.pickupEnabled}
                    className={cn(
                      'flex flex-col items-center gap-1.5 p-4 rounded-2xl border-2 transition-all relative overflow-hidden',
                      deliveryMethod === 'pickup' ? 'border-primary bg-primary/5 shadow-glow' : 'border-border/40',
                      !deliverySettings?.pickupEnabled && 'opacity-40 cursor-not-allowed',
                    )}
                  >
                    <Store className={cn('h-6 w-6', deliveryMethod === 'pickup' && 'text-primary')} />
                    <span className="text-xs font-semibold">Самовывоз</span>
                  </button>
                </div>

                {/* Pickup details */}
                <AnimatePresence mode="wait">
                  {deliveryMethod === 'pickup' && (
                    <motion.div
                      key="pickup"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="rounded-2xl glass border border-border/40 p-4 space-y-3">
                        {deliverySettings?.storeAddress ? (
                          <div className="flex items-start gap-2">
                            <MapPin className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-xs text-muted-foreground">Адрес магазина</p>
                              <p className="text-sm font-medium">{deliverySettings.storeAddress}</p>
                            </div>
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground">
                            Адрес магазина будет уточнён менеджером по телефону.
                          </p>
                        )}
                        {deliverySettings?.workingHours && (
                          <div className="flex items-start gap-2">
                            <Clock className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-xs text-muted-foreground">Время работы</p>
                              <p className="text-sm font-medium">{deliverySettings.workingHours}</p>
                            </div>
                          </div>
                        )}
                        {storeHasCoords && (
                          <a
                            href={buildMapUrl(deliverySettings!.storeLat!, deliverySettings!.storeLng!, 'Магазин')}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => {
                              // On mobile, prefer opening native app; on desktop the https link opens browser maps.
                              e.preventDefault()
                              window.open(buildMapUrl(deliverySettings!.storeLat!, deliverySettings!.storeLng!, 'Магазин'), '_blank', 'noopener,noreferrer')
                            }}
                            className="w-full h-10 rounded-xl bg-primary/10 hover:bg-primary/15 text-primary font-medium text-sm flex items-center justify-center gap-2 transition-colors"
                          >
                            <Navigation className="h-4 w-4" />
                            Открыть на карте
                          </a>
                        )}
                        {deliverySettings?.pickupTerms && (
                          <p className="text-[11px] text-muted-foreground/80 leading-relaxed pt-1 border-t border-border/20">
                            {deliverySettings.pickupTerms}
                          </p>
                        )}
                      </div>
                    </motion.div>
                  )}

                  {/* Delivery details */}
                  {deliveryMethod === 'delivery' && (
                    <motion.div
                      key="delivery"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden space-y-3"
                    >
                      {/* Zone selector */}
                      {deliveryZones.length > 0 && (
                        <div>
                          <label className="text-xs text-muted-foreground flex items-center gap-1 mb-2">
                            <MapPin className="h-3 w-3" /> Зона доставки
                          </label>
                          <div className="flex flex-wrap gap-2">
                            {deliveryZones.map((zone) => (
                              <button
                                key={zone.id}
                                onClick={() => { haptic.tap(); setSelectedZoneId(zone.id) }}
                                className={cn(
                                  'px-3 py-2 rounded-xl border-2 text-xs font-semibold transition-all',
                                  selectedZoneId === zone.id
                                    ? 'border-primary bg-primary/5 text-primary'
                                    : 'border-border/40 hover:border-border/60',
                                )}
                              >
                                {zone.name}
                                {zone.cost > 0 && (
                                  <span className="ml-1.5 text-[10px] opacity-70">+{formatPrice(zone.cost)}</span>
                                )}
                              </button>
                            ))}
                          </div>
                          {selectedZone?.description && (
                            <p className="text-[11px] text-muted-foreground/70 mt-1.5">{selectedZone.description}</p>
                          )}
                        </div>
                      )}

                      {/* Address mode toggle */}
                      <div>
                        <label className="text-xs text-muted-foreground flex items-center gap-1 mb-2">
                          <MapPin className="h-3 w-3" /> Адрес доставки *
                        </label>
                        <div className="grid grid-cols-2 gap-2 mb-3">
                          <button
                            onClick={() => { haptic.tap(); setAddressMode('map') }}
                            className={cn(
                              'flex items-center justify-center gap-1.5 py-2.5 rounded-xl border-2 text-xs font-semibold transition-all',
                              addressMode === 'map' ? 'border-primary bg-primary/5 text-primary' : 'border-border/40',
                            )}
                          >
                            <MapPin className="h-3.5 w-3.5" /> На карте
                          </button>
                          <button
                            onClick={() => { haptic.tap(); setAddressMode('manual') }}
                            className={cn(
                              'flex items-center justify-center gap-1.5 py-2.5 rounded-xl border-2 text-xs font-semibold transition-all',
                              addressMode === 'manual' ? 'border-primary bg-primary/5 text-primary' : 'border-border/40',
                            )}
                          >
                            <Search className="h-3.5 w-3.5" /> Вручную
                          </button>
                        </div>

                        <AnimatePresence mode="wait">
                          {addressMode === 'map' ? (
                            <motion.div
                              key="map-mode"
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              exit={{ opacity: 0 }}
                            >
                              <button
                                onClick={() => { haptic.tap(); setMapPickerOpen(true) }}
                                className={cn(
                                  'w-full rounded-xl border-2 border-dashed p-4 flex flex-col items-center gap-2 transition-all',
                                  mapPoint ? 'border-primary/50 bg-primary/5' : 'border-border/40 hover:border-border/60',
                                )}
                              >
                                {mapPoint ? (
                                  <>
                                    <div className="h-10 w-10 rounded-full bg-primary/15 grid place-items-center">
                                      <MapPin className="h-5 w-5 text-primary" />
                                    </div>
                                    <div className="text-center min-w-0 w-full">
                                      <p className="text-xs font-semibold text-primary">Точка выбрана</p>
                                      <p className="text-[11px] text-muted-foreground font-mono truncate">
                                        {mapPoint.lat.toFixed(5)}, {mapPoint.lng.toFixed(5)}
                                      </p>
                                      {mapPoint.address && (
                                        <p className="text-[11px] text-muted-foreground/80 truncate mt-0.5">{mapPoint.address}</p>
                                      )}
                                    </div>
                                    <span className="text-[11px] text-primary font-medium">Изменить</span>
                                  </>
                                ) : (
                                  <>
                                    <div className="h-10 w-10 rounded-full bg-foreground/5 grid place-items-center">
                                      <MapPin className="h-5 w-5 text-muted-foreground" />
                                    </div>
                                    <span className="text-sm font-medium">Выбрать на карте</span>
                                    <span className="text-[11px] text-muted-foreground">Нажмите, чтобы открыть карту</span>
                                  </>
                                )}
                              </button>
                              {/* Optional manual address line alongside map point */}
                              {mapPoint && (
                                <input
                                  type="text"
                                  value={address}
                                  onChange={(e) => setAddress(e.target.value)}
                                  placeholder="Доп. информация: кв., этаж, домофон (необязательно)"
                                  className="mt-2 w-full h-11 rounded-xl bg-foreground/5 border border-border/40 px-3 text-sm"
                                />
                              )}
                            </motion.div>
                          ) : (
                            <motion.div
                              key="manual-mode"
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              exit={{ opacity: 0 }}
                            >
                              <textarea
                                value={address}
                                onChange={(e) => setAddress(e.target.value)}
                                placeholder="Город, улица, дом, квартира"
                                rows={3}
                                className="w-full rounded-xl bg-foreground/5 border border-border/40 px-3 py-2.5 text-sm resize-none"
                              />
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>

                      {deliverySettings?.deliveryTerms && (
                        <p className="text-[11px] text-muted-foreground/80 leading-relaxed">
                          {deliverySettings.deliveryTerms}
                        </p>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Contact method */}
              <div className="space-y-3">
                <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Предпочтительный способ связи</h3>
                <div className="grid grid-cols-4 gap-2">
                  {([
                    { v: 'whatsapp', l: 'WhatsApp', icon: '💬' },
                    { v: 'telegram', l: 'Telegram', icon: '✈️' },
                    { v: 'phone', l: 'Звонок', icon: '📞' },
                    { v: 'email', l: 'Email', icon: '✉️' },
                  ] as const).map((opt) => (
                    <button
                      key={opt.v}
                      onClick={() => { haptic.tap(); setContactMethod(opt.v) }}
                      className={cn(
                        'flex flex-col items-center gap-1 p-2 rounded-xl border-2 transition-all',
                        contactMethod === opt.v ? 'border-primary bg-primary/5' : 'border-border/40',
                      )}
                    >
                      <span className="text-lg">{opt.icon}</span>
                      <span className="text-[10px] font-semibold">{opt.l}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Comment */}
              <div>
                <label className="text-xs text-muted-foreground flex items-center gap-1 mb-1">
                  <MessageSquare className="h-3 w-3" /> Комментарий к заказу
                </label>
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Дополнительные пожелания (необязательно)"
                  rows={2}
                  className="w-full rounded-xl bg-foreground/5 border border-border/40 px-3 py-2 text-sm resize-none"
                />
              </div>
            </div>

            {/* Footer */}
            <div className="shrink-0 p-4 border-t border-border/30 glass-strong" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)' }}>
              <button
                onClick={handleSubmit}
                disabled={!canSubmit}
                className={cn(
                  'w-full h-12 rounded-full font-bold text-sm transition-all flex items-center justify-center gap-2',
                  canSubmit ? 'gradient-brand text-white shadow-glow hover:scale-[1.02] active:scale-95' : 'bg-foreground/5 text-muted-foreground',
                )}
              >
                {submitting ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Оформляем…</>
                ) : (
                  <>Оформить заказ · {formatPrice(grandTotal)}</>
                )}
              </button>
            </div>
          </motion.div>
        </motion.div>
      </AnimatePresence>

      {/* v20: Email verification gate modal — premium design */}
      <EmailVerificationGateModal
        open={showEmailGate}
        email={user?.email || ''}
        onClose={() => setShowEmailGate(false)}
        onVerified={() => {
          setShowEmailGate(false)
          // Refresh user to pick up emailVerified, then retry submit
          useAuthStore.getState().fetchMe().then(() => {
            toast.success('Email подтверждён! Можете оформить заказ.')
          }).catch(() => {})
        }}
      />
    </>
  )
}

/**
 * v20: Premium modal shown when an unverified-email user tries to checkout.
 * Offers to verify email right here (paste link / send again) without
 * leaving the checkout flow.
 */
function EmailVerificationGateModal({
  open, email, onClose, onVerified,
}: {
  open: boolean
  email: string
  onClose: () => void
  onVerified: () => void
}) {
  const completeEmailVerification = useAuthStore((s) => s.completeEmailVerification)
  const [input, setInput] = useState('')
  const [internal, setInternal] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [resendIn, setResendIn] = useState(60)
  const [resending, setResending] = useState(false)

  useEffect(() => {
    if (!open) return
    setResendIn(60)
    setInternal('')
    const t = setInterval(() => setResendIn((s) => (s > 0 ? s - 1 : 0)), 1000)
    return () => clearInterval(t)
  }, [open])

  const handleResend = async () => {
    if (resendIn > 0 || resending) return
    setResending(true)
    try {
      await api.post('/api/auth/send-verification', { json: {}, auth: true })
      toast.success('Письмо отправлено повторно')
      setResendIn(60)
    } catch (e: any) {
      toast.error(e?.message || 'Не удалось отправить письмо')
    } finally {
      setResending(false)
    }
  }

  const handleVerify = async () => {
    const trimmed = (internal || input).trim()
    if (!trimmed) {
      toast.error('Вставьте ссылку или код из письма')
      return
    }
    setVerifying(true)
    try {
      let token = trimmed
      try {
        const url = new URL(trimmed)
        const t = url.searchParams.get('token')
        if (t) token = t
      } catch { /* raw token */ }
      const res = await fetch(`/api/auth/verify-email?token=${encodeURIComponent(token)}`, { method: 'GET' })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.ok) {
        completeEmailVerification()
        toast.success('Email подтверждён!')
        onVerified()
      } else {
        toast.error(data.error || 'Не удалось подтвердить email')
      }
    } catch (e: any) {
      toast.error(e?.message || 'Ошибка верификации')
    } finally {
      setVerifying(false)
    }
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[500] grid place-items-center p-4"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.92, y: 16, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.92, y: 16, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 28 }}
        className="relative w-full max-w-md rounded-3xl overflow-hidden glass-strong border border-border/40 shadow-glow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 pb-4 text-center">
          <div className="flex justify-center mb-4">
            <div
              className="h-16 w-16 rounded-2xl grid place-items-center shadow-glow"
              style={{ background: 'linear-gradient(135deg, #38bdf8 0%, #2563eb 50%, #7c3aed 100%)' }}
            >
              <MailCheck className="h-8 w-8 text-white" strokeWidth={2.2} />
            </div>
          </div>
          <h2 className="text-xl font-extrabold tracking-tight mb-1">Подтвердите Email</h2>
          <p className="text-sm text-muted-foreground px-2">
            Для оформления заказа необходимо подтвердить Email.
            <br />
            Письмо отправлено на <span className="font-semibold text-foreground">{email}</span>.
          </p>
        </div>

        <div className="px-6 pb-6 space-y-3">
          <div className="flex gap-2">
            <input
              type="text"
              value={internal}
              onChange={(e) => setInternal(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !verifying) handleVerify() }}
              placeholder="Вставьте ссылку из письма"
              className="flex-1 h-11 rounded-xl bg-foreground/5 border border-border/40 px-3 text-sm font-mono outline-none focus:border-primary/60 transition-colors"
              autoFocus
            />
            <button
              onClick={handleVerify}
              disabled={verifying || !internal.trim()}
              className="h-11 px-4 rounded-xl gradient-brand text-white text-sm font-bold disabled:opacity-50 flex items-center gap-1.5 shrink-0"
            >
              {verifying ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
              <span className="hidden sm:inline">Подтвердить</span>
            </button>
          </div>

          <button
            onClick={handleResend}
            disabled={resendIn > 0 || resending}
            className="w-full h-11 rounded-xl border border-border/40 text-sm font-medium flex items-center justify-center gap-2 hover:bg-accent/50 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {resending ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Отправка…</>
            ) : resendIn > 0 ? (
              <>Отправить повторно через {resendIn}с</>
            ) : (
              <><RefreshCw className="h-4 w-4" /> Отправить письмо снова</>
            )}
          </button>

          <button
            onClick={onClose}
            className="w-full h-9 rounded-xl text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Отмена
          </button>
        </div>
      </motion.div>
    </div>
  )
}
