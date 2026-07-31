'use client'

import { useState, useEffect, useCallback } from 'react'
import { Plus, Edit2, Trash2, Star, Zap, X, Loader2, Check } from 'lucide-react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from '@/lib/notifications'
// P1-5 fix: replace native confirm() with accessible StudioConfirmDialog
import { useConfirmDialog, StudioConfirmDialog } from '@/components/ui/confirm-dialog'

interface AIProvider {
  id: string
  name: string
  type: string
  hasApiKey: boolean
  apiKeyMasked: string
  baseUrl: string
  model: string
  enabled: boolean
  isDefault: boolean
  params: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

const PROVIDER_TYPES = [
  { value: 'deepseek', label: 'DeepSeek', defaultBaseUrl: 'https://api.deepseek.com', defaultModel: 'deepseek-chat' },
  { value: 'openai', label: 'OpenAI (GPT)', defaultBaseUrl: 'https://api.openai.com', defaultModel: 'gpt-4o-mini' },
  { value: 'gemini', label: 'Google Gemini', defaultBaseUrl: 'https://generativelanguage.googleapis.com', defaultModel: 'gemini-1.5-flash' },
  { value: 'claude', label: 'Anthropic Claude', defaultBaseUrl: 'https://api.anthropic.com', defaultModel: 'claude-3-5-sonnet-20241022' },
  { value: 'grok', label: 'xAI Grok', defaultBaseUrl: 'https://api.x.ai', defaultModel: 'grok-2-1212' },
  { value: 'openrouter', label: 'OpenRouter', defaultBaseUrl: 'https://openrouter.ai/api', defaultModel: 'openai/gpt-4o-mini' },
  { value: 'ollama', label: 'Ollama (local)', defaultBaseUrl: 'http://localhost:11434', defaultModel: 'llama3.1' },
  { value: 'custom', label: 'Custom (OpenAI-compatible)', defaultBaseUrl: '', defaultModel: '' },
]

export function AIProvidersManager() {
  const [providers, setProviders] = useState<AIProvider[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<AIProvider | null>(null)
  const [creating, setCreating] = useState(false)
  const [testing, setTesting] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<{ id: string; ok: boolean; message: string } | null>(null)
  // P1-5 fix: useConfirmDialog instead of native confirm()
  const { dialog: confirmDialog, confirm, close: closeConfirm } = useConfirmDialog()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.get<{ providers: AIProvider[] }>('/api/ai/providers', { auth: true })
      setProviders(data.providers)
    } catch (e) {
      toast.error('Не удалось загрузить провайдеры', { description: String(e) })
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const setDefault = async (id: string) => {
    try {
      await api.patch(`/api/ai/providers/${id}`, { json: { isDefault: true }, auth: true })
      toast.success('Активный провайдер изменён')
      await load()
    } catch (e) {
      toast.error('Ошибка', { description: String(e) })
    }
  }

  const toggleEnabled = async (p: AIProvider) => {
    try {
      await api.patch(`/api/ai/providers/${p.id}`, { json: { enabled: !p.enabled }, auth: true })
      await load()
    } catch (e) {
      toast.error('Ошибка', { description: String(e) })
    }
  }

  const remove = async (id: string) => {
    confirm({
      title: 'Удалить AI-провайдер?',
      message: 'Действие нельзя отменить.',
      confirmLabel: 'Удалить',
      variant: 'danger',
      onConfirm: async () => {
        closeConfirm()
        try {
          await api.delete(`/api/ai/providers/${id}`, { auth: true })
          toast.success('Удалено')
          await load()
        } catch (e) {
          toast.error('Ошибка', { description: String(e) })
        }
      },
    })
  }

  const test = async (id: string) => {
    setTesting(id)
    setTestResult(null)
    try {
      const res = await api.post<{ ok: boolean; reply?: string; error?: string; provider?: string }>(
        `/api/ai/providers/${id}/test`,
        { json: {}, auth: true },
      )
      setTestResult({
        id,
        ok: res.ok,
        message: res.ok ? `✓ ${res.reply || 'OK'}` : `✗ ${res.error || 'Ошибка'}`,
      })
    } catch (e) {
      setTestResult({ id, ok: false, message: String(e) })
    }
    setTesting(null)
  }

  if (loading) {
    return (
      <div className="p-6">
        <div className="h-20 rounded-2xl skeleton" />
      </div>
    )
  }

  return (
    <div className="px-4 md:px-6 py-6 pb-28">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight mb-1">AI провайдеры</h1>
          <p className="text-sm text-muted-foreground">
            Управление AI API ключами. Активный провайдер используется для чата.
          </p>
        </div>
        <Button onClick={() => setCreating(true)} className="gap-2">
          <Plus className="h-4 w-4" /> Добавить
        </Button>
      </div>

      {providers.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/60 p-8 text-center">
          <p className="text-muted-foreground mb-3">
            Нет настроенных AI-провайдеров. По умолчанию используется DeepSeek (если задан в .env).
          </p>
          <Button onClick={() => setCreating(true)} className="gap-2">
            <Plus className="h-4 w-4" /> Добавить провайдер
          </Button>
        </div>
      ) : (
        <div className="grid gap-3">
          {providers.map((p) => (
            <div
              key={p.id}
              className="rounded-2xl border border-border/60 bg-card p-4 flex flex-col gap-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold">{p.name}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-muted">{p.type}</span>
                    {p.isDefault && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-600 border border-emerald-500/30">
                        Активный
                      </span>
                    )}
                    {!p.enabled && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-600 border border-amber-500/30">
                        Отключён
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-muted-foreground mt-1 space-y-0.5">
                    <div>Модель: <code className="text-foreground">{p.model || '(по умолчанию)'}</code></div>
                    <div>API ключ: <code className="text-foreground">{p.apiKeyMasked || '—'}</code></div>
                    <div>Base URL: <code className="text-foreground">{p.baseUrl || '(по умолчанию)'}</code></div>
                  </div>
                </div>
                <div className="flex flex-col gap-1 shrink-0">
                  {!p.isDefault && (
                    <button
                      onClick={() => setDefault(p.id)}
                      title="Сделать активным"
                      className="grid place-items-center h-8 w-8 rounded-lg hover:bg-accent"
                    >
                      <Star className="h-4 w-4" />
                    </button>
                  )}
                  <button
                    onClick={() => setEditing(p)}
                    title="Редактировать"
                    className="grid place-items-center h-8 w-8 rounded-lg hover:bg-accent"
                  >
                    <Edit2 className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => toggleEnabled(p)}
                    title={p.enabled ? 'Отключить' : 'Включить'}
                    className="grid place-items-center h-8 w-8 rounded-lg hover:bg-accent"
                  >
                    <Zap className={`h-4 w-4 ${p.enabled ? 'text-emerald-600' : 'text-muted-foreground'}`} />
                  </button>
                  <button
                    onClick={() => remove(p.id)}
                    title="Удалить"
                    className="grid place-items-center h-8 w-8 rounded-lg hover:bg-destructive/10 text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="flex gap-2 flex-wrap">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => test(p.id)}
                  disabled={testing === p.id}
                  className="gap-2"
                >
                  {testing === p.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
                  Тест
                </Button>
                {testResult?.id === p.id && (
                  <span className={`text-xs flex items-center gap-1 ${testResult.ok ? 'text-emerald-600' : 'text-destructive'}`}>
                    {testResult.ok ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                    {testResult.message}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {(creating || editing) && (
        <ProviderEditor
          provider={editing}
          onClose={() => { setCreating(false); setEditing(null) }}
          onSaved={() => { setCreating(false); setEditing(null); load() }}
        />
      )}

      {/* P1-5 fix: accessible confirm dialog */}
      <StudioConfirmDialog dialog={confirmDialog} onClose={closeConfirm} />
    </div>
  )
}

function ProviderEditor({
  provider,
  onClose,
  onSaved,
}: {
  provider: AIProvider | null
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(provider?.name || '')
  const [type, setType] = useState(provider?.type || 'deepseek')
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl || '')
  const [model, setModel] = useState(provider?.model || '')
  const [enabled, setEnabled] = useState(provider?.enabled ?? true)
  const [isDefault, setIsDefault] = useState(provider?.isDefault ?? false)
  const [saving, setSaving] = useState(false)

  const onTypeChange = (newType: string) => {
    setType(newType)
    // Auto-fill base URL + model if empty
    const t = PROVIDER_TYPES.find((p) => p.value === newType)
    if (t) {
      if (!baseUrl) setBaseUrl(t.defaultBaseUrl)
      if (!model) setModel(t.defaultModel)
    }
  }

  const save = async () => {
    if (!name.trim()) {
      toast.error('Введите название')
      return
    }
    setSaving(true)
    try {
      const body: Record<string, unknown> = {
        name, type, baseUrl, model, enabled, isDefault,
      }
      // Only send apiKey if user typed a new one
      if (apiKey) body.apiKey = apiKey
      if (provider) {
        await api.patch(`/api/ai/providers/${provider.id}`, { json: body, auth: true })
        toast.success('Сохранено')
      } else {
        await api.post('/api/ai/providers', { json: body, auth: true })
        toast.success('Провайдер добавлен')
      }
      onSaved()
    } catch (e) {
      toast.error('Ошибка', { description: String(e) })
    }
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 z-[100] bg-black/60 grid place-items-center p-4" onClick={onClose}>
      <div
        className="bg-card rounded-2xl border border-border/60 w-full max-w-md max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-border/60">
          <h2 className="font-semibold text-lg">
            {provider ? 'Редактировать провайдер' : 'Новый AI-провайдер'}
          </h2>
          <button onClick={onClose} className="grid place-items-center h-8 w-8 rounded-lg hover:bg-accent">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <div className="space-y-1.5">
            <Label>Название</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Например: DeepSeek Production" />
          </div>
          <div className="space-y-1.5">
            <Label>Тип провайдера</Label>
            <select
              value={type}
              onChange={(e) => onTypeChange(e.target.value)}
              className="w-full h-10 rounded-md border border-input bg-background px-3"
            >
              {PROVIDER_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>API ключ {provider && provider.hasApiKey && '(оставьте пустым, чтобы не менять)'}</Label>
            {/* v24.6-audit (C-AI-2 fix): data-sensitive="true" marks this field
                so the global-studio-ai.tsx scraper skips it. Already filtered by
                type="password", but this is belt-and-braces defense-in-depth. */}
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={provider?.hasApiKey ? `Текущий: ${provider.apiKeyMasked}` : 'sk-...'}
              data-sensitive="true"
              autoComplete="off"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Base URL</Label>
            <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.deepseek.com" />
          </div>
          <div className="space-y-1.5">
            <Label>Модель</Label>
            <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="deepseek-chat" />
          </div>
          <div className="flex flex-col gap-2 pt-2">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
              Включено
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
              Использовать по умолчанию (активный провайдер)
            </label>
          </div>
        </div>
        <div className="p-4 border-t border-border/60 flex gap-2 justify-end">
          <Button variant="outline" onClick={onClose}>Отмена</Button>
          <Button onClick={save} disabled={saving} className="gap-2">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Сохранить
          </Button>
        </div>
      </div>
    </div>
  )
}
