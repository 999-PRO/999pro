'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import Image from 'next/image'
import { api, assetUrl } from '@/lib/api'
import type { HeroBlockSetting, MobileHeroBlockSetting } from '@/lib/types'
import { Sparkles, ArrowRight, Truck, ShieldCheck, Box } from 'lucide-react'
import { cn } from '@/lib/utils'
import { usePullToRefreshSubscription } from '../pull-to-refresh'
import { HeroMobileBanner } from './hero-mobile-banner'
import { useScrollParallax } from '@/lib/use-scroll-parallax'
import { useIsDesktop } from '@/lib/use-media-query'

// v25.13 (premium hero redesign): dynamic multi-image hero with:
//   • Crossfade transition between images (8-10s interval)
//   • Subtle Ken Burns zoom-pan effect per image
//   • 3D tilt + parallax on mouse move (desktop only)
//   • Correct brand text "Реклама • Мебель • Подарки"
//   • AI badge "ИИ-агент TRI999" — clickable, opens existing AI assistant
//   • Single-image fallback: no carousel if only one image
//   • Mobile: no tilt/parallax (touch-friendly), crossfade still works
//
// The hero is rendered as a 2-column editorial layout on desktop (text left,
// visual right) and single-column on mobile (visual top, text below).
//
// v25.17 MOBILE REDESIGN (owner: «именно на мобильной версии хедер-блок
// как-то не очень красиво выглядит»): раньше на телефоне рендерилась
// уменьшенная копия десктопной схемы (фото сверху, под ним большой H1,
// описание, 2 кнопки, фичи) — блок занимал пол-экрана и выглядел грубо.
// Теперь на мобиле это ОДНА цельная карточка-обложка: фото-карусель на весь
// блок, весь контент (бейдж ИИ, заголовок, описание, CTA) лежит ПОВЕРХ
// снимка на мягком градиентном скриме — как обложка в премиум-маркетплейсах.
// Десктопная 2-колоночная схема не тронута.
//
// v25.21 (owner): «на десктопе hero чётко, на мобильном слишком большой —
// сделай отдельно размером как баннеры; и добавь в hero видео/GIF»:
//   • Слайды hero = [...images (вкл. GIF), ...videos]. Активное видео —
//     autoplay muted loop, GIF рендерится «как есть» (без next/image-оптимизации).
//   • Если в Студии заполнен «Мобильный hero» (mobileHeroBlock) — на телефоне
//     рендерится КОМПАКТНЫЙ БАННЕР (hero-mobile-banner.tsx) вместо большой
//     карточки; десктоп не меняется вовсе.
//
// v25.22 (owner): «при заходе сначала появляется СТАРЫЙ большой хедер-блок,
//   потом исчезает и заменяется новым» — исправлено:
//   1) heroBlock + mobileHeroBlock кешируются в localStorage и подставляются
//      МГНОВЕННО при следующем открытии (сеть лишь обновляет);
//   2) скелетон загрузки на телефоне теперь размером с БАННЕР — никакого
//      «старого блока» нет даже на первой загрузке без кеша;
//   3) добавлен ПАРАЛЛАКС на мобиле: медиа-слой плавно смещается при скролле;
//   4) автосмена слайдов 9с → 7с — смену фото реально видно.

const DEFAULT_HERO: HeroBlockSetting = {
  enabled: true,
  useGradient: true,
  image: null,
  images: [],
  videos: [],
  gradient: 'from-sky-400 via-blue-500 to-indigo-600',
  badge: null,
  // v25.13: serious business text instead of "Бутик рекламы, подарков и мебели".
  // Reflects the actual business: рекламная продукция + мебель + подарки.
  title: 'Реклама • Мебель • Подарки',
  description: 'Рекламная продукция, мебель и подарки с доставкой по России. Каталог, чат с продавцом, заявки и оформление заказа в пару кликов.',
  primaryButton: { text: 'В каталог', view: 'catalog', link: null },
  secondaryButton: { text: '🎬 Видео-лента', view: null, link: null },
  objectFit: 'cover',
  mode: 'image-text',
}

interface HeroEditorialProps {
  onNavigate: (v: string) => void
}

