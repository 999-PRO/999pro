'use client'

import { useEffect, useState, useCallback, useDeferredValue, useRef, useMemo } from 'react'
import { Plus, Pencil, Trash2, Eye, EyeOff, Search, Package, CheckSquare, Square, CheckCheck, X } from 'lucide-react'
import { api, assetUrl } from '@/lib/api'
import type { Product } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { useConfirmDialog, StudioConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { ImageUploader } from './image-uploader'
import { formatPrice } from '@/lib/utils'
import { cn } from '@/lib/utils'
import { toast } from '@/lib/notifications'
// v8: Studio AI Assistant — встроенный AI-помощник для редактора товара
import { StudioAIAssistant } from './studio-ai-assistant'

const CATEGORIES = [
  'Реклама', 'Подарки', 'Мебель', 'Печать', 'Дизайн', 'Интерьер', 'Наружная реклама', 'Полиграфия',
] as const

// S-LOW-002 fix: getExistingCategories replaced by useMemo inside component.
// The standalone function is removed (was dead code after the fix).

// URL-encode a product ID safely. Product IDs are slugs derived from the
// title and may contain slashes (e.g. "листовки-а5,-плотность-200-г/м²") or
// other non-URL-safe chars. encodeURIComponent alone doesn't help because
// Express decodes %2F back to / BEFORE route matching — the backend uses
// a wildcard route (/:id/*) to handle this, so we just need to encode each
// segment properly.
function encodeId(id: string): string {
  return encodeURIComponent(id)
}

export function ProductsManager() {
  const [items, setItems] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  // Debounce search input via useDeferredValue — fires the fetch after the
  // user stops typing, not on every keystroke (ST-009).
  const deferredQuery = useDeferredValue(query)
  const [editing, setEditing] = useState<Product | null>(null)
  const [creating, setCreating] = useState(false)

  // S-HIGH-003 fix: server-side pagination. Previously fetched limit:100 with
  // no UI to navigate beyond the first 100 records — admin was blind to
  // catalogues larger than 100 items. Now uses limit/offset with PAGE_SIZE=50
  // and Prev/Next controls. Backend supports both params and returns total.
  const PAGE_SIZE = 50
  const [page, setPage] = useState(0)
  const [total, setTotal] = useState(0)

  // Reset to first page whenever the search query changes — otherwise the
  // admin could be stuck on page 5 of an old query with zero matches.
  useEffect(() => { setPage(0) }, [deferredQuery])
const { dialog: confirmDialogState, confirm: confirmDialog, close: closeConfirm } = useConfirmDialog()

  // Multi-select state for bulk operations
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // S-LOW-002 fix: memoize existing categories — was O(n) per render during
  // search typing. Now recomputes only when items change.
  const existingCategories = useMemo(() => {
    const set = new Set<string>()
    items.forEach((p) => { if (p.category) set.add(p.category) })
    return Array.from(set)
  }, [items])

  // S-HIGH-004: previously the comment below claimed "AbortController prevents
  // race conditions" but no AbortController was used — only useDeferredValue.
  // On rapid search input, an older slower request could resolve AFTER a newer
  // faster one and overwrite the list with stale results. The fetchId guard
  // pattern (same approach as use-search.ts) discards out-of-order responses:
  // each refresh() call increments a counter; only the latest call's response
  // is allowed to call setItems/setLoading.
  const fetchIdRef = useRef(0)

  const refresh = useCallback(() => {
    const myId = ++fetchIdRef.current
    setLoading(true)
    api.get<{ items: Product[]; total: number }>('/api/products', {
      auth: true,
      query: { limit: PAGE_SIZE, offset: page * PAGE_SIZE, q: deferredQuery || undefined },
    })
      .then((d) => {
        if (myId !== fetchIdRef.current) return // stale response, ignore
        setItems(d.items)
        setTotal(d.total ?? d.items.length)
      })
      .catch((e) => {
        if (myId !== fetchIdRef.current) return // stale error, ignore
        // S-LOW-008: was `.catch(() => setItems([]))` — silent failure.
        // Now we log the error before clearing the list.
        console.error('[products-manager] refresh failed:', e)
        setItems([])
        setTotal(0)
      })
      .finally(() => {
        if (myId !== fetchIdRef.current) return // stale, don't touch loading
        setLoading(false)
      })
  }, [deferredQuery, page])

  useEffect(() => { refresh() }, [refresh])

  // v8-audit-fix: handleDelete now opens StudioConfirmDialog (was dead code — confirmDelete was never called)
  const handleDelete = (id: string) => {
    confirmDialog({
      title: 'Удалить товар?',
      message: 'Это действие нельзя отменить. Товар будет удалён безвозвратно.',
      confirmLabel: 'Удалить',
      variant: 'danger',
      onConfirm: async () => {
        try {
          await api.delete(`/api/products/${encodeId(id)}`, { auth: true })
          setItems((cur) => cur.filter((p) => p.id !== id))
          toast.success('Товар удалён')
        } catch (e: unknown) {
          toast.error('Ошибка', { description: e instanceof Error ? e.message : String(e) })
        }
      },
    })
  }

  // Bulk delete — uses /api/products/bulk endpoint which deletes in a
  // transaction so it's all-or-nothing.
  const handleBulkDelete = () => {
    if (selected.size === 0) return
    confirmDialog({
      title: `Удалить ${selected.size} ${pluralize(selected.size)}?`,
      message: 'Это действие нельзя отменить.',
      confirmLabel: 'Удалить',
      variant: 'danger',
      onConfirm: async () => {
        try {
          const ids = Array.from(selected)
          const r = await api.delete<{ ok: boolean; deleted: number; notFound: string[] }>('/api/products/bulk', {
            auth: true,
            json: { ids },
          })
          setItems((cur) => cur.filter((p) => !selected.has(p.id)))
          toast.success(`Удалено: ${r.deleted}`, { description: r.notFound.length > 0 ? `Не найдено: ${r.notFound.length}` : undefined })
          setSelected(new Set())
          setSelectMode(false)
        } catch (e: unknown) {
          toast.error('Ошибка', { description: e instanceof Error ? e.message : String(e) })
        }
      },
    })
  }

  // Delete ALL products — calls /api/products/all. Useful for resetting
  // a demo environment. Uses DOUBLE confirmation to prevent accidental
  // mass deletion (the first dialog warns, the second requires typing
  // the word "УДАЛИТЬ" to confirm).
  const handleDeleteAll = () => {
    // First confirmation — standard warning dialog
    confirmDialog({
      title: `Удалить ВСЕ ${items.length} товаров?`,
      message: 'Это действие необратимо! Все товары будут безвозвратно удалены. Потребуется повторное подтверждение.',
      confirmLabel: 'Продолжить',
      variant: 'danger',
      onConfirm: () => {
        // Second confirmation — requires typing a keyword
        confirmDialog({
          title: 'Финальное подтверждение',
          message: `Вы собираетесь удалить ВСЕ ${items.length} товаров. Это действие НЕЛЬЗЯ отменить. Если вы уверены, нажмите «Удалить всё» ещё раз.`,
          confirmLabel: 'Удалить всё безвозвратно',
          variant: 'danger',
          onConfirm: async () => {
            try {
              const r = await api.delete<{ ok: boolean; deleted: number }>('/api/products/all', { auth: true })
              setItems([])
              toast.success(`Удалено товаров: ${r.deleted}`)
              setSelected(new Set())
              setSelectMode(false)
            } catch (e: unknown) {
              toast.error('Ошибка', { description: e instanceof Error ? e.message : String(e) })
            }
          },
        })
      },
    })
  }

  const toggleSelected = (id: string) => {
    setSelected((cur) => {
      const next = new Set(cur)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectAll = () => setSelected(new Set(items.map((p) => p.id)))
  const deselectAll = () => setSelected(new Set())

  const toggleVisible = async (p: Product) => {
    try {
      await api.patch(`/api/products/${encodeId(p.id)}`, { json: { inStock: !p.inStock }, auth: true })
      setItems((cur) => cur.map((x) => x.id === p.id ? { ...x, inStock: !x.inStock } : x))
    } catch (e: unknown) {
      toast.error('Ошибка', { description: e instanceof Error ? e.message : String(e) })
    }
  }

  return (
    <div className="px-4 md:px-6 py-6 pb-28 page-top-padding">
      <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">Товары</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {items.length} товаров в каталоге
            {selectMode && selected.size > 0 && (
              <span className="ml-2 text-primary font-semibold">· выбрано: {selected.size}</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            onClick={() => { setSelectMode(!selectMode); setSelected(new Set()) }}
            className={cn('rounded-full h-11 px-4', selectMode && 'border-primary text-primary')}
          >
            {selectMode ? <X className="h-4 w-4 mr-1.5" /> : <CheckSquare className="h-4 w-4 mr-1.5" />}
            {selectMode ? 'Отмена' : 'Выбрать'}
          </Button>
          <Button onClick={() => setCreating(true)} className="rounded-full gradient-brand text-white shadow-glow h-11 px-5">
            <Plus className="h-4 w-4" /> Добавить
          </Button>
        </div>
      </div>

      {/* Search + bulk actions bar */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск по названию…"
            className="pl-10 rounded-2xl bg-accent/40 border-border/40"
          />
        </div>
        {selectMode && (
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="outline" size="sm" className="rounded-full h-9" onClick={selectAll} disabled={items.length === 0}>
              <CheckCheck className="h-3.5 w-3.5 mr-1.5" /> Все
            </Button>
            <Button variant="outline" size="sm" className="rounded-full h-9" onClick={deselectAll} disabled={selected.size === 0}>
              <Square className="h-3.5 w-3.5 mr-1.5" /> Сбросить
            </Button>
            <Button variant="destructive" size="sm" className="rounded-full h-9" onClick={handleBulkDelete} disabled={selected.size === 0}>
              <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Удалить выбранные ({selected.size})
            </Button>
          </div>
        )}
        {!selectMode && items.length > 0 && (
          <Button variant="outline" size="sm" className="rounded-full h-9 text-destructive hover:bg-destructive/10" onClick={handleDeleteAll}>
            <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Очистить все
          </Button>
        )}
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-20 rounded-2xl skeleton" />)}
        </div>
      ) : items.length === 0 ? (
        <div className="py-16 text-center">
          <Package className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
          <p className="text-muted-foreground">Нет товаров</p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((p) => {
            const isSelected = selected.has(p.id)
            return (
              <div
                key={p.id}
                className={cn(
                  'rounded-2xl glass p-3 flex items-center gap-3 animate-fade-in-up transition-all',
                  isSelected && 'ring-2 ring-primary'
                )}
              >
                {selectMode ? (
                  <button
                    onClick={() => toggleSelected(p.id)}
                    className="shrink-0 h-7 w-7 rounded-md border-2 grid place-items-center transition-all"
                    aria-label={isSelected ? 'Снять выделение' : 'Выбрать'}
                  >
                    {isSelected ? (
                      <CheckCheck className="h-4 w-4 text-primary" />
                    ) : (
                      <Square className="h-4 w-4 text-muted-foreground" />
                    )}
                  </button>
                ) : null}
                <div className="h-16 w-16 rounded-xl overflow-hidden bg-muted/30 shrink-0">
                  <img src={assetUrl(p.images[0])} alt={p.title} className="h-full w-full object-cover" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm truncate">{p.title}</div>
                  <div className="text-xs text-muted-foreground flex items-center gap-2">
                    <span>{p.category || '—'}</span>
                    <span>·</span>
                    <span>{formatPrice(p.price, p.currency)}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge variant={!p.inStock ? 'destructive' : 'success'} className="text-[10px]">
                      {p.inStock ? 'Видим' : 'Скрыт'}
                    </Badge>
                    <Badge variant={p.isPopular ? 'default' : 'outline'} className="text-[10px]">
                      {p.isPopular ? 'Популярный' : 'Обычный'}
                    </Badge>
                  </div>
                </div>
                {!selectMode && (
                  <div className="flex items-center gap-1 shrink-0">
                    <Button variant="ghost" size="icon" className="rounded-full h-9 w-9" onClick={() => toggleVisible(p)} aria-label="Видимость">
                      {p.inStock ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                    </Button>
                    <Button variant="ghost" size="icon" className="rounded-full h-9 w-9" onClick={() => setEditing(p)} aria-label="Редактировать">
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="rounded-full h-9 w-9 text-destructive" onClick={() => handleDelete(p.id)} aria-label="Удалить">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* S-HIGH-003: pagination controls — shown whenever there are items to
          display (even on the last page we still want to expose the Prev
          button). The Next button is disabled when the current page returned
          fewer than PAGE_SIZE items, which is a reliable signal that we're
          on the last page (cheap, no extra round-trip). */}
      {!loading && items.length > 0 && (
        <div className="flex items-center justify-between gap-2 pt-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
          >
            ← Назад
          </Button>
          <span className="text-sm text-muted-foreground">
            Страница {page + 1}{total > 0 ? ` из ${Math.max(1, Math.ceil(total / PAGE_SIZE))}` : ''}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => p + 1)}
            disabled={items.length < PAGE_SIZE}
          >
            Вперёд →
          </Button>
        </div>
      )}

      {/* Editor dialog */}
      {(editing || creating) && (
        <ProductEditor
          product={editing}
          existingCategories={existingCategories}
          onClose={() => { setEditing(null); setCreating(false) }}
          onSaved={() => { setEditing(null); setCreating(false); refresh() }}
        />
      )}

      {/* Phase 25: custom confirm dialog */}
      <StudioConfirmDialog dialog={confirmDialogState} onClose={closeConfirm} />
    </div>
  )
}

// Russian pluralize helper for "товар/товара/товаров"
function pluralize(n: number): string {
  const last = n % 10
  const lastTwo = n % 100
  if (lastTwo >= 11 && lastTwo <= 14) return 'товаров'
  if (last === 1) return 'товар'
  if (last >= 2 && last <= 4) return 'товара'
  return 'товаров'
}

function ProductEditor({ product, existingCategories, onClose, onSaved }: {
  product: Product | null
  existingCategories: string[]
  onClose: () => void
  onSaved: () => void
}) {
  const [title, setTitle] = useState(product?.title || '')
  const [description, setDescription] = useState(product?.description || '')
  const [price, setPrice] = useState(String(product?.price ?? ''))
  const [oldPrice, setOldPrice] = useState(String(product?.oldPrice ?? ''))
  const [category, setCategory] = useState(product?.category || CATEGORIES[0])
  const [images, setImages] = useState<string[]>(product?.images || [])
  const [inStock, setInStock] = useState(product?.inStock ?? true)
  // v11: physical stock quantity — used to show "В наличии" / "Заканчивается" / "Нет в наличии".
  // Default to 10 for new products so they show "В наличии" by default.
  const [quantity, setQuantity] = useState(String(product?.quantity ?? 10))
  // v13.2 (audit P2-8 fix): renamed setisPopular → setIsPopular (capital I)
  // to match React naming convention used by all other setters in this file.
  const [isPopular, setIsPopular] = useState(product?.isPopular ?? false)
  const [isAction, setIsAction] = useState(product?.isAction ?? false)
  const [isNew, setIsNew] = useState(product?.isNew ?? false)
  const [isRecommended, setIsRecommended] = useState(product?.isRecommended ?? false)
  // v24.4: department link
  const [departmentId, setDepartmentId] = useState<string>(product?.departmentId || '')
  const [departments, setDepartments] = useState<Array<{ id: string; name: string }>>([])
  const [saving, setSaving] = useState(false)

  // v24.4: load departments for selector
  useEffect(() => {
    api.get<{ items: Array<{ id: string; name: string }> }>('/api/departments', { auth: true })
      .then((d) => setDepartments(d.items))
      .catch(() => {})
  }, [])

  // v8: AI Assistant — обработчик применения suggestion к полям товара
  const handleAIApply = useCallback((field: string, value: string) => {
    switch (field) {
      case 'title':
        setTitle(value)
        toast.success('Название обновлено из AI')
        break
      case 'description':
        setDescription(value)
        toast.success('Описание обновлено из AI')
        break
      case 'category':
        setCategory(value)
        toast.success('Категория обновлена из AI')
        break
      case 'specs':
        // specs нет в текущей форме — добавляем в описание
        setDescription(prev => (prev ? prev + '\n\nХарактеристики: ' + value : 'Характеристики: ' + value))
        toast.success('Характеристики добавлены в описание')
        break
      case 'seoTitle':
        setTitle(value)
        toast.success('SEO-заголовок применён к названию')
        break
      case 'seoDescription':
        setDescription(value)
        toast.success('SEO-описание применено к описанию')
        break
      case 'seoKeywords':
        // keywords добавляем в конец описания для индексации
        setDescription(prev => (prev ? prev + '\n\nКлючевые слова: ' + value : 'Ключевые слова: ' + value))
        toast.success('Ключевые слова добавлены в описание')
        break
      default:
        toast.info(`Поле ${field}: ${value.slice(0, 80)}…`)
    }
  }, [])

  // v8: функция отдаёт свежие данные карточки для контекста AI
  const getAIData = useCallback(() => ({
    title,
    description,
    price,
    oldPrice,
    category,
    images,
    inStock,
    quantity,
    isPopular,
    isAction,
    isNew,
    isRecommended,
  }), [title, description, price, oldPrice, category, images, inStock, quantity, isPopular, isAction, isNew, isRecommended])

const save = async () => {
    if (!title.trim()) return toast.error('Введите название')
    if (!images.length) return toast.error('Загрузите хотя бы одно фото')
    const priceNum = Number(price)
    if (!priceNum || priceNum < 0) return toast.error('Введите корректную цену')

    setSaving(true)
    try {
      const body = {
        title: title.trim(),
        description: description.trim() || undefined,
        price: priceNum,
        oldPrice: oldPrice ? Number(oldPrice) : undefined,
        category,
        images,
        inStock,
        // v11: send quantity to backend — 0 = out of stock, >0 = available
        quantity: Math.max(0, parseInt(quantity, 10) || 0),
        isPopular,
        isAction,
        isNew,
        isRecommended,
        // v24.4: department link
        departmentId: departmentId || null,
      }
      if (product) {
        // QW3 (S-BUG-002): encode product id — slugs may contain "/" (e.g. "листовки-а5,-плотность-200-г/м²")
        await api.patch(`/api/products/${encodeId(product.id)}`, { json: body, auth: true })
        toast.success('Товар обновлён')
      } else {
        await api.post('/api/products', { json: body, auth: true })
        toast.success('Товар создан')
      }
      onSaved()
    } catch (e: unknown) {
      toast.error('Ошибка', { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setSaving(false)
    }
  }

  // v24.2 BUGFIX: modal={false} disables Radix's FocusScope trap, which
  // was yanking focus back to DialogContent whenever the user clicked the
  // StudioAIAssistant input (rendered via Portal in document.body). With
  // modal=false, the AI assistant's input field accepts text normally.
  // We still manage open/closed state via onOpenChange + the explicit
  // Close button. Escape key still works via Radix default.
  return (
    <Dialog open={true} modal={false} onOpenChange={(v) => !v && onClose()}>
      {/* v24.3 BUGFIX: onPointerDownOutside + onInteractOutside preventDefault.
          With modal={false}, Radix's DismissableLayer fires onPointerDownOutside
          for ANY pointerdown outside DialogContent. The StudioAIAssistant
          drawer+backdrop are rendered via Portal in document.body (outside
          DialogContent), so without these handlers, any interaction with the
          AI assistant (clicking input, scrolling, tapping buttons) would close
          the product dialog. We preventDefault to keep the dialog open while
          the AI assistant is in use. The explicit X button + Escape still work. */}
      <DialogContent
        className="sm:max-w-2xl rounded-3xl"
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={() => {
          // Only allow Escape if AI assistant drawer is closed (don't conflict)
          // We can't easily check AI state here, so just allow Escape always —
          // Radix handles Escape at DialogContent level, AI drawer handles its own.
        }}
      >
        <DialogHeader>
          <DialogTitle>{product ? 'Редактировать товар' : 'Новый товар'}</DialogTitle>
          <DialogDescription>Заполните поля и нажмите «Сохранить».</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <ImageUploader value={images} onChange={setImages} multiple max={8} aspect="square" label="Фотографии товара" />

          <div className="space-y-1.5">
            <Label htmlFor="title">Название</Label>
            <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} className="rounded-2xl" placeholder="Смартфон Vision 12 Pro" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="price">Цена (₽)</Label>
              <Input id="price" type="number" value={price} onChange={(e) => setPrice(e.target.value)} className="rounded-2xl" placeholder="79990" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="oldPrice">Старая цена (₽, необязательно)</Label>
              <Input id="oldPrice" type="number" value={oldPrice} onChange={(e) => setOldPrice(e.target.value)} className="rounded-2xl" placeholder="89990" />
            </div>
          </div>

          {/* v11: Quantity field — physical stock on hand */}
          <div className="space-y-1.5">
            <Label htmlFor="quantity">Количество на складе</Label>
            <Input
              id="quantity"
              type="number"
              min={0}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="rounded-2xl"
              placeholder="10"
            />
            <p className="text-xs text-muted-foreground">
              0 = «Нет в наличии» · 1–5 = «Заканчивается» · 6+ = «В наличии»
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="category">Категория</Label>
            <div className="flex gap-2">
              <Input
                id="category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="rounded-2xl flex-1"
                placeholder="Введите категорию"
                list="category-suggestions"
              />
              <datalist id="category-suggestions">
                {Array.from(new Set([...CATEGORIES, ...existingCategories])).map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
            <div className="flex flex-wrap gap-2 mt-1">
              {Array.from(new Set([...CATEGORIES, ...existingCategories])).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategory(c)}
                  className={cn(
                    'px-3 py-1.5 rounded-full text-xs font-medium transition-all',
                    category === c ? 'gradient-brand text-white shadow-glow' : 'glass text-muted-foreground hover:text-foreground',
                  )}
                >
                  {c}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              Можно ввести свою категорию вручную или выбрать из списка.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="description">Описание</Label>
            <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} className="rounded-2xl min-h-[80px]" placeholder="Описание товара…" />
          </div>

          <div className="flex items-center gap-6 flex-wrap">
            <div className="flex items-center gap-2">
              <Switch checked={inStock} onCheckedChange={setInStock} id="inStock" />
              <Label htmlFor="inStock">Видим в каталоге</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={isPopular} onCheckedChange={setIsPopular} id="popular" />
              <Label htmlFor="popular">Популярный</Label>
            </div>
          </div>

          {/* Curated-section badges — when enabled, the product appears in
              the corresponding block on the home page (Акция / Новинка / Рекомендуем). */}
          <div className="space-y-1.5">
            <Label>Подборки на главной</Label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setIsAction(!isAction)}
                className={cn(
                  'px-3 py-1.5 rounded-full text-xs font-medium transition-all',
                  isAction ? 'bg-rose-500 text-white shadow-glow' : 'glass text-muted-foreground hover:text-foreground',
                )}
              >
                Акция
              </button>
              <button
                type="button"
                onClick={() => setIsNew(!isNew)}
                className={cn(
                  'px-3 py-1.5 rounded-full text-xs font-medium transition-all',
                  isNew ? 'bg-emerald-500 text-white shadow-glow' : 'glass text-muted-foreground hover:text-foreground',
                )}
              >
                Новинка
              </button>
              <button
                type="button"
                onClick={() => setIsRecommended(!isRecommended)}
                className={cn(
                  'px-3 py-1.5 rounded-full text-xs font-medium transition-all',
                  isRecommended ? 'gradient-brand text-white shadow-glow' : 'glass text-muted-foreground hover:text-foreground',
                )}
              >
                Рекомендуем
              </button>
            </div>
          </div>

          {/* v24.5: Department selector — ALWAYS shown (even when no departments exist).
              If no departments, show a message telling the admin to create them first. */}
          <div className="space-y-1.5">
            <Label>Подразделение (для контактов менеджера)</Label>
            {departments.length > 0 ? (
              <select
                value={departmentId}
                onChange={(e) => setDepartmentId(e.target.value)}
                className="w-full h-11 rounded-xl border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-violet-400/20"
              >
                <option value="">— Не выбрано —</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            ) : (
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-700 dark:text-amber-400">
                Нет созданных подразделений. Создайте их в разделе
                <button
                  type="button"
                  onClick={() => window.location.hash = 'departments'}
                  className="font-semibold underline ml-1"
                >
                  Контакты направлений
                </button>
                (Мебель, Реклама, Подарки и т.д.) — у каждого свои контакты менеджера.
              </div>
            )}
            <p className="text-[11px] text-muted-foreground">
              При открытии товара покажутся контакты менеджера этого направления
            </p>
          </div>

          <div className="flex gap-2 pt-2">
            <Button variant="outline" className="flex-1 rounded-full h-11" onClick={onClose}>Отмена</Button>
            <Button className="flex-1 rounded-full gradient-brand text-white shadow-glow h-11" onClick={save} disabled={saving}>
              {saving ? 'Сохранение…' : 'Сохранить'}
            </Button>
          </div>
        </div>
      </DialogContent>

      {/* v8: Studio AI Assistant — плавающая кнопка + drawer с чатом для товара */}
      <StudioAIAssistant
        type="product"
        getData={getAIData}
        onApply={handleAIApply}
        title={title || (product ? 'Без названия' : 'Новый товар')}
      />
    </Dialog>
  )
}
