'use client'

/**
 * v20: RegistrationSettingsManager — Studio section for registration flow.
 *
 * Currently exposes:
 *   - "Требовать подтверждение Email" toggle (reads/writes SecuritySettings)
 *
 * When ON:
 *   - Registration completes only after email verification
 *   - User cannot place orders until verified (enforced in checkout-sheet)
 *   - Verification email auto-sent on registration
 *
 * When OFF:
 *   - Registration completes immediately
 *   - No verification email sent
 *   - User gets full access per their role
 */

import { useState, useEffect, useCallback } from 'react'
import { Save, Loader2, MailCheck, UserPlus, ShieldCheck } from 'lucide-react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { toast } from '@/lib/notifications'

interface SecuritySettings {
  emailVerificationRequired: boolean
  allowLoginWithoutVerification: boolean
  totpRequiredForAdmins: boolean
  totpRequiredForUsers: boolean
  totpAllowBackupCodes: boolean
  sessionTimeoutMin: number
  refreshTokenTTLDays: number
  maxFailedLogins: number
  lockoutDurationMin: number
  passwordMinLength: number
  passwordMaxLength: number
  passwordRequireUppercase: boolean
  passwordRequireLowercase: boolean
  passwordRequireDigit: boolean
  passwordRequireSymbol: boolean
  authRateLimitPer15Min: number
}

export function RegistrationSettingsManager() {
  const [settings, setSettings] = useState<SecuritySettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.get<{ settings: SecuritySettings }>('/api/security-settings')
      setSettings(data.settings)
    } catch (e) {
      toast.error('Ошибка загрузки', { description: String(e) })
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const save = async () => {
    if (!settings) return
    setSaving(true)
    try {
      await api.put('/api/security-settings', { json: settings, auth: true })
      toast.success('Настройки регистрации сохранены')
    } catch (e) {
      toast.error('Ошибка', { description: String(e) })
    }
    setSaving(false)
  }

  if (loading || !settings) {
    return <div className="p-6"><div className="h-20 rounded-2xl skeleton" /></div>
  }

  return (
    <div className="px-4 md:px-6 py-6 pb-28">
      <div className="flex items-center gap-2 mb-4">
        <UserPlus className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight mb-1">Настройки регистрации</h1>
          <p className="text-sm text-muted-foreground">
            Управление процессом регистрации и подтверждением Email.
          </p>
        </div>
      </div>

      <div className="space-y-4">
        {/* Email Verification */}
        <div className="rounded-2xl border border-border/60 bg-card p-4 md:p-6 space-y-3">
          <div className="flex items-center gap-2">
            <MailCheck className="h-5 w-5 text-primary" />
            <h3 className="font-semibold">Подтверждение Email</h3>
          </div>

          <Toggle
            label="Требовать подтверждение Email"
            description="При включении: регистрация завершается только после подтверждения Email. Пользователь не сможет оформить заказ, пока Email не подтверждён. Письмо с кодом/ссылкой отправляется автоматически."
            checked={settings.emailVerificationRequired}
            onChange={(v) => setSettings({ ...settings, emailVerificationRequired: v })}
          />

          {settings.emailVerificationRequired && (
            <div className="rounded-xl bg-amber-500/5 border border-amber-500/20 p-3 text-xs text-amber-700 dark:text-amber-400 space-y-1">
              <div className="font-semibold">Активный режим:</div>
              <ul className="list-disc pl-4 space-y-0.5 text-muted-foreground">
                <li>После регистрации показывается модальное окно подтверждения</li>
                <li>Письмо со ссылкой отправляется автоматически</li>
                <li>Пользователь может пользоваться приложением, но не может оформлять заказы</li>
                <li>После подтверждения — автоматический вход и полный доступ</li>
              </ul>
            </div>
          )}

          {!settings.emailVerificationRequired && (
            <div className="rounded-xl bg-emerald-500/5 border border-emerald-500/20 p-3 text-xs text-emerald-700 dark:text-emerald-400 space-y-1">
              <div className="font-semibold">Регистрация без подтверждения:</div>
              <ul className="list-disc pl-4 space-y-0.5 text-muted-foreground">
                <li>Регистрация завершается сразу</li>
                <li>Никакие письма не отправляются</li>
                <li>Пользователь сразу получает полный доступ согласно правам</li>
              </ul>
            </div>
          )}
        </div>

        {/* Password Policy (also affects registration) */}
        <div className="rounded-2xl border border-border/60 bg-card p-4 md:p-6 space-y-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <h3 className="font-semibold">Политика паролей</h3>
          </div>
          <p className="text-xs text-muted-foreground -mt-1">
            Применяется при регистрации и смене пароля.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Мин. длина</label>
              <input
                type="number"
                min="6" max="128"
                value={settings.passwordMinLength}
                onChange={(e) => setSettings({ ...settings, passwordMinLength: Number(e.target.value) })}
                className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Макс. длина</label>
              <input
                type="number"
                min="32" max="256"
                value={settings.passwordMaxLength}
                onChange={(e) => setSettings({ ...settings, passwordMaxLength: Number(e.target.value) })}
                className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
          </div>
          <div className="space-y-2 pt-1">
            <Toggle
              label="Требовать заглавные буквы"
              checked={settings.passwordRequireUppercase}
              onChange={(v) => setSettings({ ...settings, passwordRequireUppercase: v })}
            />
            <Toggle
              label="Требовать строчные буквы"
              checked={settings.passwordRequireLowercase}
              onChange={(v) => setSettings({ ...settings, passwordRequireLowercase: v })}
            />
            <Toggle
              label="Требовать цифры"
              checked={settings.passwordRequireDigit}
              onChange={(v) => setSettings({ ...settings, passwordRequireDigit: v })}
            />
            <Toggle
              label="Требовать спецсимволы"
              checked={settings.passwordRequireSymbol}
              onChange={(v) => setSettings({ ...settings, passwordRequireSymbol: v })}
            />
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <Button onClick={save} disabled={saving} className="gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Сохранить
          </Button>
        </div>
      </div>
    </div>
  )
}

function Toggle({
  label, description, checked, onChange,
}: { label: string; description?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-start gap-3 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4"
      />
      <div className="flex-1">
        <div className="text-sm font-medium">{label}</div>
        {description && <div className="text-xs text-muted-foreground mt-0.5">{description}</div>}
      </div>
    </label>
  )
}
