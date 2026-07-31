'use client'

/**
 * v20: CommunicationManager — Studio section for chat communication features.
 *
 * Toggles for:
 *   - Обычные звонки (audio calls)
 *   - Видеозвонки
 *   - Отправка фотографий
 *   - Отправка документов
 *   - Отправка видео (OFF by default)
 *   - Голосовые сообщения
 *   - Демонстрация экрана (future)
 *   - Видеоконференции (future)
 *
 * When a feature is OFF, the chat UI hides/disables the button and shows
 * "Функция временно недоступна." or "Функция находится в разработке…".
 *
 * Changes are persisted to AppSetting.communicationSettings and broadcast
 * to all connected clients via the `settings:changed` socket event —
 * no app restart needed.
 */

import { useState, useEffect, useCallback } from 'react'
import { Save, Loader2, Phone, Image as ImageIcon, Users } from 'lucide-react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { toast } from '@/lib/notifications'

interface CommunicationSettings {
  calls: boolean
  videoCalls: boolean
  photoUpload: boolean
  documentUpload: boolean
  videoUpload: boolean
  voiceMessages: boolean
  screenShare: boolean
  videoConferences: boolean
}

const DEFAULTS: CommunicationSettings = {
  calls: true,
  videoCalls: true,
  photoUpload: true,
  documentUpload: true,
  videoUpload: false,
  voiceMessages: true,
  screenShare: false,
  videoConferences: false,
}

export function CommunicationManager() {
  const [settings, setSettings] = useState<CommunicationSettings>(DEFAULTS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.get<{ value: CommunicationSettings | null }>('/api/settings/communicationSettings')
      if (data.value) {
        // Merge with defaults so new keys are filled in
        setSettings({ ...DEFAULTS, ...data.value })
      }
    } catch (e) {
      toast.error('Ошибка загрузки', { description: String(e) })
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const save = async () => {
    setSaving(true)
    try {
      await api.put('/api/settings/communicationSettings', { json: settings, auth: true })
      toast.success('Настройки общения сохранены')
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
        <Users className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight mb-1">Настройки общения</h1>
          <p className="text-sm text-muted-foreground">
            Включайте и отключайте функции общения в чате. Изменения применяются мгновенно для всех пользователей.
          </p>
        </div>
      </div>

      <div className="space-y-4">
        {/* Звонки */}
        <Section icon={<Phone className="h-5 w-5" />} title="Звонки">
          <Toggle
            label="Обычные звонки"
            description="Аудиозвонки между пользователями"
            checked={settings.calls}
            onChange={(v) => setSettings({ ...settings, calls: v })}
          />
          <Toggle
            label="Видеозвонки"
            description="Видеозвонки с поддержкой WebRTC"
            checked={settings.videoCalls}
            onChange={(v) => setSettings({ ...settings, videoCalls: v })}
          />
          <Toggle
            label="Демонстрация экрана"
            description="Пока в разработке — появится в следующих обновлениях"
            checked={settings.screenShare}
            onChange={(v) => setSettings({ ...settings, screenShare: v })}
            badge="Скоро"
          />
          <Toggle
            label="Видеоконференции"
            description="Групповые видеозвонки — в разработке"
            checked={settings.videoConferences}
            onChange={(v) => setSettings({ ...settings, videoConferences: v })}
            badge="Скоро"
          />
        </Section>

        {/* Отправка файлов */}
        <Section icon={<ImageIcon className="h-5 w-5" />} title="Отправка файлов">
          <Toggle
            label="Отправка фотографий"
            description="Фото из галереи и камеры"
            checked={settings.photoUpload}
            onChange={(v) => setSettings({ ...settings, photoUpload: v })}
          />
          <Toggle
            label="Отправка документов"
            description="PDF, DOCX, XLSX, TXT, ZIP и др."
            checked={settings.documentUpload}
            onChange={(v) => setSettings({ ...settings, documentUpload: v })}
          />
          <Toggle
            label="Отправка видео"
            description="Видеофайлы через чат. По умолчанию отключено."
            checked={settings.videoUpload}
            onChange={(v) => setSettings({ ...settings, videoUpload: v })}
          />
          <Toggle
            label="Голосовые сообщения"
            description="Запись и отправка голосовых сообщений"
            checked={settings.voiceMessages}
            onChange={(v) => setSettings({ ...settings, voiceMessages: v })}
          />
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
  label, description, checked, onChange, badge,
}: { label: string; description?: string; checked: boolean; onChange: (v: boolean) => void; badge?: string }) {
  return (
    <label className="flex items-start gap-3 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4"
      />
      <div className="flex-1">
        <div className="text-sm font-medium flex items-center gap-2">
          {label}
          {badge && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-600 border border-amber-500/30">
              {badge}
            </span>
          )}
        </div>
        {description && <div className="text-xs text-muted-foreground mt-0.5">{description}</div>}
      </div>
    </label>
  )
}
