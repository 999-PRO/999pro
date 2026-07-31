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
import { Loader2, KeyRound, Eye, EyeOff } from 'lucide-react'
import { api } from '@/lib/api'
import { useAuthStore } from '@/lib/auth-store'
import { toast } from '@/lib/notifications'
interface ChangePasswordDialogProps {
  open: boolean
  onOpenChange: (v: boolean) => void
}

/**
 * Change password dialog — для авторизованного пользователя (админа).
 * Вызывает POST /api/auth/change-password.
 */
export function ChangePasswordDialog({ open, onOpenChange }: ChangePasswordDialogProps) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
const setToken = useAuthStore((s) => s.setToken)

  const reset = () => {
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
    setShowPassword(false)
    setError(null)
  }

  const handleClose = (v: boolean) => {
    if (!v) reset()
    onOpenChange(v)
  }

  const validate = (): string | null => {
    if (!currentPassword) return 'Введите текущий пароль'
    if (newPassword.length < 8) return 'Новый пароль должен быть не короче 8 символов'
    if (newPassword === currentPassword) return 'Новый пароль должен отличаться от текущего'
    if (newPassword !== confirmPassword) return 'Новые пароли не совпадают'
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
    setLoading(true)
    try {
      // CRITICAL: backend bumps tokenVersion and returns a FRESH token in the
      // response. The old token (still in localStorage) is now invalid — the
      // next authenticated request would 401 and log the user out. We must
      // capture and persist the new token BEFORE doing anything else.
      const data = await api.post<{ ok: true; token: string }>('/api/auth/change-password', {
        json: {
          currentPassword,
          newPassword,
          confirmPassword,
        },
        auth: true,
      })
      if (data.token) {
        setToken(data.token)
      }
      toast.success('Пароль изменён', { description: 'Используйте новый пароль при следующем входе.' })
      reset()
      onOpenChange(false)
    } catch (e: unknown) {
      const msg = (e instanceof Error ? e.message : String(e)) || 'Не удалось изменить пароль'
      setError(msg)
      toast.error('Ошибка', { description: msg })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md rounded-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-2xl">
            <KeyRound className="h-6 w-6 text-primary" /> Сменить пароль
          </DialogTitle>
          <DialogDescription>
            Введите текущий пароль и новый пароль.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="current-password">Текущий пароль</Label>
            <div className="relative">
              <Input
                id="current-password"
                type={showPassword ? 'text' : 'password'}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="••••••••"
                className="rounded-2xl pr-10"
                required
                autoFocus
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
            <Label htmlFor="new-password">Новый пароль</Label>
            <Input
              id="new-password"
              type={showPassword ? 'text' : 'password'}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="••••••••"
              className="rounded-2xl"
              minLength={8}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="confirm-new-password">Подтвердите новый пароль</Label>
            <Input
              id="confirm-new-password"
              type={showPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••"
              className="rounded-2xl"
              minLength={8}
              required
            />
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
              onClick={() => handleClose(false)}
              disabled={loading}
            >
              Отмена
            </Button>
            <Button
              type="submit"
              className="flex-1 rounded-full gradient-brand text-white"
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> Сохранение…
                </>
              ) : (
                'Изменить пароль'
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
