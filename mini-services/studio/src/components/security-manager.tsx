'use client'

import { useState, useEffect, useCallback } from 'react'
import { Save, Loader2, Shield, ShieldCheck, KeyRound, Clock, Lock } from 'lucide-react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from '@/lib/notifications'

interface SecuritySettings {
  emailVerificationRequired: boolean
  totpRequiredForAdmins: boolean
  totpRequiredForUsers: boolean
  totpAllowBackupCodes: boolean
  allowLoginWithoutVerification: boolean
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

export function SecurityManager() {
  const [settings, setSettings] = useState<SecuritySettings>({
    emailVerificationRequired: false,
    totpRequiredForAdmins: true,
    totpRequiredForUsers: false,
    totpAllowBackupCodes: true,
    allowLoginWithoutVerification: true,
    sessionTimeoutMin: 10080,
    refreshTokenTTLDays: 30,
    maxFailedLogins: 5,
    lockoutDurationMin: 15,
    passwordMinLength: 8,
    passwordMaxLength: 128,
    passwordRequireUppercase: false,
    passwordRequireLowercase: true,
    passwordRequireDigit: false,
    passwordRequireSymbol: false,
    authRateLimitPer15Min: 10,
  })
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
    setSaving(true)
    try {
      await api.put('/api/security-settings', { json: settings, auth: true })
      toast.success('Настройки безопасности сохранены')
    } catch (e) {
      toast.error('Ошибка', { description: String(e) })
    }
    setSaving(false)
  }

  if (loading) {
    return <div className="p-6"><div className="h-20 rounded-2xl skeleton" /></div>
  }

  return (
    <div className="px-4 md:px-6 py-6 pb-28">
      <div className="flex items-center gap-2 mb-4">
        <Shield className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight mb-1">Безопасность</h1>
          <p className="text-sm text-muted-foreground">
            Глобальная политика безопасности приложения.
          </p>
        </div>
      </div>

      <div className="space-y-4">
        {/* Email verification */}
        <Section icon={<ShieldCheck className="h-5 w-5" />} title="Подтверждение Email">
          <Toggle
            label="Требовать подтверждение Email"
            description="Пользователи должны подтвердить email перед входом"
            checked={settings.emailVerificationRequired}
            onChange={(v) => setSettings({ ...settings, emailVerificationRequired: v })}
          />
          <Toggle
            label="Разрешить вход без подтверждения"
            description="Пользователь может войти, но не может оформить заказ (применяется если подтвердить Email не обязательно)"
            checked={settings.allowLoginWithoutVerification}
            onChange={(v) => setSettings({ ...settings, allowLoginWithoutVerification: v })}
          />
        </Section>

        {/* 2FA */}
        <Section icon={<KeyRound className="h-5 w-5" />} title="Двухфакторная аутентификация (2FA)">
          <Toggle
            label="Обязательная 2FA для администраторов"
            description="TOTP (Google Authenticator и др.)"
            checked={settings.totpRequiredForAdmins}
            onChange={(v) => setSettings({ ...settings, totpRequiredForAdmins: v })}
          />
          <Toggle
            label="Обязательная 2FA для пользователей"
            description="Применяется при следующем входе"
            checked={settings.totpRequiredForUsers}
            onChange={(v) => setSettings({ ...settings, totpRequiredForUsers: v })}
          />
          <Toggle
            label="Разрешить резервные коды"
            description="Пользователи могут восстановить доступ при потере устройства"
            checked={settings.totpAllowBackupCodes}
            onChange={(v) => setSettings({ ...settings, totpAllowBackupCodes: v })}
          />
        </Section>

        {/* Sessions */}
        <Section icon={<Clock className="h-5 w-5" />} title="Сессии">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Время жизни сессии (мин)</Label>
              <Input
                type="number"
                value={settings.sessionTimeoutMin}
                onChange={(e) => setSettings({ ...settings, sessionTimeoutMin: Number(e.target.value) })}
              />
              <p className="text-xs text-muted-foreground">10080 = 7 дней</p>
            </div>
            <div className="space-y-1.5">
              <Label>Refresh token (дней)</Label>
              <Input
                type="number"
                value={settings.refreshTokenTTLDays}
                onChange={(e) => setSettings({ ...settings, refreshTokenTTLDays: Number(e.target.value) })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Макс. неудачных попыток входа</Label>
              <Input
                type="number"
                value={settings.maxFailedLogins}
                onChange={(e) => setSettings({ ...settings, maxFailedLogins: Number(e.target.value) })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Блокировка (мин)</Label>
              <Input
                type="number"
                value={settings.lockoutDurationMin}
                onChange={(e) => setSettings({ ...settings, lockoutDurationMin: Number(e.target.value) })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Rate limit: попыток / 15 мин</Label>
              <Input
                type="number"
                value={settings.authRateLimitPer15Min}
                onChange={(e) => setSettings({ ...settings, authRateLimitPer15Min: Number(e.target.value) })}
              />
            </div>
          </div>
        </Section>

        {/* Password policy */}
        <Section icon={<Lock className="h-5 w-5" />} title="Политика паролей">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Мин. длина пароля</Label>
              <Input
                type="number"
                value={settings.passwordMinLength}
                onChange={(e) => setSettings({ ...settings, passwordMinLength: Number(e.target.value) })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Макс. длина пароля</Label>
              <Input
                type="number"
                value={settings.passwordMaxLength}
                onChange={(e) => setSettings({ ...settings, passwordMaxLength: Number(e.target.value) })}
              />
            </div>
          </div>
          <div className="space-y-2 pt-2">
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
        </Section>

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

function Section({
  icon, title, children,
}: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card p-4 md:p-6 space-y-3">
      <h3 className="font-semibold flex items-center gap-2">
        {icon}
        {title}
      </h3>
      <div className="space-y-3">{children}</div>
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
        className="mt-0.5"
      />
      <div className="flex-1">
        <div className="text-sm font-medium">{label}</div>
        {description && <div className="text-xs text-muted-foreground">{description}</div>}
      </div>
    </label>
  )
}
