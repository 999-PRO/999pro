'use client'

import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import { assetUrl } from '@/lib/api'
import type { MobileHeroBlockSetting, HeroButton } from '@/lib/types'
import { cn } from '@/lib/utils'
import { haptic } from '@/lib/haptic'
import { useScrollParallax } from '@/lib/use-scroll-parallax'

// v25.22 (owner): «не вижу, чтобы несколько фотографий менялись; нет
// параллакса». Добавлено:
//  • ПАРАЛЛАКС при скролле — медиа-слой плавно смещается (scale 1.14);
//  • счётчик «n / N» рядом с точками — смену кадров сразу видно;
//  • точки-индикаторы стали кнопками (листается вручную).

// ============================================================================
//  v25.21 — HeroMobileBanner: ОТДЕЛЬНЫЙ мобильный hero размером «как баннер».
//
//  Владелец: «на десктопе Hairblock чётко, на мобильном он слишком большой.
//  Хочу на мобиле отдельный hero в размере баннеров — картинки, видео,
//  кнопки; без кнопки тоже можно».
//
//  Что это:
//   • Компактная карточка-баннер (высота 176px — между плиткой категории и
//     промо-баннером каталога), рендерится ТОЛЬКО на мобиле (md:hidden).
//   • Медиа-карусель: изображения (вкл. GIF «как есть») и видео (autoplay
//     muted loop) вперемешку — тип определяется по расширению файла.
//   • Тексты и кнопки полностью опциональны: нет ни текста, ни кнопок —
//     чистый медийный баннер; есть — аккуратный скрим + компактный контент.
//   • Кнопки: основная (градиент) + вторичная (стекло), view → внутренняя
//     навигация, link → внешняя вкладка.
// ============================================================================

type BannerSlide = { kind: 'image' | 'gif' | 'video'; url: string }
const isVideoUrl = (u: string) => /\.(mp4|webm|mov|m4v)(\?|$)/i.test(u)
const isGifUrl = (u: string) => /\.gif(\?|$)/i.test(u)

const ROTATE_MS = 7000

