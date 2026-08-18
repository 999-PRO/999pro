'use client'

/**
 * v25.11 — Categories Manager (Studio).
 *
 * Full CRUD for product categories. Replaces the hardcoded PROJECT_CATEGORIES
 * that were duplicated in 5 frontend files.
 *
 * Features:
 *   - List with drag-to-reorder (up/down buttons)
 *   - Create / edit / delete (with confirmation)
 *   - Toggle visibility
 *   - Shows product count per category
 *   - "Seed defaults" button — imports the 8 legacy categories
 *
 * API: /api/categories (public) + /api/categories/all (admin) +
 *      /api/categories/reorder + /api/categories/seed
 */

import { useState, useEffect, useCallback } from 'react'
import {
  Plus, Trash2, Pencil, ArrowUp, ArrowDown, Eye, EyeOff, Folder, Loader2, Sparkles,
} from 'lucide-react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useConfirmDialog, StudioConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { toast } from '@/lib/notifications'
import { cn } from '@/lib/utils'

interface Category {
  id: string
  name: string
  slug: string
  icon: string
  description: string | null
  sortOrder: number
  visible: boolean
  parentId: string | null
  productsCount?: number
  parent?: { id: string; name: string } | null
}

// Popular Lucide icon names for the picker
const ICON_OPTIONS = [
  'Folder', 'Megaphone', 'Gift', 'Armchair', 'Printer', 'Palette', 'Home',
  'FileText', 'ShoppingBag', 'Package', 'Tag', 'Star', 'Heart', 'Crown',
  'Sparkles', 'Camera', 'Music', 'Book', 'Coffee', 'Plane', 'Car', 'Watch',
  'Smartphone', 'Laptop', 'Tshirt', 'PaintBucket', 'Brush', 'PenTool',
  'Building2', 'Store', 'Shirt', 'GlassWater', 'Cookie', 'Pizza', 'Cake',
]

