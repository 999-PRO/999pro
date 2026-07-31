'use client'

// ============================================================================
//  ShareAnalyticsView — Studio admin view for Smart Share analytics.
//  ----------------------------------------------------------------------------
//  Shows:
//    • Totals (shares, opens, app opens, installs, orders)
//    • Top shared products (with click-through to product page)
//    • Per-platform breakdown (WhatsApp, Telegram, etc.)
//    • Recent events feed
// ============================================================================

import { useEffect, useState, useCallback } from 'react'
import { api, assetUrl } from '@/lib/api'
import type { ShareAnalytics } from '@999pro/shared'
import {
  Share2, Eye, Smartphone, Download, ShoppingBag,
  MessageCircle, Send, Facebook, Instagram, Twitter, Mail, Link2, QrCode,
  TrendingUp, ExternalLink,
} from 'lucide-react'
import { cn, formatCompactNumber, formatPrice } from '@/lib/utils'
import type { LucideIcon } from 'lucide-react'

const PLATFORM_ICONS: Record<string, LucideIcon> = {
  whatsapp: MessageCircle,
  telegram: Send,
  facebook: Facebook,
  instagram: Instagram,
  x: Twitter,
  email: Mail,
  copy: Link2,
  qrcode: QrCode,
  vk: MessageCircle,
  messenger: MessageCircle,
  unknown: Share2,
  web: Eye,
  'in-app': Smartphone,
}

const PLATFORM_COLORS: Record<string, string> = {
  whatsapp: 'text-emerald-500',
  telegram: 'text-sky-500',
  facebook: 'text-blue-600',
  instagram: 'text-pink-500',
  x: 'text-slate-900 dark:text-white',
  email: 'text-slate-600',
  copy: 'text-slate-600',
  qrcode: 'text-slate-900 dark:text-white',
  vk: 'text-blue-500',
  messenger: 'text-violet-500',
  unknown: 'text-slate-500',
  web: 'text-slate-500',
  'in-app': 'text-blue-500',
}

interface StatCard {
  key: keyof ShareAnalytics['totals']
  label: string
  icon: LucideIcon
  color: string
  gradient: string
}

const STAT_CARDS: StatCard[] = [
  { key: 'shares', label: 'Поделились', icon: Share2, color: 'text-sky-500', gradient: 'from-sky-400/20 to-blue-500/10' },
  { key: 'opens', label: 'Открыли ссылку', icon: Eye, color: 'text-violet-500', gradient: 'from-violet-400/20 to-purple-500/10' },
  { key: 'appOpens', label: 'Открыли в приложении', icon: Smartphone, color: 'text-fuchsia-500', gradient: 'from-fuchsia-400/20 to-pink-500/10' },
  { key: 'installs', label: 'Установок приложения', icon: Download, color: 'text-emerald-500', gradient: 'from-emerald-400/20 to-teal-500/10' },
  { key: 'orders', label: 'Заказов после share', icon: ShoppingBag, color: 'text-amber-500', gradient: 'from-amber-400/20 to-orange-500/10' },
]

