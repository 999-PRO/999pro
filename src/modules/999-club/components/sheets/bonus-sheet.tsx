'use client'

/**
 * BonusSheet — ⭐ bespoke bonus experience.
 *
 * Visual identity: top section shows the user's points balance + level
 * progress (Bronze → Silver → Gold → Platinum). Each bonus card shows
 * the reward prominently with a coin-flip animation. Claiming triggers
 * a "coin flying to balance" animation.
 */

import { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Star, Check, TrendingUp } from 'lucide-react'
import { toast } from '@/lib/notifications'
import { cn } from '@/lib/utils'
import { haptic } from '@/lib/haptic'
import { clubApi } from '../../api'
import { assetUrl } from '@/lib/api'
import type { ClubBonus, ClubCardMeta } from '../../types'
import { bonusEntrance, pointsFly, numberPop } from '../../animations'
import { ClubSheetWrapper } from './club-sheet-wrapper'

interface BonusSheetProps {
  bonuses: ClubBonus[]
  meta: ClubCardMeta
  points: number
  pointsEarnedTotal: number
  onClose: () => void
  onChanged: () => Promise<void>
}

/** Level system: based on total points earned. */
const LEVELS = [
  { name: 'Bronze', min: 0, max: 500, color: '#cd7f32', icon: '🥉' },
  { name: 'Silver', min: 500, max: 1500, color: '#c0c0c0', icon: '🥈' },
  { name: 'Gold', min: 1500, max: 5000, color: '#ffd700', icon: '🥇' },
  { name: 'Platinum', min: 5000, max: Infinity, color: '#e5e4e2', icon: '💎' },
]

function getLevel(total: number) {
  return LEVELS.find((l) => total >= l.min && total < l.max) || LEVELS[LEVELS.length - 1]
}

function getNextLevel(total: number) {
  const current = getLevel(total)
  const idx = LEVELS.indexOf(current)
  return idx < LEVELS.length - 1 ? LEVELS[idx + 1] : null
}

