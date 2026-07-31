'use client'

/**
 * /verify-email — frontend success/error page for email verification.
 *
 * v16.8 final: previously GET /api/auth/verify-email?token=xxx returned raw
 * JSON, which is a poor UX (user clicks a link in the email and sees
 * `{"ok":true,"message":"Email успешно подтверждён."}`). This page wraps the
 * same API call with a branded, mobile-friendly UI:
 *
 *  States:
 *   - loading (verifying…) → spinner
 *   - success → green checkmark + "Email подтверждён" + button to home
 *   - error (invalid/expired token) → red icon + message + "request new
 *     verification email" link (auto-logs in if user has a JWT cookie)
 *   - no token in URL → invalid-link state
 *
 * The page is intentionally simple — no animations beyond a single fade-in —
 * because email-confirmation pages are visited once and the user expects a
 * fast, no-frills confirmation that their action worked.
 */

import { useEffect, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
  CheckCircle2,
  XCircle,
  MailCheck,
  MailWarning,
  Loader2,
  ArrowRight,
} from 'lucide-react'
// v16.8 final: after a successful verification we refresh the auth store so
// the `emailVerified` field on the user object is updated. This makes the
// "verify your email" banner in the profile screen disappear the next time
// the user navigates to their profile (without needing a full page reload).
import { useAuthStore } from '@/lib/auth-store'

type VerifyState = 'loading' | 'success' | 'error' | 'no-token'

function VerifyWrapper({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-[100dvh] grid place-items-center px-4 py-12 bg-gradient-to-b from-background to-muted/30">
      <div className="w-full max-w-md text-center">{children}</div>
    </main>
  )
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<VerifyEmailLoading />}>
      <VerifyEmailContent />
    </Suspense>
  )
}

function VerifyEmailContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const token = searchParams.get('token')
  const [state, setState] = useState<VerifyState>(token ? 'loading' : 'no-token')
  const [errorMessage, setErrorMessage] = useState<string>('')
  const [resendSent, setResendSent] = useState(false)
  // v16.8 final: pull fetchMe so we can refresh the user's emailVerified
  // status after a successful verification.
  const fetchMe = useAuthStore((s) => s.fetchMe)

  useEffect(() => {
    if (!token) {
      setState('no-token')
      return
    }
    let cancelled = false
    setState('loading')
    fetch(`/api/auth/verify-email?token=${encodeURIComponent(token)}`, {
      method: 'GET',
      // Use credentials so a logged-in user's JWT cookie (if any) is sent —
      // this lets the backend's audit log attribute the verification to the
      // correct user.
      credentials: 'include',
    })
      .then(async (res) => {
        if (cancelled) return
        const data = await res.json().catch(() => ({}))
        if (res.ok && data.ok) {
          setState('success')
          // Refresh the auth store so the user object's emailVerified field
          // is updated. This is non-blocking — if the user has no JWT (e.g.
          // they opened the link in a different browser), fetchMe will
          // silently no-op (the API returns 401 which fetchMe handles).
          fetchMe().catch(() => {})
        } else {
          setState('error')
          setErrorMessage(data.error || 'Не удалось подтвердить email.')
        }
      })
      .catch(() => {
        if (cancelled) return
        setState('error')
        setErrorMessage('Проверьте подключение к интернету и попробуйте снова.')
      })
    return () => {
      cancelled = true
    }
  }, [token, fetchMe])

  const handleResend = async () => {
    try {
      const res = await fetch('/api/auth/send-verification', {
        method: 'POST',
        credentials: 'include',
      })
      if (res.ok) {
        setResendSent(true)
      } else {
        const data = await res.json().catch(() => ({}))
        setErrorMessage(data.error || 'Не удалось отправить письмо.')
      }
    } catch {
      setErrorMessage('Проверьте подключение к интернету.')
    }
  }

  if (state === 'loading') {
    return (
      <VerifyWrapper>
        <div className="mx-auto mb-6 h-20 w-20 rounded-3xl bg-primary/10 grid place-items-center">
          <Loader2 className="h-10 w-10 text-primary animate-spin" />
        </div>
        <h1 className="text-2xl font-bold mb-2">Подтверждаем email…</h1>
        <p className="text-muted-foreground text-sm">
          Пожалуйста, подождите несколько секунд.
        </p>
      </VerifyWrapper>
    )
  }

  if (state === 'success') {
    return (
      <VerifyWrapper>
        <div className="mx-auto mb-6 h-24 w-24 rounded-full bg-emerald-500/15 grid place-items-center shadow-lg shadow-emerald-500/20">
          <CheckCircle2 className="h-14 w-14 text-emerald-500" strokeWidth={2.4} />
        </div>
        <h1 className="text-3xl font-extrabold mb-3 tracking-tight">
          Email подтверждён!
        </h1>
        <p className="text-muted-foreground mb-7 leading-relaxed">
          Ваш адрес электронной почты успешно подтверждён. Теперь вам доступны
          все возможности 999 — Три девятки — чат, CLUB, заказы и push-уведомления.
        </p>
        <Button
          onClick={() => router.push('/')}
          className="rounded-full gradient-brand text-white font-semibold shadow-glow h-12 px-8 text-base"
        >
          Перейти в приложение
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </VerifyWrapper>
    )
  }

  if (state === 'no-token') {
    return (
      <VerifyWrapper>
        <div className="mx-auto mb-6 h-24 w-24 rounded-full bg-amber-500/15 grid place-items-center shadow-lg shadow-amber-500/20">
          <MailWarning className="h-14 w-14 text-amber-500" strokeWidth={2.2} />
        </div>
        <h1 className="text-2xl font-bold mb-3">Ссылка недействительна</h1>
        <p className="text-muted-foreground mb-7 leading-relaxed">
          В ссылке отсутствует код подтверждения. Откройте письмо от 999 — Три девятки и
          нажмите кнопку «Подтвердить email».
        </p>
        <Button
          onClick={() => router.push('/')}
          variant="outline"
          className="rounded-full font-semibold h-12 px-8"
        >
          На главную
        </Button>
      </VerifyWrapper>
    )
  }

  // state === 'error'
  return (
    <VerifyWrapper>
      <div className="mx-auto mb-6 h-24 w-24 rounded-full bg-rose-500/15 grid place-items-center shadow-lg shadow-rose-500/20">
        <XCircle className="h-14 w-14 text-rose-500" strokeWidth={2.2} />
      </div>
      <h1 className="text-2xl font-bold mb-3">Не удалось подтвердить</h1>
      <p className="text-muted-foreground mb-2 leading-relaxed">
        {errorMessage || 'Срок действия ссылки истёк или она уже была использована.'}
      </p>
      <p className="text-muted-foreground mb-7 text-sm leading-relaxed">
        Вы можете запросить новое письмо с подтверждением — оно придёт в течение
        пары минут.
      </p>
      {resendSent ? (
        <div className="rounded-2xl bg-emerald-500/10 border border-emerald-500/30 px-5 py-4 text-sm text-emerald-700 dark:text-emerald-400 mb-5">
          <div className="flex items-center gap-2 justify-center">
            <MailCheck className="h-5 w-5" />
            <span className="font-semibold">Новое письмо отправлено</span>
          </div>
          <p className="text-xs mt-1 text-emerald-600/80 dark:text-emerald-400/80">
            Проверьте свой почтовый ящик.
          </p>
        </div>
      ) : (
        <Button
          onClick={handleResend}
          className="rounded-full gradient-brand text-white font-semibold shadow-glow h-12 px-8 mb-3"
        >
          Отправить письмо повторно
        </Button>
      )}
      <div>
        <Button
          onClick={() => router.push('/')}
          variant="outline"
          className="rounded-full font-semibold h-12 px-8"
        >
          На главную
        </Button>
      </div>
      </VerifyWrapper>
  )
}

function VerifyEmailLoading() {
  return (
    <main className="min-h-[100dvh] grid place-items-center px-4 py-12 bg-gradient-to-b from-background to-muted/30">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto mb-6 h-20 w-20 rounded-3xl bg-primary/10 grid place-items-center">
          <Loader2 className="h-10 w-10 text-primary animate-spin" />
        </div>
        <h1 className="text-2xl font-bold mb-2">Подтверждаем email…</h1>
        <p className="text-muted-foreground text-sm">
          Пожалуйста, подождите несколько секунд.
        </p>
      </div>
    </main>
  )
}
