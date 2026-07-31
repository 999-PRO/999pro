'use client'

import { useState, useEffect, useCallback } from 'react'
import { Plus, Edit2, Trash2, X, Loader2, Tag, Percent, Coins } from 'lucide-react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from '@/lib/notifications'
// P1-5 fix: replace native confirm() with accessible StudioConfirmDialog
import { useConfirmDialog, StudioConfirmDialog } from '@/components/ui/confirm-dialog'

interface PromoCode {
  id: string
  code: string
  description: string | null
  discountType: 'percent' | 'fixed'
  discountValue: number
  minOrderTotal: number
  maxDiscount: number | null
  maxUses: number | null
  maxUsesPerUser: number | null
  usedCount: number
  startsAt: string | null
  endsAt: string | null
  active: boolean
  category: string | null
  createdAt: string
  updatedAt: string
}

export function PromoCodesManager() {
  const [promos, setPromos] = useState<PromoCode[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<PromoCode | null>(null)
  const [creating, setCreating] = useState(false)
  // P1-5 fix: useConfirmDialog instead of native confirm()
  const { dialog: confirmDialog, confirm, close: closeConfirm } = useConfirmDialog()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.get<{ promoCodes: PromoCode[] }>('/api/promo-codes', { auth: true })
      setPromos(data.promoCodes)
    } catch (e) {
      toast.error('Ошибка загрузки', { description: String(e) })
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const remove = async (id: string) => {
    confirm({
      title: 'Удалить промокод?',
      message: 'Действие нельзя отменить.',
      confirmLabel: 'Удалить',
      variant: 'danger',
      onConfirm: async () => {
        closeConfirm()
        try {
          await api.delete(`/api/promo-codes/${id}`, { auth: true })
          toast.success('Удалено')
          load()
        } catch (e) {
          toast.error('Ошибка', { description: String(e) })
        }
      },
    })
  }

  if (loading) {
    return <div className="p-6"><div className="h-20 rounded-2xl skeleton" /></div>
  }

  return (
    <div className="px-4 md:px-6 py-6 pb-28">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight mb-1">Промокоды</h1>
          <p className="text-sm text-muted-foreground">
            Коды скидок для применения в корзине.
          </p>
        </div>
        <Button onClick={() => setCreating(true)} className="gap-2">
          <Plus className="h-4 w-4" /> Создать
        </Button>
      </div>

      {promos.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/60 p-8 text-center">
          <Tag className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
          <p className="text-muted-foreground mb-3">Промокодов пока нет</p>
          <Button onClick={() => setCreating(true)} className="gap-2">
            <Plus className="h-4 w-4" /> Создать первый
          </Button>
        </div>
      ) : (
        <div className="grid gap-3">
          {promos.map((p) => (
            <div key={p.id} className="rounded-2xl border border-border/60 bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <code className="text-sm font-bold tracking-wide px-2 py-0.5 rounded bg-primary/10 text-primary">
                      {p.code}
                    </code>
                    <span className="text-sm flex items-center gap-1">
                      {p.discountType === 'percent' ? <Percent className="h-3 w-3" /> : <Coins className="h-3 w-3" />}
                      {p.discountValue}{p.discountType === 'percent' ? '%' : '₽'}
                    </span>
                    {!p.active && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-600 border border-amber-500/30">
                        Отключён
                      </span>
                    )}
                  </div>
                  {p.description && (
                    <p className="text-sm text-muted-foreground mt-1">{p.description}</p>
                  )}
                  <div className="text-xs text-muted-foreground mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5">
                    <div>Использований: {p.usedCount}{p.maxUses ? ` / ${p.maxUses}` : ''}</div>
                    <div>На пользователя: {p.maxUsesPerUser || '∞'}</div>
                    <div>Мин. сумма: {p.minOrderTotal}₽</div>
                    {p.maxDiscount && <div>Макс. скидка: {p.maxDiscount}₽</div>}
                    {p.startsAt && <div>С: {new Date(p.startsAt).toLocaleDateString('ru')}</div>}
                    {p.endsAt && <div>До: {new Date(p.endsAt).toLocaleDateString('ru')}</div>}
                    {p.category && <div>Категория: {p.category}</div>}
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button onClick={() => setEditing(p)} className="grid place-items-center h-8 w-8 rounded-lg hover:bg-accent">
                    <Edit2 className="h-4 w-4" />
                  </button>
                  <button onClick={() => remove(p.id)} className="grid place-items-center h-8 w-8 rounded-lg hover:bg-destructive/10 text-destructive">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {(creating || editing) && (
        <PromoEditor
          promo={editing}
          onClose={() => { setCreating(false); setEditing(null) }}
          onSaved={() => { setCreating(false); setEditing(null); load() }}
        />
      )}

      {/* P1-5 fix: accessible confirm dialog */}
      <StudioConfirmDialog dialog={confirmDialog} onClose={closeConfirm} />
    </div>
  )
}

function PromoEditor({
  promo,
  onClose,
  onSaved,
}: {
  promo: PromoCode | null
  onClose: () => void
  onSaved: () => void
}) {
  const [code, setCode] = useState(promo?.code || '')
  const [description, setDescription] = useState(promo?.description || '')
  const [discountType, setDiscountType] = useState<'percent' | 'fixed'>(promo?.discountType || 'percent')
  const [discountValue, setDiscountValue] = useState(String(promo?.discountValue || 10))
  const [minOrderTotal, setMinOrderTotal] = useState(String(promo?.minOrderTotal || 0))
  const [maxDiscount, setMaxDiscount] = useState(promo?.maxDiscount ? String(promo.maxDiscount) : '')
  const [maxUses, setMaxUses] = useState(promo?.maxUses ? String(promo.maxUses) : '')
  const [maxUsesPerUser, setMaxUsesPerUser] = useState(promo?.maxUsesPerUser ? String(promo.maxUsesPerUser) : '')
  const [startsAt, setStartsAt] = useState(promo?.startsAt ? new Date(promo.startsAt).toISOString().slice(0, 10) : '')
  const [endsAt, setEndsAt] = useState(promo?.endsAt ? new Date(promo.endsAt).toISOString().slice(0, 10) : '')
  const [active, setActive] = useState(promo?.active ?? true)
  const [category, setCategory] = useState(promo?.category || '')
  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (!code.trim()) { toast.error('Введите код'); return }
    if (!/^[A-Z0-9_-]+$/i.test(code)) {
      toast.error('Код может содержать только буквы, цифры, дефис и подчёркивание')
      return
    }
    setSaving(true)
    try {
      const body: Record<string, unknown> = {
        code: code.toUpperCase(),
        description: description || undefined,
        discountType,
        discountValue: Number(discountValue),
        minOrderTotal: Number(minOrderTotal),
        maxDiscount: maxDiscount ? Number(maxDiscount) : null,
        maxUses: maxUses ? Number(maxUses) : null,
        maxUsesPerUser: maxUsesPerUser ? Number(maxUsesPerUser) : null,
        startsAt: startsAt ? new Date(startsAt).toISOString() : null,
        endsAt: endsAt ? new Date(endsAt).toISOString() : null,
        active,
        category: category || null,
      }
      if (promo) {
        await api.patch(`/api/promo-codes/${promo.id}`, { json: body, auth: true })
        toast.success('Сохранено')
      } else {
        await api.post('/api/promo-codes', { json: body, auth: true })
        toast.success('Создано')
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
        className="bg-card rounded-2xl border border-border/60 w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-border/60">
          <h2 className="font-semibold text-lg">{promo ? 'Редактировать промокод' : 'Новый промокод'}</h2>
          <button onClick={onClose} className="grid place-items-center h-8 w-8 rounded-lg hover:bg-accent">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <div className="space-y-1.5">
            <Label>Код</Label>
            <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="SUMMER2025" className="font-mono" />
          </div>
          <div className="space-y-1.5">
            <Label>Описание</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Летняя скидка" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Тип скидки</Label>
              <select
                value={discountType}
                onChange={(e) => setDiscountType(e.target.value as 'percent' | 'fixed')}
                className="w-full h-10 rounded-md border border-input bg-background px-3"
              >
                <option value="percent">Процент</option>
                <option value="fixed">Фиксированная</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Размер скидки ({discountType === 'percent' ? '%' : '₽'})</Label>
              <Input type="number" value={discountValue} onChange={(e) => setDiscountValue(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Мин. сумма заказа (₽)</Label>
              <Input type="number" value={minOrderTotal} onChange={(e) => setMinOrderTotal(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Макс. скидка (₽, только %)</Label>
              <Input type="number" value={maxDiscount} onChange={(e) => setMaxDiscount(e.target.value)} placeholder="Не ограничено" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Макс. использований</Label>
              <Input type="number" value={maxUses} onChange={(e) => setMaxUses(e.target.value)} placeholder="∞" />
            </div>
            <div className="space-y-1.5">
              <Label>На одного пользователя</Label>
              <Input type="number" value={maxUsesPerUser} onChange={(e) => setMaxUsesPerUser(e.target.value)} placeholder="∞" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Действует с</Label>
              <Input type="date" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Действует до</Label>
              <Input type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Категория (необязательно)</Label>
            <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Реклама, Мебель, Полиграфия..." />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Активен
          </label>
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
