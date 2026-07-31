'use client'

import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'

import { api, assetUrl } from '@/lib/api'
import type { HeaderImageSetting } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { ImageUploader } from './image-uploader'
import { useConfirmDialog, StudioConfirmDialog } from '@/components/ui/confirm-dialog'
import { cn } from '@/lib/utils'
import { toast } from '@/lib/notifications'

const POSITIONS = [
  { id: 'center', label: 'Центр' },
  { id: 'top', label: 'Сверху' },
  { id: 'bottom', label: 'Снизу' },
] as const

export function HeaderManager() {
  const [setting, setSetting] = useState<HeaderImageSetting>({ url: null, position: 'center', enabled: false })
  const [appTitle, setAppTitle] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
// v9-audit-fix (U-3): confirmation dialog for destructive header image removal.
  // Previously this was a one-click delete with no confirmation — unlike every
  // other destructive action in the panel.
  const { dialog: confirmDialog, confirm, close: closeConfirm } = useConfirmDialog()

  useEffect(() => {
    Promise.all([
      api.get<{ value: HeaderImageSetting | null }>('/api/settings/headerImage', { auth: true }),
      api.get<{ value: string | null }>('/api/settings/appTitle', { auth: true }),
    ])
      .then(([hd, td]) => {
        if (hd.value && typeof hd.value === 'object') setSetting(hd.value as HeaderImageSetting)
        if (typeof td.value === "string") setAppTitle(td.value)
      })
      .catch((e) => {
        // S-LOW-008: was `.catch(() => {})` — silent failure swallowed
        // network/backend errors, leaving the manager stuck on defaults.
        console.error('[header-manager] load failed:', e)
      })
      .finally(() => setLoading(false))
  }, [])

  const save = async () => {
    setSaving(true)
    try {
      await Promise.all([
        api.put('/api/settings/headerImage', { json: setting, auth: true }),
        // v8-audit-fix: send "" instead of null (Express rejects null JSON body)
        api.put('/api/settings/appTitle', { json: appTitle.trim() || '', auth: true }),
      ])
      toast.success('Настройки шапки сохранены')
    } catch (e: unknown) {
      toast.error('Ошибка', { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setSaving(false)
    }
  }

  const removeImage = async () => {
    const next = { ...setting, url: null, enabled: false }
    setSetting(next)
    try {
      await api.delete('/api/settings/headerImage', { auth: true })
      toast.success('Изображение удалено')
    } catch (e: unknown) {
      toast.error('Ошибка', { description: e instanceof Error ? e.message : String(e) })
    }
  }

  if (loading) {
    return <div className="px-4 md:px-6 py-6 page-top-padding"><div className="h-64 rounded-2xl skeleton" /></div>
  }

  return (
    <div className="px-4 md:px-6 py-6 pb-28 page-top-padding max-w-2xl">
      <div className="mb-4">
        <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">Шапка</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Управление названием и изображением шапки приложения.</p>
      </div>

      {/* App title setting */}
      <div className="mb-6 p-4 rounded-2xl glass space-y-3">
        <Label className="block">Название в шапке</Label>
        <Input
          value={appTitle}
          onChange={(e) => setAppTitle(e.target.value)}
          placeholder="Оставьте пустым — название не будет показываться"
          className="max-w-sm"
        />
        <p className="text-xs text-muted-foreground">
          Оставьте пустым, чтобы убрать название из шапки полностью.
        </p>
      </div>

      {/* Live preview */}
      <div className="mb-4">
        <Label className="mb-2 block">Предпросмотр</Label>
        <div
          className="relative w-full h-32 rounded-3xl overflow-hidden glass"
          style={{ backgroundImage: 'linear-gradient(135deg, rgba(56,189,248,0.55) 0%, rgba(37,99,235,0.55) 50%, rgba(124,58,237,0.55) 100%)' }}
        >
          {setting.url ? (
            <img
              src={assetUrl(setting.url)}
              alt="Header preview"
              className="absolute inset-0 h-full w-full object-cover mix-blend-overlay opacity-60"
              style={{ objectPosition: setting.position === 'top' ? 'top' : setting.position === 'bottom' ? 'bottom' : 'center' }}
            />
          ) : (
            <div className="absolute inset-0 grid place-items-center text-white/70 text-sm">Нет изображения</div>
          )}
          <div className="relative h-full flex items-center px-4">
            <span className="font-extrabold text-xl tracking-tight text-white drop-shadow-sm">
              999 <span className="font-light opacity-90">PRO</span>
            </span>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <ImageUploader
          value={setting.url ? [setting.url] : []}
          onChange={(urls) => setSetting((s) => ({ ...s, url: urls[0] || null, enabled: urls.length > 0 ? true : s.enabled }))}
          aspect="banner"
          label="Изображение шапки"
        />

        {setting.url && (
          <div className="space-y-1.5">
            <Label>Положение изображения</Label>
            <div className="flex gap-2">
              {POSITIONS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSetting((s) => ({ ...s, position: p.id }))}
                  className={cn(
                    'flex-1 px-3 py-2 rounded-xl text-sm font-medium transition-all',
                    setting.position === p.id ? 'gradient-brand text-white shadow-glow' : 'glass text-muted-foreground hover:text-foreground',
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center gap-2">
          <Switch
            checked={setting.enabled}
            onCheckedChange={(v) => setSetting((s) => ({ ...s, enabled: v }))}
            id="enabled"
            disabled={!setting.url}
          />
          <Label htmlFor="enabled">Показывать изображение в шапке</Label>
        </div>

        <div className="flex gap-2 pt-2">
          {setting.url && (
            <Button
              variant="outline"
              className="rounded-full h-11 text-destructive"
              onClick={() =>
                // v9-audit-fix (U-3): require confirmation before deleting the
                // header image — matches the pattern used by every other
                // destructive action in the panel.
                confirm({
                  title: 'Удалить изображение шапки?',
                  message: 'Изображение будет удалено, и шапка вернётся к стандартному виду. Это действие нельзя отменить.',
                  confirmLabel: 'Удалить',
                  variant: 'danger',
                  onConfirm: removeImage,
                })
              }
            >
              <Trash2 className="h-4 w-4 mr-1" /> Удалить
            </Button>
          )}
          <Button
            className="flex-1 rounded-full gradient-brand text-white shadow-glow h-11"
            onClick={save}
            disabled={saving || (!setting.url && setting.enabled)}
          >
            {saving ? 'Сохранение…' : 'Сохранить'}
          </Button>
        </div>
      </div>

      {/* v9-audit-fix (U-3): confirmation dialog mount point */}
      <StudioConfirmDialog dialog={confirmDialog} onClose={closeConfirm} />
    </div>
  )
}
