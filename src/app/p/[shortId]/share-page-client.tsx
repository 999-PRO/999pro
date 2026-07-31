'use client'

// ============================================================================
//  SharePageClient — the interactive body of /p/[shortId].
//  Rendered server-side with OG meta tags (see page.tsx), hydrated client-side
//  to add: image gallery, swipe, "Open App" / "Install App" buttons, share
//  button, QR modal, story generator.
// ============================================================================

import { useEffect, useState, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ChevronLeft, ChevronRight, Star, Share2, ShoppingBag, Heart,
  Check, Truck, Shield, RefreshCw, Download, Smartphone, QrCode,
  ExternalLink, ChevronDown, Store, Sparkles,
} from 'lucide-react'
import type { SharePageData } from '@999pro/shared'
import { formatPrice, formatCompactNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import { SmartShareSheet } from '@/components/share/smart-share-sheet'
import { QrModal } from '@/components/share/qr-modal'
import { toast } from '@/lib/notifications'
import { api, assetUrl } from '@/lib/api'

interface Props {
  data: SharePageData
  appPublicUrl: string
}

export function SharePageClient({ data, appPublicUrl }: Props) {
  const { product, reviews, related, stats, shortId, shareUrl, deepLinkUrl } = data
  const [imgIndex, setImgIndex] = useState(0)
  const [shareOpen, setShareOpen] = useState(false)
  const [qrOpen, setQrOpen] = useState(false)
  const touchStartX = useRef(0)

  // P-MED-004: Removed duplicate client-side `open` event tracking.
  // Previously this useEffect fired POST /api/share/track { eventType: 'open' }
  // on mount — but the backend already records an `open` ShareEvent (with the
  // same referrer via req.headers.referer) on the GET /api/share/s/:shortId
  // call that produced this page's data. The duplicate client-side call caused
  // every page view to be double-counted in share analytics.
  //
  // Client-side tracking is still used for `app_open` events (see openInApp)
  // because there is no equivalent server-side call when the user taps
  // "Open in App" — that's a pure client-side action.

  // Open the app via deep link. We use the /?product=<id> URL which is
  // configured as a Universal Link (iOS) / App Link (Android). If the app
  // is installed, the OS intercepts the URL and opens the app at this
  // specific product (the app's URL handler routes ?product=<id> to the
  // product screen). If the app is NOT installed, the URL loads in the
  // browser — which is the main app SPA, and it routes to the product
  // page directly (so the user still sees the product, just in the browser).
  //
  // We use the product.id (NOT shortId) because the main app SPA's router
  // expects ?product=<internal-id>, not ?product=<shortId>. The share page
  // already has the product.id from the backend's /api/share/s response.
  const openInApp = useCallback(() => {
    if (typeof window === 'undefined') return
    // Track the app_open attempt — the backend records this even if the app
    // isn't installed (we can't know if it opened).
    // Wave 6d: extract ref + UTM from URL params for attribution
    const urlParams = new URLSearchParams(window.location.search)
    const ref = urlParams.get('ref') || undefined
    const utmSource = urlParams.get('utm_source') || undefined
    const utmMedium = urlParams.get('utm_medium') || undefined
    const utmCampaign = urlParams.get('utm_campaign') || undefined
    api
      .post('/api/share/track', {
        json: { shortId, eventType: 'app_open', platform: 'in-app', ref, utmSource, utmMedium, utmCampaign },
      })
      .catch(() => {})
    // Build the deep link URL using the CURRENT origin (window.location.origin).
    // This is critical: Universal Links / App Links only work when the URL
    // host matches the domain in the apple-app-site-association / assetlinks.json
    // files. Using a hardcoded domain (like 999.pro) would break the OS
    // interception and the app wouldn't open.
    const deepLinkUrl = `${window.location.origin}/?product=${encodeURIComponent(product.id)}`
    // Use window.location.href for navigation. On iOS/Android with the app
    // installed, the OS intercepts this and opens the app. On desktop or
    // without the app, it navigates within the browser.
    window.location.href = deepLinkUrl
  }, [product.id, shortId])

  // Open the product in the web app (browser). This navigates to the main
  // app SPA with ?product=<id> query param — the SPA's router opens the
  // product page directly. Works on Desktop, Android, iPhone — in any
  // browser. The URL uses window.location.origin so it always points to
  // the actual deployment the user is currently on.
  const openProductInWebApp = useCallback(() => {
    if (typeof window === 'undefined') return
    const webAppUrl = `${window.location.origin}/?product=${encodeURIComponent(product.id)}`
    // Use window.location.href for same-tab navigation. We don't use
    // window.open() because:
    //   1. On mobile, a new tab would lose the user's back navigation.
    //   2. Popup blockers may block window.open().
    //   3. Same-tab navigation is the expected behaviour for "open in browser".
    window.location.href = webAppUrl
  }, [product.id])

  // Download / install PWA — triggers the browser's "Add to Home Screen"
  // prompt if available. We listen for `beforeinstallprompt` in a useEffect
  // and capture the event so we can call prompt() here.
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null)
  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e)
    }
    window.addEventListener('beforeinstallprompt', onPrompt as EventListener)
    return () => window.removeEventListener('beforeinstallprompt', onPrompt as EventListener)
  }, [])

  const installApp = useCallback(async () => {
    // Track install attempt
    api
      .post('/api/share/track', {
        json: { shortId, eventType: 'install', platform: 'web' },
      })
      .catch(() => {})
    if (deferredPrompt) {
      deferredPrompt.prompt()
      try {
        await deferredPrompt.userChoice
      } catch {}
      setDeferredPrompt(null)
    } else {
      // No PWA prompt available — show a toast telling the user how to install.
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
      if (isIOS) {
        toast.info('Откройте в Safari', {
          description: 'Нажмите «Поделиться» → «На экран Домой», чтобы установить 999 — Три девятки.',
          duration: 6000,
        })
      } else {
        toast.info('Установка приложения', {
          description: 'Нажмите на иконку установки в адресной строке браузера.',
          duration: 6000,
        })
      }
    }
  }, [deferredPrompt, shortId])

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-sky-50 dark:from-slate-950 dark:via-slate-900 dark:to-blue-950">
      {/* Top brand bar — always visible, reinforces 999 — Три девятки identity */}
      <header className="sticky top-0 z-30 backdrop-blur-xl bg-white/80 dark:bg-slate-950/80 border-b border-slate-200/60 dark:border-slate-800/60">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <a
            href={appPublicUrl}
            className="flex items-center gap-2 group"
          >
            <div className="h-9 w-9 rounded-2xl bg-gradient-to-br from-sky-400 via-blue-500 to-violet-600 grid place-items-center text-white font-extrabold shadow-lg shadow-blue-500/30">
              9
            </div>
            <div className="leading-tight">
              <div className="text-base font-extrabold tracking-tight">999 <span className="font-light text-slate-500">— Три девятки</span></div>
              <div className="text-[10px] text-slate-500 -mt-0.5 hidden sm:block">Маркетплейс нового поколения</div>
            </div>
          </a>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setQrOpen(true)}
              className="hidden sm:inline-flex items-center gap-1.5 h-9 px-3 rounded-full bg-slate-100 dark:bg-slate-800 text-sm font-semibold hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
              aria-label="Показать QR-код"
            >
              <QrCode className="h-4 w-4" /> QR
            </button>
            {/* v24.3: REMOVED the "Поделиться" button from the header.
                The user opened this page via a shared link — re-sharing
                from this page is redundant. The floating mobile button
                below was also removed. Share is only accessible from the
                main app's product card now. */}
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6 md:py-10">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-10">
          {/* Gallery */}
          <div className="space-y-3">
            <div
              className="relative aspect-square rounded-3xl overflow-hidden bg-slate-100 dark:bg-slate-800 select-none"
              onTouchStart={(e) => { touchStartX.current = e.touches[0].clientX }}
              onTouchEnd={(e) => {
                if (product.images.length <= 1) return
                const dx = e.changedTouches[0].clientX - touchStartX.current
                if (dx < -50) setImgIndex((i) => (i + 1) % product.images.length)
                else if (dx > 50) setImgIndex((i) => (i - 1 + product.images.length) % product.images.length)
              }}
            >
              <div
                className="flex h-full transition-transform duration-300 ease-out"
                style={{ transform: `translateX(-${imgIndex * 100}%)` }}
              >
                {product.images.map((src, i) => (
                  <img
                    key={i}
                    src={assetUrl(src)}
                    alt={`${product.title} — фото ${i + 1}`}
                    className="h-full w-full object-cover shrink-0"
                    style={{ aspectRatio: '1 / 1' }}
                    decoding="async"
                    draggable={false}
                  />
                ))}
              </div>

              {product.images.length > 1 && (
                <>
                  <button
                    onClick={() => setImgIndex((i) => (i - 1 + product.images.length) % product.images.length)}
                    aria-label="Предыдущее фото"
                    className="absolute left-3 top-1/2 -translate-y-1/2 h-10 w-10 rounded-full bg-white/80 dark:bg-slate-900/80 backdrop-blur grid place-items-center hover:scale-105 active:scale-95 transition-transform shadow-lg"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  <button
                    onClick={() => setImgIndex((i) => (i + 1) % product.images.length)}
                    aria-label="Следующее фото"
                    className="absolute right-3 top-1/2 -translate-y-1/2 h-10 w-10 rounded-full bg-white/80 dark:bg-slate-900/80 backdrop-blur grid place-items-center hover:scale-105 active:scale-95 transition-transform shadow-lg"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </button>
                  <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
                    {product.images.map((_, i) => (
                      <button
                        key={i}
                        onClick={() => setImgIndex(i)}
                        aria-label={`Фото ${i + 1}`}
                        className={cn(
                          'h-1.5 rounded-full transition-all',
                          i === imgIndex ? 'w-6 bg-white' : 'w-1.5 bg-white/60',
                        )}
                      />
                    ))}
                  </div>
                </>
              )}

              {product.oldPrice && product.oldPrice > product.price && (
                <div className="absolute top-3 left-3 px-3 py-1.5 rounded-full bg-red-500 text-white text-xs font-bold shadow-lg">
                  -{Math.round(100 - (product.price / product.oldPrice) * 100)}%
                </div>
              )}
            </div>

            {/* Thumbnails — horizontal strip under the main image.
                Container has vertical padding (py-2) so the ring-2 and
                scale-105 effects are not clipped at the edges. */}
            {product.images.length > 1 && (
              <div className="flex gap-2.5 overflow-x-auto no-scrollbar px-0.5 py-2">
                {product.images.map((src, i) => (
                  <button
                    key={i}
                    onClick={() => setImgIndex(i)}
                    className={cn(
                      'shrink-0 h-16 w-16 rounded-xl overflow-hidden border-2 transition-all',
                      i === imgIndex
                        ? 'border-blue-500 ring-2 ring-blue-500/40 opacity-100 scale-105 shadow-md'
                        : 'border-transparent opacity-70 hover:opacity-100 hover:border-slate-300 dark:hover:border-slate-600',
                    )}
                  >
                    <img src={assetUrl(src)} alt={`${product.title} — фото ${i + 1}`} className="h-full w-full object-cover" loading="lazy" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Info */}
          <div className="flex flex-col gap-4">
            {product.category && (
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-gradient-to-r from-sky-400/15 to-violet-500/15 text-blue-600 dark:text-blue-300 text-xs font-semibold w-fit">
                <Store className="h-3 w-3" /> {product.category}
              </div>
            )}

            <h1 className="text-2xl md:text-3xl font-extrabold leading-tight tracking-tight">
              {product.title}
            </h1>

            {product.rating > 0 && (
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-0.5">
                  {[1, 2, 3, 4, 5].map((s) => (
                    <Star
                      key={s}
                      className={cn(
                        'h-4 w-4',
                        s <= Math.round(product.rating) ? 'fill-amber-400 text-amber-400' : 'text-slate-300 dark:text-slate-600',
                      )}
                    />
                  ))}
                </div>
                <span className="text-sm font-semibold">{product.rating.toFixed(1)}</span>
                <span className="text-sm text-slate-500">· {formatCompactNumber(product.reviewsCount)} отзывов</span>
              </div>
            )}

            <div className="flex items-baseline gap-3 flex-wrap">
              <span className="text-3xl md:text-4xl font-extrabold bg-gradient-to-r from-blue-600 to-violet-600 bg-clip-text text-transparent">
                {formatPrice(product.price, product.currency)}
              </span>
              {product.oldPrice && product.oldPrice > product.price && (
                <span className="text-lg text-slate-400 line-through">
                  {formatPrice(product.oldPrice, product.currency)}
                </span>
              )}
            </div>

            <div className="flex flex-wrap gap-2 text-xs">
              {product.inStock && (
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                  <Check className="h-3.5 w-3.5" /> В наличии
                </div>
              )}
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                <Truck className="h-3.5 w-3.5" /> Доставка 2–4 дня
              </div>
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                <Shield className="h-3.5 w-3.5" /> Гарантия 12 мес.
              </div>
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                <RefreshCw className="h-3.5 w-3.5" /> Возврат 14 дней
              </div>
            </div>

            {product.description && (
              <div className="pt-2">
                <h2 className="text-sm font-bold mb-1.5">Описание</h2>
                <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                  {product.description}
                </p>
              </div>
            )}

            {/* Specs */}
            <div className="pt-1">
              <h2 className="text-sm font-bold mb-1.5">Характеристики</h2>
              <div className="rounded-2xl bg-white/70 dark:bg-slate-900/70 backdrop-blur border border-slate-200/60 dark:border-slate-800/60 overflow-hidden divide-y divide-slate-200/40 dark:divide-slate-800/40">
                <SpecRow label="Категория" value={product.category || '—'} />
                <SpecRow label="Артикул" value={shortId.toUpperCase()} />
                <SpecRow label="Валюта" value={product.currency || 'RUB'} />
                <SpecRow label="Наличие" value={product.inStock ? 'В наличии' : 'Под заказ'} />
                <SpecRow label="Количество фото" value={String(product.images.length)} />
              </div>
            </div>

            {/* Primary CTAs */}
            <div className="pt-2 space-y-2.5">
              <button
                onClick={openInApp}
                className="w-full h-12 rounded-2xl bg-gradient-to-r from-blue-600 via-blue-600 to-violet-600 text-white font-bold shadow-lg shadow-blue-500/30 hover:shadow-xl hover:shadow-blue-500/40 transition-all hover:scale-[1.02] flex items-center justify-center gap-2"
              >
                <Smartphone className="h-5 w-5" />
                Открыть в приложении «Три девятки»
              </button>

              <div className="grid grid-cols-2 gap-2.5">
                <button
                  onClick={openProductInWebApp}
                  className="h-11 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-semibold hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors flex items-center justify-center gap-1.5"
                >
                  <ExternalLink className="h-4 w-4" />
                  Открыть в браузере
                </button>
                <button
                  onClick={installApp}
                  className="h-11 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-semibold hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors flex items-center justify-center gap-1.5"
                >
                  <Download className="h-4 w-4" />
                  Установить
                </button>
              </div>
            </div>

            {/* App promo block */}
            <div className="rounded-3xl bg-gradient-to-br from-sky-500 via-blue-600 to-violet-700 p-5 text-white relative overflow-hidden">
              <div className="absolute inset-0 opacity-20">
                <Sparkles className="absolute -top-4 -right-4 h-24 w-24" />
              </div>
              <div className="relative">
                <div className="flex items-center gap-2 mb-2">
                  <div className="h-7 w-7 rounded-xl bg-white/20 backdrop-blur grid place-items-center text-sm font-extrabold">9</div>
                  <div className="text-sm font-bold">999 — Три девятки</div>
                </div>
                <h3 className="text-lg font-extrabold leading-tight mb-1">
                  Тысячи товаров и услуг в одном приложении
                </h3>
                <p className="text-xs text-white/80 leading-relaxed mb-3">
                  {/* QW9 (F-DEAD-005): Feed removed, replaced by 999 CLUB */}
                  Программа лояльности 999 CLUB, живой чат, аудио- и видеозвонки, эксклюзивные акции и push-уведомления о новых поступлениях.
                </p>
                <button
                  onClick={installApp}
                  className="inline-flex items-center gap-1.5 h-9 px-4 rounded-full bg-white text-blue-700 text-xs font-bold hover:bg-white/90 transition-colors"
                >
                  <Download className="h-3.5 w-3.5" /> Скачать приложение
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Reviews */}
        {reviews.length > 0 && (
          <section className="mt-12">
            <h2 className="text-xl font-extrabold mb-4">Отзывы покупателей</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {reviews.map((r) => (
                <div
                  key={r.id}
                  className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800/60 p-4"
                >
                  <div className="flex items-center gap-3 mb-2">
                    <div className="h-9 w-9 rounded-full bg-gradient-to-br from-sky-400 to-violet-500 grid place-items-center text-white text-xs font-bold">
                      {(r.user?.displayName || r.user?.username || '?').slice(0, 1).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold truncate">
                        {r.user?.displayName || r.user?.username || 'Аноним'}
                      </div>
                      <div className="flex items-center gap-1 mt-0.5">
                        {[1, 2, 3, 4, 5].map((s) => (
                          <Star
                            key={s}
                            className={cn(
                              'h-3 w-3',
                              s <= r.rating ? 'fill-amber-400 text-amber-400' : 'text-slate-300 dark:text-slate-600',
                            )}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                  {r.title && <div className="text-sm font-semibold mb-1">{r.title}</div>}
                  {r.content && <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{r.content}</p>}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Related */}
        {related.length > 0 && (
          <section className="mt-12">
            <h2 className="text-xl font-extrabold mb-4">Похожие товары</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {related.map((p) => {
                // P-MED-002: removed unused `relShareUrl` declaration (dead
                // code — the actual link below uses appPublicUrl + ?product=
                // query, not the shortId path).
                return (
                  <a
                    key={p.id}
                    href={`${appPublicUrl}/?product=${encodeURIComponent(p.id)}`}
                    className="group rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800/60 overflow-hidden hover:shadow-lg transition-all hover:-translate-y-0.5"
                  >
                    <div className="aspect-square overflow-hidden bg-slate-100 dark:bg-slate-800">
                      {p.images?.[0] && (
                        <img
                          src={assetUrl(p.images[0])}
                          alt={p.title}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                          loading="lazy"
                        />
                      )}
                    </div>
                    <div className="p-3">
                      <div className="text-xs font-semibold truncate leading-tight">{p.title}</div>
                      <div className="text-sm font-bold text-blue-600 dark:text-blue-400 mt-1">
                        {formatPrice(p.price, p.currency)}
                      </div>
                    </div>
                  </a>
                )
              })}
            </div>
          </section>
        )}

        {/* Share stats — visible to everyone, social proof */}
        {(stats.shares > 0 || stats.opens > 0) && (
          <section className="mt-12">
            <div className="rounded-2xl bg-slate-100 dark:bg-slate-800/50 p-4 text-center">
              <div className="text-xs text-slate-500 mb-1">Этим товаром уже поделились</div>
              <div className="text-2xl font-extrabold">{formatCompactNumber(stats.shares)} раз</div>
              <div className="text-xs text-slate-500 mt-1">и просмотрели {formatCompactNumber(stats.opens)} раз</div>
            </div>
          </section>
        )}
      </main>

      {/* Footer */}
      <footer className="mt-16 border-t border-slate-200/60 dark:border-slate-800/60 py-8">
        <div className="max-w-5xl mx-auto px-4 text-center">
          <div className="flex items-center justify-center gap-2 mb-2">
            <div className="h-7 w-7 rounded-xl bg-gradient-to-br from-sky-400 via-blue-500 to-violet-600 grid place-items-center text-white text-xs font-extrabold">9</div>
            <span className="font-extrabold">999 <span className="font-light text-slate-500">— Три девятки</span></span>
          </div>
          <p className="text-xs text-slate-500">Маркетплейс нового поколения · © 999 — Три девятки</p>
        </div>
      </footer>

      {/* v24.3: REMOVED the floating mobile share button.
          The user opened this page via a shared link — re-sharing is
          redundant. Both share buttons (header + floating) were removed. */}

      {/* Modals */}
      <AnimatePresence>
        {shareOpen && (
          <SmartShareSheet
            open={shareOpen}
            onClose={() => setShareOpen(false)}
            product={product}
            shareUrl={shareUrl}
            deepLinkUrl={deepLinkUrl}
            shortId={shortId}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {qrOpen && (
          <QrModal
            open={qrOpen}
            onClose={() => setQrOpen(false)}
            url={deepLinkUrl}
            title={product.title}
            shortId={shortId}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

function SpecRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5">
      <span className="text-sm text-slate-500">{label}</span>
      <span className="text-sm font-semibold text-right">{value}</span>
    </div>
  )
}
