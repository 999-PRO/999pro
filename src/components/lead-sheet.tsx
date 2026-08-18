'use client'

// ============================================================================
//  LeadSheet — "Оставить заявку" modal for product pages.
//  ----------------------------------------------------------------------------
//  v25.10 (Task #16): replaces the "Купить" CTA. Payments are not connected,
//  so the primary product-page action is now "leave a request" — the existing
//  /api/leads backend route (public, rate-limited) accepts the form.
//
//  Architecture:
//    • Mounted once globally via AppShell (listens for the `open-lead`
//      window event — same pattern as `open-checkout`).
//    • Captures: name, phone, optional comment, contact method.
//    • POSTs to /api/leads with the active product context.
//    • Auth-aware: pre-fills name+phone from the logged-in user, attaches
//      userId for the lead owner (so the user sees their request in
//      `GET /api/leads/mine`).
//    • No cart / order / payment logic — pure lead capture.
// ============================================================================

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { X, Phone, MessageSquare, Send, Loader2, User, Mail } from 'lucide-react'
import { api } from '@/lib/api'
import { toast } from '@/lib/notifications'
import { haptic } from '@/lib/haptic'
import { formatPrice } from '@/lib/format'
import { assetUrl } from '@/lib/api'
import type { Product } from '@/lib/types'

interface LeadPayload {
  product: Product | null
}

type ContactMethod = 'whatsapp' | 'telegram' | 'phone'

export function LeadSheet() {
  const [open, setOpen] = useState(false)
  const [product, setProduct] = useState<Product | null>(null)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [comment, setComment] = useState('')
  const [contactMethod, setContactMethod] = useState<ContactMethod>('whatsapp')
  const [submitting, setSubmitting] = useState(false)

  // ─── Open / close via window event ───
  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent).detail as LeadPayload | undefined
      setProduct(detail?.product ?? null)
      setOpen(true)
    }
    window.addEventListener('open-lead', onOpen as EventListener)
    return () => window.removeEventListener('open-lead', onOpen as EventListener)
  }, [])

  // v25.12: fields are EMPTY on open — user must fill them manually.
  // Previously pre-filled from logged-in user, but that was confusing.
  // Reset fields when sheet opens.
  useEffect(() => {
    if (open) {
      setName('')
      setPhone('')
      setComment('')
    }
  }, [open])

  // Lock body scroll while open
  useEffect(() => {
    if (!open) return
    const original = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = original
    }
  }, [open])

  const close = () => {
    setOpen(false)
    setComment('')
  }

  const submit = async () => {
    if (!name.trim()) {
      toast.error('Введите имя')
      return
    }
    if (!phone.trim()) {
      toast.error('Введите телефон')
      return
    }
    setSubmitting(true)
    haptic.tap()
    try {
      // v25.12: auth: false — /api/leads supports optionalAuth on the backend.
      // Sending auth: true would throw "Not authenticated" for guests, which
      // is wrong — leads are designed to be submittable without an account.
      // The backend links the lead to userId only if a valid Bearer token is
      // present; otherwise it creates an anonymous lead.
      await api.post('/api/leads', {
        json: {
          name: name.trim(),
          phone: phone.trim(),
          comment: comment.trim() || null,
          productId: product?.id || null,
          productTitle: product?.title || null,
          // v25.12: round price to int — backend z.number().int() rejects floats
          productPrice: product?.price ? Math.round(product.price) : null,
          productImage: product?.images?.[0] || null,
          quantity: 1,
          contactMethod,
        },
        // auth: true would block guests; we want leads to be submittable anonymously
      })
      toast.success('Заявка отправлена! Мы свяжемся с вами.')
      haptic.success()
      close()
    } catch (err: any) {
      toast.error(err?.message || 'Не удалось отправить заявку')
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[460] flex items-end sm:items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="lead-sheet-title"
    >
      {/* Backdrop */}
      <motion.div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={close}
      />

      {/* Sheet */}
      <motion.div
        initial={{ y: '100%', opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: 'spring', damping: 30, stiffness: 320 }}
        className="relative w-full sm:max-w-md max-h-[92vh] overflow-y-auto custom-scroll bg-background sm:rounded-3xl rounded-t-3xl border border-border/40 shadow-2xl"
      >
        {/* Drag handle */}
        <div className="sm:hidden sticky top-0 z-10 pt-3 pb-1 bg-background/95 backdrop-blur">
          <div className="h-1 w-10 rounded-full bg-muted-foreground/30 mx-auto" />
        </div>

        {/* Close button */}
        <button
          onClick={close}
          aria-label="Закрыть"
          className="absolute top-3 right-3 h-9 w-9 rounded-full glass-strong grid place-items-center hover:scale-105 active:scale-95 transition-transform z-20"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="p-5 pt-6 space-y-5">
          <div>
            <h2 id="lead-sheet-title" className="text-xl font-bold">Оставить заявку</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Заполните форму — мы свяжемся с вами в ближайшее время.
            </p>
          </div>

          {/* Product context card */}
          {product && (
            <div className="flex items-center gap-3 p-3 rounded-2xl glass">
              <div className="h-14 w-14 rounded-xl overflow-hidden bg-muted shrink-0">
                {product.images?.[0] && (
                  <img
                    src={assetUrl(product.images[0])}
                    alt={product.title}
                    className="h-full w-full object-cover"
                  />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold truncate">{product.title}</div>
                <div className="text-sm font-bold text-primary mt-0.5">
                  {formatPrice(product.price, product.currency)}
                </div>
              </div>
            </div>
          )}

          {/* Name */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <User className="h-3 w-3" /> Имя
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Как вас зовут"
              className="w-full h-11 px-4 rounded-xl bg-muted/40 border border-border/40 outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20 transition-all text-sm"
              maxLength={80}
            />
          </div>

          {/* Phone */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <Phone className="h-3 w-3" /> Телефон
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+7 999 123-45-67"
              className="w-full h-11 px-4 rounded-xl bg-muted/40 border border-border/40 outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20 transition-all text-sm"
              maxLength={32}
            />
          </div>

          {/* Contact method */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Способ связи</label>
            <div className="grid grid-cols-3 gap-2">
              {(['whatsapp', 'telegram', 'phone'] as ContactMethod[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setContactMethod(m)}
                  className={`h-10 rounded-xl text-xs font-semibold border transition-all ${
                    contactMethod === m
                      ? 'bg-primary text-primary-foreground border-primary shadow-md'
                      : 'bg-muted/40 border-border/40 hover:bg-muted/60'
                  }`}
                >
                  {m === 'whatsapp' ? 'WhatsApp' : m === 'telegram' ? 'Telegram' : 'Звонок'}
                </button>
              ))}
            </div>
          </div>

          {/* Comment */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <MessageSquare className="h-3 w-3" /> Комментарий (необязательно)
            </label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Вопрос, пожелания, удобное время для звонка…"
              rows={3}
              maxLength={500}
              className="w-full px-4 py-3 rounded-xl bg-muted/40 border border-border/40 outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20 transition-all text-sm resize-none"
            />
          </div>

          {/* Submit */}
          <button
            onClick={submit}
            disabled={submitting}
            className="w-full h-12 rounded-xl font-bold text-white shadow-glow bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 hover:shadow-glow-lg active:scale-[0.98] transition-all disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Отправляем…
              </>
            ) : (
              <>
                <Send className="h-4 w-4" /> Отправить заявку
              </>
            )}
          </button>

          <p className="text-[11px] text-muted-foreground text-center">
            Нажимая «Отправить», вы соглашаетесь на обработку персональных данных.
          </p>
        </div>
      </motion.div>
    </div>
  )
}