export function HeroMobileBanner({
  data,
  onNavigate,
}: {
  data: MobileHeroBlockSetting
  onNavigate: (v: string) => void
}) {
  const slides: BannerSlide[] = (data.media || [])
    .filter(Boolean)
    .map((url) => ({
      kind: isVideoUrl(url) ? 'video' : isGifUrl(url) ? 'gif' : 'image',
      url,
    }))

  const [idx, setIdx] = useState(0)
  const touchX = useRef<number | null>(null)
  // v25.22: параллакс медиа-слоя при скролле страницы.
  const { ref: parallaxRef, style: parallaxStyle } = useScrollParallax(true)

  // Автосмена слайдов (видео тоже участвует — баннер лёгкий, до 10 файлов).
  useEffect(() => {
    if (slides.length <= 1) return
    const id = setInterval(() => setIdx((p) => (p + 1) % slides.length), ROTATE_MS)
    return () => clearInterval(id)
  }, [slides.length])

  if (slides.length === 0) return null

  const hasText = !!(data.badge || data.title || data.description)
  const hasButtons = !!(data.primaryButton || data.secondaryButton)

  const runButton = (btn: HeroButton | null) => {
    haptic.tap()
    if (!btn) return
    if (btn.view) onNavigate(btn.view)
    else if (btn.link) window.open(btn.link, '_blank', 'noopener,noreferrer')
  }

  return (
    <section className="pt-1 pb-1" aria-label="Акция">
      <div
        className="relative h-[176px] rounded-[20px] overflow-hidden select-none"
        style={{
          background: 'linear-gradient(135deg, #FFE4EC 0%, #F3E8FF 55%, #E0F2FE 100%)',
          boxShadow: '0 20px 44px -26px rgba(160,32,112,0.45), inset 0 1px 0 rgba(255,255,255,0.6)',
        }}
        onTouchStart={(e) => { touchX.current = e.touches[0].clientX }}
        onTouchEnd={(e) => {
          if (touchX.current == null || slides.length <= 1) return
          const dx = e.changedTouches[0].clientX - touchX.current
          touchX.current = null
          if (Math.abs(dx) > 42) {
            haptic.select()
            setIdx((p) => (p + (dx < 0 ? 1 : -1) + slides.length) % slides.length)
          }
        }}
      >
        {/* ── медиа-слои (внутри параллакс-обёртки, v25.22) ── */}
        <div ref={parallaxRef} className="absolute inset-0">
          <div className="absolute inset-0" style={parallaxStyle}>
            {slides.map((s, i) => {
              if (s.kind === 'video') {
                if (i !== idx) return null
                return (
                  <video
                    key={`${s.url}-${i}`}
                    src={assetUrl(s.url)}
                    autoPlay
                    muted
                    loop
                    playsInline
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                )
              }
              return (
                <div
                  key={`${s.url}-${i}`}
                  className="absolute inset-0 transition-opacity duration-[900ms] ease-in-out"
                  style={{ opacity: i === idx ? 1 : 0 }}
                >
                  {s.kind === 'gif' ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={assetUrl(s.url)} alt="" className="h-full w-full object-cover" draggable={false} />
                  ) : (
                    <Image
                      src={assetUrl(s.url)}
                      alt=""
                      fill
                      priority={i === 0}
                      sizes="100vw"
                      className="object-cover"
                    />
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* ── скрим под контент (только если есть что показывать) ── */}
        {(hasText || hasButtons) && (
          <>
            <div
              aria-hidden
              className="absolute inset-0"
              style={{
                background: hasButtons
                  ? 'linear-gradient(to top, rgba(8,10,22,0.82) 0%, rgba(8,10,22,0.38) 52%, transparent 82%)'
                  : 'linear-gradient(to top, rgba(8,10,22,0.72) 0%, rgba(8,10,22,0.25) 55%, transparent 85%)',
              }}
            />
            <div className="absolute inset-x-0 bottom-0 z-10 p-3.5 text-white">
              {data.badge && (
                <span className="inline-flex items-center rounded-full bg-white/16 backdrop-blur-md ring-1 ring-white/25 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] mb-1.5">
                  {data.badge}
                </span>
              )}
              {data.title && (
                <h2 className={cn('font-extrabold tracking-tight leading-tight', hasButtons ? 'text-[17px]' : 'text-lg')}>
                  {data.title}
                </h2>
              )}
              {data.description && (
                <p className="text-[11.5px] leading-snug text-white/78 line-clamp-2 mt-0.5 max-w-[94%]">
                  {data.description}
                </p>
              )}
              {hasButtons && (
                <div className="flex gap-2 mt-2.5">
                  {data.primaryButton && (
                    <button
                      onClick={() => runButton(data.primaryButton)}
                      className="h-9 px-4 rounded-full gradient-brand text-white text-[12.5px] font-bold grid place-items-center shadow-[0_8px_20px_-8px_rgba(160,32,112,0.7)] active:scale-95 transition-transform"
                    >
                      {data.primaryButton.text || 'Подробнее'}
                    </button>
                  )}
                  {data.secondaryButton && (
                    <button
                      onClick={() => runButton(data.secondaryButton)}
                      className="h-9 px-4 rounded-full bg-white/14 backdrop-blur-md ring-1 ring-white/25 text-white text-[12.5px] font-semibold grid place-items-center active:scale-95 transition-transform"
                    >
                      {data.secondaryButton.text || 'Открыть'}
                    </button>
                  )}
                </div>
              )}
            </div>
          </>
        )}

        {/* ── точки-слайды (если медиа больше одного) — теперь кнопки ── */}
        {slides.length > 1 && (
          <div className="absolute top-2.5 right-3 z-20 flex items-center gap-1">
            {slides.map((_, i) => (
              <button
                key={i}
                aria-label={`Слайд ${i + 1}`}
                onClick={(e) => { e.stopPropagation(); haptic.select(); setIdx(i) }}
                className={cn(
                  'h-1.5 rounded-full transition-all duration-400',
                  i === idx ? 'w-4 bg-white/95 shadow-[0_1px_5px_rgba(0,0,0,0.4)]' : 'w-1.5 bg-white/55',
                )}
              />
            ))}
            <span className="ml-1 text-[9px] font-bold text-white/85 tabular-nums drop-shadow-[0_1px_3px_rgba(0,0,0,0.6)]">
              {idx + 1}/{slides.length}
            </span>
          </div>
        )}
      </div>
    </section>
  )
}