// Hook: smooth 3D tilt + parallax based on mouse position.
// Returns ref to attach to the tilt container + transform style.
// Disabled on touch devices (no mousemove events fire).
interface TiltState {
  rotateX: number
  rotateY: number
  // Inner-element parallax offsets (subtle — px units)
  px: number
  py: number
}
const IDLE_TILT: TiltState = { rotateX: 0, rotateY: 0, px: 0, py: 0 }

function useTiltHover() {
  const [tilt, setTilt] = useState<TiltState>(IDLE_TILT)
  const rafRef = useRef<number | null>(null)

  const onMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    // Skip on touch — touchmove doesn't fire mousemove reliably, but
    // some hybrid devices emit both. We disable when pointerType !== 'mouse'.
    if ((e as any).pointerType && (e as any).pointerType !== 'mouse') return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width  // 0..1
    const y = (e.clientY - rect.top) / rect.height   // 0..1
    // Map to -0.5..0.5 for centered tilt
    const cx = x - 0.5
    const cy = y - 0.5
    // Max tilt = 4° (very subtle, premium-feel). Max parallax = 6px.
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => {
      setTilt({
        rotateX: -cy * 4,         // tilt around X axis (up/down)
        rotateY: cx * 4,          // tilt around Y axis (left/right)
        px: cx * 6,               // parallax X (inner elements move slightly)
        py: cy * 6,               // parallax Y
      })
    })
  }, [])

  const onLeave = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    // Smooth return to idle via rAF interpolation
    let frame = 0
    const target = IDLE_TILT
    setTilt((prev) => {
      const animate = () => {
        frame++
        const t = Math.min(1, frame / 12) // 12 frames ≈ 200ms at 60fps
        const ease = 1 - Math.pow(1 - t, 3) // easeOutCubic
        setTilt({
          rotateX: prev.rotateX + (target.rotateX - prev.rotateX) * ease,
          rotateY: prev.rotateY + (target.rotateY - prev.rotateY) * ease,
          px: prev.px + (target.px - prev.px) * ease,
          py: prev.py + (target.py - prev.py) * ease,
        })
        if (t < 1) requestAnimationFrame(animate)
      }
      requestAnimationFrame(animate)
      return prev // don't change here — animate will set
    })
  }, [])

  // Cleanup
  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }, [])

  return { tilt, onMove, onLeave }
}

// Hook: auto-rotate through images array every ~7s (v25.22: было 9с —
// владелец «не видит, чтобы картинки менялись»). Skipped if only one image.
function useImageRotation(total: number, enabled: boolean) {
  const [idx, setIdx] = useState(0)
  useEffect(() => {
    if (!enabled || total <= 1) return
    const id = setInterval(() => {
      setIdx((prev) => (prev + 1) % total)
    }, 7000)
    return () => clearInterval(id)
  }, [total, enabled])
  return idx
}

// v25.22: мгновенный кеш настроек hero — убирает «мигание старого блока».
const HERO_CACHE_KEY = '999pro-hero-block'
const MOBILE_HERO_CACHE_KEY = '999pro-mobile-hero-block'
function readCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as T) : null
  } catch { return null }
}
function writeCache(key: string, value: unknown) {
  try {
    if (value && typeof value === 'object') localStorage.setItem(key, JSON.stringify(value))
    else localStorage.removeItem(key)
  } catch {}
}

// v25.22: ПАРАЛЛАКС перенесён в lib/use-scroll-parallax.ts (общий с hero-mobile-banner).

type HeroSlide = { kind: 'image' | 'gif' | 'video'; url: string }
const isVideoUrl = (u: string) => /\.(mp4|webm|mov|m4v)(\?|$)/i.test(u)
const isGifUrl = (u: string) => /\.gif(\?|$)/i.test(u)

