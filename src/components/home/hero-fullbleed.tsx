'use client'

import { useEffect, useState, useCallback } from 'react'
import Image from 'next/image'
import { api, assetUrl } from '@/lib/api'
import type { HeroBlockSetting } from '@/lib/types'
import { Sparkles, ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { gradientCss } from '@/lib/banner-gradients'
import { usePullToRefreshSubscription } from '../pull-to-refresh'

// v25.11: Editorial full-bleed Hero — replaces the old BentoHero (desktop-only)
// and the legacy Hero.tsx. One unified component for both mobile and desktop.
//
// Design: full-width image (or gradient) with a soft bottom-to-top dark overlay
// for text legibility. Headline + optional sub-headline + one primary CTA.
// No bento side-cards, no decorative blur-blobs, no "stats counter" — just a
// clean editorial layout that works on every screen size.

const DEFAULT_HERO: HeroBlockSetting = {
  enabled: true,
  useGradient: true,
  image: null,
  gradient: 'from-sky-400 via-blue-500 to-indigo-600',
  badge: null,
  title: '999 Store',
  description: null,
  primaryButton: { text: 'В каталог', view: 'catalog', link: null },
  secondaryButton: { text: 'Открыть CLUB', view: 'club', link: null },
  objectFit: 'cover',
  mode: 'image-text',
}

interface HeroFullbleedProps {
  onNavigate: (v: string) => void
}

export function HeroFullbleed({ onNavigate }: HeroFullbleedProps) {
  const [hero, setHero] = useState<HeroBlockSetting | null>(null)

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

  // Instant refresh when Studio saves heroBlock
  useEffect(() => {
    const onSettingsChanged = (e: Event) => {
      const detail = (e as CustomEvent).detail as { key?: string } | undefined
      if (detail?.key === 'heroBlock') fetchHero()
    }
    window.addEventListener('999pro:settings-changed', onSettingsChanged as EventListener)
    return () => window.removeEventListener('999pro:settings-changed', onSettingsChanged as EventListener)
  }, [fetchHero])

  if (!hero) {
    return (
      <section className="px-4 md:px-6 pt-4 md:pt-6">
        <div className="relative w-full h-[280px] md:h-[400px] lg:h-[460px] rounded-3xl skeleton" />
      </section>
    )
  }

  if (!hero.enabled) return null

  const showImage = !!hero.image
  const isImageOnly = hero.mode === 'image-only'
  const fitClass = hero.objectFit === 'contain' ? 'object-contain' : 'object-cover'

  const handleButtonClick = (button: NonNullable<HeroBlockSetting['primaryButton']>) => {
    if (button.view) {
      onNavigate(button.view)
    } else if (button.link) {
      window.open(button.link, '_blank', 'noopener,noreferrer')
    }
  }

  return (
    <section className="px-4 md:px-6 pt-4 md:pt-6">
      <div
        className={cn(
          'relative w-full overflow-hidden rounded-3xl',
          // Heights: mobile 280px, tablet 360px, desktop 420px, large 460px
          'h-[280px] md:h-[360px] lg:h-[420px] xl:h-[460px]',
          'text-white shadow-lg',
          !isImageOnly && !showImage && !hero.useGradient && 'gradient-brand',
        )}
        style={
          !isImageOnly && hero.useGradient && !showImage
            ? { backgroundImage: gradientCss(hero.gradient) }
            : undefined
        }
      >
        {/* Background image — full-bleed */}
        {showImage && (
          <Image
            src={assetUrl(hero.image!)}
            alt=""
            fill
            priority
            sizes="(max-width: 768px) 100vw, 1200px"
            className={cn(fitClass, 'opacity-100')}
          />
        )}

        {/* Gradient background (when useGradient=true and no image) */}
        {!showImage && hero.useGradient && (
          <div
            className="absolute inset-0"
            style={{ backgroundImage: gradientCss(hero.gradient) }}
          />
        )}

        {/* Bottom-to-top dark overlay for text legibility — only in image-text mode */}
        {!isImageOnly && (showImage || hero.useGradient) && (
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent pointer-events-none" />
        )}

        {/* Content — bottom-left aligned, editorial style */}
        {!isImageOnly && (hero.badge || hero.title || hero.description || hero.primaryButton) && (
          <div className="absolute inset-x-0 bottom-0 p-5 md:p-8 lg:p-10">
            <div className="max-w-2xl">
              {hero.badge && (
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/20 backdrop-blur-md text-xs font-medium mb-3 ring-1 ring-white/30">
                  <Sparkles className="h-3 w-3" /> {hero.badge}
                </div>
              )}
              {hero.title && (
                <h1 className="text-3xl md:text-5xl lg:text-6xl font-extrabold leading-[1.05] tracking-tight mb-2 md:mb-3 drop-shadow-lg">
                  {hero.title}
                </h1>
              )}
              {hero.description && (
                <p className="text-white/90 text-sm md:text-base lg:text-lg mb-4 md:mb-6 max-w-xl leading-relaxed">
                  {hero.description}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {hero.primaryButton && (
                  <button
                    onClick={() => handleButtonClick(hero.primaryButton!)}
                    className="inline-flex items-center gap-2 rounded-full bg-white text-slate-900 font-semibold h-11 md:h-12 px-5 md:px-6 hover:bg-white/90 active:scale-95 transition-all shadow-lg"
                  >
                    {hero.primaryButton.text}
                    <ArrowRight className="h-4 w-4" />
                  </button>
                )}
                {hero.secondaryButton && (
                  <button
                    onClick={() => handleButtonClick(hero.secondaryButton!)}
                    className="inline-flex items-center gap-2 rounded-full bg-white/10 backdrop-blur-md text-white font-semibold h-11 md:h-12 px-5 md:px-6 hover:bg-white/20 active:scale-95 transition-all ring-1 ring-white/30"
                  >
                    {hero.secondaryButton.text}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
