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
import { api } from '@/lib/api'
import type { User } from '@/lib/types'
import { Loader2, Venus, Mars, Circle, Shield } from 'lucide-react'
import { cn } from '@/lib/utils'
// Wave 3 (S-PROD-001): QR code rendering for TOTP setup
import QRCode from 'qrcode'
import { toast } from '@/lib/notifications'

// Simple QR code component that renders the otpauth:// URL as an SVG
function QrCodeDisplay({ value, size = 160 }: { value: string; size?: number }) {
  const [svg, setSvg] = useState('')
  useEffect(() => {
    QRCode.toString(value, { type: 'svg', margin: 1, width: size, errorCorrectionLevel: 'M' })
      .then(setSvg)
      .catch(() => setSvg(''))
  }, [value, size])
  if (!svg) return null
  return <div dangerouslySetInnerHTML={{ __html: svg }} style={{ width: size, height: size }} />
}

type Gender = 'male' | 'female' | 'other'
type Mode = 'login' | 'register'

/**
 * Studio AuthDialog — ТОЧНАЯ КОПИЯ диалога из основного приложения
 * (src/components/auth-dialog.tsx), чтобы пользователь видел одинаковый
 * UX и в приложении, и в Studio.
 *
 * ВАЖНО: регистрация в Studio создаёт ОБЫЧНОГО пользователя (role=user).
 * Если в БД ещё нет ни одного админа — первый зарегистрированный автоматически
 * становится админом (это логика бэкенда, см. routes/auth.ts).
 * Если админ уже существует — новый пользователь получит role=user и увидит
 * экран "Доступ запрещён". Это нормально: Studio — админка, доступ только
 * для админов. Но форма регистрации доступна всем, как в основном приложении.
 */
