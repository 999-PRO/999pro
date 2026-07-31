'use client'

/**
 * PromoSheet — 🔥 bespoke promo experience.
 *
 * Visual identity: each promo has a LIVE countdown timer (days:hrs:min:sec)
 * ticking every second. Featured promo (first one) takes full width with a
 * large layout. Flame icon flickers. Discount percentage is HUGE.
 */

import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Flame, Copy, ExternalLink, Tag } from 'lucide-react'
import { toast } from '@/lib/notifications'
import { cn } from '@/lib/utils'
import { haptic } from '@/lib/haptic'
import { assetUrl } from '@/lib/api'
import type { ClubPromo, ClubCardMeta } from '../../types'
import { promoEntrance, flameFlicker } from '../../animations'
import { ClubSheetWrapper } from './club-sheet-wrapper'

interface PromoSheetProps {
  promos: ClubPromo[]
  meta: ClubCardMeta
  onClose: () => void
}

/** Countdown timer that ticks every second. */
function useCountdown(endsAt?: string | null) {
  const [remaining, setRemaining] = useState<number>(0)
  useEffect(() => {
    if (!endsAt) return
    const target = new Date(endsAt).getTime()
    const update = () => setRemaining(Math.max(0, target - Date.now()))
    update()
    const interval = setInterval(update, 1000)
    return () => clearInterval(interval)
  }, [endsAt])
  if (remaining <= 0) return null
  const days = Math.floor(remaining / (1000 * 60 * 60 * 24))
  const hours = Math.floor((remaining % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
  const mins = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60))
  const secs = Math.floor((remaining % (1000 * 60)) / 1000)
  return { days, hours, mins, secs }
}

function CountdownTimer({ endsAt }: { endsAt?: string | null }) {
  const time = useCountdown(endsAt)
  if (!time) return <span className="text-xs text-red-500 font-bold">Акция завершена</span>
  const units = [
    { v: time.days, l: 'дней' },
    { v: time.hours, l: 'часов' },
    { v: time.mins, l: 'минут' },
    { v: time.secs, l: 'секунд' },
  ]
  return (
    <div className="flex items-center gap-1">
      {units.map((u, i) => (
        <div key={i} className="flex items-center gap-1">
          <div className="flex flex-col items-center">
            <span className="text-base font-extrabold tabular-nums leading-none bg-foreground/5 rounded-md px-1.5 py-1 min-w-[28px] text-center">
              {String(u.v).padStart(2, '0')}
            </span>
            <span className="text-[8px] text-muted-foreground mt-0.5">{u.l}</span>
          </div>
          {i < units.length - 1 && <span className="text-muted-foreground font-bold">:</span>}
        </div>
      ))}
    </div>
  )
}

export function PromoSheet({ promos, meta, onClose }: PromoSheetProps) {
  const handleCopy = useCallback((code: string) => {
    haptic.tap()
    navigator.clipboard.writeText(code).then(() => {
      toast.success('Промокод скопирован', { description: code })
    })
  }, [])

  const handleCta = useCallback((promo: ClubPromo) => {
    haptic.tap()
    if (promo.ctaUrl) {
      window.open(promo.ctaUrl, '_blank', 'noopener,noreferrer')
    } else if (promo.promoCode) {
      handleCopy(promo.promoCode)
    }
  }, [handleCopy])

  return (
    <ClubSheetWrapper meta={meta} onClose={onClose} subtitle="Ограниченные по времени предложения">
      <div className="p-4 space-y-4">
        {promos.map((promo, i) => {
          const isFeatured = i === 0
          return (
            <motion.div
              key={promo.id}
              variants={promoEntrance}
              initial="hidden"
              animate="visible"
              transition={{ delay: i * 0.08 }}
              className={cn(
                'relative rounded-3xl overflow-hidden border border-white/15',
                isFeatured ? 'shadow-glow-lg' : 'shadow-glow',
              )}
            >
              {/* Background image */}
              {promo.image && (
                <div className="absolute inset-0">
                  <img src={assetUrl(promo.image)} alt="" className="w-full h-full object-cover" loading="lazy" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent" />
                </div>
              )}

              {/* Content */}
              <div className={cn('relative p-5', isFeatured ? 'min-h-[200px] flex flex-col justify-end' : 'min-h-[140px] flex flex-col justify-end')}>
                {/* Flame + discount badge */}
                <div className="absolute top-4 right-4 flex items-center gap-2">
                  {promo.discountPercent != null && (
                    <span className="text-2xl font-extrabold text-white" style={{ textShadow: '0 2px 8px rgba(0,0,0,0.6)' }}>
                      -{promo.discountPercent}%
                    </span>
                  )}
                  <motion.div
                    variants={flameFlicker}
                    initial="flicker"
                    animate="flicker"
                  >
                    <Flame className="h-6 w-6 text-orange-400" fill="currentColor" />
                  </motion.div>
                </div>

                <h3 className={cn('font-extrabold text-white tracking-tight', isFeatured ? 'text-2xl' : 'text-lg')} style={{ textShadow: '0 2px 8px rgba(0,0,0,0.6)' }}>
                  {promo.title}
                </h3>
                <p className="text-xs text-white/80 mt-1 line-clamp-2">{promo.description}</p>

                {/* Countdown */}
                <div className="mt-3 flex items-center gap-2">
                  <span className="text-[10px] text-white/70 font-semibold uppercase tracking-wide">До конца:</span>
                  <CountdownTimer endsAt={promo.endsAt} />
                </div>

                {/* Promo code + CTA */}
                <div className="mt-3 flex items-center gap-2">
                  {promo.promoCode && (
                    <button
                      onClick={() => handleCopy(promo.promoCode!)}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/15 backdrop-blur-md border border-white/20 text-white text-xs font-bold hover:bg-white/25 transition-colors"
                    >
                      <Tag className="h-3.5 w-3.5" />
                      {promo.promoCode}
                      <Copy className="h-3 w-3 opacity-60" />
                    </button>
                  )}
                  <button
                    onClick={() => handleCta(promo)}
                    className="flex-1 h-10 rounded-xl bg-white text-slate-900 text-sm font-bold hover:bg-white/90 transition-colors flex items-center justify-center gap-1.5"
                  >
                    {promo.ctaText || 'Перейти'}
                    <ExternalLink className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </motion.div>
          )
        })}

        {promos.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Flame className="h-12 w-12 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground text-center px-4">
              Акций пока нет. Следите за обновлениями — мы готовим выгодные предложения!
            </p>
          </div>
        )}
      </div>
    </ClubSheetWrapper>
  )
}