export function ShareAnalyticsView() {
  const [data, setData] = useState<ShareAnalytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(() => {
    setLoading(true)
    setError(null)
    api
      .get<ShareAnalytics>('/api/share/analytics', { auth: true })
      .then(setData)
      .catch((e: unknown) => {
        const msg = e instanceof Error ? (e instanceof Error ? e.message : String(e)) : 'Не удалось загрузить аналитику'
        setError(msg)
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return (
    <div className="px-4 md:px-6 py-6 pb-28 page-top-padding">
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-gradient-to-r from-sky-400/15 to-violet-500/15 text-blue-600 dark:text-blue-300 text-xs font-semibold mb-2">
            <Share2 className="h-3 w-3" /> Smart Share
          </div>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">Аналитика шеринг</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Сколько раз товарами делились, открывали ссылки, устанавливали приложение и делали заказы после перехода.
          </p>
        </div>
      </div>

      {error ? (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6 text-center">
          <p className="text-destructive font-semibold mb-2">⚠ Ошибка загрузки</p>
          <p className="text-sm text-muted-foreground mb-4">{error}</p>
          <button
            onClick={refresh}
            className="inline-flex items-center justify-center h-10 px-5 rounded-full gradient-brand text-white font-semibold text-sm hover:opacity-90"
          >
            Повторить
          </button>
        </div>
      ) : loading || !data ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-28 rounded-2xl skeleton" />
          ))}
        </div>
      ) : (
        <>
          {/* Totals */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            {STAT_CARDS.map((s, i) => {
              const Icon = s.icon
              const value = data.totals[s.key] || 0
              return (
                <div
                  key={s.key}
                  className="relative rounded-2xl glass p-4 overflow-hidden animate-fade-in-up"
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

          {/* Conversion rate */}
          {data.totals.opens > 0 && (
            <div className="mt-4 rounded-2xl glass p-4 flex items-center gap-4">
              <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-emerald-400 to-teal-500 grid place-items-center text-white">
                <TrendingUp className="h-6 w-6" />
              </div>
              <div className="flex-1">
                <div className="text-sm font-semibold">Конверсия в заказ</div>
                <div className="text-xs text-muted-foreground">
                  Из {formatCompactNumber(data.totals.opens)} открытий ссылки → {formatCompactNumber(data.totals.orders)} заказов
                </div>
              </div>
              <div className="text-2xl font-extrabold text-emerald-500">
                {((data.totals.orders / data.totals.opens) * 100).toFixed(1)}%
              </div>
            </div>
          )}

          <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Top shared products */}
            <div>
              <h2 className="text-lg font-bold mb-3">Топ товаров по шерингу</h2>
              <div className="space-y-2">
                {data.topProducts.length === 0 ? (
                  <div className="rounded-2xl glass p-6 text-center text-sm text-muted-foreground">
                    Пока никто не поделился товарами. Откройте товар в приложении и нажмите «Поделиться».
                  </div>
                ) : (
                  data.topProducts.map((p, i) => (
                    <div
                      key={p.productId}
                      className="rounded-2xl glass p-3 flex items-center gap-3"
                    >
                      <div className="text-sm font-bold text-muted-foreground w-6">#{i + 1}</div>
                      {p.image ? (
                        <img
                          // v13.2 (audit P1-15 fix): use assetUrl() for
                          // consistency with other managers. Currently a
                          // no-op but future-proofs against CDN/basePath changes.
                          src={assetUrl(p.image)}
                          alt={p.title}
                          className="h-12 w-12 rounded-xl object-cover shrink-0"
                        />
                      ) : (
                        <div className="h-12 w-12 rounded-xl bg-muted grid place-items-center text-muted-foreground shrink-0">
                          <ShoppingBag className="h-5 w-5" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold truncate">{p.title}</div>
                        <div className="text-xs text-muted-foreground">
                          {formatPrice(p.price, p.currency)} · {formatCompactNumber(p.shares)} шеринг · {formatCompactNumber(p.opens)} открытий
                        </div>
                      </div>
                      <a
                        href={`${process.env.NEXT_PUBLIC_APP_URL || ''}/p/${p.shortId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 h-9 w-9 rounded-full bg-muted grid place-items-center hover:bg-accent transition-colors"
                        aria-label="Открыть share page"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* By platform */}
            <div>
              <h2 className="text-lg font-bold mb-3">По платформам</h2>
              <div className="space-y-2">
                {data.byPlatform.length === 0 ? (
                  <div className="rounded-2xl glass p-6 text-center text-sm text-muted-foreground">
                    Нет данных по платформам.
                  </div>
                ) : (
                  data.byPlatform.map((p) => {
                    const Icon = PLATFORM_ICONS[p.platform] || Share2
                    const color = PLATFORM_COLORS[p.platform] || 'text-slate-500'
                    const total = data.totals.shares || 1
                    const pct = (p.shares / total) * 100
                    return (
                      <div key={p.platform} className="rounded-2xl glass p-3">
                        <div className="flex items-center gap-3 mb-2">
                          <div className={cn('h-9 w-9 rounded-xl bg-background/60 grid place-items-center', color)}>
                            <Icon className="h-5 w-5" />
                          </div>
                          <div className="flex-1">
                            <div className="text-sm font-semibold capitalize">{p.platform}</div>
                            <div className="text-xs text-muted-foreground">{formatCompactNumber(p.shares)} раз</div>
                          </div>
                          <div className="text-sm font-bold">{pct.toFixed(1)}%</div>
                        </div>
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-sky-500 to-violet-600 transition-all"
                            style={{ width: `${Math.max(pct, 2)}%` }}
                          />
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          </div>

          {/* Recent events */}
          <div className="mt-6">
            <h2 className="text-lg font-bold mb-3">Последние события</h2>
            <div className="rounded-2xl glass overflow-hidden divide-y divide-border/30">
              {data.recentEvents.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  Событий пока нет.
                </div>
              ) : (
                data.recentEvents.map((e) => {
                  const Icon = PLATFORM_ICONS[e.platform] || Share2
                  const color = PLATFORM_COLORS[e.platform] || 'text-slate-500'
                  const eventLabels: Record<string, string> = {
                    share: 'Поделился',
                    open: 'Открыл ссылку',
                    app_open: 'Открыл в приложении',
                    install: 'Установил приложение',
                    order: 'Сделал заказ',
                  }
                  return (
                    <div key={e.id} className="p-3 flex items-center gap-3">
                      <div className={cn('h-8 w-8 rounded-lg bg-background/60 grid place-items-center', color)}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm">
                          <span className="font-semibold">{eventLabels[e.eventType] || e.eventType}</span>
                          {e.productTitle && (
                            <>
                              {' · '}
                              <span className="text-muted-foreground truncate">{e.productTitle}</span>
                            </>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {new Date(e.createdAt).toLocaleString('ru-RU', {
                            day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                          })} · {e.platform}
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