export function CategoriesManager() {
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState<Category | null>(null)
  const [creating, setCreating] = useState(false)
  const [seeding, setSeeding] = useState(false)
  const { dialog: confirmDialog, confirm: openConfirm, close: closeConfirm } = useConfirmDialog()
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const d = await api.get<{ items: Category[] }>('/api/categories/all', { auth: true })
      setCategories(d.items)
    } catch {
      toast.error('Не удалось загрузить категории')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Live refresh: when categories are changed elsewhere (e.g. seed endpoint)
  useEffect(() => {
    const onCatsChanged = () => load()
    window.addEventListener('999pro:categories-changed', onCatsChanged as EventListener)
    return () => window.removeEventListener('999pro:categories-changed', onCatsChanged as EventListener)
  }, [load])

  const handleDelete = async () => {
    if (!deleteId) return
    try {
      await api.delete(`/api/categories/${deleteId}`, { auth: true })
      toast.success('Категория удалена')
      setCategories(categories.filter((c) => c.id !== deleteId))
    } catch {
      toast.error('Ошибка удаления')
    } finally {
      setDeleteId(null)
      closeConfirm()
    }
  }

  const moveBlock = async (idx: number, dir: -1 | 1) => {
    const newIdx = idx + dir
    if (newIdx < 0 || newIdx >= categories.length) return
    const reordered = [...categories]
    ;[reordered[idx], reordered[newIdx]] = [reordered[newIdx], reordered[idx]]
    // Renumber sortOrder
    const renumbered = reordered.map((c, i) => ({ ...c, sortOrder: i }))
    setCategories(renumbered)
    setSaving(true)
    try {
      await api.post('/api/categories/reorder', {
        json: { items: renumbered.map((c) => ({ id: c.id, sortOrder: c.sortOrder })) },
        auth: true,
      })
      toast.success('Порядок сохранён')
    } catch {
      toast.error('Не удалось сохранить порядок')
      load()
    } finally {
      setSaving(false)
    }
  }

  const toggleVisible = async (cat: Category) => {
    const newVisible = !cat.visible
    setCategories(categories.map((c) => c.id === cat.id ? { ...c, visible: newVisible } : c))
    try {
      await api.patch(`/api/categories/${cat.id}`, { json: { visible: newVisible }, auth: true })
      toast.success(newVisible ? 'Категория видна' : 'Категория скрыта')
    } catch {
      toast.error('Ошибка')
      load()
    }
  }

  const handleSeed = async () => {
    setSeeding(true)
    try {
      const res = await api.post<{ created: number; skipped: number; linked: number }>('/api/categories/seed', { auth: true })
      toast.success(`Создано: ${res.created}, пропущено: ${res.skipped}, привязано товаров: ${res.linked}`)
      load()
    } catch {
      toast.error('Ошибка импорта')
    } finally {
      setSeeding(false)
    }
  }

  if (loading) {
    return (
      <div className="px-4 md:px-6 py-6 pb-28 page-top-padding">
        <div className="h-8 w-48 skeleton rounded-lg mb-4" />
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 skeleton rounded-2xl" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="px-4 md:px-6 py-6 pb-28 page-top-padding max-w-3xl">
      {/* Header */}
      <div className="mb-5 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">Категории</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Категории товаров для каталога и фильтров. Управляют порядком отображения.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {categories.length === 0 && (
            <Button onClick={handleSeed} variant="outline" className="rounded-full" disabled={seeding}>
              {seeding ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Sparkles className="h-4 w-4 mr-1" />}
              Импорт по умолчанию
            </Button>
          )}
          <Button onClick={() => setCreating(true)} className="rounded-full gradient-brand text-white shadow-glow">
            <Plus className="h-4 w-4 mr-1" /> Добавить
          </Button>
        </div>
      </div>

      {/* Info */}
      {categories.length > 0 && (
        <div className="mb-4 rounded-2xl border border-border/40 bg-card p-3 text-xs text-muted-foreground">
          <p>💡 Категории управляют каталогом и фильтрами. Скрытые не видны клиентам. Порядок меняется кнопками ↑↓.</p>
        </div>
      )}

      {categories.length === 0 ? (
        <div className="text-center py-16 rounded-2xl border border-dashed border-border">
          <Folder className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
          <p className="text-muted-foreground mb-3">Пока нет категорий</p>
          <div className="flex items-center justify-center gap-2 flex-wrap">
            <Button onClick={handleSeed} variant="outline" className="rounded-full" disabled={seeding}>
              {seeding ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Sparkles className="h-4 w-4 mr-1" />}
              Импортировать 8 по умолчанию
            </Button>
            <Button onClick={() => setCreating(true)} className="rounded-full gradient-brand text-white">
              <Plus className="h-4 w-4 mr-1" /> Создать
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {categories.map((cat, idx) => (
            <div
              key={cat.id}
              className={cn(
                'rounded-2xl border bg-card p-3 flex items-center gap-3 transition-all',
                cat.visible ? 'border-border/40' : 'border-border/40 opacity-60',
              )}
            >
              {/* Up/Down */}
              <div className="flex flex-col shrink-0">
                <button
                  onClick={() => moveBlock(idx, -1)}
                  disabled={idx === 0 || saving}
                  className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => moveBlock(idx, 1)}
                  disabled={idx === categories.length - 1 || saving}
                  className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* Order number */}
              <div className="h-9 w-9 rounded-lg bg-foreground/5 grid place-items-center text-xs font-bold text-muted-foreground shrink-0">
                {idx + 1}
              </div>

              {/* Icon */}
              <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-foreground/5 to-foreground/10 grid place-items-center shrink-0">
                <Folder className="h-5 w-5 text-primary" />
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold truncate">{cat.name}</div>
                <div className="text-[10px] text-muted-foreground truncate">
                  /{cat.slug} · {cat.productsCount ?? 0} тов.
                </div>
                <div className={cn('text-[10px] font-medium mt-0.5', cat.visible ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground')}>
                  {cat.visible ? '● Видима' : '○ Скрыта'}
                </div>
              </div>

              {/* Visibility toggle */}
              <button
                onClick={() => toggleVisible(cat)}
                title={cat.visible ? 'Скрыть' : 'Показать'}
                className={cn(
                  'h-9 w-9 rounded-lg grid place-items-center transition-colors shrink-0',
                  cat.visible ? 'bg-emerald-500/15 text-emerald-600' : 'bg-foreground/5 text-muted-foreground hover:bg-foreground/10',
                )}
              >
                {cat.visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
              </button>

              {/* Edit */}
              <button
                onClick={() => setEditing(cat)}
                title="Редактировать"
                className="h-9 w-9 rounded-lg grid place-items-center bg-foreground/5 text-muted-foreground hover:bg-foreground/10 transition-colors shrink-0"
              >
                <Pencil className="h-4 w-4" />
              </button>

              {/* Delete */}
              <button
                onClick={() => { setDeleteId(cat.id); openConfirm() }}
                title="Удалить"
                className="h-9 w-9 rounded-lg grid place-items-center bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors shrink-0"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Saving indicator */}
      {saving && (
        <div className="fixed bottom-4 right-4 flex items-center gap-2 px-4 py-2 rounded-xl bg-background/90 backdrop-blur-md border border-border/40 shadow-lg text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Сохранение…
        </div>
      )}

      {/* Create/Edit dialog */}
      {(creating || editing) && (
        <CategoryEditor
          category={editing}
          categories={categories}
          onClose={() => { setCreating(false); setEditing(null) }}
          onSaved={() => { setCreating(false); setEditing(null); load() }}
        />
      )}

      <StudioConfirmDialog
        {...confirmDialog}
        title="Удалить категорию?"
        description="Товары в этой категории останутся, но потеряют привязку. Их можно будет привязать к другой категории позже."
        confirmLabel="Удалить"
        danger
        onConfirm={handleDelete}
      />
    </div>
  )
}

// ============================================================================
//  CategoryEditor — create / edit dialog
// ============================================================================
function CategoryEditor({
  category,
  categories,
  onClose,
  onSaved,
}: {
  category: Category | null
  categories: Category[]
  onClose: () => void
  onSaved: () => void
}) {
  const isEdit = !!category
  const [name, setName] = useState(category?.name ?? '')
  const [slug, setSlug] = useState(category?.slug ?? '')
  const [icon, setIcon] = useState(category?.icon ?? 'Folder')
  const [description, setDescription] = useState(category?.description ?? '')
  const [visible, setVisible] = useState(category?.visible ?? true)
  const [parentId, setParentId] = useState<string | null>(category?.parentId ?? null)
  const [saving, setSaving] = useState(false)

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast.error('Введите название')
      return
    }
    setSaving(true)
    try {
      const payload = {
        name: name.trim(),
        slug: slug.trim(),
        icon,
        description: description.trim() || null,
        visible,
        parentId: parentId || null,
      }
      if (isEdit && category) {
        await api.patch(`/api/categories/${category.id}`, { json: payload, auth: true })
        toast.success('Категория обновлена')
      } else {
        await api.post('/api/categories', { json: payload, auth: true })
        toast.success('Категория создана')
      }
      // Broadcast to other tabs / home page
      window.dispatchEvent(new CustomEvent('999pro:categories-changed'))
      onSaved()
    } catch (e: any) {
      toast.error(e?.message || 'Ошибка сохранения')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Редактировать категорию' : 'Новая категория'}</DialogTitle>
          <DialogDescription>
            {isEdit ? 'Измените параметры категории' : 'Создайте новую категорию товаров'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Name */}
          <div className="space-y-1.5">
            <Label htmlFor="cat-name">Название *</Label>
            <Input
              id="cat-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Например: Электроника"
              maxLength={100}
            />
          </div>

          {/* Slug */}
          <div className="space-y-1.5">
            <Label htmlFor="cat-slug">Slug (URL)</Label>
            <Input
              id="cat-slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="авто-из-названия"
              maxLength={120}
            />
            <p className="text-[10px] text-muted-foreground">Оставьте пустым для автогенерации</p>
          </div>

          {/* Icon */}
          <div className="space-y-1.5">
            <Label>Иконка</Label>
            <div className="grid grid-cols-8 gap-1.5 max-h-32 overflow-y-auto p-2 rounded-lg bg-muted/30">
              {ICON_OPTIONS.map((ic) => (
                <button
                  key={ic}
                  type="button"
                  onClick={() => setIcon(ic)}
                  className={cn(
                    'h-9 rounded-lg text-[10px] font-medium grid place-items-center transition-all',
                    icon === ic
                      ? 'gradient-brand text-white shadow-md'
                      : 'bg-background hover:bg-accent/40 text-muted-foreground',
                  )}
                  title={ic}
                >
                  {ic.slice(0, 6)}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground">Текущая: {icon}</p>
          </div>

          {/* Parent (optional) */}
          {categories.length > 0 && (
            <div className="space-y-1.5">
              <Label>Родительская категория (опц.)</Label>
              <select
                value={parentId ?? ''}
                onChange={(e) => setParentId(e.target.value || null)}
                className="w-full h-10 px-3 rounded-lg bg-background border border-border/40 text-sm"
              >
                <option value="">— Без родителя (top-level) —</option>
                {categories
                  .filter((c) => c.id !== category?.id)
                  .map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
              </select>
            </div>
          )}

          {/* Description */}
          <div className="space-y-1.5">
            <Label htmlFor="cat-desc">Описание</Label>
            <Textarea
              id="cat-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Короткое описание категории"
              rows={2}
              maxLength={500}
            />
          </div>

          {/* Visibility */}
          <div className="flex items-center justify-between">
            <Label htmlFor="cat-visible">Видима клиентам</Label>
            <Switch id="cat-visible" checked={visible} onCheckedChange={setVisible} />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>Отмена</Button>
          <Button onClick={handleSubmit} disabled={saving} className="gradient-brand text-white">
            {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            {isEdit ? 'Сохранить' : 'Создать'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
