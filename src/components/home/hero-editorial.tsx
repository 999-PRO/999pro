'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import Image from 'next/image'
import { api, assetUrl } from '@/lib/api'
import type { HeroBlockSetting } from '@/lib/types'
import { Sparkles, ArrowRight, Truck, ShieldCheck, Box } from 'lucide-react'
import { cn } from '@/lib/utils'
import { usePullToRefreshSubscription } from '../pull-to-refresh'

// v25.13 (premium hero redesign): dynamic multi-image hero with:
//   • Crossfade transition between images (8-10s interval)
//   • Subtle Ken Burns zoom-pan effect per image
//   • 3D tilt + parallax on mouse move (desktop only)
//   • Correct brand text "Реклама • Мебель • Подарки"
//   • AI badge "ИИ-агент 999PRO" — clickable, opens existing AI assistant
//   • Single-image fallback: no carousel if only one image
//   • Mobile: no tilt/parallax (touch-friendly), crossfade still works
//
// The hero is rendered as a 2-column editorial layout on desktop (text left,
// visual right) and single-column on mobile (visual top, text below).

const DEFAULT_HERO: HeroBlockSetting = {
  enabled: true,
  useGradient: true,
  image: null,
  images: [],
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

// Hook: auto-rotate through images array every ~8-10s.
// Uses a deterministic interval (9 seconds = midpoint of 8-10 range).
// Skipped if only one image (or zero).
function useImageRotation(total: number, enabled: boolean) {
  const [idx, setIdx] = useState(0)
  useEffect(() => {
    if (!enabled || total <= 1) return
    const id = setInterval(() => {
      setIdx((prev) => (prev + 1) % total)
    }, 9000)
    return () => clearInterval(id)
  }, [total, enabled])
  return idx
}

export function HeroEditorial({ onNavigate }: HeroEditorialProps) {
  const [hero, setHero] = useState<HeroBlockSetting | null>(null)
  const { tilt, onMove, onLeave } = useTiltHover()

  const fetchHero = useCallback(async () => {
    try {
      const d = await api.get<{ value: HeroBlockSetting | null }>('/api/settings/heroBlock')
      if (d.value && typeof d.value === 'object') {
        setHero({ ...DEFAULT_HERO, ...d.value })
      } else {
        setHero(DEFAULT_HERO)
      }
    } catch {
      setHero(DEFAULT_HERO)
    }
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

  // v25.13: collect all images for the carousel. Priority: `images` array,
  // then fallback to single `image`. If both empty → no image (use gradient orb).
  const allImages = (hero?.images && hero.images.length > 0)
    ? hero.images
    : (hero?.image ? [hero.image] : [])
  const activeIdx = useImageRotation(allImages.length, allImages.length > 1)

  if (!hero) {
    return (
      <section className="grid grid-cols-1 md:grid-cols-12 gap-8 md:gap-10 items-center min-h-[400px] md:min-h-[480px]">
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
        <div className="hidden md:block md:col-span-7">
          <div className="aspect-square rounded-full skeleton opacity-50" />
        </div>
      </section>
    )
  }

  if (!hero.enabled) return null

  const showImage = allImages.length > 0
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
    <section
      // v25.13: the 3D tilt is applied directly to the section element.
      // No inner wrapper — children are direct grid items. The section's
      // transform creates the perspective box; children with their own
      // transforms (translate3d) move along the Z axis for parallax.
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      style={{
        perspective: '1200px',
        transform: `rotateX(${tilt.rotateX}deg) rotateY(${tilt.rotateY}deg)`,
        transformStyle: 'preserve-3d',
        transition: 'transform 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
      }}
      className="grid grid-cols-1 md:grid-cols-12 gap-8 md:gap-10 items-center min-h-[400px] md:min-h-[480px]"
    >
        {/* ─── LEFT: text content ──────────────────────────────────── */}
        <div
          className="md:col-span-5 order-2 md:order-1"
          style={{
            // v25.13: subtle parallax — text moves opposite to mouse for depth.
            transform: `translate3d(${tilt.px * 0.5}px, ${tilt.py * 0.5}px, 40px)`,
            transition: 'transform 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        >
          {/* AI badge — CLICKABLE, opens existing AI assistant */}
          {/* v25.13: replaced "ИИ-агент 999PRO подберёт за вас" with
              "ИИ-агент 999PRO подберёт для вас" (brand name, not persona). */}
          <button
            onClick={handleAIClick}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/10 mb-4 hover:bg-primary/20 transition-colors cursor-pointer group"
            aria-label="Открыть ИИ-ассистента 999PRO"
          >
            <Sparkles className="h-3.5 w-3.5 text-primary group-hover:scale-110 transition-transform" />
            <span className="text-xs md:text-sm font-medium text-primary">
              ИИ-агент 999PRO подберёт для вас
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
          {showImage ? (
            <div className="relative aspect-[4/3] md:aspect-[5/4] rounded-2xl overflow-hidden bg-muted">
              {/* v25.13: multi-image crossfade. Each image is positioned
                  absolutely on top of the others; opacity transitions
                  smoothly. Active image also gets a Ken Burns zoom-pan
                  via transform scale (1 → 1.08 over the visible interval). */}
              {allImages.map((img, i) => {
                const isActive = i === activeIdx
                return (
                  <div
                    key={i}
                    className="absolute inset-0 transition-opacity duration-[1200ms] ease-in-out"
                    style={{ opacity: isActive ? 1 : 0 }}
                  >
                    <Image
                      src={assetUrl(img)}
                      alt=""
                      fill
                      priority={i === 0}
                      sizes="(max-width: 768px) 100vw, 60vw"
                      className="object-cover transition-transform duration-[9000ms] ease-out"
                      // v25.13: Ken Burns — slow zoom-in over the visible interval.
                      // Scale goes from 1.0 → 1.08 over 9s. When image rotates
                      // out (i !== activeIdx), scale resets to 1.0 instantly
                      // via the `key`-less transition (opacity drives the visible
                      // state, the transform is naturally reset on next show
                      // because the previous transform already completed).
                      style={{
                        transform: isActive ? 'scale(1.08)' : 'scale(1.0)',
                      }}
                    />
                  </div>
                )
              })}
              {/* Subtle gradient overlay for text readability if the image
                  has dark spots — but only at the bottom. */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/10 to-transparent" />
              {/* Image dots indicator (only if 2+ images) */}
              {allImages.length > 1 && (
                <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5 z-10">
                  {allImages.map((_, i) => (
                    <span
                      key={i}
                      className={cn(
                        'h-1.5 rounded-full transition-all duration-500',
                        i === activeIdx ? 'w-5 bg-white/80' : 'w-1.5 bg-white/40',
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
              {/* Brand watermark — centered, very subtle */}
              <div className="absolute inset-0 flex items-center justify-center">
                <span
                  className="text-5xl md:text-7xl font-extrabold tracking-tight opacity-15"
                  style={{
                    backgroundImage: 'linear-gradient(135deg, #EC4899 0%, #A855F7 50%, #9333EA 100%)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    backgroundClip: 'text',
                  }}
                >
                  999PRO
                </span>
              </div>
            </div>
          )}
        </div>
    </section>
  )
}
