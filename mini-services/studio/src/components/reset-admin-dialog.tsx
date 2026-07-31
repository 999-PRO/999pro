'use client'

import { useState } from 'react'
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
import { Loader2, KeyRound, Eye, EyeOff, AlertTriangle } from 'lucide-react'
import { api } from '@/lib/api'
import { useAuthStore } from '@/lib/auth-store'
import { toast } from '@/lib/notifications'
interface ResetAdminDialogProps {
  open: boolean
  onComplete: () => void
  onClose: () => void
}

/**
 * Reset admin dialog — используется когда пользователь забыл пароль.
 *
 * ВНИМАНИЕ: этот dialog вызывает /api/auth/reset-admin, который УДАЛЯЕТ
 * всех существующих админов и создаёт нового. Поэтому мы показываем
 * большое предупреждение и просим подтверждения.
 *
 * После сброса пользователь автоматически входит как новый админ.
 */
export function ResetAdminDialog({ open, onComplete, onClose }: ResetAdminDialogProps) {
  const [displayName, setDisplayName] = useState('')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  // S-CRIT-001 fix: backend requires X-Reset-Admin-Token header (constant-time
  // compared against process.env.RESET_ADMIN_TOKEN). Previously the dialog
  // didn't send this header, so the backend always responded 403 — locked-out
  // admins had no recovery path. Now the operator enters the token (which
  // they should have set on the backend via RESET_ADMIN_TOKEN env var).
  const [resetToken, setResetToken] = useState('')
const reset = () => {
    setDisplayName('')
    setUsername('')
    setEmail('')
    setPassword('')
    setConfirmPassword('')
    setShowPassword(false)
    setError(null)
    setConfirmed(false)
  }

  const handleClose = () => {
    reset()
    onClose()
  }

  const validate = (): string | null => {
    if (!displayName.trim()) return 'Введите имя'
    if (!username.trim() || username.length < 3) return 'Логин должен быть не короче 3 символов'
    if (!/^[a-zA-Z0-9_]+$/.test(username)) return 'Логин: только латинские буквы, цифры и _'
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Введите корректный email'
    if (password.length < 8) return 'Пароль должен быть не короче 8 символов'
    if (password !== confirmPassword) return 'Пароли не совпадают'
    return null
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    const err = validate()
    if (err) {
      setError(err)
      return
    }
    if (!confirmed) {
      setError('Подтвердите, что понимаете последствия — установите галочку выше')
      return
    }
    if (!resetToken.trim()) {
      setError('Введите токен сброса администратора (RESET_ADMIN_TOKEN с backend)')
      return
    }
    setLoading(true)
    try {
      // S-CRIT-001 fix: send X-Reset-Admin-Token header. Backend requires
      // this in ALL environments (constant-time compared against
      // process.env.RESET_ADMIN_TOKEN, length ≥ 16).
      const data = await api.post<{ token: string; user: any }>('/api/auth/reset-admin', {
        json: {
          displayName: displayName.trim(),
          username: username.trim().toLowerCase(),
          email: email.trim().toLowerCase(),
          password,
          confirmPassword,
        },
        headers: {
          'X-Reset-Admin-Token': resetToken.trim(),
        },
      })

      // S-MED-003 fix: removed the manual localStorage write — Zustand
      // persist middleware handles persistence on state changes. The manual
      // write was a workaround for a timing issue that no longer exists.
      // v19.1 fix: use completeReset() so the auth cookie is also set —
      // previously setState() bypassed setAuthCookie(), causing the next
      // hard page load to redirect to the login dialog (cookie was missing).
      useAuthStore.getState().completeReset(data.token, data.user)

      toast.success('Новый администратор создан', { description: 'Старые админы удалены. Вы вошли как новый админ.' })

      setTimeout(() => {
        reset()
        onComplete()
      }, 200)
    } catch (e: unknown) {
      const msg = (e instanceof Error ? e.message : String(e)) || 'Не удалось сбросить админа'
      setError(msg)
      toast.error('Ошибка', { description: msg })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) handleClose()
      }}
    >
      <DialogContent className="sm:max-w-md rounded-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-2xl">
            <KeyRound className="h-6 w-6 text-primary" /> Сброс администратора
          </DialogTitle>
          <DialogDescription>
            Создайте нового администратора. Старые будут удалены.
          </DialogDescription>
        </DialogHeader>

        {/* Предупреждение */}
        <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-3 flex gap-2">
          <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-semibold text-destructive mb-1">Внимание!</p>
            <p className="text-muted-foreground">
              Все существующие администраторы будут удалены. Будет создан новый
              администратор с указанными ниже данными. Используйте эту функцию
              только если забыли пароль и не можете войти.
            </p>
          </div>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="reset-displayName">Имя</Label>
            <Input
              id="reset-displayName"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Иван Иванов"
              className="rounded-2xl"
              required
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="reset-username">Логин</Label>
              <Input
                id="reset-username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="ivan_admin"
                className="rounded-2xl"
                pattern="[a-zA-Z0-9_]+"
                minLength={3}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reset-email">Email</Label>
              <Input
                id="reset-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@example.com"
                className="rounded-2xl"
                required
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="reset-password">Пароль</Label>
            <div className="relative">
              <Input
                id="reset-password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="rounded-2xl pr-10"
                minLength={8}
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="reset-confirmPassword">Подтвердите пароль</Label>
            <Input
              id="reset-confirmPassword"
              type={showPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••"
              className="rounded-2xl"
              minLength={8}
              required
            />
          </div>

          {/* Подтверждение */}
          <label className="flex items-start gap-2 p-3 bg-muted/40 rounded-xl cursor-pointer">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="mt-0.5"
            />
            <span className="text-sm text-muted-foreground">
              Я понимаю, что все существующие админы будут удалены, и
              подтверждаю создание нового администратора.
            </span>
          </label>

          {/* S-CRIT-001 fix: Reset token input. Operator must provide the
              RESET_ADMIN_TOKEN that was set on the backend. */}
          <div className="space-y-1.5">
            <Label htmlFor="reset-token">Токен сброса (RESET_ADMIN_TOKEN)</Label>
            <Input
              id="reset-token"
              type="password"
              value={resetToken}
              onChange={(e) => setResetToken(e.target.value)}
              placeholder="Введите токен с backend .env"
              className="rounded-2xl font-mono text-sm"
              autoComplete="off"
              required
            />
            <p className="text-xs text-muted-foreground">
              Токен находится в <code>RESET_ADMIN_TOKEN</code> переменной backend
              (<code>app/mini-services/backend/.env</code>). Без него сброс невозможен.
            </p>
          </div>

          {error && (
            <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-xl p-3">
              ⚠ {error}
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1 rounded-full"
              onClick={handleClose}
              disabled={loading}
            >
              Отмена
            </Button>
            <Button
              type="submit"
              className="flex-1 rounded-full bg-destructive text-white hover:bg-destructive/90"
              disabled={loading || !confirmed || !resetToken.trim()}
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> Сброс…
                </>
              ) : (
                'Сбросить и создать нового'
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
