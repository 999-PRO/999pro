'use client'

/**
 * CouponSheet — 🎟 bespoke coupon experience.
 *
 * Visual identity: each coupon is a physical "ticket stub" with a
 * perforated edge between the main body and the stub. Different colors
 * per discount type (percent = pink, fixed = violet). Claiming triggers
 * a "tear off" animation. Claimed coupons are visually "punched".
 */

import { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Ticket, Check, Copy, Percent, Ruler } from 'lucide-react'
import { toast } from '@/lib/notifications'
import { cn } from '@/lib/utils'
import { haptic } from '@/lib/haptic'
import { clubApi } from '../../api'
import { assetUrl } from '@/lib/api'
import type { ClubCoupon, ClubCardMeta } from '../../types'
import { couponTear } from '../../animations'
import { ClubSheetWrapper } from './club-sheet-wrapper'

interface CouponSheetProps {
  coupons: ClubCoupon[]
  meta: ClubCardMeta
  onClose: () => void
  onChanged: () => Promise<void>
}

export function CouponSheet({ coupons, meta, onClose, onChanged }: CouponSheetProps) {
  const [claiming, setClaiming] = useState<string | null>(null)
  const [tearId, setTearId] = useState<string | null>(null)

  const handleClaim = useCallback(async (coupon: ClubCoupon) => {
    haptic.heavy()
    setClaiming(coupon.id)
    try {
      await clubApi.claimCoupon(coupon.id)
      setTearId(coupon.id)
      haptic.success()
      setTimeout(() => setTearId(null), 600)
      toast.success('🎟 Купон активирован!', {
        description: coupon.code ? `Код: ${coupon.code}` : undefined,
      })
      await onChanged()
    } catch (e: any) {
      haptic.error()
      toast.error(e?.message || 'Не удалось активировать купон')
    } finally {
      setClaiming(null)
    }
  }, [onChanged])

  const handleCopy = useCallback((code: string) => {
    haptic.tap()
    navigator.clipboard.writeText(code).then(() => toast.success('Код скопирован'))
  }, [])

  return (
    <ClubSheetWrapper meta={meta} onClose={onClose} subtitle="Промокоды и скидочные купоны">
      <div className="p-4 space-y-3">
        {coupons.map((coupon, i) => {
          const isClaimed = coupon.claimedByMe
          const isClaiming = claiming === coupon.id
          const isTearing = tearId === coupon.id
          const isPercent = coupon.discountType === 'percent'
          const soldOut = coupon.remaining != null && coupon.remaining === 0

          const accentColor = isPercent ? '#ec4899' : '#8b5cf6'
          const accentBg = isPercent
            ? 'linear-gradient(135deg, rgba(236,72,153,0.10), rgba(217,70,239,0.06))'
            : 'linear-gradient(135deg, rgba(139,92,246,0.10), rgba(99,102,241,0.06))'

          return (
            <motion.div
              key={coupon.id}
              variants={couponTear}
              initial="idle"
              animate={isTearing ? 'tear' : 'idle'}
              transition={{ delay: i * 0.06 }}
              className="relative flex"
            >
              {/* Main coupon body */}
              <div
                className={cn(
                  'flex-1 relative rounded-l-2xl overflow-hidden border-2 border-r-0 p-3',
                  isClaimed ? 'border-emerald-500/20' : 'border-border/40',
                )}
                style={{ background: accentBg }}
              >
                {/* Discount badge — HUGE */}
                <div className="flex items-start gap-3">
                  <div
                    className="shrink-0 rounded-xl p-2.5 grid place-items-center"
                    style={{ background: `linear-gradient(135deg, ${accentColor}, ${isPercent ? '#d946ef' : '#6366f1'})` }}
                  >
                    {isPercent ? (
                      <Percent className="h-5 w-5 text-white" strokeWidth={2.5} />
                    ) : (
                      <Ruler className="h-5 w-5 text-white" strokeWidth={2.5} />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-1">
                      <span className="text-2xl font-extrabold" style={{ color: accentColor }}>
                        {coupon.discountValue}
                      </span>
                      <span className="text-sm font-bold" style={{ color: accentColor }}>
                        {isPercent ? '%' : '₽'}
                      </span>
                      <span className="text-[10px] text-muted-foreground ml-1">скидка</span>
                    </div>
                    <h3 className="font-bold text-sm leading-tight mt-0.5">{coupon.title}</h3>
                    <p className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">{coupon.description}</p>
                  </div>
                </div>

                {/* Meta row */}
                <div className="flex items-center gap-2 mt-2 text-[10px] text-muted-foreground">
                  {coupon.code && (
                    <button
                      onClick={() => handleCopy(coupon.code!)}
                      className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-foreground/5 hover:bg-foreground/10 transition-colors font-mono font-bold"
                    >
                      {coupon.code}
                      <Copy className="h-2.5 w-2.5" />
                    </button>
                  )}
                  {coupon.remaining != null && (
                    <span>Осталось: {coupon.remaining}</span>
                  )}
                </div>

                {/* Claimed "punch hole" */}
                {isClaimed && (
                  <div className="absolute top-2 right-2 h-6 w-6 rounded-full bg-emerald-500 grid place-items-center">
                    <Check className="h-4 w-4 text-white" strokeWidth={3} />
                  </div>
                )}
              </div>

              {/* Perforation */}
              <div className="relative flex flex-col items-center justify-center w-3">
                <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 border-l-2 border-dashed border-border/50" />
              </div>

              {/* Stub */}
              <div
                className={cn(
                  'w-20 rounded-r-2xl border-2 border-l-0 p-2 flex flex-col items-center justify-center gap-1',
                  isClaimed ? 'border-emerald-500/20' : 'border-border/40',
                )}
                style={{ background: accentBg }}
              >
                {isClaimed ? (
                  <>
                    <Check className="h-6 w-6 text-emerald-500" strokeWidth={2.5} />
                    <span className="text-[8px] font-bold text-emerald-500 text-center leading-tight">ИСПОЛЬЗОВАН</span>
                  </>
                ) : soldOut ? (
                  <>
                    <Ticket className="h-6 w-6 text-muted-foreground/50" />
                    <span className="text-[8px] text-muted-foreground text-center">НЕТ</span>
                  </>
                ) : (
                  <button
                    onClick={() => handleClaim(coupon)}
                    disabled={isClaiming}
                    className="flex flex-col items-center gap-1 active:scale-90 transition-transform"
                  >
                    <div
                      className="h-8 w-8 rounded-full grid place-items-center"
                      style={{ background: `linear-gradient(135deg, ${accentColor}, ${isPercent ? '#d946ef' : '#6366f1'})` }}
                    >
                      {isClaiming ? (
                        <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}>
                          <Ticket className="h-4 w-4 text-white" />
                        </motion.div>
                      ) : (
                        <Ticket className="h-4 w-4 text-white" />
                      )}
                    </div>
                    <span className="text-[8px] font-bold text-center leading-tight" style={{ color: accentColor }}>
                      АКТИВИРОВАТЬ
                    </span>
                  </button>
                )}
              </div>
            </motion.div>
          )
        })}

        {coupons.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Ticket className="h-12 w-12 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground text-center px-4">
              Купоны скоро появятся. Активируйте промокоды и получайте скидки!
            </p>
          </div>
        )}
      </div>
    </ClubSheetWrapper>
  )
}