export function AuthDialog({
  open,
  onOpenChange,
  defaultMode = 'login',
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  defaultMode?: Mode
}) {
  const [mode, setMode] = useState<Mode>(defaultMode)
  const [loading, setLoading] = useState(false)
  // Wave 3 (S-PROD-001): 2FA flow state
  // - 'none'    → normal login form
  // - 'totp'    → password OK, asking for TOTP code (already enrolled)
  // - 'setup'   → password OK, admin must enroll TOTP (mandatory for admin role)
  type TotpFlow = 'none' | 'totp' | 'setup'
  const [totpFlow, setTotpFlow] = useState<TotpFlow>('none')
  const [totpCode, setTotpCode] = useState('')
  // For setup flow — store the QR URL + secret from /totp/setup
  const [totpQrUrl, setTotpQrUrl] = useState('')
  const [totpSecret, setTotpSecret] = useState('')
  const login = useAuthStore((s) => s.login)
  const register = useAuthStore((s) => s.register)
  const completeTotpSetup = useAuthStore((s) => s.completeTotpSetup)
// Login fields
  const [loginField, setLoginField] = useState('')
  const [password, setPassword] = useState('')

  // Registration fields (same as main app)
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [gender, setGender] = useState<Gender | ''>('')
  const [confirmPassword, setConfirmPassword] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      if (mode === 'login') {
        // ===== TOTP setup flow: verify code and complete enrollment =====
        // When `totpFlow === 'setup'`, the admin has already:
        //   1. Logged in with correct password (backend returned setupToken)
        //   2. Seen the QR code (fetched via /totp/setup)
        //   3. Scanned it in their authenticator app
        //   4. Typed the 6-digit code
        // Now we POST /totp/verify with the code. On success, the backend
        // issues a FRESH regular JWT (no totpPending) and we swap the
        // setupToken for it via `completeTotpSetup()` — full admin access
        // restored.
        if (totpFlow === 'setup') {
          const verify = await api.post<{
            enabled: boolean
            token: string
            user: User
          }>('/api/auth/totp/verify', {
            auth: 'totp-setup',
            json: { code: totpCode },
          })
          completeTotpSetup(verify.token, verify.user)
          toast.success('2FA настроена!', { description: 'Добро пожаловать в Studio.' })
          setTotpFlow('none')
          setTotpCode('')
          setTotpQrUrl('')
          setTotpSecret('')
          onOpenChange(false)
          return
        }

        // ===== Login (no TOTP code yet) or TOTP verify (already enrolled) =====
        // - totpFlow === 'none': first login attempt, no code yet.
        // - totpFlow === 'totp': password OK + TOTP enrolled, user typed code.
        // Both cases call /api/auth/login with optional totpCode.
        const result = await login(loginField, password, totpFlow === 'totp' ? totpCode : undefined)

        // Case 2/3: 2FA flow — backend issued a setup token OR asked for TOTP code
        if ('totpRequired' in result || 'totpSetupRequired' in result) {
          const r = result as {
            user: User
            totpRequired?: boolean
            totpSetupRequired?: boolean
            message?: string
          }
          if (r.totpSetupRequired) {
            // Admin must enroll TOTP — fetch QR via /totp/setup using the
            // setupToken that login() just stored in the auth store.
            setTotpFlow('setup')
            try {
              const setup = await api.post<{ secret: string; otpauthUrl: string }>(
                '/api/auth/totp/setup',
                { auth: 'totp-setup' },
              )
              setTotpQrUrl(setup.otpauthUrl)
              setTotpSecret(setup.secret)
              toast.info('Требуется настройка 2FA', { description: 'Для аккаунта администратора обязательно включение двухфакторной аутентификации.' })
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : 'Не удалось получить QR-код'
              toast.error('Ошибка настройки 2FA', { description: msg })
              setTotpFlow('none')
            }
            // Reset totpCode for next entry
            setTotpCode('')
            return
          }
          if (r.totpRequired) {
            // Already enrolled — just ask for code
            setTotpFlow('totp')
            toast.info('Введите код 2FA', { description: 'Откройте приложение аутентификатора и введите 6-значный код.' })
            // Reset totpCode for next entry
            setTotpCode('')
            return
          }
        }

        // Case 1: success — result is a User (narrowed type)
        const user = result as User
        if (user.role === 'admin') {
          toast.success('Добро пожаловать в Studio!')
        } else {
          // Logged in as non-admin — Studio will show "Доступ запрещён"
          // screen with a clear explanation and logout button.
          toast.error('Вход выполнен', { description: 'Этот аккаунт не имеет прав администратора. Studio доступна только для админов.' })
        }
      } else {
        // Local validation
        if (password !== confirmPassword) {
          toast.error('Пароли не совпадают')
          return
        }
        const user = await register({
          username,
          email,
          password,
          phone: phone || undefined,
          displayName: displayName || undefined,
          gender: gender || undefined,
        })
        if (user.role === 'admin') {
          toast.success('Администратор создан!', { description: 'Вы автоматически вошли в Studio как администратор.' })
        } else {
          toast.error('Аккаунт создан', { description: 'Ваш аккаунт создан, но без прав администратора. Studio доступна только для админов.' })
        }
      }
      onOpenChange(false)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Что-то пошло не так'
      toast.error('Ошибка', { description: msg })
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
                    placeholder="ivan_99 или Иван"
                    className="rounded-2xl"
                    pattern="[a-zA-Z0-9_а-яА-ЯёЁ]+"
                    minLength={3}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="phone">Телефон</Label>
                  <Input
                    id="phone"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+79991234567"
                    className="rounded-2xl"
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

              {/* Gender selector — same as main app */}
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
                disabled={totpFlow !== 'none'}
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
              disabled={totpFlow !== 'none'}
            />
          </div>

          {/* Wave 3 (S-PROD-001): 2FA flow — shown after password is verified */}
          {mode === 'login' && totpFlow === 'setup' && (
            <div className="space-y-3 rounded-2xl bg-amber-500/10 border border-amber-500/30 p-4">
              <div className="flex items-start gap-2">
                <Shield className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-semibold text-amber-100">Настройка 2FA обязательна</p>
                  <p className="text-xs text-amber-200/80 mt-1">
                    Для аккаунта администратора обязательно включение двухфакторной аутентификации.
                    Отсканируйте QR-код в приложении аутентификаторе (Google Authenticator, Authy, 1Password)
                    и введите 6-значный код.
                  </p>
                </div>
              </div>
              {totpQrUrl && (
                <div className="bg-white p-3 rounded-xl flex justify-center">
                  <QrCodeDisplay value={totpQrUrl} size={160} />
                </div>
              )}
              {totpSecret && (
                <div className="text-xs text-amber-200/70 break-all">
                  <span className="font-semibold">Секрет (вручную):</span>{' '}
                  <code className="font-mono">{totpSecret}</code>
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="totp-setup-code" className="text-amber-100">6-значный код из приложения</Label>
                <Input
                  id="totp-setup-code"
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  className="rounded-2xl font-mono text-center text-lg tracking-widest"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  required
                  autoFocus
                />
              </div>
              <Button type="submit" disabled={totpCode.length !== 6} className="w-full">
                Подтвердить и включить 2FA
              </Button>
              {/* v13.1 (audit P1-12 fix): "Назад" button to cancel the TOTP
                  setup flow. Previously, once totpFlow==='setup' was entered,
                  login/password fields were disabled and there was no way to
                  cancel back to the login form. If the admin fat-fingered
                  their password, they had to refresh the page. */}
              <Button
                type="button"
                variant="ghost"
                className="w-full text-xs text-amber-200/80 hover:text-amber-100"
                onClick={() => {
                  setTotpFlow('none')
                  setTotpCode('')
                  setTotpQrUrl('')
                  setTotpSecret('')
                  // Clear the setupToken from the auth store
                  useAuthStore.setState({ setupToken: null })
                }}
              >
                Назад к форме входа
              </Button>
            </div>
          )}

          {mode === 'login' && totpFlow === 'totp' && (
            <div className="space-y-3 rounded-2xl bg-sky-500/10 border border-sky-500/30 p-4">
              <div className="flex items-start gap-2">
                <Shield className="h-5 w-5 text-sky-400 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-semibold text-sky-100">Введите код 2FA</p>
                  <p className="text-xs text-sky-200/80 mt-1">
                    Откройте приложение аутентификатор и введите 6-значный код.
                  </p>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="totp-code" className="text-sky-100">Код подтверждения</Label>
                <Input
                  id="totp-code"
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  className="rounded-2xl font-mono text-center text-lg tracking-widest"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  required
                  autoFocus
                />
              </div>
              <Button type="submit" disabled={totpCode.length !== 6} className="w-full">
                Войти
              </Button>
              {/* v13.1 (audit P1-12 fix): back button for the TOTP verify flow too. */}
              <Button
                type="button"
                variant="ghost"
                className="w-full text-xs text-sky-200/80 hover:text-sky-100"
                onClick={() => {
                  setTotpFlow('none')
                  setTotpCode('')
                  useAuthStore.setState({ setupToken: null })
                }}
              >
                Назад к форме входа
              </Button>
            </div>
          )}

          {mode === 'login' && totpFlow === 'none' && (
            <Button type="submit" disabled={loading} className="w-full">
              {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Войти в Studio
            </Button>
          )}

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
            </div>
          )}

          {mode === 'register' && (
            <Button
              type="submit"
              disabled={loading}
              className="w-full rounded-full gradient-brand text-white font-semibold shadow-glow h-11"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
              Создать аккаунт
            </Button>
          )}

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

          {mode === 'login' && process.env.NEXT_PUBLIC_DEV_HINTS === '1' && (
            <div className="text-xs text-center text-muted-foreground border-t border-border/40 pt-3 mt-2">
              Используйте логин и пароль, заданные при первичной настройке через
              веб-мастер первого запуска.
            </div>
          )}
        </form>
      </DialogContent>
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
