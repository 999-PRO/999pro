'use client'

import { useEffect, useState } from 'react'
import { Send, Loader2, Megaphone, Users, BellRing } from 'lucide-react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useConfirmDialog, StudioConfirmDialog } from '@/components/ui/confirm-dialog'
import { toast } from '@/lib/notifications'

export function MassPushManager() {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [url, setUrl] = useState('/')
  const [sending, setSending] = useState(false)
  const [recipientCount, setRecipientCount] = useState<number | null>(null)
  // v25.15: авто-push при новом товаре (setting notifyNewProduct,
  // по умолчанию ВКЛ — отсутствующее значение трактуется как true).
  const [autoNewProduct, setAutoNewProduct] = useState(true)
  const [autoLoading, setAutoLoading] = useState(true)
  const { dialog: confirmDialog, confirm: openConfirm, close: closeConfirm } = useConfirmDialog()

  useEffect(() => {
    api.get<{ value: boolean | null }>('/api/settings/notifyNewProduct')
      .then((d) => setAutoNewProduct(d.value !== false))
      .catch(() => {})
      .finally(() => setAutoLoading(false))
  }, [])

  const toggleAutoNewProduct = async (v: boolean) => {
    setAutoNewProduct(v)
    try {
      await api.put('/api/settings/notifyNewProduct', { json: v, auth: true })
      toast.success(v ? 'Авто-push при новом товаре включён' : 'Авто-push отключён')
    } catch {
      setAutoNewProduct(!v)
      toast.error('Не удалось сохранить настройку')
    }
  }

  const handleSend = async () => {
    if (!title.trim() || !body.trim()) {
      toast.error('Заполните заголовок и текст')
      return
    }
    setSending(true)
    try {
      const res = await api.post<{ ok: boolean; recipientCount: number; message: string }>('/api/push/broadcast', {
        json: { title: title.trim(), body: body.trim(), url: url || '/' },
        auth: true,
      })
      setRecipientCount(res.recipientCount)
      toast.success(`Push отправляется ${res.recipientCount} пользователям`)
      setTitle('')
      setBody('')
      setUrl('/')
    } catch (e: unknown) {
      toast.error('Ошибка отправки', { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setSending(false)
    }
  }

  const handleSendClick = () => {
    if (!title.trim() || !body.trim()) {
      toast.error('Заполните заголовок и текст')
      return
    }
    openConfirm({
      title: 'Отправить массовый Push?',
      message: `Уведомление получат все пользователи приложения. Заголовок: "${title.trim()}"`,
      confirmLabel: 'Отправить',
      variant: 'danger',
      onConfirm: handleSend,
    })
  }

  return (
    <div className="px-4 md:px-6 py-6 pb-28 page-top-padding max-w-2xl">
      <div className="mb-5">
        <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight flex items-center gap-2">
          <Megaphone className="h-7 w-7 text-violet-600" />
          Массовая рассылка Push
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Отправить push-уведомление всем пользователям приложения.
        </p>
      </div>

      <div className="space-y-5">
        <div className="space-y-1.5">
          <Label htmlFor="push-title">Заголовок</Label>
          <Input
            id="push-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Например: Новая акция!"
            maxLength={50}
          />
          <p className="text-[11px] text-muted-foreground">{title.length}/50 символов</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="push-body">Текст уведомления</Label>
          <textarea
            id="push-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Например: Скидка 50% на все товары до конца недели!"
            maxLength={200}
            rows={3}
            className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-400/20 focus:border-violet-400/50 resize-none"
          />
          <p className="text-[11px] text-muted-foreground">{body.length}/200 символов</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="push-url">Ссылка при клике</Label>
          <Input
            id="push-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="/?view=catalog или /?view=club"
          />
          <p className="text-[11px] text-muted-foreground">
            Куда перейти при клике на уведомление (по умолчанию — главная)
          </p>
        </div>

        {recipientCount !== null && (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-violet-500/10 border border-violet-500/20">
            <Users className="h-4 w-4 text-violet-600 shrink-0" />
            <span className="text-sm text-violet-700 dark:text-violet-400">
              Последняя рассылка: {recipientCount} получателей
            </span>
          </div>
        )}

        <Button
          className="w-full rounded-full gradient-brand text-white shadow-glow h-12"
          onClick={handleSendClick}
          disabled={sending || !title.trim() || !body.trim()}
        >
          {sending ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Отправка…
            </>
          ) : (
            <>
              <Send className="h-4 w-4 mr-2" /> Отправить Push всем пользователям
            </>
          )}
        </Button>

        {/* ── v25.15: АВТОУВЕДОМЛЕНИЯ ─────────────────────────────── */}
        <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
          <div className="flex items-center gap-2">
            <BellRing className="h-5 w-5 text-violet-600" />
            <span className="font-bold">Автоуведомления</span>
          </div>

          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <Label className="text-sm font-semibold cursor-pointer" htmlFor="auto-new-product">
                Push при добавлении товара
              </Label>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                Когда вы публикуете новый товар в каталоге, все пользователи с
                включёнными уведомлениями автоматически получают push:
                «Новый товар в каталоге». Вам самим уведомление не приходит.
              </p>
            </div>
            <Switch
              id="auto-new-product"
              checked={autoNewProduct}
              disabled={autoLoading}
              onCheckedChange={toggleAutoNewProduct}
            />
          </div>
        </div>
      </div>

      <StudioConfirmDialog
        dialog={confirmDialog}
        onClose={closeConfirm}
      />
    </div>
  )
}
