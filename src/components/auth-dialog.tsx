'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useAuthStore } from '@/lib/auth-store'
import { haptic } from '@/lib/haptic'
import { sounds } from '@/lib/sounds'
import { loginSchema } from '@/lib/schemas'
import { toast } from '@/lib/notifications'
import type { User } from '@/lib/types'
import { Loader2, Venus, Mars, Circle } from 'lucide-react'
import { cn } from '@/lib/utils'
// v20: email verification modal shown after registration
import { EmailVerificationModal } from './email-verification-modal'

type Gender = 'male' | 'female' | 'other'

export function AuthDialog({
  open,
  onOpenChange,
  defaultMode = 'login',
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  defaultMode?: 'login' | 'register'
}) {
  const [mode, setMode] = useState<'login' | 'register'>(defaultMode)
  useEffect(() => {
    setMode(defaultMode)
  }, [defaultMode])
  const [loading, setLoading] = useState(false)
  const login = useAuthStore((s) => s.login)
  const register = useAuthStore((s) => s.register)
  // v20: email verification modal state — shown after registration when
  // SecuritySettings.emailVerificationRequired is ON.
  const [verifyModal, setVerifyModal] = useState<{ open: boolean; email: string }>({ open: false, email: '' })

  const [loginField, setLoginField] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [gender, setGender] = useState<Gender | ''>('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      if (mode === 'login') {
        // F-HIGH-005: validate the login form with the shared zod loginSchema.
        //
        // The login field accepts email OR username OR phone (the backend's
        // /api/auth/login resolves all three). The loginSchema only knows
        // about the `email` shape — so we run the full schema parse only
        // when the input looks like an email (contains "@"). For usernames
        // and phones we still reuse the password rule from the same schema
        // via `loginSchema.shape.password` so the min-length / messages stay
        // in sync with the schema file.
        const looksLikeEmail = loginField.includes('@')
        if (looksLikeEmail) {
          const result = loginSchema.safeParse({ email: loginField, password })
          if (!result.success) {
            const firstIssue = result.error.issues[0]
            toast.error(firstIssue?.message || 'Проверьте введённые данные')
            return
          }
        } else {
          if (!loginField.trim()) {
            toast.error('Введите email, никнейм или телефон')
            return
          }
          const pwdResult = loginSchema.shape.password.safeParse(password)
          if (!pwdResult.success) {
            toast.error(pwdResult.error.issues[0]?.message || 'Минимум 8 символов')
            return
          }
        }
        const result = await login(loginField, password)
        // v25.7 (TZ ЭТАП 2.1): the auth store returns a result OBJECT (not a
        // User) when the backend demands 2FA — either `totpRequired` (admin
        // already enrolled) or `totpSetupRequired` (admin must enroll). The
        // regular AuthDialog has no TOTP input UI; AdminLoginView does. So we
        // detect the admin 2FA shape here, close this dialog, and dispatch a
        // `navigate` event that page.tsx listens for → switches to
        // AdminLoginView. The auth store already stashed `setupToken` /
        // remembered `user`, so AdminLoginView will resume the wizard at the
        // correct step (QR setup OR 6-digit code input).
        if (result && typeof result === 'object' && !('id' in result) && 'user' in result) {
          const r = result as { user: User; totpRequired?: boolean; totpSetupRequired?: boolean; message?: string }
          if (r.user?.role === 'admin') {
            toast.info('Требуется 2FA', {
              description: 'Перенаправляем в форму входа администратора…',
              duration: 4000,
            })
            onOpenChange(false)
            haptic.select()
            // page.tsx listens for `navigate` events and switches the view.
            window.dispatchEvent(new CustomEvent('navigate', { detail: { view: 'admin-login' } }))
            return
          }
          // Non-admin user somehow hit TOTP — surface a clear message.
          toast.info('Требуется подтверждение', { description: r.message || 'Обратитесь к администратору.' })
          return
        }
        toast.success('Добро пожаловать!')
        haptic.success() // v10-native: haptic on successful login
        sounds.success() // v10-native: sound on successful login
      } else {
        // v19.0: validate password confirmation client-side before submission.
        if (!password) {
          toast.error('Введите пароль')
          return
        }
        if (password.length < 8) {
          toast.error('Пароль должен содержать минимум 8 символов')
          return
        }
        if (password !== confirmPassword) {
          toast.error('Пароли не совпадают')
          return
        }
        // v19.0: password strength checks (match default SecuritySettings)
        if (!/[a-zа-я]/.test(password)) {
          toast.error('Пароль должен содержать хотя бы одну строчную букву')
          return
        }
        await register({
          username,
          email,
          password,
          confirmPassword,
          phone: phone.trim(),
          displayName: displayName || undefined,
          gender: gender || undefined,
          // v12.6: pass referral code from URL ?ref=CODE so the backend
          // can link the new user to the referrer and award points.
          referralCode:
            typeof window !== 'undefined'
              ? new URLSearchParams(window.location.search).get('ref') || undefined
              : undefined,
        }).then((result) => {
          if (result.kind === 'verification_required') {
            // v20: don't auto-login — show verification modal instead.
            setVerifyModal({ open: true, email: result.email })
            haptic.success()
            sounds.success()
            return
          }
          // result.kind === 'verified' → auto-login already done in store
          toast.success('Аккаунт создан!')
          haptic.success() // v10-native: haptic on successful registration
          sounds.success() // v10-native: sound on successful registration
        })
      }
      // Phase 14: close dialog IMMEDIATELY after successful auth, before
      // requesting notification permission. Previously, Notification.requestPermission()
      // could block the dialog from closing (especially on browsers where the
      // permission prompt is modal). By closing first, the user sees the
      // authenticated UI immediately, and the permission request runs in the
      // background.
      onOpenChange(false)

      // Request notification permission right after successful auth — this
      // is a user gesture (form submit), so the browser allows it. Without
      // asking here, push notifications would never work because browsers
      // block permission requests that fire on page load without a gesture.
      if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        try {
          const result = await Notification.requestPermission()
          if (result === 'denied') {
            toast.info('Уведомления отключены', {
              description: 'Вы не получите push-уведомления о новых сообщениях. Включить можно в настройках браузера.',
              duration: 6000,
            })
          }
        } catch {
          // user denied or browser doesn't support — non-fatal
        }
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Что-то пошло не так'
      toast.error(msg)
      haptic.error() // v10-native: haptic on auth error
      sounds.error() // v10-native: sound on auth error
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md rounded-3xl">
        <DialogHeader>
          <DialogTitle className="text-2xl">
            {mode === 'login' ? 'Вход' : 'Регистрация'}
          </DialogTitle>
          <DialogDescription>
            {mode === 'login'
              ? 'Войдите по email, имени пользователя или телефону.'
              : 'Создайте аккаунт за минуту.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-3">
          {mode === 'register' && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="displayName">Имя (необязательно)</Label>
                <Input
                  id="displayName"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Иван Иванов"
                  className="rounded-2xl"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="username">Никнейм</Label>
                  <Input
                    id="username"
                    required
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="ivan_99"
                    className="rounded-2xl"
                    pattern="[a-zA-Z0-9_]+"
                    minLength={3}
                    title="Только латинские буквы, цифры и подчёркивание"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="phone">Телефон *</Label>
                  <Input
                    id="phone"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+79991234567"
                    className="rounded-2xl"
                    required
                    pattern="^\+?[\d\s\-()]{7,20}$"
                    minLength={7}
                    maxLength={20}
                    title="Только цифры, пробелы, +, -, скобки. Минимум 7 символов."
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="rounded-2xl"
                />
              </div>

              {/* Gender selector — determines chat card gradient theme */}
              <div className="space-y-1.5">
                <Label>Пол</Label>
                <div className="grid grid-cols-3 gap-2">
                  <GenderButton
                    selected={gender === 'male'}
                    onClick={() => setGender('male')}
                    icon={<Mars className="h-4 w-4" />}
                    label="Мужской"
                    activeGradient="linear-gradient(135deg, #0ea5e9 0%, #2563eb 100%)"
                  />
                  <GenderButton
                    selected={gender === 'female'}
                    onClick={() => setGender('female')}
                    icon={<Venus className="h-4 w-4" />}
                    label="Женский"
                    activeGradient="linear-gradient(135deg, #f472b6 0%, #ec4899 100%)"
                  />
                  <GenderButton
                    selected={gender === 'other'}
                    onClick={() => setGender('other')}
                    icon={<Circle className="h-4 w-4" />}
                    label="Другое"
                    activeGradient="linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)"
                  />
                </div>
              </div>
            </>
          )}

          {mode === 'login' && (
            <div className="space-y-1.5">
              <Label htmlFor="login">Email, никнейм или телефон</Label>
              <Input
                id="login"
                required
                value={loginField}
                onChange={(e) => setLoginField(e.target.value)}
                placeholder="alex@999.pro или alex_pro"
                className="rounded-2xl"
                autoFocus
              />
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="password">Пароль</Label>
            <Input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="rounded-2xl"
              minLength={8}
              maxLength={128}
            />
            {/* v19.0: password strength indicator */}
            {mode === 'register' && password && (
              <PasswordStrengthMeter password={password} />
            )}
          </div>

          {mode === 'register' && (
            <div className="space-y-1.5">
              <Label htmlFor="confirmPassword">Подтвердите пароль</Label>
              <Input
                id="confirmPassword"
                type="password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                className="rounded-2xl"
                minLength={8}
                maxLength={128}
              />
              {confirmPassword && password !== confirmPassword && (
                <p className="text-xs text-destructive">Пароли не совпадают</p>
              )}
              {confirmPassword && password === confirmPassword && (
                <p className="text-xs text-emerald-600">✓ Пароли совпадают</p>
              )}
            </div>
          )}

          <Button
            type="submit"
            disabled={loading}
            className="w-full rounded-full gradient-brand text-white font-semibold shadow-glow h-11"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
            {mode === 'login' ? 'Войти' : 'Создать аккаунт'}
          </Button>

          <div className="text-center text-sm text-muted-foreground">
            {mode === 'login' ? 'Нет аккаунта? ' : 'Уже зарегистрированы? '}
            <button
              type="button"
              onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
              className="text-primary font-semibold hover:underline"
            >
              {mode === 'login' ? 'Создать' : 'Войти'}
            </button>
          </div>

          {/* v25.14: the fake "demo access" hint (maria@999.pro / 123456) was
              removed — the store has ONE real owner account and exposing
              demo credentials confused real customers. */}
        </form>
      </DialogContent>

      {/* v20: Email verification modal — shown after registration when
          SecuritySettings.emailVerificationRequired is ON. Renders outside
          the auth Dialog so it stays visible after the auth dialog closes. */}
      <EmailVerificationModal
        open={verifyModal.open}
        email={verifyModal.email}
        onClose={() => setVerifyModal({ open: false, email: '' })}
        onVerified={() => {
          setVerifyModal({ open: false, email: '' })
          toast.success('Добро пожаловать!')
          // Trigger the same post-auth flow (notification permission, etc.)
          if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
            Notification.requestPermission().catch(() => {})
          }
        }}
      />
    </Dialog>
  )
}

