'use client'

/**
 * v20: EmailVerificationModal — premium modal shown after registration when
 * SecuritySettings.emailVerificationRequired is ON.
 *
 * Flow:
 *   1. User submits registration form
 *   2. Backend creates the user + sends verification email with a link
 *   3. This modal opens (the auth-dialog stays dismissed)
 *   4. User either:
 *      a) Clicks the link in the email → backend verifies → this tab polls
 *         /api/auth/me and detects emailVerified → auto-activates session
 *      b) Pastes the link URL into the input → we extract the token and
 *         call /api/auth/verify-email?token=... directly
 *   5. On success: completeEmailVerification() activates the session with
 *      the stashed pending token, modal closes, user is logged in.
 *
 * The modal also offers a "Send again" button (rate-limited to 60s).
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { MailCheck, Loader2, RefreshCw, X, Check, ArrowRight } from 'lucide-react'
import { useAuthStore } from '@/lib/auth-store'
import { api } from '@/lib/api'
import { toast } from '@/lib/notifications'
import { haptic } from '@/lib/haptic'

interface EmailVerificationModalProps {
  open: boolean
  email: string
  onClose: () => void
  onVerified: () => void
}

export function EmailVerificationModal({ open, email, onClose, onVerified }: EmailVerificationModalProps) {
  const completeEmailVerification = useAuthStore((s) => s.completeEmailVerification)
  const [input, setInput] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [resendIn, setResendIn] = useState(60)
  const [resending, setResending] = useState(false)
  const [verified, setVerified] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Countdown for resend button
  useEffect(() => {
    if (!open) return
    setResendIn(60)
    const t = setInterval(() => {
      setResendIn((s) => (s > 0 ? s - 1 : 0))
    }, 1000)
    return () => clearInterval(t)
  }, [open])

  // Poll /api/auth/me every 4s while the modal is open — detects when the
  // user has clicked the email link in another tab/device.
  useEffect(() => {
    if (!open || verified) return
    const poll = async () => {
      try {
        const data = await api.get<{ user: { emailVerified?: string | null } }>('/api/auth/me', { auth: true })
        if (data.user?.emailVerified) {
          setVerified(true)
          completeEmailVerification()
          haptic.success()
          setTimeout(() => {
            onVerified()
          }, 1200)
        }
      } catch {
        // 401 expected if the stashed token isn't set yet — ignore
      }
    }
    pollRef.current = setInterval(poll, 4000)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [open, verified, completeEmailVerification, onVerified])

  const handleResend = useCallback(async () => {
    if (resendIn > 0 || resending) return
    setResending(true)
    try {
      await api.post('/api/auth/send-verification', { json: {}, auth: true })
      toast.success('Письмо отправлено повторно')
      setResendIn(60)
    } catch (e: any) {
      toast.error(e?.message || 'Не удалось отправить письмо')
    } finally {
      setResending(false)
    }
  }, [resendIn, resending])

  const handleVerifyToken = useCallback(async () => {
    const trimmed = input.trim()
    if (!trimmed) {
      toast.error('Вставьте ссылку или код из письма')
      return
    }
    setVerifying(true)
    try {
      // Extract token from pasted URL or accept raw token
      let token = trimmed
      try {
        const url = new URL(trimmed)
        const t = url.searchParams.get('token')
        if (t) token = t
      } catch {
        // Not a URL — treat as raw token
      }
      const res = await fetch(`/api/auth/verify-email?token=${encodeURIComponent(token)}`, {
        method: 'GET',
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.ok) {
        setVerified(true)
        completeEmailVerification()
        haptic.success()
        toast.success('Email подтверждён!')
        setTimeout(() => onVerified(), 1200)
      } else {
        toast.error(data.error || 'Не удалось подтвердить email')
      }
    } catch (e: any) {
      toast.error(e?.message || 'Ошибка верификации')
    } finally {
      setVerifying(false)
    }
  }, [input, completeEmailVerification, onVerified])

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[200] grid place-items-center p-4"
          style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.92, y: 16, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.92, y: 16, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            className="relative w-full max-w-md rounded-3xl overflow-hidden glass-strong border border-border/40 shadow-glow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Success overlay */}
            <AnimatePresence>
              {verified && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 z-10 grid place-items-center bg-background/95 backdrop-blur-md"
                >
                  <div className="text-center px-6">
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ type: 'spring', stiffness: 260, damping: 15 }}
                      className="h-20 w-20 rounded-full bg-emerald-500 grid place-items-center mx-auto mb-4 shadow-glow"
                    >
                      <Check className="h-10 w-10 text-white" strokeWidth={3} />
                    </motion.div>
                    <h3 className="text-xl font-bold mb-1">Email подтверждён!</h3>
                    <p className="text-sm text-muted-foreground">Выполняем вход…</p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Header */}
            <div className="relative p-6 pb-4">
              <button
                onClick={onClose}
                aria-label="Закрыть"
                className="absolute top-4 right-4 h-8 w-8 rounded-full grid place-items-center text-muted-foreground hover:bg-accent transition-colors"
              >
                <X className="h-4 w-4" />
              </button>

              <div className="flex flex-col items-center text-center">
                <motion.div
                  initial={{ scale: 0, rotate: -30 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ type: 'spring', stiffness: 260, damping: 18, delay: 0.1 }}
                  className="h-16 w-16 rounded-2xl grid place-items-center mb-4 shadow-glow"
                  style={{
                    background: 'linear-gradient(135deg, #38bdf8 0%, #2563eb 50%, #7c3aed 100%)',
                  }}
                >
                  <MailCheck className="h-8 w-8 text-white" strokeWidth={2.2} />
                </motion.div>
                <h2 className="text-xl font-extrabold tracking-tight mb-1">Подтвердите Email</h2>
                <p className="text-sm text-muted-foreground px-2">
                  Мы отправили письмо на{' '}
                  <span className="font-semibold text-foreground">{email}</span>.
                  <br />
                  Перейдите по ссылке из письма или вставьте её ниже.
                </p>
              </div>
            </div>

            {/* Body */}
            <div className="px-6 pb-6 space-y-4">
              {/* Link/token input */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Ссылка или код из письма
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !verifying) handleVerifyToken() }}
                    placeholder="https://...?token=..."
                    className="flex-1 h-11 rounded-xl bg-foreground/5 border border-border/40 px-3 text-sm font-mono outline-none focus:border-primary/60 transition-colors"
                    autoFocus
                  />
                  <button
                    onClick={handleVerifyToken}
                    disabled={verifying || !input.trim()}
                    className="h-11 px-4 rounded-xl gradient-brand text-white text-sm font-bold disabled:opacity-50 flex items-center gap-1.5 shrink-0"
                  >
                    {verifying ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                    <span className="hidden sm:inline">Подтвердить</span>
                  </button>
                </div>
              </div>

              {/* Divider */}
              <div className="flex items-center gap-3 py-1">
                <div className="flex-1 h-px bg-border/40" />
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">или</span>
                <div className="flex-1 h-px bg-border/40" />
              </div>

              {/* Resend button */}
              <button
                onClick={handleResend}
                disabled={resendIn > 0 || resending}
                className="w-full h-11 rounded-xl border border-border/40 text-sm font-medium flex items-center justify-center gap-2 hover:bg-accent/50 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {resending ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Отправка…</>
                ) : resendIn > 0 ? (
                  <>Отправить повторно через {resendIn}с</>
                ) : (
                  <><RefreshCw className="h-4 w-4" /> Отправить письмо снова</>
                )}
              </button>

              <p className="text-[11px] text-center text-muted-foreground leading-relaxed">
                Если письмо не пришло — проверьте папку «Спам». Ссылка действительна 24 часа.
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