export function HeroEditorial({ onNavigate }: HeroEditorialProps) {
  const [hero, setHero] = useState<HeroBlockSetting | null>(null)
  // v25.21: отдельная настройка мобильного баннера.
  const [mobileHero, setMobileHero] = useState<MobileHeroBlockSetting | null>(null)
  const { tilt, onMove, onLeave } = useTiltHover()
  // v25.22: параллакс медиа при скролле — только на мобиле (на десктопе tilt).
  const isDesktop = useIsDesktop()
  const { ref: parallaxRef, style: parallaxStyle } = useScrollParallax(!isDesktop)

  const fetchHero = useCallback(async () => {
    try {
      const d = await api.get<{ value: HeroBlockSetting | null }>('/api/settings/heroBlock')
      if (d.value && typeof d.value === 'object') {
        setHero({ ...DEFAULT_HERO, ...d.value })
        writeCache(HERO_CACHE_KEY, d.value)
      } else {
        setHero(DEFAULT_HERO)
        writeCache(HERO_CACHE_KEY, null)
      }
    } catch {
      setHero((prev) => prev || DEFAULT_HERO)
    }
    try {
      const m = await api.get<{ value: MobileHeroBlockSetting | null }>('/api/settings/mobileHeroBlock')
      const mv = m.value && typeof m.value === 'object' ? m.value : null
      setMobileHero(mv)
      writeCache(MOBILE_HERO_CACHE_KEY, mv)
    } catch {
      setMobileHero((prev) => prev || null)
    }
  }, [])

  // v25.22: ПЕРВОЕ ДЕЛО — мгновенная гидрация из localStorage (до сети).
  // Убирает «сначала старый большой блок, потом новый»: при повторном
  // открытии правильный hero/баннер рисуется с первого кадра.
  useEffect(() => {
    const cachedHero = readCache<HeroBlockSetting>(HERO_CACHE_KEY)
    if (cachedHero) setHero({ ...DEFAULT_HERO, ...cachedHero })
    const cachedMobile = readCache<MobileHeroBlockSetting>(MOBILE_HERO_CACHE_KEY)
    if (cachedMobile) setMobileHero(cachedMobile)
  }, [])

  useEffect(() => { fetchHero() }, [fetchHero])
  usePullToRefreshSubscription(fetchHero, [fetchHero])

  useEffect(() => {
    const onSettingsChanged = (e: Event) => {
      const detail = (e as CustomEvent).detail as { key?: string } | undefined
      if (detail?.key === 'heroBlock') fetchHero()
    }
    window.addEventListener('999pro:settings-changed', onSettingsChanged as EventListener)
    return () => window.removeEventListener('999pro:settings-changed', onSettingsChanged as EventListener)
  }, [fetchHero])

  // v25.13+v25.21: собираем ВСЕ медиа-слайды: картинки (вкл. GIF) + видео.
  // Приоритет: массив images → одиночный image. Видео добавляются после
  // картинок (первый кадр — мгновенная картинка). Пусто → градиентный орб.
  const imageInputs = (hero?.images && hero.images.length > 0)
    ? hero.images
    : (hero?.image ? [hero.image] : [])
  const allSlides: HeroSlide[] = [
    ...imageInputs.map((url) => ({ kind: isGifUrl(url) ? 'gif' : 'image', url }) as HeroSlide),
    ...(hero?.videos || []).filter(Boolean).map((url) => ({ kind: 'video' as const, url })),
  ]
  const activeIdx = useImageRotation(allSlides.length, allSlides.length > 1)

  // v25.21: мобильный баннер активен только если включён и есть медиа.
  const mobileBannerActive = !!(
    mobileHero?.enabled && mobileHero.media && mobileHero.media.length > 0
  )

  if (!hero) {
    // v25.22: скелетон на телефоне — размером с МОБИЛЬНЫЙ БАННЕР (не пол-
    // экранного гиганта): владелец больше не видит «старый большой блок»
    // даже на самой первой загрузке без кеша. Десктопу — своя сетка.
    return (
      <>
        <section className="md:hidden pt-1 pb-1" aria-hidden>
          <div className="h-[176px] rounded-[20px] skeleton" />
        </section>
        <section
          className="hidden md:grid grid-cols-12 gap-10 items-center min-h-[480px]"
          aria-hidden
        >
          <div className="md:col-span-5 space-y-4">
            <div className="h-7 w-40 rounded-full skeleton" />
            <div className="h-12 w-full rounded-lg skeleton" />
            <div className="h-4 w-full rounded skeleton mt-2" />
            <div className="h-4 w-5/6 rounded skeleton" />
            <div className="flex gap-3 pt-2">
              <div className="h-11 w-32 rounded-full skeleton" />
              <div className="h-11 w-32 rounded-full skeleton" />
            </div>
          </div>
          <div className="md:col-span-7">
            <div className="aspect-[5/4] rounded-2xl skeleton opacity-50" />
          </div>
        </section>
      </>
    )
  }

  if (!hero.enabled) return null

  const showMedia = allSlides.length > 0
  const handlePrimary = () => {
    if (hero.primaryButton?.view) onNavigate(hero.primaryButton.view)
    else if (hero.primaryButton?.link) window.open(hero.primaryButton.link, '_blank', 'noopener,noreferrer')
  }
  const handleSecondary = () => {
    if (hero.secondaryButton?.view) onNavigate(hero.secondaryButton.view)
    else if (hero.secondaryButton?.link) window.open(hero.secondaryButton.link, '_blank', 'noopener,noreferrer')
    else {
      window.dispatchEvent(new CustomEvent('open-feed'))
    }
  }

  // v25.13: AI badge is now CLICKABLE — dispatches the existing
  // 'open-ai-assistant' CustomEvent. The AI Assistant global overlay is
  // already mounted in AppShell and listens for this event — we don't
  // create a new AI, just open the existing one.
  const handleAIClick = () => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('open-ai-assistant'))
    }
  }

  // Highlight part of the title with gradient (split by '*')
  const titleParts = (hero.title || '').split('*')
  const renderTitle = () => {
    if (titleParts.length === 1) return <>{hero.title}</>
    return (
      <>
        {titleParts.map((part, i) => (
          i % 2 === 1
            ? <span key={i} className="bg-gradient-to-r from-[#EC4899] via-[#A855F7] to-[#9333EA] bg-clip-text text-transparent">{part}</span>
            : <span key={i}>{part}</span>
        ))}
      </>
    )
  }

  return (
    <>
    <section
      // v25.13: the 3D tilt is applied directly to the section element.
      // No inner wrapper — children are direct grid items. The section's
      // transform creates the perspective box; children with their own
      // transforms (translate3d) move along the Z axis for parallax.
      // v25.21: когда включён мобильный баннер — большой hero на телефоне
      // скрыт (hidden md:grid), десктоп видит прежнюю сетку.
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      style={{
        perspective: '1200px',
        transform: `rotateX(${tilt.rotateX}deg) rotateY(${tilt.rotateY}deg)`,
        transformStyle: 'preserve-3d',
        transition: 'transform 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
      }}
      className={cn(
        'grid grid-cols-1 md:grid-cols-12 gap-8 md:gap-10 items-center md:min-h-[480px]',
        mobileBannerActive && 'hidden md:grid',
      )}
    >
        {/* ─── LEFT: text content — ТОЛЬКО ДЕСКТОП ────────────────
            v25.17: на мобиле этот блок скрыт — весь текст переехал
            на оверлей поверх фото-карточки (см. mobile scrim ниже). */}
        <div
          className="hidden md:block md:col-span-5"
          style={{
            // v25.13: subtle parallax — text moves opposite to mouse for depth.
            transform: `translate3d(${tilt.px * 0.5}px, ${tilt.py * 0.5}px, 40px)`,
            transition: 'transform 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        >
          {/* AI badge — CLICKABLE, opens existing AI assistant */}
          {/* v25.13: replaced "ИИ-агент TRI999 подберёт за вас" with
              "ИИ-агент TRI999 подберёт для вас" (brand name, not persona). */}
          <button
            onClick={handleAIClick}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/10 mb-4 hover:bg-primary/20 transition-colors cursor-pointer group"
            aria-label="Открыть ИИ-ассистента TRI999"
          >
            <Sparkles className="h-3.5 w-3.5 text-primary group-hover:scale-110 transition-transform" />
            <span className="text-xs md:text-sm font-medium text-primary">
              ИИ-агент TRI999 подберёт для вас
            </span>
            <ArrowRight className="h-3 w-3 text-primary/70 group-hover:translate-x-0.5 transition-transform" />
          </button>

          {/* H1 title */}
          <h1 className="text-3xl md:text-4xl lg:text-5xl font-extrabold leading-[1.05] tracking-tight text-foreground">
            {renderTitle()}
          </h1>

          {/* Description */}
          {hero.description && (
            <p className="text-sm md:text-base text-muted-foreground mt-4 leading-relaxed max-w-md">
              {hero.description}
            </p>
          )}

          {/* CTA buttons */}
          <div className="flex flex-wrap gap-2.5 mt-6">
            <button
              onClick={handlePrimary}
              className="inline-flex items-center gap-2 h-11 md:h-12 px-5 md:px-6 rounded-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-sm md:text-base shadow-[0_6px_20px_-6px_rgba(160,32,112,0.5)] active:scale-95 transition-all"
            >
              {hero.primaryButton?.text || 'В каталог'}
              <ArrowRight className="h-4 w-4" />
            </button>
            <button
              onClick={handleSecondary}
              className="inline-flex items-center gap-2 h-11 md:h-12 px-5 md:px-6 rounded-full bg-card text-card-foreground font-semibold text-sm md:text-base border border-border hover:bg-accent active:scale-95 transition-all"
            >
              {hero.secondaryButton?.text || '🎬 Видео-лента'}
            </button>
          </div>

          {/* Features — inline horizontal row */}
          <div className="mt-6 md:mt-7 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs md:text-sm text-muted-foreground">
            <div className="inline-flex items-center gap-1.5">
              <Truck className="h-4 w-4 text-primary" />
              <span>Доставка по РФ</span>
            </div>
            <span className="hidden md:inline text-border">·</span>
            <div className="inline-flex items-center gap-1.5">
              <ShieldCheck className="h-4 w-4 text-primary" />
              <span>Гарантия качества</span>
            </div>
            <span className="hidden md:inline text-border">·</span>
            <div className="inline-flex items-center gap-1.5">
              <Box className="h-4 w-4 text-primary" />
              <span>3D / AR для мебели</span>
            </div>
          </div>
        </div>

        {/* ─── RIGHT: visual element ─────────────────────────────── */}
        <div
          className="md:col-span-7 order-1 md:order-2 relative"
          style={{
            // v25.13: visual moves slightly more than text for stronger parallax
            transform: `translate3d(${tilt.px * 1.2}px, ${tilt.py * 1.2}px, 60px)`,
            transition: 'transform 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        >
          {showMedia ? (
            <div className="relative aspect-[4/3] md:aspect-[5/4] rounded-2xl overflow-hidden bg-muted">
              {/* v25.22: ПАРАЛЛАКС-СЛОЙ — внешний div ловит rect, внутренний
                  смещается при скролле (только мобайл; на десктопе style={}). */}
              <div ref={parallaxRef} className="absolute inset-0">
                <div className="absolute inset-0" style={parallaxStyle}>
                  {/* v25.13: multi-media crossfade. Each slide is positioned
                      absolutely on top of the others; opacity transitions
                      smoothly. Active image also gets a Ken Burns zoom-pan.
                      v25.21: видео-слайды рендерятся только когда активны
                      (свежий маунт → autoplay muted loop), GIF — «как есть». */}
                  {allSlides.map((slide, i) => {
                    const isActive = i === activeIdx
                    if (slide.kind === 'video') {
                      if (!isActive) return null
                      return (
                        <div key={`${slide.url}-${i}`} className="absolute inset-0">
                          <video
                            src={assetUrl(slide.url)}
                            autoPlay
                            muted
                            loop
                            playsInline
                            className="h-full w-full object-cover"
                          />
                        </div>
                      )
                    }
                    return (
                      <div
                        key={`${slide.url}-${i}`}
                        className="absolute inset-0 transition-opacity duration-[1200ms] ease-in-out"
                        style={{ opacity: isActive ? 1 : 0 }}
                      >
                        {slide.kind === 'gif' ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={assetUrl(slide.url)}
                            alt=""
                            className="h-full w-full object-cover transition-transform duration-[9000ms] ease-out"
                            style={{ transform: isActive ? 'scale(1.08)' : 'scale(1.0)' }}
                          />
                        ) : (
                          <Image
                            src={assetUrl(slide.url)}
                            alt=""
                            fill
                            priority={i === 0}
                            sizes="(max-width: 768px) 100vw, 60vw"
                            className="object-cover transition-transform duration-[9000ms] ease-out"
                            // v25.13: Ken Burns — slow zoom-in over the visible interval.
                            style={{
                              transform: isActive ? 'scale(1.08)' : 'scale(1.0)',
                            }}
                          />
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
              {/* Subtle gradient overlay for text readability if the image
                  has dark spots — but only at the bottom. */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/10 to-transparent" />
              {/* v25.17: MOBILE overlay — контент поверх фото (десктоп его
                  не видит). Рендерим и в фото-ветке, и в fallback-ветке. */}
              <HeroMobileOverlay
                title={hero.title}
                description={hero.description}
                primaryText={hero.primaryButton?.text || 'В каталог'}
                onPrimary={handlePrimary}
                secondaryText={hero.secondaryButton?.text || '🎬 Видео-лента'}
                onSecondary={handleSecondary}
                onAIClick={handleAIClick}
              />
              {/* Image dots indicator (only if 2+ slides) — v25.17: на мобиле
                  точки переехали наверх (внизу теперь текст-оверлей). */}
              {allSlides.length > 1 && (
                <div className="absolute top-3 left-1/2 -translate-x-1/2 md:top-auto md:bottom-3 flex gap-1.5 z-20">
                  {allSlides.map((_, i) => (
                    <span
                      key={i}
                      className={cn(
                        'h-1.5 rounded-full transition-all duration-500',
                        i === activeIdx ? 'w-5 bg-white/90 shadow-[0_1px_6px_rgba(0,0,0,0.4)]' : 'w-1.5 bg-white/50',
                      )}
                    />
                  ))}
                </div>
              )}
            </div>
          ) : (
            // v25.13: NO admin image → use a tasteful gradient orb instead
            // of a flat pink rectangle. The orb has soft radial gradients
            // + subtle noise texture (via backdrop-blur) — looks like a
            // premium brand visual, not a placeholder.
            <div className="relative aspect-[4/3] md:aspect-[5/4] rounded-2xl overflow-hidden">
              {/* Layer 1: warm soft gradient (base) */}
              <div
                className="absolute inset-0"
                style={{
                  background: 'linear-gradient(135deg, #FFE4EC 0%, #FCE4EC 35%, #EDE4F3 65%, #E4ECF9 100%)',
                }}
              />
              {/* Layer 2: pink orb (top-left) */}
              <div
                className="absolute -top-12 -left-12 w-2/3 h-2/3 rounded-full opacity-60 blur-2xl"
                style={{
                  background: 'radial-gradient(circle, rgba(236,72,153,0.55) 0%, transparent 70%)',
                }}
              />
              {/* Layer 3: violet orb (bottom-right) */}
              <div
                className="absolute -bottom-12 -right-12 w-2/3 h-2/3 rounded-full opacity-50 blur-2xl"
                style={{
                  background: 'radial-gradient(circle, rgba(147,51,234,0.5) 0%, transparent 70%)',
                }}
              />
              {/* Layer 4: subtle magenta orb (center) */}
              <div
                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1/2 h-1/2 rounded-full opacity-30 blur-2xl"
                style={{
                  background: 'radial-gradient(circle, rgba(160,32,112,0.45) 0%, transparent 70%)',
                }}
              />
              {/* Brand watermark — centered, very subtle (desktop) */}
              <div className="absolute inset-0 hidden md:flex items-center justify-center">
                <span
                  className="text-5xl md:text-7xl font-extrabold tracking-tight opacity-15"
                  style={{
                    backgroundImage: 'linear-gradient(135deg, #EC4899 0%, #A855F7 50%, #9333EA 100%)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    backgroundClip: 'text',
                  }}
                >
                  TRI999
                </span>
              </div>
              {/* v25.17: тот же мобильный оверлей в fallback-ветке */}
              <HeroMobileOverlay
                title={hero.title}
                description={hero.description}
                primaryText={hero.primaryButton?.text || 'В каталог'}
                onPrimary={handlePrimary}
                secondaryText={hero.secondaryButton?.text || '🎬 Видео-лента'}
                onSecondary={handleSecondary}
                onAIClick={handleAIClick}
              />
            </div>
          )}
        </div>
    </section>

    {/* ═══ v25.21: МОБИЛЬНЫЙ HERO-БАННЕР ═══
        Владелец: «на десктопе hero чётко, на мобильном слишком большой —
        сделай отдельно, размером как баннеры». Когда в Студии включён
        mobileHeroBlock и есть медиа — на телефоне рендерится компактный
        баннер ВМЕСТО большого hero (сам hero выше скрыт через hidden md:grid).
        Десктоп этот блок не видит. */}
    {mobileBannerActive && mobileHero && (
      <div className="md:hidden">
        <HeroMobileBanner data={mobileHero} onNavigate={onNavigate} />
      </div>
    )}
    </>
  )
}

// ============================================================================
// HeroMobileOverlay — v25.17. Контент хедер-блока на мобильных: скрим снизу,
// бейдж ИИ, заголовок, короткое описание и CTA-кнопки ПОВЕРХ фото-карточки.
// На десктопе не рендерится (hidden md:hidden) — там своя 2-колоночная схема.
// ============================================================================
function HeroMobileOverlay({
  title,
  description,
  primaryText,
  onPrimary,
  secondaryText,
  onSecondary,
  onAIClick,
}: {
  title: string
  description?: string | null
  primaryText: string
  onPrimary: () => void
  secondaryText: string
  onSecondary: () => void
  onAIClick: () => void
}) {
  return (
    <div className="md:hidden absolute inset-x-0 bottom-0 z-10">
      {/* Скрим: плотнее у текста, растворяется к центру кадра */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{ background: 'linear-gradient(to top, rgba(8,10,22,0.88) 0%, rgba(8,10,22,0.55) 46%, transparent 78%)' }}
      />
      <div className="relative p-4 pb-5 text-white">
        {/* Бейдж ИИ — кликабельный, открывает существующего агента */}
        <button
          onClick={(e) => { e.stopPropagation(); onAIClick() }}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/14 backdrop-blur-md ring-1 ring-white/25 mb-2 active:scale-95 transition-transform"
          aria-label="Открыть ИИ-ассистента TRI999"
        >
          <Sparkles className="h-3 w-3 text-amber-300" />
          <span className="text-[11px] font-semibold">ИИ-агент TRI999 подберёт для вас</span>
          <ArrowRight className="h-2.5 w-2.5 text-white/70" />
        </button>

        <h1 className="text-[26px] leading-[1.08] font-extrabold tracking-tight drop-shadow-[0_2px_10px_rgba(0,0,0,0.35)]">
          {renderHeroTitle(title)}
        </h1>

        {description && (
          <p className="text-[12.5px] leading-snug text-white/75 mt-1.5 line-clamp-2 max-w-[92%]">
            {description}
          </p>
        )}

        <div className="flex gap-2 mt-3">
          <button
            onClick={(e) => { e.stopPropagation(); onPrimary() }}
            className="flex-1 h-10 rounded-full gradient-brand text-white text-[13px] font-bold grid place-items-center shadow-[0_8px_22px_-8px_rgba(160,32,112,0.65)] active:scale-95 transition-transform"
          >
            {primaryText}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onSecondary() }}
            className="h-10 px-4 rounded-full bg-white/14 backdrop-blur-md ring-1 ring-white/25 text-white text-[13px] font-semibold grid place-items-center active:scale-95 transition-transform"
          >
            {secondaryText}
          </button>
        </div>
      </div>
    </div>
  )
}

// Разделение заголовка по *: нечётные части — градиент (как на десктопе).
function renderHeroTitle(title: string) {
  const parts = (title || '').split('*')
  if (parts.length === 1) return <>{title}</>
  return (
    <>
      {parts.map((part, i) => (
        i % 2 === 1
          ? <span key={i} className="bg-gradient-to-r from-[#F9A8D4] via-[#E9D5FF] to-[#C4B5FD] bg-clip-text text-transparent">{part}</span>
          : <span key={i}>{part}</span>
      ))}
    </>
  )
}
