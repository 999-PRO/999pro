'use client'

/**
 * ClubManager — Studio admin panel for the 999 CLUB module (Phase 2).
 *
 * Full CRUD for all 8 entity types. The manager has a left-side tab list
 * (gifts, promos, giveaways, bonuses, tasks, coupons, events) and a
 * right-side table + create/edit dialog.
 *
 * Each entity type uses a shared <ClubCrudTable> component with a per-entity
 * field config, so we don't duplicate 8 near-identical tables.
 */

import { useEffect, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Crown, Plus, Trash2, Edit3, X, Eye, EyeOff, Loader2, Save,
} from 'lucide-react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { useConfirmDialog, StudioConfirmDialog } from '@/components/ui/confirm-dialog'
import { ImageUploader } from './image-uploader'
import { cn } from '@/lib/utils'
import { CLUB_CONFIG } from '@/lib/club-config'
import type { ClubEntityType, ClubCategoryMeta } from '@/lib/club-types'
import { toast } from '@/lib/notifications'

// ============================================================================
// Category metadata
// ============================================================================

const CATEGORIES: ClubCategoryMeta[] = [
  { kind: 'gifts', emoji: '🎁', title: 'Подарки', desc: 'Эксклюзивные подарки', accent: 'linear-gradient(135deg, #f59e0b 0%, #f97316 50%, #ef4444 100%)' },
  { kind: 'promos', emoji: '🔥', title: 'Акции', desc: 'Ограниченные предложения', accent: 'linear-gradient(135deg, #f43f5e 0%, #ec4899 50%, #d946ef 100%)' },
  { kind: 'giveaways', emoji: '🏆', title: 'Розыгрыши', desc: 'Честные розыгрыши', accent: 'linear-gradient(135deg, #f59e0b 0%, #f97316 50%, #ef4444 100%)' },
  { kind: 'bonuses', emoji: '⭐', title: 'Бонусы', desc: 'Начисление баллов', accent: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 50%, #6366f1 100%)' },
  { kind: 'tasks', emoji: '🎯', title: 'Задания', desc: 'Ежедневные и разовые', accent: 'linear-gradient(135deg, #0ea5e9 0%, #3b82f6 50%, #6366f1 100%)' },
  { kind: 'coupons', emoji: '🎟', title: 'Купоны', desc: 'Промокоды и скидки', accent: 'linear-gradient(135deg, #ec4899 0%, #d946ef 50%, #a855f7 100%)' },
  { kind: 'events', emoji: '📅', title: 'События', desc: 'Календарь мероприятий', accent: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 50%, #6366f1 100%)' },
]

// ============================================================================
// Main component
// ============================================================================

export function ClubManager() {
  const [activeKind, setActiveKind] = useState<ClubEntityType>('gifts')
  const activeMeta = CATEGORIES.find((c) => c.kind === activeKind)!

  return (
    <div className="p-4 md:p-6 pb-24 md:pb-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div
          className="h-11 w-11 rounded-2xl grid place-items-center shadow-glow"
          style={{ backgroundImage: 'linear-gradient(135deg, #f59e0b 0%, #ec4899 50%, #8b5cf6 100%)' }}
        >
          <Crown className="h-5 w-5 text-white" strokeWidth={2.4} />
        </div>
        <div>
          <h2 className="text-2xl font-bold tracking-tight">{CLUB_CONFIG.fullName}</h2>
          <p className="text-sm text-muted-foreground">Управление разделом · Phase 4</p>
        </div>
      </div>

      {/* v12.6: CLUB analytics summary */}
      <ClubStatsBar />

      {/* Category tabs */}
      <div className="flex flex-wrap gap-2">
        {CATEGORIES.map((cat) => {
          const isActive = cat.kind === activeKind
          return (
            <button
              key={cat.kind}
              onClick={() => setActiveKind(cat.kind)}
              className={cn(
                'inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold transition-all',
                isActive
                  ? 'text-white shadow-glow'
                  : 'glass text-foreground hover:bg-foreground/5',
              )}
              style={isActive ? { backgroundImage: cat.accent } : undefined}
            >
              <span>{cat.emoji}</span>
              <span>{cat.title}</span>
            </button>
          )
        })}
      </div>

      {/* Active category content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeKind}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2 }}
        >
          <ClubCrudTable key={activeKind} meta={activeMeta} />
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

// ============================================================================
// ClubCrudTable — generic CRUD table for one entity type
// ============================================================================

interface ClubCrudTableProps {
  meta: ClubCategoryMeta
}

function ClubCrudTable({ meta }: ClubCrudTableProps) {
  const [items, setItems] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<any | null>(null)
  const [creating, setCreating] = useState(false)
  const { dialog: confirmDialog, confirm, close } = useConfirmDialog()
const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get<{ items: any[] }>(`/api/club/admin/${meta.kind}`, { auth: true })
      setItems(res.items)
    } catch (e: unknown) {
      toast.error('Ошибка загрузки', { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setLoading(false)
    }
  }, [meta.kind, toast])

  useEffect(() => {
    load()
  }, [load])

  const handleDelete = (id: string) => {
    confirm({
      title: 'Удалить?',
      message: 'Это действие нельзя отменить.',
      confirmLabel: 'Удалить',
      cancelLabel: 'Отмена',
      variant: 'danger',
      onConfirm: async () => {
        try {
          await api.delete(`/api/club/admin/${meta.kind}/${id}`, { auth: true })
          toast.info('Удалено')
          load()
        } catch (e: unknown) {
          toast.error('Ошибка', { description: e instanceof Error ? e.message : String(e) })
        }
      },
    })
  }

  const handleToggleActive = async (item: any) => {
    try {
      await api.patch(`/api/club/admin/${meta.kind}/${item.id}`, {
        json: { active: !item.active },
        auth: true,
      })
      load()
    } catch (e: unknown) {
      toast.error('Ошибка', { description: e instanceof Error ? e.message : String(e) })
    }
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold">{meta.emoji} {meta.title}</h3>
          <p className="text-xs text-muted-foreground">{meta.desc}</p>
        </div>
        <Button onClick={() => setCreating(true)} className="rounded-xl">
          <Plus className="h-4 w-4 mr-1" /> Создать
        </Button>
      </div>

      {/* Table */}
      <div className="rounded-2xl glass overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2">
            <div className="text-3xl opacity-50">{meta.emoji}</div>
            <p className="text-sm text-muted-foreground">Пока пусто. Нажмите «Создать».</p>
          </div>
        ) : (
          <div className="divide-y divide-border/30">
            {items.map((item) => (
              <div key={item.id} className="flex items-center gap-3 p-3 hover:bg-foreground/5 transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm truncate">{item.title}</span>
                    {!item.active && (
                      <Badge variant="secondary" className="text-[10px]">Выключено</Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {meta.kind === 'gifts' && `Получено: ${item.claimedCount}${item.quantity ? `/${item.quantity}` : ''}`}
                    {meta.kind === 'giveaways' && `Розыгрыш: ${item.drawnAt ? 'завершён' : new Date(item.drawAt).toLocaleDateString('ru-RU')}`}
                    {meta.kind === 'coupons' && `Использовано: ${item.usedCount}${item.quantity ? `/${item.quantity}` : ''}`}
                    {meta.kind === 'bonuses' && `Награда: ${item.pointsReward} ⭐`}
                    {meta.kind === 'tasks' && `${item.taskType === 'daily' ? 'Ежедневное' : 'Одноразовое'} · ${item.pointsReward} ⭐`}
                    {(meta.kind === 'promos' || meta.kind === 'events') && (item.description || '—')}
                  </div>
                </div>
                <button
                  onClick={() => handleToggleActive(item)}
                  className="h-8 w-8 rounded-lg grid place-items-center hover:bg-foreground/10 transition-colors"
                  title={item.active ? 'Выключить' : 'Включить'}
                >
                  {item.active ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4 text-muted-foreground" />}
                </button>
                <button
                  onClick={() => setEditing(item)}
                  className="h-8 w-8 rounded-lg grid place-items-center hover:bg-foreground/10 transition-colors"
                  title="Редактировать"
                >
                  <Edit3 className="h-4 w-4" />
                </button>
                <button
                  onClick={() => handleDelete(item.id)}
                  className="h-8 w-8 rounded-lg grid place-items-center hover:bg-red-500/10 text-red-500 transition-colors"
                  title="Удалить"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create/Edit dialog */}
      <AnimatePresence>
        {(creating || editing) && (
          <ClubEditDialog
            meta={meta}
            item={editing}
            onClose={() => {
              setCreating(false)
              setEditing(null)
            }}
            onSaved={() => {
              setCreating(false)
              setEditing(null)
              load()
            }}
          />
        )}
      </AnimatePresence>

      <StudioConfirmDialog dialog={confirmDialog} onClose={close} />
    </div>
  )
}

// ============================================================================
// ClubEditDialog — create/edit form (fields depend on entity type)
// ============================================================================

function ClubEditDialog({
  meta,
  item,
  onClose,
  onSaved,
}: {
  meta: ClubCategoryMeta
  item: any | null
  onClose: () => void
  onSaved: () => void
}) {
const isEdit = !!item
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<any>(() => getInitialForm(meta.kind, item))

  const setField = (key: string, value: any) => {
    setForm((f: any) => ({ ...f, [key]: value }))
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      // Convert date strings to ISO for the backend
      const payload = { ...form }
      for (const key of ['startsAt', 'endsAt', 'drawAt']) {
        if (payload[key] === '') payload[key] = null
        else if (payload[key]) payload[key] = new Date(payload[key]).toISOString()
      }
      if (isEdit) {
        await api.patch(`/api/club/admin/${meta.kind}/${item.id}`, { json: payload, auth: true })
        toast.info('Сохранено')
      } else {
        await api.post(`/api/club/admin/${meta.kind}`, { json: payload, auth: true })
        toast.info('Создано')
      }
      onSaved()
    } catch (e: unknown) {
      toast.error('Ошибка', { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setSaving(false)
    }
  }

  const fields = getFieldsForKind(meta.kind)

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[300] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl glass-strong border border-border/40 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold">
            {meta.emoji} {isEdit ? 'Редактировать' : 'Создать'} · {meta.title}
          </h3>
          <button onClick={onClose} className="h-8 w-8 rounded-full grid place-items-center hover:bg-foreground/10">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4">
          {fields.map((field) => (
            <FieldRenderer
              key={field.key}
              field={field}
              value={form[field.key]}
              onChange={(v) => setField(field.key, v)}
            />
          ))}
        </div>

        <div className="flex gap-2 mt-6">
          <Button variant="outline" onClick={onClose} className="flex-1 rounded-xl">
            Отмена
          </Button>
          <Button onClick={handleSave} disabled={saving} className="flex-1 rounded-xl">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
            {isEdit ? 'Сохранить' : 'Создать'}
          </Button>
        </div>
      </motion.div>
    </motion.div>
  )
}

// ============================================================================
// Field config + renderer
// ============================================================================

interface FieldConfig {
  key: string
  label: string
  type: 'text' | 'textarea' | 'number' | 'switch' | 'date' | 'select' | 'image'
  placeholder?: string
  options?: { value: string; label: string }[]
  required?: boolean
}

function getFieldsForKind(kind: ClubEntityType): FieldConfig[] {
  const common: FieldConfig[] = [
    { key: 'title', label: 'Название', type: 'text', required: true, placeholder: 'Введите название' },
    { key: 'description', label: 'Описание', type: 'textarea', placeholder: 'Описание (необязательно)' },
    { key: 'image', label: 'Изображение', type: 'image', placeholder: 'https://...' },
    { key: 'active', label: 'Активно', type: 'switch' },
    { key: 'order', label: 'Порядок', type: 'number', placeholder: '0' },
  ]

  switch (kind) {
    case 'gifts':
      return [
        ...common,
        { key: 'pointsCost', label: 'Стоимость в баллах', type: 'number', placeholder: '0' },
        { key: 'quantity', label: 'Количество (пусто = безлимит)', type: 'number', placeholder: '' },
        { key: 'startsAt', label: 'Начало', type: 'date' },
        { key: 'endsAt', label: 'Окончание', type: 'date' },
      ]
    case 'promos':
      return [
        ...common,
        { key: 'promoCode', label: 'Промокод', type: 'text', placeholder: 'SUMMER2026' },
        { key: 'discountPercent', label: 'Скидка %', type: 'number', placeholder: '10' },
        { key: 'ctaText', label: 'Текст кнопки', type: 'text', placeholder: 'Перейти' },
        { key: 'ctaUrl', label: 'URL кнопки', type: 'text', placeholder: 'https://...' },
        { key: 'startsAt', label: 'Начало', type: 'date' },
        { key: 'endsAt', label: 'Окончание', type: 'date' },
      ]
    case 'giveaways':
      return [
        ...common,
        { key: 'winnersCount', label: 'Число победителей', type: 'number', placeholder: '1' },
        { key: 'drawAt', label: 'Дата розыгрыша', type: 'date', required: true },
      ]
    case 'bonuses':
      return [
        ...common,
        { key: 'pointsReward', label: 'Баллов за выполнение', type: 'number', placeholder: '50' },
        { key: 'startsAt', label: 'Начало', type: 'date' },
        { key: 'endsAt', label: 'Окончание', type: 'date' },
      ]
    case 'tasks':
      return [
        ...common,
        { key: 'taskType', label: 'Тип', type: 'select', options: [
          { value: 'one-time', label: 'Одноразовое' },
          { value: 'daily', label: 'Ежедневное' },
        ]},
        { key: 'pointsReward', label: 'Баллов за выполнение', type: 'number', placeholder: '50' },
        { key: 'actionKey', label: 'Ключ действия', type: 'text', placeholder: 'complete_profile' },
      ]
    case 'coupons':
      return [
        ...common,
        { key: 'code', label: 'Код купона', type: 'text', placeholder: 'WELCOME50' },
        { key: 'discountType', label: 'Тип скидки', type: 'select', options: [
          { value: 'percent', label: 'Процент' },
          { value: 'fixed', label: 'Фиксированная' },
        ]},
        { key: 'discountValue', label: 'Размер скидки', type: 'number', placeholder: '10' },
        { key: 'category', label: 'Категория (пусто = любая)', type: 'text', placeholder: '' },
        { key: 'quantity', label: 'Количество (пусто = безлимит)', type: 'number', placeholder: '' },
        { key: 'startsAt', label: 'Начало', type: 'date' },
        { key: 'endsAt', label: 'Окончание', type: 'date' },
      ]
    case 'events':
      return [
        ...common,
        { key: 'location', label: 'Место / ссылка', type: 'text', placeholder: 'Онлайн / адрес' },
        { key: 'startsAt', label: 'Начало', type: 'date', required: true },
        { key: 'endsAt', label: 'Окончание', type: 'date' },
        { key: 'maxAttendees', label: 'Макс. участников (пусто = безлимит)', type: 'number', placeholder: '' },
      ]
    default:
      return common
  }
}

function getInitialForm(kind: ClubEntityType, item: any | null): any {
  if (item) {
    // Convert ISO dates to datetime-local format for the input fields
    const form = { ...item }
    for (const key of ['startsAt', 'endsAt', 'drawAt']) {
      if (form[key]) {
        const d = new Date(form[key])
        form[key] = d.toISOString().slice(0, 16) // yyyy-mm-ddThh:mm
      } else {
        form[key] = ''
      }
    }
    // linkedProductIds is a JSON array in the DB; we don't expose it in the
    // form in Phase 2 (could add a multi-select later).
    delete form.linkedProductIds
    delete form.winnerIds
    delete form.giftRewardId
    return form
  }
  // Defaults for new items
  const base: any = {
    title: '',
    description: '',
    image: '',
    active: true,
    order: 0,
    startsAt: '',
    endsAt: '',
  }
  switch (kind) {
    case 'gifts': return { ...base, pointsCost: 0, quantity: '' }
    case 'promos': return { ...base, promoCode: '', discountPercent: '', ctaText: 'Перейти', ctaUrl: '' }
    case 'giveaways': return { ...base, winnersCount: 1, drawAt: '' }
    case 'bonuses': return { ...base, pointsReward: 50 }
    case 'tasks': return { ...base, taskType: 'one-time', pointsReward: 50, actionKey: '' }
    case 'coupons': return { ...base, code: '', discountType: 'percent', discountValue: 10, category: '', quantity: '' }
    case 'events': return { ...base, location: '', maxAttendees: '' }
    default: return base
  }
}

function FieldRenderer({
  field,
  value,
  onChange,
}: {
  field: FieldConfig
  value: any
  onChange: (v: any) => void
}) {
  switch (field.type) {
    case 'textarea':
      return (
        <div>
          <Label className="text-xs text-muted-foreground">{field.label}</Label>
          <Textarea
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.placeholder}
            rows={3}
            className="mt-1"
          />
        </div>
      )
    case 'number':
      return (
        <div>
          <Label className="text-xs text-muted-foreground">{field.label}</Label>
          <Input
            type="number"
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value === '' ? (field.key === 'quantity' || field.key === 'maxAttendees' || field.key === 'pointsCost' || field.key === 'pointsReward' || field.key === 'discountPercent' || field.key === 'discountValue' || field.key === 'winnersCount' || field.key === 'order' ? '' : 0) : Number(e.target.value))}
            placeholder={field.placeholder}
            className="mt-1"
          />
        </div>
      )
    case 'switch':
      return (
        <div className="flex items-center justify-between">
          <Label className="text-sm">{field.label}</Label>
          <Switch checked={!!value} onCheckedChange={onChange} />
        </div>
      )
    case 'date':
      return (
        <div>
          <Label className="text-xs text-muted-foreground">{field.label}</Label>
          <Input
            type="datetime-local"
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
            className="mt-1"
          />
        </div>
      )
    case 'select':
      return (
        <div>
          <Label className="text-xs text-muted-foreground">{field.label}</Label>
          <select
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
            className="mt-1 w-full h-10 rounded-xl bg-background border border-border px-3 text-sm"
          >
            {field.options?.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      )
    case 'image':
      return (
        <div>
          <Label className="text-xs text-muted-foreground">{field.label}</Label>
          <div className="mt-1">
            <ImageUploader
              value={value || ''}
              onChange={(urls) => onChange(urls[0] || '')}
              kind="image"
              aspect="square"
            />
          </div>
        </div>
      )
    default: // text
      return (
        <div>
          <Label className="text-xs text-muted-foreground">
            {field.label}{field.required && ' *'}
          </Label>
          <Input
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.placeholder}
            className="mt-1"
          />
        </div>
      )
  }
}

// ============================================================================
// ClubStatsBar — analytics summary at the top of ClubManager
// ============================================================================

function ClubStatsBar() {
  const [stats, setStats] = useState<any>(null)

  useEffect(() => {
    api.get('/api/club/admin/stats', { auth: true }).then(setStats).catch(() => {})
  }, [])

  if (!stats) return null

  const cards = [
    { label: 'Подарки', value: stats.gifts.claimed, sub: `из ${stats.gifts.total} создано`, icon: '🎁', color: 'text-amber-500' },
    { label: 'Розыгрыши', value: stats.giveaways.participants, sub: `${stats.giveaways.drawn} завершено`, icon: '🏆', color: 'text-orange-500' },
    { label: 'Задания', value: stats.tasks.completed, sub: `${stats.tasks.active} активно`, icon: '🎯', color: 'text-sky-500' },
    { label: 'Купоны', value: stats.coupons.claimed, sub: `${stats.coupons.active} активно`, icon: '🎟', color: 'text-pink-500' },
    { label: 'Баллы', value: stats.points.totalAwarded, sub: `${stats.points.activeUsers} активных`, icon: '⭐', color: 'text-violet-500' },
  ]

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      {cards.map((c) => (
        <div key={c.label} className="rounded-2xl glass p-3 text-center">
          <div className="text-xl mb-1">{c.icon}</div>
          <div className={cn('text-2xl font-extrabold tabular-nums', c.color)}>{c.value}</div>
          <div className="text-[10px] font-semibold">{c.label}</div>
          <div className="text-[9px] text-muted-foreground">{c.sub}</div>
        </div>
      ))}
    </div>
  )
}