export function BonusSheet({ bonuses, meta, points, pointsEarnedTotal, onClose, onChanged }: BonusSheetProps) {
  const [claiming, setClaiming] = useState<string | null>(null)
  const [flyId, setFlyId] = useState<string | null>(null)
  const [popKey, setPopKey] = useState(0)

  const level = getLevel(pointsEarnedTotal)
  const nextLevel = getNextLevel(pointsEarnedTotal)
  const levelProgress = nextLevel
    ? ((pointsEarnedTotal - level.min) / (nextLevel.min - level.min)) * 100
    : 100

  const handleClaim = useCallback(async (bonus: ClubBonus) => {
    haptic.heavy()
    setClaiming(bonus.id)
    try {
      const res = await clubApi.claimBonus(bonus.id)
      setFlyId(bonus.id)
      setPopKey((k) => k + 1)
      haptic.success()
      setTimeout(() => setFlyId(null), 800)
      toast.success(`⭐ +${res.pointsAwarded} баллов!`, { description: bonus.title, sound: 'club' })
      await onChanged()
    } catch (e: any) {
      haptic.error()
      toast.error(e?.message || 'Не удалось получить бонус')
    } finally {
      setClaiming(null)
    }
  }, [onChanged])

  return (
    <ClubSheetWrapper
      meta={meta}
      onClose={onClose}
      subtitle="Зарабатывайте баллы и повышайте уровень"
      headerExtra={
        <div className="rounded-2xl glass border border-border/40 p-4">
          {/* Level + balance */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-2xl">{level.icon}</span>
              <div>
                <div className="text-xs text-muted-foreground">Уровень</div>
                <div className="font-bold text-sm" style={{ color: level.color }}>{level.name}</div>
              </div>
            </div>
            <motion.div
              key={popKey}
              variants={numberPop}
              initial="pop"
              animate="idle"
              className="text-right"
            >
              <div className="flex items-center gap-1 justify-end">
                <Star className="h-4 w-4 text-amber-500" fill="currentColor" />
                <span className="text-2xl font-extrabold tabular-nums">{points}</span>
              </div>
              <div className="text-[10px] text-muted-foreground">доступно баллов</div>
            </motion.div>
          </div>
          {/* Level progress bar */}
          {nextLevel && (
            <div>
              <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
                <span>До уровня {nextLevel.icon} {nextLevel.name}</span>
                <span>{nextLevel.min - pointsEarnedTotal} ⭐ осталось</span>
              </div>
              <div className="h-2 rounded-full bg-foreground/10 overflow-hidden">
                <motion.div
                  className="h-full rounded-full"
                  style={{ background: `linear-gradient(90deg, ${level.color}, ${nextLevel.color})` }}
                  initial={{ width: 0 }}
                  animate={{ width: `${levelProgress}%` }}
                  transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                />
              </div>
            </div>
          )}
        </div>
      }
    >
      <div className="p-4 space-y-3">
        {bonuses.map((bonus, i) => {
          const isClaimed = bonus.claimedByMe
          const isClaiming = claiming === bonus.id
          const isFlying = flyId === bonus.id

          return (
            <motion.div
              key={bonus.id}
              variants={bonusEntrance}
              initial="hidden"
              animate="visible"
              transition={{ delay: i * 0.08 }}
              className={cn(
                'relative rounded-2xl overflow-hidden border',
                isClaimed ? 'border-emerald-500/20 opacity-60' : 'border-violet-500/20',
              )}
              style={{ background: 'linear-gradient(135deg, rgba(139,92,246,0.08), rgba(99,102,241,0.04))' }}
            >
              <div className="flex items-center gap-3 p-3">
                {/* Coin icon */}
                <motion.div
                  className="relative h-14 w-14 rounded-full grid place-items-center shrink-0"
                  style={{ background: 'linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)' }}
                  animate={isFlying ? { y: [-0, -40, -80], opacity: [1, 1, 0], scale: [1, 1.2, 0.3] } : {}}
                  transition={{ duration: 0.8, ease: 'easeInOut' }}
                >
                  <Star className="h-7 w-7 text-white" fill="currentColor" />
                  {bonus.image && (
                    <img src={assetUrl(bonus.image)} alt="" className="absolute inset-0 rounded-full object-cover" loading="lazy" />
                  )}
                </motion.div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold text-sm leading-tight">{bonus.title}</h3>
                  <p className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">{bonus.description}</p>
                  <div className="flex items-center gap-1 mt-1">
                    <TrendingUp className="h-3 w-3 text-violet-500" />
                    <span className="text-xs font-bold text-violet-500">+{bonus.pointsReward} баллов</span>
                  </div>
                </div>

                {/* Claim button */}
                <button
                  onClick={() => handleClaim(bonus)}
                  disabled={isClaimed || isClaiming}
                  className={cn(
                    'shrink-0 h-10 px-4 rounded-xl text-xs font-bold transition-all',
                    isClaimed ? 'bg-emerald-500/20 text-emerald-500' : 'text-white active:scale-95',
                  )}
                  style={!isClaimed ? { background: 'linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)' } : undefined}
                >
                  {isClaiming ? '...' : isClaimed ? '✓' : 'Забрать'}
                </button>
              </div>

              {/* Flying coins animation */}
              <AnimatePresence>
                {isFlying && (
                  <>
                    {[...Array(5)].map((_, j) => (
                      <motion.div
                        key={j}
                        variants={pointsFly}
                        initial="idle"
                        animate="fly"
                        custom={{ x: 150 + j * 10, y: -200 - j * 15 }}
                        className="absolute w-6 h-6 rounded-full grid place-items-center pointer-events-none"
                        style={{ background: 'linear-gradient(135deg, #8b5cf6, #6366f1)', top: '50%', left: '20px' }}
                      >
                        <Star className="h-3.5 w-3.5 text-white" fill="currentColor" />
                      </motion.div>
                    ))}
                  </>
                )}
              </AnimatePresence>
            </motion.div>
          )
        })}

        {bonuses.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Star className="h-12 w-12 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground text-center px-4">
              Бонусы скоро появятся. Выполняйте задания и зарабатывайте баллы!
            </p>
          </div>
        )}
      </div>
    </ClubSheetWrapper>
  )
}
