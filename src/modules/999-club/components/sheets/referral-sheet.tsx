'use client'

/**
 * ReferralSheet — 👥 bespoke referral experience.
 *
 * Visual identity: NOT a simple list — it's a "referral hub" with:
 *   - Personal referral card with QR code (generated client-side)
 *   - One-tap copy link
 *   - Share buttons (WhatsApp, Telegram, Copy, Native share)
 *   - Stats: friends invited, points earned
 *   - "How it works" 3-step guide
 */

import { useState, useCallback, useMemo, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Users, Copy, Share2, Gift, TrendingUp, Check, MessageCircle } from 'lucide-react'
import QRCode from 'qrcode'
import { toast } from '@/lib/notifications'
import { cn } from '@/lib/utils'
import { haptic } from '@/lib/haptic'
import type { ClubCardMeta } from '../../types'
import { ClubSheetWrapper } from './club-sheet-wrapper'

interface ReferralSheetProps {
  referralCode: string | null
  referralCount: number
  pointsEarnedTotal: number
  meta: ClubCardMeta
  onClose: () => void
}

/** Real QR code generated via the `qrcode` library — scannable by any phone camera. */
function RealQrCode({ data, size = 140 }: { data: string; size?: number }) {
  const [dataUrl, setDataUrl] = useState<string>('')
  useEffect(() => {
    if (!data) return
    QRCode.toDataURL(data, {
      width: size,
      margin: 1,
      color: { dark: '#0f172a', light: '#ffffff' },
      errorCorrectionLevel: 'M',
    })
      .then(setDataUrl)
      .catch(() => {})
  }, [data, size])
  if (!dataUrl) return <div style={{ width: size, height: size }} className="rounded-xl bg-white animate-pulse" />
  return (
    <img
      src={dataUrl}
      width={size}
      height={size}
      alt="QR код для реферальной ссылки"
      className="rounded-xl"
    />
  )
}

