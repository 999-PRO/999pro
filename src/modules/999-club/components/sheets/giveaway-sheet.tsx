'use client'

/**
 * GiveawaySheet — 🏆 bespoke giveaway experience.
 *
 * Visual identity: each giveaway is a "lottery ticket" with a serial
 * number, golden border, and perforated edge. Live participant counter
 * with animated number. Participating triggers a ticket-print animation.
 * After draw: winner announcement with confetti.
 */

import { useState, useCallback, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Trophy, Users, Clock, Check, Crown } from 'lucide-react'
import { toast } from '@/lib/notifications'
import { cn } from '@/lib/utils'
import { haptic } from '@/lib/haptic'
import { assetUrl } from '@/lib/api'
import { clubApi } from '../../api'
import type { ClubGiveaway, ClubCardMeta } from '../../types'
import { giveawayEntrance, ticketPrint, confettiBurst } from '../../animations'
import { ClubSheetWrapper } from './club-sheet-wrapper'

interface GiveawaySheetProps {
  giveaways: ClubGiveaway[]
  meta: ClubCardMeta
  onClose: () => void
  onChanged: () => Promise<void>
}

function useCountdown(drawAt: string) {
  const [remaining, setRemaining] = useState(() => {
    const target = new Date(drawAt).getTime()
    return Math.max(0, target - Date.now())
  })
  // Simple ticking without re-render storm
  useState(() => {
    const interval = setInterval(() => {
      const target = new Date(drawAt).getTime()
      setRemaining(Math.max(0, target - Date.now()))
    }, 1000)
    return () => clearInterval(interval)
  })
  if (remaining <= 0) return 'Розыгрыш завершён'
  const days = Math.floor(remaining / (1000 * 60 * 60 * 24))
  const hours = Math.floor((remaining % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
  const mins = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60))
  if (days > 0) return `${days}д ${hours}ч`
  if (hours > 0) return `${hours}ч ${mins}м`
  const secs = Math.floor((remaining % (1000 * 60)) / 1000)
  return `${mins}м ${secs}с`
}

