'use client'

import { useEffect, useState, useCallback } from 'react'
import Image from 'next/image'
import { api, assetUrl } from '@/lib/api'
import type { HeroBlockSetting } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Sparkles, TrendingUp } from 'lucide-react'
import { cn } from '@/lib/utils'
// QW10 (F-DUP-001): extracted to shared module
import { gradientCss } from '@/lib/banner-gradients'
import { usePullToRefreshSubscription } from './pull-to-refresh'

// Default hero — used when the admin hasn't configured anything yet, so the
// home page never looks broken on first launch.
// v12.6: minimal copy per Phase 6 spec — only "999 Store" headline, no
// marketing subtitle, no badge. The admin can still override via Studio.
const DEFAULT_HERO: HeroBlockSetting = {
  enabled: true,
  useGradient: true,
  image: null,
  gradient: 'from-sky-400 via-blue-500 to-indigo-600',
  badge: null,
  title: '999 Store',
  description: null,
  primaryButton: { text: 'В каталог', view: 'catalog', link: null },
  // v12.3: secondary CTA now points to 999 CLUB (was 'feed' — deleted).
  secondaryButton: { text: 'Открыть CLUB', view: 'club', link: null },
  // v12.6.4: new fields — default to legacy behaviour
  objectFit: 'cover',
  mode: 'image-text',
}

interface HeroProps {
  onNavigate: (v: string) => void
}

/**
 * Hero — the main desktop hero block on the home page.
 *
 * Loads its configuration from /api/settings/heroBlock (public). When the
 * admin hasn't configured anything yet, falls back to DEFAULT_HERO so the
 * page never looks broken.
 *
 * When `enabled` is false, renders nothing (the home page flows as if the
 * hero didn't exist).
 *
 * Rendering modes:
 *  - useGradient=true: gradient background + image with overlay (legacy)
 *  - useGradient=false + image: raw image with dark gradient overlay for
 *     text legibility (no colour overlay, no automatic processing)
 *  - useGradient=false + no image: solid gradient-brand background
 */
export function Hero({ onNavigate }: HeroProps) {
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

  useEffect(() => {
    fetchHero()
  }, [fetchHero])

  // v12.6: Pull To Refresh subscription — refetch hero config from Studio.
  usePullToRefreshSubscription(fetchHero, [fetchHero])

  // v16.5: Instant refresh — when Studio saves heroBlock, backend emits
  // `settings:changed` → use-socket forwards as window CustomEvent → refetch.
  useEffect(() => {
    const onSettingsChanged = (e: Event) => {
      const detail = (e as CustomEvent).detail as { key?: string } | undefined
      if (detail?.key === 'heroBlock') fetchHero()
    }
    window.addEventListener('999pro:settings-changed', onSettingsChanged as EventListener)
    return () => window.removeEventListener('999pro:settings-changed', onSettingsChanged as EventListener)
  }, [fetchHero])

  // Loading state — render a skeleton placeholder so the page doesn't jump
  // when the hero config arrives.
  if (!hero) {
    return (
      <div className="hidden md:block px-6 pt-6">
        <div className="h-56 rounded-3xl skeleton" />
      </div>
    )
  }

  // Disabled — render nothing.
  if (!hero.enabled) return null

  const showImage = !!hero.image
  // v12.6.4: image-only mode — just the image, no text/overlay/buttons.
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
    <div className="hidden md:block px-6 pt-6">
      <div
        className={cn(
          'relative overflow-hidden rounded-3xl text-white shadow-glow-lg',
          // v12.6.4: in image-only mode, no padding (image fills everything).
          // In image-text mode, keep padding for text content.
          isImageOnly ? '' : 'p-8 md:p-10',
          !isImageOnly && !hero.useGradient && !showImage && 'gradient-brand',
        )}
        style={
          !isImageOnly && hero.useGradient
            ? { backgroundImage: gradientCss(hero.gradient) }
            : undefined
        }
      >
        {/* Background image — v12.6.4: respects objectFit (cover/contain)
            v18.11: removed `mix-blend-overlay` when useGradient=true — it darkened
            images unpredictably. Now images are shown at full opacity with a
            soft bottom gradient for text legibility. */}
        {showImage && (
          <Image
            src={assetUrl(hero.image!)}
            alt=""
            fill
            priority
            sizes="(max-width: 768px) 100vw, 1200px"
            className={cn(
              fitClass,
              // v18.11: always show image at full opacity — no more mix-blend-overlay.
              'opacity-100',
            )}
          />
        )}

        {/* Decorative blobs (gradient mode only, image-text mode only) */}
        {!isImageOnly && hero.useGradient && (
          <>
            <div className="absolute -top-12 -right-12 h-48 w-48 rounded-full bg-white/20 blur-3xl" />
            <div className="absolute -bottom-12 -left-12 h-48 w-48 rounded-full bg-black/10 blur-3xl" />
          </>
        )}

        {/* v18.11: Soft bottom-only gradient overlay for text legibility.
            Previously used `from-black/70 via-black/25 to-transparent` which
            darkened the ENTIRE image (top + middle + bottom). Now we only
            darken the bottom third where text/buttons sit — the rest of the
            image stays bright and visible.
            Also applied when useGradient=true + image, so text on gradient
            banners with images is also legible. */}
        {!isImageOnly && showImage && (
          <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/60 via-black/20 to-transparent pointer-events-none" />
        )}

        {/* Content — v12.6.4: only rendered in image-text mode AND only if
            at least one text/button field is non-empty. No empty blocks. */}
        {!isImageOnly && (hero.badge || hero.title || hero.description || hero.primaryButton || hero.secondaryButton) && (
          <div className="relative max-w-2xl">
            {hero.badge && (
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/15 text-xs font-medium mb-4 backdrop-blur-sm">
                <Sparkles className="h-3 w-3" /> {hero.badge}
              </div>
            )}
            {hero.title && (
              <h1 className="text-3xl md:text-4xl font-extrabold leading-tight mb-2 drop-shadow-sm">
                {hero.title}
              </h1>
            )}
            {hero.description && (
              <p className="text-white/90 text-sm md:text-base mb-5 max-w-xl">
                {hero.description}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {hero.primaryButton && (
                <Button
                  onClick={() => handleButtonClick(hero.primaryButton!)}
                  className="rounded-full bg-white text-slate-900 font-semibold hover:bg-white/90 h-11 px-6"
                >
                  <TrendingUp className="h-4 w-4 mr-1.5" /> {hero.primaryButton.text}
                </Button>
              )}
              {hero.secondaryButton && (
                <Button
                  onClick={() => handleButtonClick(hero.secondaryButton!)}
                  variant="outline"
                  className="rounded-full border-white/40 text-white hover:bg-white/10 h-11 px-6"
                >
                  {hero.secondaryButton.text}
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
