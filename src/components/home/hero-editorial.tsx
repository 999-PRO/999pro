'use client'

import { useEffect, useState, useCallback } from 'react'
import Image from 'next/image'
import { api, assetUrl } from '@/lib/api'
import type { HeroBlockSetting } from '@/lib/types'
import { Sparkles, ArrowRight, Film, Truck, ShieldCheck, Box } from 'lucide-react'
import { cn } from '@/lib/utils'
import { gradientCss } from '@/lib/banner-gradients'
import { usePullToRefreshSubscription } from '../pull-to-refresh'

// v25.12: Editorial Hero — точная реплика дизайна с IMG_3191.
// Светло-розовый градиентный фон, AI-бейдж "Зои подберёт за вас",
// крупный заголовок с градиентным выделением, 2 CTA (В каталог + Видео-лента),
// 3 фичи (Доставка / Гарантия / 3D-AR).

const DEFAULT_HERO: HeroBlockSetting = {
  enabled: true,
  useGradient: true,
  image: null,
  gradient: 'from-sky-400 via-blue-500 to-indigo-600',
  badge: null,
  title: 'Бутик рекламы, подарков и мебели',
  description: 'Спросите голосом или текстом — получите подборку товаров с фото, ценами и документами. Корзина, заказ и доставка в пару кликов.',
  primaryButton: { text: 'В каталог', view: 'catalog', link: null },
  secondaryButton: { text: '🎬 Видео-лента', view: null, link: null },
  objectFit: 'cover',
  mode: 'image-text',
}

interface HeroEditorialProps {
  onNavigate: (v: string) => void
}

export function HeroEditorial({ onNavigate }: HeroEditorialProps) {
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
      <section className="px-4 pt-1">
        <div className="h-[320px] md:h-[400px] rounded-3xl skeleton" />
      </section>
    )
  }

  if (!hero.enabled) return null

  const showImage = !!hero.image
  const handlePrimary = () => {
    if (hero.primaryButton?.view) onNavigate(hero.primaryButton.view)
    else if (hero.primaryButton?.link) window.open(hero.primaryButton.link, '_blank', 'noopener,noreferrer')
  }
  const handleSecondary = () => {
    if (hero.secondaryButton?.view) onNavigate(hero.secondaryButton.view)
    else if (hero.secondaryButton?.link) window.open(hero.secondaryButton.link, '_blank', 'noopener,noreferrer')
    else {
      // default: open feed (Reels)
      window.dispatchEvent(new CustomEvent('open-feed'))
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
    <section className="px-4 pt-1">
      <div
        className={cn(
          'relative w-full overflow-hidden rounded-3xl',
          'bg-gradient-to-br from-[#FFF5F7] via-[#FFE4EC] to-[#FFF0E6]',
          'shadow-[0_8px_30px_-12px_rgba(160,32,112,0.15)]',
        )}
      >
        {/* Background image (if set) */}
        {showImage && (
          <Image
            src={assetUrl(hero.image!)}
            alt=""
            fill
            priority
            sizes="(max-width: 768px) 100vw, 1200px"
            className="object-cover opacity-20"
          />
        )}

        <div className="relative p-5 md:p-8 lg:p-10">
          {/* AI badge */}
          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#FCE4EC] mb-4">
            <Sparkles className="h-3.5 w-3.5 text-[#A02070]" />
            <span className="text-xs md:text-sm font-medium text-[#880E4F]">ИИ-агент Зои подберёт за вас</span>
          </div>

          {/* H1 title — supports *gradient* markers */}
          <h1 className="text-2xl md:text-4xl lg:text-5xl font-extrabold leading-[1.1] tracking-tight text-[#1A1A1A] max-w-2xl">
            {renderTitle()}
          </h1>

          {/* Description */}
          {hero.description && (
            <p className="text-sm md:text-base text-[#666666] mt-3 max-w-xl leading-relaxed">
              {hero.description}
            </p>
          )}

          {/* CTA buttons */}
          <div className="flex flex-wrap gap-2.5 mt-5 md:mt-6">
            <button
              onClick={handlePrimary}
              className="inline-flex items-center gap-2 h-11 md:h-12 px-5 md:px-6 rounded-full bg-[#A02070] hover:bg-[#880E4F] text-white font-semibold text-sm md:text-base shadow-[0_6px_20px_-6px_rgba(160,32,112,0.5)] active:scale-95 transition-all"
            >
              {hero.primaryButton?.text || 'В каталог'}
              <ArrowRight className="h-4 w-4" />
            </button>
            <button
              onClick={handleSecondary}
              className="inline-flex items-center gap-2 h-11 md:h-12 px-5 md:px-6 rounded-full bg-white text-[#1A1A1A] font-semibold text-sm md:text-base border border-[#E5E7EB] hover:bg-[#FAFAFA] active:scale-95 transition-all"
            >
              {hero.secondaryButton?.text || '🎬 Видео-лента'}
            </button>
          </div>

          {/* Features */}
          <div className="mt-5 md:mt-7 flex flex-col gap-2 md:gap-2.5">
            <div className="flex items-center gap-2 text-sm text-[#4A4A4A]">
              <Truck className="h-4 w-4 text-[#A02070]" />
              <span>Доставка по РФ</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-[#4A4A4A]">
              <ShieldCheck className="h-4 w-4 text-[#A02070]" />
              <span>Гарантия качества</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-[#4A4A4A]">
              <Box className="h-4 w-4 text-[#A02070]" />
              <span>3D / AR для мебели</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
