'use client'

// ============================================================================
//  ChatSettingsManager — Studio panel for chat configuration.
//  v25.8 (TRI999 launch):
//    • Visibility setting — who is available to clients in the chat:
//        admin | manager | both | none
//    • Cleanup test data — removes test conversations, messages, demo users
// ============================================================================

import { useEffect, useState, useCallback } from 'react'
import { MessageSquare, Trash2, Loader2, ShieldCheck, Shield, Ban, Users } from 'lucide-react'
import { api } from '@/lib/api'
import { toast } from '@/lib/notifications'
import { Button } from '@/components/ui/button'

type Visibility = 'admin' | 'manager' | 'both' | 'none'

const VISIBILITY_OPTIONS: Array<{
  value: Visibility
  label: string
  description: string
  icon: typeof ShieldCheck
}> = [
  {
    value: 'admin',
    label: 'Только администратор',
    description: 'Клиенты видят чат с администратором. Менеджеры не отображаются.',
    icon: ShieldCheck,
  },
  {
    value: 'manager',
    label: 'Только менеджер',
    description: 'Клиенты видят чат с менеджером. Администраторы не отображаются как контакты.',
    icon: Shield,
  },
  {
    value: 'both',
    label: 'Администратор + менеджер',
    description: 'Клиенты видят оба официальных контакта.',
    icon: Users,
  },
  {
    value: 'none',
    label: 'Никто',
    description: 'Клиенты не видят официальных контактов. Существующие чаты остаются доступны.',
    icon: Ban,
  },
]

export function ChatSettingsManager() {
  const [visibility, setVisibility] = useState<Visibility>('admin')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [cleaningUp, setCleaningUp] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const d = await api.get<{ visibility: Visibility }>('/api/chat/visibility', { auth: true })
      setVisibility(d.visibility)
    } catch (e: any) {
      toast.error('Не удалось загрузить настройки чата', { description: e?.message || String(e) })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleSave = async (v: Visibility) => {
    setSaving(true)
    try {
      await api.patch('/api/chat/visibility', { json: { visibility: v }, auth: true })
      setVisibility(v)
      toast.success('Настройка сохранена', {
        description: 'Клиенты увидят изменения при следующем открытии чата.',
      })
    } catch (e: any) {
      toast.error('Ошибка сохранения', { description: e?.message || String(e) })
    } finally {
      setSaving(false)
    }
  }

  const handleCleanup = async () => {
    if (!confirm(
      'Удалить все тестовые чаты, сообщения и демо-пользователи?\n\n' +
      'Будут удалены:\n' +
      '• Чаты, где есть пользователи с именами test/demo/тест/демо\n' +
      '• Пустые support-чаты без сообщений\n' +
      '• Демо-аккаунты (сoft-delete)\n\n' +
      'Реальные клиентские данные сохранятся. Действие необратимо.'
    )) return
    setCleaningUp(true)
    try {
      const d = await api.post<{
        deletedConversations: number
        deletedMessages: number
        deletedUsers: number
      }>('/api/chat/cleanup-test-data', { auth: true })
      toast.success('Тестовые данные удалены', {
        description: `Чатов: ${d.deletedConversations}, сообщений: ${d.deletedMessages}, пользователей: ${d.deletedUsers}`,
      })
    } catch (e: any) {
      toast.error('Ошибка очистки', { description: e?.message || String(e) })
    } finally {
      setCleaningUp(false)
    }
  }

  if (loading) {
    return (
      <div className="px-4 md:px-6 py-6 pb-28 page-top-padding">
        <div className="h-8 w-48 skeleton rounded-lg mb-4" />
        <div className="h-32 rounded-2xl skeleton" />
      </div>
    )
  }

  return (
    <div className="px-4 md:px-6 py-6 pb-28 page-top-padding">
      <div className="mb-6">
        <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight flex items-center gap-2">
          <MessageSquare className="h-7 w-7" />
          Настройки чата
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Кто доступен клиентам в чате, очистка тестовых данных.
        </p>
      </div>

      {/* Visibility section */}
      <div className="rounded-2xl glass p-5 mb-6">
        <h2 className="text-lg font-semibold mb-1">Видимые контакты для клиентов</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Выберите, какие официальные контакты видят клиенты при открытии чата.
          Настройка сохраняется в базе данных и применяется на всех устройствах.
        </p>

        <div className="grid gap-2">
          {VISIBILITY_OPTIONS.map((opt) => {
            const Icon = opt.icon
            const active = visibility === opt.value
            return (
              <button
                key={opt.value}
                onClick={() => handleSave(opt.value)}
                disabled={saving}
                className={`flex items-start gap-3 p-3 rounded-xl border text-left transition-all disabled:opacity-50 ${
                  active
                    ? 'bg-primary/10 border-primary shadow-soft'
                    : 'bg-background border-border/60 hover:bg-accent/30'
                }`}
              >
                <div className={`h-9 w-9 rounded-full grid place-items-center shrink-0 ${
                  active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                }`}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm">{opt.label}</span>
                    {active && (
                      <span className="text-[10px] font-bold uppercase text-primary">● Активно</span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{opt.description}</p>
                </div>
                {saving && active && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
              </button>
            )
          })}
        </div>
      </div>

      {/* Cleanup section */}
      <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-5">
        <h2 className="text-lg font-semibold mb-1 flex items-center gap-2 text-amber-700 dark:text-amber-400">
          <Trash2 className="h-5 w-5" />
          Очистка тестовых данных
        </h2>
        <p className="text-sm text-muted-foreground mb-4">
          Удаляет все тестовые чаты, демонстрационные переписки и демо-пользователей.
          Реальные клиентские данные сохраняются. Действие необратимо.
        </p>
        <div className="rounded-xl bg-background/50 p-3 mb-4 text-xs text-muted-foreground">
          <p className="font-semibold mb-1">Критерии удаления:</p>
          <ul className="space-y-0.5 ml-3 list-disc">
            <li>Чаты, где есть пользователи с именами: <code>test</code>, <code>demo</code>, <code>тест</code>, <code>демо</code></li>
            <li>Пустые support-чаты без единого сообщения</li>
            <li>Пользователи с email на <code>example.com</code> или с тестовыми именами</li>
          </ul>
        </div>
        <Button
          variant="destructive"
          onClick={handleCleanup}
          disabled={cleaningUp}
          className="gap-2"
        >
          {cleaningUp ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          {cleaningUp ? 'Очистка...' : 'Очистить тестовые данные'}
        </Button>
      </div>
    </div>
  )
}
