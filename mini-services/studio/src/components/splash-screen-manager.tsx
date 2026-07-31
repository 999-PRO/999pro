'use client'

/**
 * v20: SplashScreenManager — Studio section for configuring the app's
 * start/splash screen shown on first load.
 *
 * Admin can:
 *   - Upload an image (or use a gradient)
 *   - Set main title, subtitle, description
 *   - Toggle text visibility
 *   - Set display duration (ms)
 *   - Delete the image
 *
 * Stored as AppSetting.splashScreen (JSON, public-readable).
 * Applied instantly via settings:changed socket event.
 */

import { useState, useEffect, useCallback } from 'react'
import { Save, Loader2, Image as ImageIcon, Trash2, Upload, Eye, EyeOff, Smartphone } from 'lucide-react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from '@/lib/notifications'
import { useAuthStore } from '@/lib/auth-store'

interface SplashScreenSettings {
  enabled: boolean
  image: string | null
  title: string
  subtitle: string
  description: string
  textColor: string
  showText: boolean
  durationMs: number
}

const DEFAULTS: SplashScreenSettings = {
  enabled: false,
  image: null,
  title: '999 — Три девятки',
  subtitle: 'Маркетплейс нового поколения',
  description: '',
  textColor: '#ffffff',
  showText: true,
  durationMs: 2500,
}

