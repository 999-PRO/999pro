'use client'

/**
 * GiftSheet — 🎁 bespoke gift experience.
 *
 * Visual identity: each gift is a "wrapped box" with a ribbon. Gifts have
 * rarity tiers (common/rare/legendary) with different gradient treatments.
 * Claiming triggers a gift-unwrapping burst animation + confetti.
 */

import { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Gift, Check } from 'lucide-react'
import { toast } from '@/lib/notifications'
import { cn } from '@/lib/utils'
import { haptic } from '@/lib/haptic'
import { clubApi } from '../../api'
import { assetUrl } from '@/lib/api'
import type { ClubGift, ClubCardMeta } from '../../types'
import { giftEntrance, giftBurst, confettiBurst } from '../../animations'
import { ClubSheetWrapper } from './club-sheet-wrapper'

interface GiftSheetProps {
  gifts: ClubGift[]
  meta: ClubCardMeta
  onClose: () => void
  onChanged: () => Promise<void>
}

function getRarity(gift: ClubGift): 'common' | 'rare' | 'legendary' {
  if (gift.pointsCost >= 500) return 'legendary'
  if (gift.pointsCost >= 200) return 'rare'
  return 'common'
}

const RARITY_STYLES = {
  common: {
    gradient: 'linear-gradient(135deg, #f59e0b 0%, #f97316 100%)',
    glow: 'rgba(245, 158, 11, 0.3)',
    label: 'Обычный',
    ribbon: '#fbbf24',
  },
  rare: {
    gradient: 'linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)',
    glow: 'rgba(139, 92, 246, 0.4)',
    label: 'Редкий',
    ribbon: '#a78bfa',
  },
  legendary: {
    gradient: 'linear-gradient(135deg, #ec4899 0%, #8b5cf6 50%, #f59e0b 100%)',
    glow: 'rgba(236, 72, 153, 0.5)',
    label: 'Легендарный',
    ribbon: '#f0abfc',
  },
}

export function GiftSheet({ gifts, meta, onClose, onChanged }: GiftSheetProps) {
  const [claiming, setClaiming] = useState<string | null>(null)
  const [burstId, setBurstId] = useState<string | null>(null)

  const handleClaim = useCallback(async (gift: ClubGift) => {
    haptic.heavy()
    setClaiming(gift.id)
    try {
      await clubApi.claimGift(gift.id)
      setBurstId(gift.id)
      haptic.success()
      setTimeout(() => setBurstId(null), 1000)
      toast.success('🎁 Подарок получен!', { description: gift.title, sound: 'club' })
      await onChanged()
    } catch (e: any) {
      haptic.error()
      toast.error(e?.message || 'Не удалось получить подарок')
    } finally {
      setClaiming(null)
    }
  }, [onChanged])

  return (
    <ClubSheetWrapper meta={meta} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3 p-4">
        {gifts.map((gift, i) => {
          const rarity = getRarity(gift)
          const style = RARITY_STYLES[rarity]
          const isBursting = burstId === gift.id
          const isClaimed = gift.claimedByMe
          const isClaiming = claiming === gift.id
          const soldOut = gift.remaining != null && gift.remaining === 0

          return (
            <motion.div
              key={gift.id}
              variants={giftEntrance}
              initial="hidden"
              animate="visible"
              transition={{ delay: i * 0.08 }}
            >
              <motion.div
                variants={giftBurst}
                initial="idle"
                animate={isBursting ? 'burst' : 'idle'}
                className={cn(
                  'relative rounded-2xl overflow-hidden',
                  'bg-gradient-to-br from-white/10 to-white/5',
                  'border backdrop-blur-xl',
                  isClaimed ? 'border-emerald-500/30 opacity-60' : 'border-white/15',
                )}
                style={{ boxShadow: isClaimed ? 'none' : `0 8px 32px -8px ${style.glow}` }}
              >
                <div className="absolute top-2 left-2 z-10">
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full text-white" style={{ background: style.gradient }}>
                    {style.label}
                  </span>
                </div>

                <div className="relative h-32 flex items-center justify-center overflow-hidden">
                  {gift.image ? (
                    <img src={assetUrl(gift.image)} alt="" className="w-full h-full object-cover" loading="lazy" />
                  ) : (
                    <div className="w-20 h-20 rounded-2xl grid place-items-center" style={{ background: style.gradient }}>
                      <Gift className="h-10 w-10 text-white" strokeWidth={1.8} />
                    </div>
                  )}
                  {!isClaimed && (
                    <>
                      <div className="absolute top-0 bottom-0 left-1/2 w-3 -translate-x-1/2 opacity-60" style={{ background: style.ribbon }} />
                      <div className="absolute left-0 right-0 top-1/2 h-3 -translate-y-1/2 opacity-60" style={{ background: style.ribbon }} />
                    </>
                  )}
                  {isClaimed && (
                    <div className="absolute inset-0 bg-emerald-500/20 grid place-items-center">
                      <div className="h-10 w-10 rounded-full bg-emerald-500 grid place-items-center">
                        <Check className="h-6 w-6 text-white" strokeWidth={3} />
                      </div>
                    </div>
                  )}
                  <AnimatePresence>
                    {isBursting && (
                      <>
                        {[...Array(8)].map((_, j) => (
                          <motion.div
                            key={j}
                            variants={confettiBurst}
                            initial="idle"
                            animate="burst"
                            className="absolute w-2 h-2 rounded-full"
                            style={{
                              background: ['#f59e0b', '#ec4899', '#8b5cf6', '#10b981'][j % 4],
                              top: '50%', left: '50%',
                              x: Math.cos((j / 8) * Math.PI * 2) * 80,
                              y: Math.sin((j / 8) * Math.PI * 2) * 80,
                            }}
                          />
                        ))}
                      </>
                    )}
                  </AnimatePresence>
                </div>

                <div className="p-3">
                  <h3 className="font-bold text-sm leading-tight line-clamp-1">{gift.title}</h3>
                  <p className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5 h-7">{gift.description}</p>
                  <div className="flex items-center justify-between mt-2 text-[10px]">
                    {gift.pointsCost > 0 ? (
                      <span className="font-bold text-amber-500">⭐ {gift.pointsCost}</span>
                    ) : (
                      <span className="font-semibold text-emerald-500">Бесплатно</span>
                    )}
                    {gift.remaining != null && <span className="text-muted-foreground">Осталось: {gift.remaining}</span>}
                  </div>
                  <button
                    onClick={() => handleClaim(gift)}
                    disabled={isClaimed || soldOut || isClaiming}
                    className={cn(
                      'w-full h-8 rounded-xl mt-2 text-xs font-bold transition-all',
                      isClaimed ? 'bg-emerald-500/20 text-emerald-500' : soldOut ? 'bg-foreground/5 text-muted-foreground' : 'text-white active:scale-95',
                    )}
                    style={!isClaimed && !soldOut ? { background: style.gradient } : undefined}
                  >
                    {isClaiming ? '...' : isClaimed ? '✓ Получено' : soldOut ? 'Закончились' : 'Открыть'}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )
        })}
      </div>

      {gifts.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <Gift className="h-12 w-12 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground text-center px-4">
            Подарки скоро появятся. Загляните позже — мы готовим что-то особенное!
          </p>
        </div>
      )}
    </ClubSheetWrapper>
  )
}
