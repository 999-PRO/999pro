'use client'

import { useState, useEffect, useCallback } from 'react'
import { Save, Loader2, ToggleLeft, ToggleRight, Grid3x3 } from 'lucide-react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { toast } from '@/lib/notifications'

const MODULES = [
  { key: 'chat', label: 'Чат', icon: '💬', desc: 'Real-time чат с продавцами и поддержкой' },
  { key: 'ai-assistant', label: 'AI Assistant', icon: '🤖', desc: 'AI-ассистент для помощи покупателям' },
  { key: 'audio-hub', label: 'Audio Hub', icon: '🎵', desc: 'Поиск и прослушивание музыки' },
  { key: 'video-hub', label: 'Video Hub', icon: '🎬', desc: 'Каталог фильмов и сериалов' },
  { key: 'media-hub', label: 'Media Hub', icon: '📺', desc: 'Медиа-контент' },
  { key: 'catalog', label: 'Каталог', icon: '🛍️', desc: 'Каталог товаров' },
  { key: 'orders', label: 'Заказы', icon: '📦', desc: 'История и статус заказов' },
  { key: 'profile', label: 'Профиль', icon: '👤', desc: 'Профиль пользователя' },
  { key: 'favorites', label: 'Избранное', icon: '❤️', desc: 'Избранные товары' },
  { key: 'news', label: 'Новости', icon: '📰', desc: 'Новости и обновления' },
  { key: 'notifications', label: 'Уведомления', icon: '🔔', desc: 'Push и in-app уведомления' },
  { key: 'club', label: '999 CLUB', icon: '👑', desc: 'Программа лояльности' },
  { key: 'stories', label: 'Сторис', icon: '📸', desc: 'Истории продавцов' },
  { key: 'reviews', label: 'Отзывы', icon: '⭐', desc: 'Отзывы на товары' },
  { key: 'support', label: 'Поддержка', icon: '🛟', desc: 'Служба поддержки' },
  { key: 'settings', label: 'Настройки', icon: '⚙️', desc: 'Настройки приложения' },
] as const

type ModulesMap = Record<string, boolean>

export function ModuleAccessManager() {
  const [modules, setModules] = useState<ModulesMap>(
    Object.fromEntries(MODULES.map((m) => [m.key, true])),
  )
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.get<{ value: ModulesMap | null }>('/api/settings/modulesEnabled')
      if (data.value && typeof data.value === 'object') {
        // Merge with defaults so new modules default to enabled
        const merged: ModulesMap = Object.fromEntries(MODULES.map((m) => [m.key, true]))
        for (const k of Object.keys(data.value)) {
          merged[k] = data.value[k]
        }
        setModules(merged)
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
      await api.put('/api/settings/modulesEnabled', { json: modules, auth: true })
      toast.success('Настройки модулей сохранены')
    } catch (e) {
      toast.error('Ошибка', { description: String(e) })
    }
    setSaving(false)
  }

  const toggle = (key: string) => {
    setModules((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  if (loading) {
    return <div className="p-6"><div className="h-20 rounded-2xl skeleton" /></div>
  }

  return (
    <div className="px-4 md:px-6 py-6 pb-28">
      <div className="flex items-center gap-2 mb-4">
        <Grid3x3 className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight mb-1">Доступ к модулям</h1>
          <p className="text-sm text-muted-foreground">
            Включайте и отключайте разделы приложения. Отключённые модули скрываются из навигации.
          </p>
        </div>
      </div>

      <div className="grid gap-2 md:grid-cols-2">
        {MODULES.map((m) => {
          const enabled = modules[m.key] ?? true
          return (
            <button
              key={m.key}
              onClick={() => toggle(m.key)}
              className={`rounded-2xl border p-4 text-left transition-all flex items-start gap-3 ${
                enabled
                  ? 'border-emerald-500/30 bg-emerald-500/5'
                  : 'border-border/40 bg-card opacity-60'
              }`}
            >
              <div className="text-2xl">{m.icon}</div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold flex items-center gap-2">
                  {m.label}
                  {enabled
                    ? <ToggleRight className="h-4 w-4 text-emerald-600 ml-auto" />
                    : <ToggleLeft className="h-4 w-4 text-muted-foreground ml-auto" />}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">{m.desc}</div>
              </div>
            </button>
          )
        })}
      </div>

      <div className="flex justify-end pt-4">
        <Button onClick={save} disabled={saving} className="gap-2">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Сохранить
        </Button>
      </div>
    </div>
  )
}