export function GiveawaySheet({ giveaways, meta, onClose, onChanged }: GiveawaySheetProps) {
  const [participating, setParticipating] = useState<string | null>(null)
  const [printId, setPrintId] = useState<string | null>(null)
  // v12.6: Real-time participant count — poll every 10s while sheet is open.
  // This gives a "live" feel without Socket.IO complexity.
  const [liveGiveaways, setLiveGiveaways] = useState(giveaways)
  useEffect(() => {
    setLiveGiveaways(giveaways)
    const interval = setInterval(async () => {
      try {
        const fresh = await clubApi.listGiveaways()
        setLiveGiveaways(fresh)
      } catch {}
    }, 10000)
    return () => clearInterval(interval)
  }, [giveaways])

  const handleParticipate = useCallback(async (giveaway: ClubGiveaway) => {
    haptic.heavy()
    setParticipating(giveaway.id)
    try {
      await clubApi.participateInGiveaway(giveaway.id)
      setPrintId(giveaway.id)
      haptic.success()
      setTimeout(() => setPrintId(null), 800)
      toast.success('🎫 Вы участвуете!', { description: giveaway.title })
      await onChanged()
    } catch (e: any) {
      haptic.error()
      toast.error(e?.message || 'Не удалось участвовать')
    } finally {
      setParticipating(null)
    }
  }, [onChanged])

  return (
    <ClubSheetWrapper meta={meta} onClose={onClose} subtitle="Бесплатные розыгрыши · один пользователь = одна заявка">
      <div className="p-4 space-y-4">
        {liveGiveaways.map((giveaway, i) => {
          const isParticipating = giveaway.isParticipating
          const isDrawn = !!giveaway.drawnAt
          const isPrinting = printId === giveaway.id
          const ticketNumber = `№ ${giveaway.id.slice(-6).toUpperCase()}`

          return (
            <motion.div
              key={giveaway.id}
              variants={ticketPrint}
              initial="hidden"
              animate="visible"
              transition={{ delay: i * 0.1 }}
              className="relative"
            >
              {/* Ticket with perforated edge */}
              <div className="relative flex">
                {/* Main ticket body */}
                <div
                  className={cn(
                    'flex-1 relative rounded-l-2xl overflow-hidden',
                    'border-2 border-r-0',
                    isParticipating ? 'border-amber-500/50' : 'border-amber-500/30',
                  )}
                  style={{
                    background: isDrawn
                      ? 'linear-gradient(135deg, rgba(100,116,139,0.15), rgba(71,85,105,0.1))'
                      : 'linear-gradient(135deg, rgba(245,158,11,0.12), rgba(236,72,153,0.08))',
                  }}
                >
                  {/* Image + overlay */}
                  {giveaway.image && (
                    <div className="relative h-28 overflow-hidden">
                      <img src={assetUrl(giveaway.image)} alt="" className="w-full h-full object-cover" loading="lazy" />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
                      <div className="absolute top-2 left-2">
                        <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-amber-500/90 text-white backdrop-blur-sm">
                          {ticketNumber}
                        </span>
                      </div>
                      {isDrawn && (
                        <div className="absolute top-2 right-2 flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/90 text-white text-[9px] font-bold backdrop-blur-sm">
                          <Trophy className="h-3 w-3" /> Итоги
                        </div>
                      )}
                    </div>
                  )}

                  <div className="p-3">
                    <h3 className="font-bold text-sm leading-tight">{giveaway.title}</h3>
                    <p className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">{giveaway.description}</p>

                    {/* Stats row */}
                    <div className="flex items-center gap-3 mt-2 text-[10px] text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Users className="h-3 w-3" />
                        <motion.span
                          key={giveaway.participantsCount}
                          initial={{ scale: 1.2, color: '#f59e0b' }}
                          animate={{ scale: 1, color: 'currentColor' }}
                          transition={{ duration: 0.3 }}
                          className="font-bold tabular-nums"
                        >
                          {giveaway.participantsCount || 0}
                        </motion.span>
                        участников
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        <CountdownText drawAt={giveaway.drawAt} />
                      </span>
                    </div>

                    {/* Winner display */}
                    {isDrawn && giveaway.winnerIds && giveaway.winnerIds.length > 0 && (
                      <div className="mt-2 flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
                        <Crown className="h-3.5 w-3.5 text-amber-500" />
                        <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                          Победитель определён!
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Perforated edge + stub */}
                <div className="relative flex flex-col items-center justify-center w-16 rounded-r-2xl border-2 border-l-0 border-amber-500/30 bg-amber-500/5">
                  {/* Perforation dots */}
                  <div className="absolute left-0 top-0 bottom-0 w-px flex flex-col justify-evenly">
                    {[...Array(8)].map((_, j) => (
                      <div key={j} className="w-1.5 h-1.5 rounded-full bg-background -ml-0.5" />
                    ))}
                  </div>
                  {/* Stub content */}
                  <div className="flex flex-col items-center gap-1 px-2">
                    {isParticipating ? (
                      <>
                        <div className="h-8 w-8 rounded-full bg-emerald-500 grid place-items-center">
                          <Check className="h-5 w-5 text-white" strokeWidth={3} />
                        </div>
                        <span className="text-[8px] font-bold text-emerald-500 text-center leading-tight">ВЫ<br/>УЧАСТВУЕТЕ</span>
                      </>
                    ) : isDrawn ? (
                      <>
                        <Trophy className="h-6 w-6 text-amber-500/50" />
                        <span className="text-[8px] text-muted-foreground text-center">ЗАВЕРШЁН</span>
                      </>
                    ) : (
                      <>
                        <Trophy className="h-6 w-6 text-amber-500" />
                        <span className="text-[8px] font-bold text-amber-600 dark:text-amber-400 text-center leading-tight">{giveaway.winnersCount}<br/>ПРИЗ{giveaway.winnersCount > 1 ? 'А' : ''}</span>
                      </>
                    )}
                  </div>
                </div>

                {/* Print animation overlay */}
                <AnimatePresence>
                  {isPrinting && (
                    <>
                      {[...Array(6)].map((_, j) => (
                        <motion.div
                          key={j}
                          variants={confettiBurst}
                          initial="idle"
                          animate="burst"
                          className="absolute w-2 h-2 rounded-full bg-amber-400"
                          style={{
                            top: '50%', left: '50%',
                            x: Math.cos((j / 6) * Math.PI * 2) * 60,
                            y: Math.sin((j / 6) * Math.PI * 2) * 60,
                          }}
                        />
                      ))}
                    </>
                  )}
                </AnimatePresence>
              </div>

              {/* Participate button */}
              {!isDrawn && (
                <button
                  onClick={() => handleParticipate(giveaway)}
                  disabled={isParticipating || participating === giveaway.id}
                  className={cn(
                    'w-full h-10 rounded-xl mt-2 text-sm font-bold transition-all flex items-center justify-center gap-1.5',
                    isParticipating
                      ? 'bg-emerald-500/20 text-emerald-500'
                      : 'text-white active:scale-[0.98] shadow-glow',
                  )}
                  style={!isParticipating ? { backgroundImage: 'linear-gradient(135deg, #f59e0b 0%, #ec4899 100%)' } : undefined}
                >
                  {participating === giveaway.id ? '...' : isParticipating ? '✓ Вы участвуете' : 'Участвовать бесплатно'}
                </button>
              )}
            </motion.div>
          )
        })}

        {giveaways.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Trophy className="h-12 w-12 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground text-center px-4">
              Розыгрыши скоро появятся. Участвуйте бесплатно и выигрывайте призы!
            </p>
          </div>
        )}
      </div>
    </ClubSheetWrapper>
  )
}

/** Countdown display component (hooks must be at top level). */
function CountdownText({ drawAt }: { drawAt: string }) {
  const countdown = useCountdown(drawAt)
  return <>{countdown}</>
}
