'use client'

// ============================================================================
//  AdminLoginView — separate admin login page in the main app
// ----------------------------------------------------------------------------
//  Allows administrators to log in and access Studio directly from the app.
//
//  v25.3 (TZ task #1): Full 2FA / TOTP enrollment flow now happens HERE —
//  no redirect to Studio required. When an admin logs in without TOTP
//  enrolled, the backend returns a short-lived `totpPending` setup token.
//  We stash it in the auth store, then show an inline 4-step wizard:
//
//    Step 1 — Login form (login + password)
//    Step 2 — /totp/setup → backend returns secret + otpauthUrl
//    Step 3 — Render QR (locally via `qrcode` package, no third-party leak)
//    Step 4 — User scans QR in authenticator app, types 6-digit code
//             → /totp/verify → backend issues fresh regular JWT
//             → completeTotpSetup() → navigate to Studio
//
//  Security notes:
//    - The setup token is REJECTED by every admin endpoint (requireAdmin),
//      so a leaked setup token can only be used to finish TOTP enrollment,
//      nothing else. It also expires in 15 minutes.
//    - The QR code is generated locally (qrcode package) — the secret
//      never leaves the user's device. (Older versions leaked it to
//      api.qrserver.com via URL query string.)
//    - After successful verify, the setup token is replaced by a regular
//      JWT via completeTotpSetup() — full admin access restored.
// ============================================================================

import { useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import QRCode from 'qrcode'
import { Shield, Loader2, ArrowLeft, KeyRound, User, Lock, ExternalLink, QrCode, Check, RefreshCw } from 'lucide-react'
import { useAuthStore } from '@/lib/auth-store'
import { api } from '@/lib/api'
import { toast } from '@/lib/notifications'
import type { User as UserType } from '@/lib/types'

// v25.4: 'totp' state added for admins who ALREADY have TOTP enrolled.
//   'none'   — login form (credentials step)
//   'setup'  — first-time TOTP enrollment (fetching QR from /totp/setup)
//   'verify' — first-time TOTP enrollment (user enters 6-digit code after QR scan)
//   'totp'   — returning admin with TOTP already enrolled (enter 6-digit code)
type TotpFlow = 'none' | 'setup' | 'verify' | 'totp'

export function AdminLoginView({ onBack, onNavigate }: { onBack: () => void; onNavigate: (v: string) => void }) {
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  // v25.3: 2FA enrollment state
  const [totpFlow, setTotpFlow] = useState<TotpFlow>('none')
  const [totpCode, setTotpCode] = useState('')
  const [totpQrUrl, setTotpQrUrl] = useState('')
  const [totpSecret, setTotpSecret] = useState('')
  const [totpBusy, setTotpBusy] = useState(false)

  const authLogin = useAuthStore((s) => s.login)
  const completeTotpSetup = useAuthStore((s) => s.completeTotpSetup)
  const clearSetupToken = useAuthStore((s) => s.clearSetupToken)
  const user = useAuthStore((s) => s.user)
  const setupToken = useAuthStore((s) => s.setupToken)

  // v25.3: If the auth store already has a setupToken (e.g. page refresh
  // during the enrollment flow), resume the wizard at the QR step.
  useEffect(() => {
    if (setupToken && totpFlow === 'none' && user?.role === 'admin') {
      setTotpFlow('setup')
      // Re-fetch the QR (the secret may have been cleared on refresh).
      void fetchTotpSetup()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setupToken, user])

  // Cleanup on unmount: if the user navigates away mid-setup, clear the
  // setup token so it doesn't linger in localStorage.
  useEffect(() => {
    return () => {
      if (useAuthStore.getState().setupToken && !useAuthStore.getState().isAuthenticated) {
        clearSetupToken()
      }
    }
  }, [clearSetupToken])

  // If already logged in as admin, show the admin dashboard shortcut.
  if (user?.role === 'admin' && !setupToken) {
    return (
      <div className="min-h-screen flex items-center justify-center p-5 bg-gradient-to-br from-slate-50 to-blue-50 dark:from-slate-900 dark:to-slate-950">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md rounded-3xl border border-border/40 bg-background/80 backdrop-blur-xl p-8 shadow-2xl"
        >
          <div className="flex flex-col items-center text-center gap-3 mb-6">
            <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 grid place-items-center shadow-lg shadow-blue-500/30">
              <Shield className="h-8 w-8 text-white" />
            </div>
            <h1 className="text-2xl font-bold">Вы вошли как администратор</h1>
            <p className="text-sm text-muted-foreground">Привет, {user.displayName || user.username}!</p>
          </div>

          <div className="space-y-3">
            <button
              onClick={() => onNavigate('studio')}
              className="w-full flex items-center justify-center gap-2 h-12 rounded-xl bg-gradient-to-r from-blue-500 to-indigo-600 text-white font-semibold hover:scale-[1.02] transition-transform shadow-lg shadow-blue-500/30"
            >
              <Shield className="h-5 w-5" />
              Открыть Studio
            </button>
            <button
              onClick={onBack}
              className="w-full flex items-center justify-center gap-2 h-12 rounded-xl bg-accent hover:bg-accent/80 transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
              На главную
            </button>
          </div>

          <div className="mt-6 p-3 rounded-xl bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900">
            <div className="text-xs font-semibold text-blue-700 dark:text-blue-300 mb-1">💡 Подсказка</div>
            <div className="text-xs text-muted-foreground">
              Studio — это административная панель для управления товарами, заказами, пользователями и базой знаний AI.
            </div>
          </div>
        </motion.div>
      </div>
    )
  }

  // ========================================================================
  // v25.3: 2FA setup wizard — shown when setupToken is in the store.
  // Step 1 (setup): fetch QR via /totp/setup using the setup token
  // Step 2 (verify): user enters 6-digit code → /totp/verify → completeTotpSetup
  // ========================================================================
  async function fetchTotpSetup() {
    setTotpBusy(true)
    try {
      const data = await api.post<{ secret: string; otpauthUrl: string }>(
        '/api/auth/totp/setup',
        { auth: 'totp-setup', json: {} },
      )
      setTotpQrUrl(data.otpauthUrl)
      setTotpSecret(data.secret)
      setTotpFlow('verify')
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Не удалось получить QR-код'
      toast.error('Ошибка настройки 2FA', { description: msg })
      // Reset back to login form — setup token may be invalid/expired.
      setTotpFlow('none')
      clearSetupToken()
    } finally {
      setTotpBusy(false)
    }
  }

  async function verifyTotpCode() {
    if (totpCode.length !== 6) {
      toast.error('Введите 6-значный код')
      return
    }
    setTotpBusy(true)
    try {
      const result = await api.post<{ enabled: boolean; token: string; user: UserType }>(
        '/api/auth/totp/verify',
        { auth: 'totp-setup', json: { code: totpCode } },
      )
      // Swap the setup token for a regular JWT — full admin access restored.
      completeTotpSetup(result.token, result.user)
      toast.success('2FA настроена!', { description: 'Добро пожаловать, администратор!' })
      // Reset local state
      setTotpFlow('none')
      setTotpCode('')
      setTotpQrUrl('')
      setTotpSecret('')
      // v25.7 (TZ ЭТАП 2.1): land on Home instead of forcing Studio — admin
      // can then pick Chat / Studio / Catalog from the sidebar/bottom-nav.
      // This fixes the symptom "admin logged in but cannot use the chat":
      // the chat is now reachable in one tap from the post-login screen.
      onNavigate('home')
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Неверный код'
      toast.error('Ошибка проверки кода', { description: msg })
      setTotpCode('')
    } finally {
      setTotpBusy(false)
    }
  }

  // v25.4: Submit a 6-digit TOTP code for an admin who ALREADY has 2FA enrolled.
  // This re-calls /api/auth/login with login + password + totpCode in one request —
  // the backend validates the code and returns a regular JWT on success.
  async function verifyTotpLogin() {
    if (totpCode.length !== 6) {
      toast.error('Введите 6-значный код')
      return
    }
    setTotpBusy(true)
    try {
      const result = await authLogin(login, password, totpCode)
      // On success the store is authenticated — result is the User object.
      const u = result as UserType
      if (u?.role !== 'admin') {
        toast.error('Этот аккаунт не является администратором')
        return
      }
      toast.success('Добро пожаловать, администратор!')
      setTotpFlow('none')
      setTotpCode('')
      // v25.7: land on Home — admin can access Chat, Studio, etc. from there.
      onNavigate('home')
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Неверный код'
      toast.error('Неверный код подтверждения', { description: msg })
      setTotpCode('')
    } finally {
      setTotpBusy(false)
    }
  }

  // v25.4: Cancel the 'totp' (already-enrolled) flow — go back to credentials.
  function cancelTotpLogin() {
    setTotpFlow('none')
    setTotpCode('')
  }

  function cancelTotpSetup() {
    setTotpFlow('none')
    setTotpCode('')
    setTotpQrUrl('')
    setTotpSecret('')
    clearSetupToken()
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!login.trim() || !password.trim()) return
    setLoading(true)
    try {
      // v25.4: when in 'totp' state (already-enrolled admin), submit the code
      // alongside the credentials. When in 'none' state, just send credentials.
      const result = await authLogin(login, password, totpFlow === 'totp' ? totpCode : undefined)

      // v25.4: authLogin may now return either a User (success) or a result
      // object ({ totpRequired } or { totpSetupRequired }) when 2FA is required.
      if (result && typeof result === 'object' && 'totpRequired' in result) {
        // Already-enrolled admin — show the 6-digit code input.
        if (result.user?.role !== 'admin') {
          toast.error('Этот аккаунт не является администратором')
          return
        }
        setTotpFlow('totp')
        setTotpCode('')
        toast.info('Введите код 2FA', {
          description: 'Откройте приложение-аутентификатор и введите 6-значный код.',
        })
        return
      }

      if (result && typeof result === 'object' && 'totpSetupRequired' in result) {
        // First-time enrollment — start the QR setup wizard.
        if (useAuthStore.getState().setupToken && (result as { user: UserType }).user?.role !== 'admin') {
          toast.error('Этот аккаунт не является администратором')
          clearSetupToken()
          return
        }
        setTotpFlow('setup')
        toast.info('Требуется настройка 2FA', {
          description: 'Для аккаунта администратора обязательно включение двухфакторной аутентификации.',
        })
        await fetchTotpSetup()
        return
      }

      // Fallback for v25.3 callers: if the auth store got a setupToken even
      // though result is a User (legacy shape), still start the wizard.
      if (useAuthStore.getState().setupToken) {
        const u = result as UserType
        if (u.role !== 'admin') {
          toast.error('Этот аккаунт не является администратором')
          clearSetupToken()
          return
        }
        setTotpFlow('setup')
        toast.info('Требуется настройка 2FA', {
          description: 'Для аккаунта администратора обязательно включение двухфакторной аутентификации.',
        })
        await fetchTotpSetup()
        return
      }

      // Normal login — admin already has TOTP enabled and code was accepted.
      const u = result as UserType
      if (u.role !== 'admin') {
        toast.error('Этот аккаунт не является администратором')
        return
      }
      toast.success('Добро пожаловать, администратор!')
      setTotpFlow('none')
      setTotpCode('')
      // v25.7: land on Home — admin can access Chat, Studio, etc. from there.
      onNavigate('home')
    } catch (e: any) {
      toast.error('Ошибка входа', { description: e?.message || 'Проверьте данные' })
    } finally {
      setLoading(false)
    }
  }

  // v24.6-audit (S-CRIT-2 / C-FE-2 fix): gate default-credential hint behind explicit
  // NEXT_PUBLIC_DEV_HINTS=1 env var (same gate as Studio uses). In any production /
  // staging deploy this hint is suppressed so attackers don't see default creds.
  const SHOW_DEV_HINTS = process.env.NEXT_PUBLIC_DEV_HINTS === '1'

  // ========================================================================
  // v25.4: TOTP-already-enrolled screen — shown when totpFlow === 'totp'.
  // Distinct from the setup wizard: no QR, just a 6-digit code input.
  // ========================================================================
  if (totpFlow === 'totp') {
    return (
      <div className="min-h-screen flex items-center justify-center p-5 bg-gradient-to-br from-slate-50 to-blue-50 dark:from-slate-900 dark:to-slate-950">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md rounded-3xl border border-border/40 bg-background/80 backdrop-blur-xl p-8 shadow-2xl"
        >
          {/* Header */}
          <div className="flex flex-col items-center text-center gap-3 mb-6">
            <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-sky-500 to-blue-600 grid place-items-center shadow-lg shadow-sky-500/30">
              <Shield className="h-8 w-8 text-white" />
            </div>
            <h1 className="text-2xl font-bold">Двухфакторная аутентификация</h1>
            <p className="text-sm text-muted-foreground">
              Введите 6-значный код из приложения-аутентификатора.
            </p>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (!totpBusy && totpCode.length === 6) void verifyTotpLogin()
            }}
            className="space-y-4"
          >
            <input
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000"
              inputMode="numeric"
              autoFocus
              className="w-full h-14 px-4 rounded-xl bg-background border border-border/60 outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/20 text-center font-mono text-2xl tracking-widest"
            />

            <button
              type="submit"
              disabled={totpBusy || totpCode.length !== 6}
              className="w-full flex items-center justify-center gap-2 h-12 rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 text-white font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:scale-[1.02] transition-transform shadow-lg shadow-sky-500/30"
            >
              {totpBusy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Check className="h-5 w-5" />}
              Войти
            </button>
          </form>

          <button
            onClick={cancelTotpLogin}
            disabled={totpBusy}
            className="w-full mt-3 flex items-center justify-center gap-1.5 h-10 rounded-xl bg-accent hover:bg-accent/80 transition-colors text-xs font-medium disabled:opacity-40"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Назад к форме входа
          </button>

          <div className="mt-4 p-3 rounded-xl bg-sky-50 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-900">
            <div className="text-xs text-muted-foreground">
              💡 Если у вас нет доступа к аутентификатору, обратитесь к администратору для сброса 2FA.
            </div>
          </div>
        </motion.div>
      </div>
    )
  }

  // ========================================================================
  // 2FA setup wizard — shown when totpFlow === 'setup' || 'verify'
  // ========================================================================
  if (totpFlow !== 'none') {
    return (
      <div className="min-h-screen flex items-center justify-center p-5 bg-gradient-to-br from-slate-50 to-blue-50 dark:from-slate-900 dark:to-slate-950">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md rounded-3xl border border-border/40 bg-background/80 backdrop-blur-xl p-8 shadow-2xl"
        >
          {/* Header */}
          <div className="flex flex-col items-center text-center gap-3 mb-6">
            <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 grid place-items-center shadow-lg shadow-amber-500/30">
              <Shield className="h-8 w-8 text-white" />
            </div>
            <h1 className="text-2xl font-bold">Настройка 2FA</h1>
            <p className="text-sm text-muted-foreground">
              Для аккаунта администратора обязательно включение двухфакторной аутентификации.
            </p>
          </div>

          {/* Loading state — fetching QR */}
          {totpFlow === 'setup' && (
            <div className="py-12 grid place-items-center">
              <Loader2 className="h-10 w-10 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground mt-3">Генерация QR-кода…</p>
            </div>
          )}

          {/* Verify state — QR + code input */}
          {totpFlow === 'verify' && (
            <div className="space-y-4">
              <div className="space-y-2 text-sm">
                <p className="text-muted-foreground">
                  1. Отсканируйте QR-код в приложении-аутентификаторе (Google Authenticator, Authy, 1Password и т.п.).
                </p>
              </div>

              {totpQrUrl && (
                <div className="grid place-items-center bg-white p-4 rounded-2xl">
                  <QrCodeCanvas data={totpQrUrl} size={200} />
                </div>
              )}

              {totpSecret && (
                <div className="text-xs">
                  <span className="text-muted-foreground">Или введите секрет вручную: </span>
                  <code className="font-mono bg-muted px-1.5 py-0.5 rounded break-all">{totpSecret}</code>
                </div>
              )}

              <div className="space-y-2 text-sm">
                <p className="text-muted-foreground">2. Введите 6-значный код из приложения:</p>
              </div>

              <input
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                inputMode="numeric"
                autoFocus
                className="w-full h-14 px-4 rounded-xl bg-background border border-border/60 outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/20 text-center font-mono text-2xl tracking-widest"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && totpCode.length === 6 && !totpBusy) {
                    void verifyTotpCode()
                  }
                }}
              />

              <button
                onClick={() => void verifyTotpCode()}
                disabled={totpBusy || totpCode.length !== 6}
                className="w-full flex items-center justify-center gap-2 h-12 rounded-xl bg-gradient-to-r from-blue-500 to-indigo-600 text-white font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:scale-[1.02] transition-transform shadow-lg shadow-blue-500/30"
              >
                {totpBusy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Check className="h-5 w-5" />}
                Подтвердить и включить 2FA
              </button>

              <div className="flex gap-2">
                <button
                  onClick={() => void fetchTotpSetup()}
                  disabled={totpBusy}
                  className="flex-1 flex items-center justify-center gap-1.5 h-10 rounded-xl bg-accent hover:bg-accent/80 transition-colors text-xs font-medium disabled:opacity-40"
                >
                  <RefreshCw className="h-3.5 w-3.5" /> Новый QR
                </button>
                <button
                  onClick={cancelTotpSetup}
                  disabled={totpBusy}
                  className="flex-1 flex items-center justify-center gap-1.5 h-10 rounded-xl bg-accent hover:bg-accent/80 transition-colors text-xs font-medium disabled:opacity-40"
                >
                  <ArrowLeft className="h-3.5 w-3.5" /> Назад
                </button>
              </div>

              <div className="mt-2 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900">
                <div className="text-xs text-muted-foreground">
                  💡 После успешной настройки 2FA вы сможете входить в Studio и в основное приложение, используя пароль + код из аутентификатора.
                </div>
              </div>
            </div>
          )}
        </motion.div>
      </div>
    )
  }

  // ========================================================================
  // Default — login form
  // ========================================================================
  return (
    <div className="min-h-screen flex items-center justify-center p-5 bg-gradient-to-br from-slate-50 to-blue-50 dark:from-slate-900 dark:to-slate-950">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md rounded-3xl border border-border/40 bg-background/80 backdrop-blur-xl p-8 shadow-2xl"
      >
        {/* Header */}
        <div className="flex flex-col items-center text-center gap-3 mb-6">
          <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 grid place-items-center shadow-lg shadow-blue-500/30">
            <Shield className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold">Вход для администратора</h1>
          <p className="text-sm text-muted-foreground">Доступ к Studio и управлению приложением</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <User className="h-3 w-3" /> Логин или Email
            </label>
            <input
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              placeholder="admin"
              className="w-full h-12 px-4 rounded-xl bg-background border border-border/60 outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/20 text-sm"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <Lock className="h-3 w-3" /> Пароль
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full h-12 px-4 rounded-xl bg-background border border-border/60 outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/20 text-sm"
            />
          </div>

          <button
            type="submit"
            disabled={loading || !login.trim() || !password.trim()}
            className="w-full flex items-center justify-center gap-2 h-12 rounded-xl bg-gradient-to-r from-blue-500 to-indigo-600 text-white font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:scale-[1.02] transition-transform shadow-lg shadow-blue-500/30"
          >
            {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <KeyRound className="h-5 w-5" />}
            Войти
          </button>
        </form>

        {/* Test credentials hint — only shown when NEXT_PUBLIC_DEV_HINTS=1 */}
        {SHOW_DEV_HINTS && (
          <div className="mt-5 p-4 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900">
            <div className="text-xs font-semibold text-amber-700 dark:text-amber-300 mb-2 flex items-center gap-1">
              <KeyRound className="h-3 w-3" /> Учётные данные администратора (DEV)
            </div>
            <div className="text-xs text-muted-foreground space-y-1">
              <div>Используйте логин и пароль, заданные через:</div>
              <pre className="text-[10px] bg-amber-100/50 dark:bg-amber-900/30 rounded p-2 overflow-x-auto">{`ADMIN_PASSWORD='...' \
  bunx tsx scripts/create-admin.ts`}</pre>
            </div>
          </div>
        )}

        {/* Back link */}
        <button
          onClick={onBack}
          className="w-full mt-5 flex items-center justify-center gap-1.5 h-10 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Вернуться на главную
        </button>

        {/* External Studio link */}
        <div className="mt-4 pt-4 border-t border-border/40 text-center">
          <a
            href="/studio"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
          >
            Или открыть Studio напрямую <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </motion.div>
    </div>
  )
}

// ============================================================================
//  v25.3: Local QR code renderer — generates the QR as a <canvas> using the
//  `qrcode` package (already a project dependency). The TOTP secret never
//  leaves the user's device — no third-party API call (api.qrserver.com was
//  previously used and leaked the secret via URL query string).
// ============================================================================
function QrCodeCanvas({ data, size = 200 }: { data: string; size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!canvasRef.current || !data) return
    setError(false)
    QRCode.toCanvas(
      canvasRef.current,
      data,
      {
        width: size,
        margin: 1,
        color: { dark: '#000000', light: '#ffffff' },
        errorCorrectionLevel: 'M',
      },
      (err: Error | null | undefined) => {
        if (err) {
          setError(true)
        }
      },
    )
  }, [data, size])

  if (error) {
    return (
      <div className="text-xs text-destructive text-center p-4 border border-destructive/30 rounded-lg max-w-[200px]">
        Ошибка генерации QR.
        <br />
        Введите секрет вручную ниже.
      </div>
    )
  }

  return <canvas ref={canvasRef} width={size} height={size} role="img" aria-label="TOTP QR code" />
}