function GenderButton({
  selected,
  onClick,
  icon,
  label,
  activeGradient,
}: {
  selected: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
  activeGradient: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex flex-col items-center gap-1.5 py-3 rounded-2xl border-2 transition-all duration-300 active:scale-95',
        selected
          ? 'text-white border-transparent shadow-lg'
          : 'border-border/40 text-muted-foreground hover:border-border/80 hover:bg-accent/40',
      )}
      style={selected ? { background: activeGradient } : undefined}
    >
      {icon}
      <span className="text-xs font-medium">{label}</span>
    </button>
  )
}

/**
 * v19.0 — Password strength meter.
 * Shows a colored bar + label indicating password strength.
 * Used in the registration form to encourage strong passwords.
 */
function PasswordStrengthMeter({ password }: { password: string }) {
  let score = 0
  if (password.length >= 8) score++
  if (password.length >= 12) score++
  if (/[a-zа-я]/.test(password) && /[A-ZА-Я]/.test(password)) score++
  if (/\d/.test(password)) score++
  if (/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/.test(password)) score++

  const labels = ['Очень слабый', 'Слабый', 'Средний', 'Хороший', 'Сильный', 'Очень сильный']
  const colors = ['bg-red-500', 'bg-red-400', 'bg-orange-400', 'bg-yellow-400', 'bg-emerald-500', 'bg-emerald-600']
  const widthPct = (score / 5) * 100
  const label = labels[score] || labels[0]
  const color = colors[score] || colors[0]

  return (
    <div className="space-y-1">
      <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
        <div
          className={cn('h-full transition-all duration-300', color)}
          style={{ width: `${widthPct}%` }}
        />
      </div>
      <p className="text-xs text-muted-foreground">Надёжность: {label}</p>
    </div>
  )
}
