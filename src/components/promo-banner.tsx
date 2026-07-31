'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { api, assetUrl } from '@/lib/api'
import type { Banner } from '@/lib/types'
import { cn } from '@/lib/utils'
// QW10 (F-DUP-001): extracted to shared module
import { gradientCss } from '@/lib/banner-gradients'
import { usePullToRefreshSubscription } from './pull-to-refresh'

export function PromoBannerCarousel() {
  const [banners, setBanners] = useState<Banner[]>([])
  const [loading, setLoading] = useState(true)
  const [index, setIndex] = useState(0)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const autoRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Fetch banners from /api/banners (returns only active ones, ordered by `order`)
  const fetchBanners = useCallback(async () => {
    setLoading(true)
    try {
      const d = await api.get<{ items: Banner[] }>('/api/banners')
      setBanners(d.items)
    } catch {
      /* keep existing banners on transient error */
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchBanners()
  }, [fetchBanners])

  // v12.6: Pull To Refresh subscription — refetch banners.
  usePullToRefreshSubscription(fetchBanners, [fetchBanners])

  // v16.5: Instant refresh — when Studio saves banners, refetch immediately.
  useEffect(() => {
    const onBannersChanged = () => fetchBanners()
    window.addEventListener('999pro:banners-changed', onBannersChanged as EventListener)
    return () => window.removeEventListener('999pro:banners-changed', onBannersChanged as EventListener)
  }, [fetchBanners])

  const scrollTo = (i: number) => {
    const el = scrollerRef.current
    if (!el || !banners.length) return
    const next = (i + banners.length) % banners.length
    el.scrollTo({ left: el.clientWidth * next, behavior: 'smooth' })
    setIndex(next)
  }

  // Autoplay
  useEffect(() => {
    if (!banners.length) return
    autoRef.current = setInterval(() => scrollTo(index + 1), 5000)
    return () => {
      if (autoRef.current) clearInterval(autoRef.current)
    }
  }, [index, banners.length])

  const onScroll = () => {
    const el = scrollerRef.current
    if (!el) return
    const i = Math.round(el.scrollLeft / el.clientWidth)
    if (i !== index) setIndex(i)
  }

  if (loading) {
    return (
      <section aria-label="Промо-баннеры" className="py-2">
        <div className="px-4 md:px-6">
          <div className="h-44 sm:h-52 md:h-64 rounded-3xl skeleton" />
        </div>
      </section>
    )
  }

  if (!banners.length) return null

  // v18.11: Banner CTA button handler — determines the action by the button text.
  // Previously, buttons without a `link` just switched to the next slide (useless).
  // Now we match the CTA text against known keywords and navigate to the
  // corresponding view via the global 'navigate' window event (handled by page.tsx).
  // Supported CTA keywords (case-insensitive, substring match):
  //   "каталог" / "смотреть" / "выбрать" / "товары" / "покупать" → catalog
  //   "чат" / "написать" / "связаться"                            → chat
  //   "профиль" / "кабинет" / "аккаунт"                            → profile
  //   "заказ" / "заказы" / "история"                               → orders
  //   "club" / "клуб" / "бонусы"                                   → club
  //   "media" / "музыка" / "фильмы" / "видео"                      → media-hub
  //   "поиск" / "найти"                                            → search
  // If no keyword matches, fall back to catalog (most common intent).
  const handleCtaClick = (cta: string) => {
    const text = (cta || '').toLowerCase().trim()
    const navigate = (view: string) => {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('navigate', { detail: { view } }))
      }
    }
    if (/каталог|смотреть|выбрать|товар|покупа|смотрет|магазин/.test(text)) {
      navigate('catalog')
    } else if (/чат|написать|связаться|сообщен/.test(text)) {
      navigate('chat')
    } else if (/профиль|кабинет|аккаунт|войти/.test(text)) {
      navigate('profile')
    } else if (/заказ|история/.test(text)) {
      navigate('orders')
    } else if (/club|клуб|бонус/.test(text)) {
      navigate('club')
    } else if (/media|музык|фильм|видео|ауди/.test(text)) {
      navigate('media-hub')
    } else if (/поиск|найти/.test(text)) {
      navigate('search')
    } else {
      // Default — open catalog (most banners promote products).
      navigate('catalog')
    }
  }

  return (
    <section aria-label="Промо-баннеры" className="py-2">
      <div
        ref={scrollerRef}
        onScroll={onScroll}
        className="no-scrollbar smooth-x flex overflow-x-auto snap-x snap-mandatory"
      >
        {banners.map((b, i) => {
          // v12.6.4: image-only mode — just the image, no text/overlay.
          const isImageOnly = b.mode === 'image-only'
          const fit = b.objectFit === 'contain' ? 'object-contain' : 'object-cover'
          return (
            <div
              key={b.id}
              className="shrink-0 w-full px-4 md:px-6 snap-center"
              style={{ scrollSnapStop: 'always' }}
            >
              <div
                className="relative h-44 sm:h-52 md:h-64 rounded-3xl overflow-hidden"
                style={
                  !isImageOnly && b.useGradient
                    ? { backgroundImage: gradientCss(b.gradient) }
                    : undefined
                }
              >
                {/* Background image — v12.6.4: respects objectFit (cover/contain) */}
                {b.image && (
                  <img
                    src={assetUrl(b.image)}
                    alt=""
                    className={cn(
                      'absolute inset-0 h-full w-full',
                      fit,
                      // Legacy overlay style when gradient is on; raw image when off.
                      !isImageOnly && b.useGradient
                        ? 'opacity-40 mix-blend-overlay'
                        : 'opacity-100',
                    )}
                    loading={i === 0 ? 'eager' : 'lazy'}
                  />
                )}
                {/* Decorative blobs (gradient mode only, image-text mode only) */}
                {!isImageOnly && b.useGradient && (
                  <>
                    <div className="absolute -top-12 -right-12 h-44 w-44 rounded-full bg-white/20 blur-2xl" />
                    <div className="absolute -bottom-10 -left-10 h-40 w-40 rounded-full bg-black/10 blur-2xl" />
                  </>
                )}
                {/* Dark gradient overlay for text legibility on raw images */}
                {!isImageOnly && !b.useGradient && (
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/25 to-transparent" />
                )}

                {/* Content — v12.6.4: only rendered in image-text mode AND only
                    if at least one text field is non-empty. No empty blocks. */}
                {!isImageOnly && (b.title || b.subtitle || b.cta) && (
                  <div className="relative h-full p-6 md:p-8 flex flex-col justify-between text-white">
                    <div className="space-y-1.5 max-w-[70%]">
                      {b.title && (
                        <h3 className="text-2xl md:text-3xl font-extrabold tracking-tight leading-tight drop-shadow-sm">
                          {b.title}
                        </h3>
                      )}
                      {b.subtitle && (
                        <p className="text-sm md:text-base text-white/90">{b.subtitle}</p>
                      )}
                    </div>
                    {b.cta && (
                      <div>
                        {b.link ? (
                          <a
                            href={b.link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-block px-5 py-2.5 rounded-full bg-white text-slate-900 text-sm font-semibold shadow-lg hover:scale-105 active:scale-95 transition-transform"
                          >
                            {b.cta}
                          </a>
                        ) : (
                          <button
                            className="px-5 py-2.5 rounded-full bg-white text-slate-900 text-sm font-semibold shadow-lg hover:scale-105 active:scale-95 transition-transform"
                            onClick={() => handleCtaClick(b.cta || '')}
                          >
                            {b.cta}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Dots */}
      <div className="flex justify-center gap-1.5 mt-3">
        {banners.map((b, i) => (
          <button
            key={b.id}
            onClick={() => scrollTo(i)}
            aria-label={`Слайд ${i + 1}`}
            className={cn(
              'h-1.5 rounded-full transition-all',
              i === index ? 'w-6 bg-primary' : 'w-1.5 bg-muted-foreground/40',
            )}
          />
        ))}
      </div>
    </section>
  )
}