export function SplashScreenManager() {
  const [settings, setSettings] = useState<SplashScreenSettings>(DEFAULTS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.get<{ value: SplashScreenSettings | null }>('/api/settings/splashScreen')
      if (data.value) {
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
      await api.put('/api/settings/splashScreen', { json: settings, auth: true })
      toast.success('Настройки стартового экрана сохранены')
    } catch (e) {
      toast.error('Ошибка', { description: String(e) })
    }
    setSaving(false)
  }

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${useAuthStore.getState().token}`,
        },
        body: formData,
      })
      if (!res.ok) throw new Error('Upload failed')
      const data = await res.json()
      setSettings({ ...settings, image: data.url })
      toast.success('Изображение загружено')
    } catch (e: any) {
      toast.error('Ошибка загрузки', { description: e?.message || String(e) })
    } finally {
      setUploading(false)
      if (e.target) e.target.value = ''
    }
  }

  const deleteImage = () => {
    setSettings({ ...settings, image: null })
    toast.info('Изображение удалено (не забудьте сохранить)')
  }

  if (loading) {
    return <div className="p-6"><div className="h-20 rounded-2xl skeleton" /></div>
  }

  return (
    <div className="px-4 md:px-6 py-6 pb-28">
      <div className="flex items-center gap-2 mb-4">
        <Smartphone className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight mb-1">Стартовый экран</h1>
          <p className="text-sm text-muted-foreground">
            Настройка экрана заставки при запуске приложения.
          </p>
        </div>
      </div>

      {/* Phone Preview — portrait orientation */}
      <div className="mb-6 flex justify-center">
        <div
          className="relative rounded-[2rem] overflow-hidden border-4 border-border/60 shadow-2xl"
          style={{ width: '240px', height: '427px', aspectRatio: '9/16' }}
        >
          {/* Background */}
          <div className="absolute inset-0" style={{
            backgroundImage: settings.image ? `url(${settings.image})` : 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #312e81 100%)',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }} />
          {/* Dark overlay for text readability */}
          {settings.showText && (
            <div className="absolute inset-0" style={{
              background: 'linear-gradient(180deg, rgba(0,0,0,0.2) 0%, rgba(0,0,0,0.5) 60%, rgba(0,0,0,0.8) 100%)',
            }} />
          )}
          {/* Text content */}
          {settings.showText && (
            <div className="absolute inset-0 flex flex-col items-center justify-end p-6 pb-12 text-center">
              {settings.title && (
                <h2 className="text-2xl font-extrabold mb-1" style={{ color: settings.textColor }}>
                  {settings.title}
                </h2>
              )}
              {settings.subtitle && (
                <p className="text-sm mb-2" style={{ color: settings.textColor, opacity: 0.9 }}>
                  {settings.subtitle}
                </p>
              )}
              {settings.description && (
                <p className="text-xs" style={{ color: settings.textColor, opacity: 0.7 }}>
                  {settings.description}
                </p>
              )}
            </div>
          )}
          {/* Duration indicator */}
          <div className="absolute top-3 right-3 text-[10px] px-2 py-0.5 rounded-full bg-black/50 text-white backdrop-blur-sm">
            {(settings.durationMs / 1000).toFixed(1)}с
          </div>
          {!settings.enabled && (
            <div className="absolute top-3 left-3 text-[10px] px-2 py-0.5 rounded-full bg-amber-500/80 text-white">
              Отключён
            </div>
          )}
        </div>
      </div>

      <div className="space-y-4">
        {/* Enable toggle */}
        <div className="rounded-2xl border border-border/60 bg-card p-4 md:p-6">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })}
              className="h-4 w-4"
            />
            <div>
              <div className="text-sm font-medium">Включить стартовый экран</div>
              <div className="text-xs text-muted-foreground">Показывать при запуске приложения</div>
            </div>
          </label>
        </div>

        {/* Image upload */}
        <div className="rounded-2xl border border-border/60 bg-card p-4 md:p-6 space-y-3">
          <div className="flex items-center gap-2">
            <ImageIcon className="h-5 w-5 text-primary" />
            <h3 className="font-semibold">Изображение</h3>
          </div>
          <p className="text-xs text-muted-foreground">
            Загрузите изображение для фона стартового экрана. Рекомендуется вертикальное (портретное) изображение 1080×1920. Изображение автоматически масштабируется под экран устройства.
          </p>
          <div className="flex gap-2 flex-wrap">
            <label className="cursor-pointer">
              <input type="file" accept="image/*" onChange={handleUpload} className="hidden" />
              <span className="inline-flex items-center gap-2 h-10 px-4 rounded-xl gradient-brand text-white text-sm font-bold">
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {settings.image ? 'Заменить' : 'Загрузить'}
              </span>
            </label>
            {settings.image && (
              <Button variant="outline" onClick={deleteImage} className="gap-2">
                <Trash2 className="h-4 w-4" /> Удалить
              </Button>
            )}
          </div>
          {settings.image && (
            <div className="text-xs text-muted-foreground">
              Текущее: <code className="font-mono">{settings.image.slice(0, 50)}…</code>
            </div>
          )}
        </div>

        {/* Text settings */}
        <div className="rounded-2xl border border-border/60 bg-card p-4 md:p-6 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold">Текст</h3>
            </div>
            <label className="flex items-center gap-2 cursor-pointer text-sm">
              {settings.showText ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
              <span>{settings.showText ? 'Показывать' : 'Скрыт'}</span>
              <input
                type="checkbox"
                checked={settings.showText}
                onChange={(e) => setSettings({ ...settings, showText: e.target.checked })}
                className="h-4 w-4"
              />
            </label>
          </div>

          <div className="space-y-2">
            <div className="space-y-1.5">
              <Label>Главный заголовок</Label>
              <Input
                value={settings.title}
                onChange={(e) => setSettings({ ...settings, title: e.target.value })}
                placeholder="999 — Три девятки"
                maxLength={50}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Подзаголовок</Label>
              <Input
                value={settings.subtitle}
                onChange={(e) => setSettings({ ...settings, subtitle: e.target.value })}
                placeholder="Маркетплейс нового поколения"
                maxLength={100}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Описание</Label>
              <Input
                value={settings.description}
                onChange={(e) => setSettings({ ...settings, description: e.target.value })}
                placeholder="Дополнительный текст (необязательно)"
                maxLength={200}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Цвет текста</Label>
              <div className="flex gap-2 items-center">
                <input
                  type="color"
                  value={settings.textColor}
                  onChange={(e) => setSettings({ ...settings, textColor: e.target.value })}
                  className="h-10 w-16 rounded-lg border border-border/40 cursor-pointer"
                />
                <Input
                  value={settings.textColor}
                  onChange={(e) => setSettings({ ...settings, textColor: e.target.value })}
                  className="font-mono"
                  maxLength={7}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Duration */}
        <div className="rounded-2xl border border-border/60 bg-card p-4 md:p-6 space-y-3">
          <h3 className="font-semibold">Время отображения</h3>
          <div className="space-y-1.5">
            <Label>Длительность (миллисекунды)</Label>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min="500"
                max="5000"
                step="100"
                value={settings.durationMs}
                onChange={(e) => setSettings({ ...settings, durationMs: Number(e.target.value) })}
                className="flex-1 h-2 rounded-full bg-foreground/10 accent-primary"
              />
              <span className="text-sm font-mono w-16 text-right">{(settings.durationMs / 1000).toFixed(1)}с</span>
            </div>
            <p className="text-xs text-muted-foreground">
              От 0.5с до 5с. Рекомендуется 2–3 секунды.
            </p>
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