export function ReferralSheet({
  referralCode,
  referralCount,
  pointsEarnedTotal,
  meta,
  onClose,
}: ReferralSheetProps) {
  const [copied, setCopied] = useState(false)

  const referralLink = useMemo(() => {
    if (!referralCode) return ''
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://999.pro'
    return `${origin}/?ref=${referralCode}`
  }, [referralCode])

  const handleCopy = useCallback(async () => {
    if (!referralLink) return
    haptic.tap()
    try {
      await navigator.clipboard.writeText(referralLink)
      setCopied(true)
      toast.success('Ссылка скопирована')
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Не удалось скопировать')
    }
  }, [referralLink])

  const handleShare = useCallback(async () => {
    haptic.tap()
    if (navigator.share) {
      try {
        await navigator.share({
          title: '999PRO — приглашаю тебя!',
          text: 'Присоединяйся к 999PRO и получи бонус при регистрации по моей ссылке:',
          url: referralLink,
        })
      } catch {}
    } else {
      handleCopy()
    }
  }, [referralLink, handleCopy])

  const handleWhatsApp = useCallback(() => {
    haptic.tap()
    const text = encodeURIComponent(`Присоединяйся к 999PRO! Регистрируйся по ссылке и получи бонус: ${referralLink}`)
    window.open(`https://wa.me/?text=${text}`, '_blank', 'noopener,noreferrer')
  }, [referralLink])

  const handleTelegram = useCallback(() => {
    haptic.tap()
    const text = encodeURIComponent('Присоединяйся к 999PRO и получи бонус при регистрации!')
    window.open(`https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${text}`, '_blank', 'noopener,noreferrer')
  }, [referralLink])

  return (
    <ClubSheetWrapper meta={meta} onClose={onClose} subtitle="Приглашайте друзей и получайте баллы">
      <div className="p-4 space-y-4">
        {/* Referral card with QR */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3 }}
          className="relative rounded-3xl overflow-hidden p-6 text-center"
          style={{
            background: 'linear-gradient(135deg, rgba(16,185,129,0.12) 0%, rgba(139,92,246,0.10) 50%, rgba(245,158,11,0.10) 100%)',
            border: '1px solid rgba(255,255,255,0.12)',
          }}
        >
          {/* Glow */}
          <div aria-hidden className="absolute -top-12 -right-12 h-32 w-32 rounded-full bg-emerald-500/20 blur-3xl" />
          <div aria-hidden className="absolute -bottom-12 -left-12 h-32 w-32 rounded-full bg-violet-500/20 blur-3xl" />

          <div className="relative">
            {/* QR code */}
            <div className="inline-block rounded-2xl p-3 bg-white shadow-glow mb-3">
              <RealQrCode data={referralLink || 'empty'} size={140} />
            </div>

            <h3 className="font-bold text-base mb-1">Ваша персональная ссылка</h3>
            <p className="text-xs text-muted-foreground mb-3">
              Поделитесь ссылкой — друг получит welcome-бонус, а вы — 50 баллов за каждого.
            </p>

            {/* Link box */}
            <div className="rounded-xl bg-foreground/5 p-2.5 mb-3">
              <div className="font-mono text-[11px] break-all text-muted-foreground select-all">
                {referralLink || '—'}
              </div>
            </div>

            {/* Copy button */}
            <button
              onClick={handleCopy}
              className={cn(
                'w-full h-10 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2',
                copied
                  ? 'bg-emerald-500 text-white'
                  : 'text-white active:scale-[0.98]',
              )}
              style={!copied ? { backgroundImage: 'linear-gradient(135deg, #10b981 0%, #8b5cf6 50%, #f59e0b 100%)' } : undefined}
            >
              {copied ? <><Check className="h-4 w-4" /> Скопировано</> : <><Copy className="h-4 w-4" /> Копировать ссылку</>}
            </button>
          </div>
        </motion.div>

        {/* Share buttons */}
        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={handleWhatsApp}
            className="flex flex-col items-center gap-1.5 p-3 rounded-2xl glass border border-border/40 hover:bg-foreground/5 transition-colors"
          >
            <div className="h-10 w-10 rounded-full bg-[#25D366] grid place-items-center">
              <MessageCircle className="h-5 w-5 text-white" fill="currentColor" />
            </div>
            <span className="text-[10px] font-semibold">WhatsApp</span>
          </button>
          <button
            onClick={handleTelegram}
            className="flex flex-col items-center gap-1.5 p-3 rounded-2xl glass border border-border/40 hover:bg-foreground/5 transition-colors"
          >
            <div className="h-10 w-10 rounded-full bg-[#0088cc] grid place-items-center">
              <svg viewBox="0 0 24 24" className="h-5 w-5 text-white" fill="currentColor"><path d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71L12.6 16.3l-1.99 1.93c-.23.23-.42.42-.83.42z"/></svg>
            </div>
            <span className="text-[10px] font-semibold">Telegram</span>
          </button>
          <button
            onClick={handleShare}
            className="flex flex-col items-center gap-1.5 p-3 rounded-2xl glass border border-border/40 hover:bg-foreground/5 transition-colors"
          >
            <div className="h-10 w-10 rounded-full gradient-club grid place-items-center">
              <Share2 className="h-5 w-5 text-white" />
            </div>
            <span className="text-[10px] font-semibold">Ещё…</span>
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl glass border border-border/40 p-4 text-center">
            <div className="h-10 w-10 rounded-xl bg-emerald-500/15 grid place-items-center mx-auto mb-2">
              <Users className="h-5 w-5 text-emerald-500" />
            </div>
            <div className="text-2xl font-extrabold tabular-nums">{referralCount}</div>
            <div className="text-[10px] text-muted-foreground">приглашено друзей</div>
          </div>
          <div className="rounded-2xl glass border border-border/40 p-4 text-center">
            <div className="h-10 w-10 rounded-xl bg-amber-500/15 grid place-items-center mx-auto mb-2">
              <TrendingUp className="h-5 w-5 text-amber-500" />
            </div>
            <div className="text-2xl font-extrabold tabular-nums">{pointsEarnedTotal}</div>
            <div className="text-[10px] text-muted-foreground">всего баллов</div>
          </div>
        </div>

        {/* How it works */}
        <div className="rounded-2xl glass border border-border/40 p-4">
          <h4 className="font-bold text-sm mb-3 flex items-center gap-2">
            <Gift className="h-4 w-4 text-emerald-500" />
            Как это работает
          </h4>
          <div className="space-y-2.5">
            {[
              { n: '1', t: 'Поделитесь ссылкой', d: 'Отправьте другу вашу персональную ссылку' },
              { n: '2', t: 'Друг регистрируется', d: 'Друг нажимает на ссылку и создаёт аккаунт' },
              { n: '3', t: 'Оба получаете баллы', d: 'Вы — 50 баллов, друг — welcome-бонус 100 баллов' },
            ].map((step) => (
              <div key={step.n} className="flex items-start gap-2.5">
                <div className="h-6 w-6 rounded-full gradient-club grid place-items-center shrink-0 text-white text-xs font-bold">
                  {step.n}
                </div>
                <div>
                  <div className="text-xs font-semibold">{step.t}</div>
                  <div className="text-[10px] text-muted-foreground">{step.d}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </ClubSheetWrapper>
  )
}
