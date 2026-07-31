'use client'

// ============================================================================
//  AI Knowledge Base Manager — Studio admin panel
// ----------------------------------------------------------------------------
//  Full CRUD for the AI Knowledge Base:
//    • Products (with pricing types, formulas, AI instructions, materials, specs)
//    • Services per product (design, mount, delivery, urgency…)
//    • FAQ (global + per-product)
//    • Categories
//    • Global AI settings (system prompt, greeting, fallback)
//
//  All data is stored in the backend DB. No code changes needed to add or
//  edit products — the assistant picks up new data immediately.
// ============================================================================
import { useEffect, useState, useCallback } from 'react'
import {
  Plus, Pencil, Trash2, Search, Sparkles, Save, Package,
  Settings as SettingsIcon, Tag, HelpCircle, ChevronDown, ChevronRight,
  Loader2, Bot, Wand2,
} from 'lucide-react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { toast } from '@/lib/notifications'
// P1-5 fix: replace native confirm() with accessible StudioConfirmDialog
import { useConfirmDialog, StudioConfirmDialog } from '@/components/ui/confirm-dialog'

// ---------------------------------------------------------------------------
//  Types
// ---------------------------------------------------------------------------
interface KBService {
  id: string
  name: string
  description?: string | null
  pricingType: string
  price: number
  isDefault: boolean
  condition?: string | null
  sortOrder: number
}
interface KBProduct {
  id: string
  name: string
  slug: string
  description?: string | null
  shortSummary?: string | null
  materials: string
  specs: string
  leadTime?: string | null
  warranty?: string | null
  pricingType: string
  basePrice: number
  maxPrice?: number | null
  currency: string
  minOrderValue?: number | null
  formula?: string | null
  formulaSpec: string
  aiInstruction?: string | null
  images: string
  isActive: boolean
  sortOrder: number
  categoryId?: string | null
  category?: { id: string; name: string } | null
  services?: KBService[]
  _count?: { services: number; faqs: number }
}
interface KBCategory {
  id: string
  name: string
  slug: string
  description?: string | null
  sortOrder: number
  _count?: { products: number }
}
interface KBFAQ {
  id: string
  question: string
  answer: string
  productId?: string | null
  product?: { id: string; name: string } | null
  sortOrder: number
  isActive: boolean
}
interface KBSettings {
  id: string
  systemPrompt: string
  fallbackMessage: string
  greeting: string
  assistantName: string
}

const PRICING_TYPES = [
  { value: 'fixed', label: 'Фиксированная' },
  { value: 'per_unit', label: 'За штуку' },
  { value: 'per_sq_meter', label: 'За м²' },
  { value: 'per_linear_meter', label: 'За погонный метр' },
  { value: 'per_set', label: 'За комплект' },
  { value: 'range', label: 'Диапазон (мин–макс)' },
  { value: 'quote', label: 'По запросу' },
]

type Tab = 'products' | 'categories' | 'faqs' | 'settings'

// ---------------------------------------------------------------------------
//  Main component
// ---------------------------------------------------------------------------
export function AIKnowledgeBaseManager() {
  const [tab, setTab] = useState<Tab>('products')

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-primary" />
            AI Knowledge Base
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            База знаний для AI-ассистента. Глубокий поиск (DeepSeek) никогда не придумывает цены —
            он использует только данные из этой панели.
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-xl bg-muted/40 glass">
        {([
          { id: 'products', label: 'Товары', icon: Package },
          { id: 'categories', label: 'Категории', icon: Tag },
          { id: 'faqs', label: 'Частые вопросы', icon: HelpCircle },
          { id: 'settings', label: 'Настройки AI', icon: SettingsIcon },
        ] as { id: Tab; label: string; icon: any }[]).map((t) => {
          const Icon = t.icon
          const active = tab === t.id
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all',
                active
                  ? 'bg-background text-foreground shadow-soft'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="h-4 w-4" />
              <span className="hidden sm:inline">{t.label}</span>
            </button>
          )
        })}
      </div>

      {tab === 'products' && <ProductsTab />}
      {tab === 'categories' && <CategoriesTab />}
      {tab === 'faqs' && <FAQsTab />}
      {tab === 'settings' && <SettingsTab />}
    </div>
  )
}

// ===========================================================================
//  PRODUCTS TAB
// ===========================================================================
function ProductsTab() {
  const [items, setItems] = useState<KBProduct[]>([])
  const [categories, setCategories] = useState<KBCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<KBProduct | null>(null)
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [prod, cat] = await Promise.all([
        api.get<{ items: KBProduct[] }>('/api/ai/products', { auth: true }),
        api.get<{ items: KBCategory[] }>('/api/ai/categories'),
      ])
      setItems(prod.items)
      setCategories(cat.items)
    } catch (e: any) {
      toast.error('Не удалось загрузить товары', { description: e?.message })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = items.filter((p) => {
    if (!q.trim()) return true
    const s = q.toLowerCase()
    return p.name.toLowerCase().includes(s) || p.slug.includes(s) || (p.description || '').toLowerCase().includes(s)
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Поиск товаров…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4 mr-1.5" />
          Добавить
        </Button>
      </div>

      {loading ? (
        <div className="py-20 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : filtered.length === 0 ? (
        <div className="py-20 text-center text-muted-foreground">
          <Package className="h-12 w-12 mx-auto mb-3 opacity-40" />
          <p>Пока нет товаров в базе знаний AI.</p>
          <Button className="mt-4" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4 mr-1.5" />
            Создать первый товар
          </Button>
        </div>
      ) : (
        <div className="grid gap-3">
          {filtered.map((p) => (
            <ProductCard key={p.id} product={p} onEdit={() => setEditing(p)} onChanged={load} />
          ))}
        </div>
      )}

      {(creating || editing) && (
        <ProductEditDialog
          product={editing}
          categories={categories}
          onClose={() => { setCreating(false); setEditing(null) }}
          onSaved={() => { setCreating(false); setEditing(null); load() }}
        />
      )}
    </div>
  )
}

function ProductCard({ product, onEdit, onChanged }: {
  product: KBProduct
  onEdit: () => void
  onChanged: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [services, setServices] = useState<KBService[]>(product.services || [])
  const [loadingServices, setLoadingServices] = useState(false)
  const [deleting, setDeleting] = useState(false)
  // P1-5 fix: useConfirmDialog instead of native confirm()
  const { dialog: confirmDialog, confirm, close: closeConfirm } = useConfirmDialog()

  const loadServices = useCallback(async () => {
    if (product.services) { setServices(product.services); return }
    setLoadingServices(true)
    try {
      const full = await api.get<KBProduct>(`/api/ai/products/${product.id}`, { auth: true })
      setServices(full.services || [])
    } finally { setLoadingServices(false) }
  }, [product.id, product.services])

  const toggleExpand = () => {
    if (!expanded) loadServices()
    setExpanded(!expanded)
  }

  const handleDelete = async () => {
    confirm({
      title: `Удалить товар «${product.name}»?`,
      message: 'Это действие нельзя отменить.',
      confirmLabel: 'Удалить',
      variant: 'danger',
      onConfirm: async () => {
        closeConfirm()
        setDeleting(true)
        try {
          await api.delete(`/api/ai/products/${product.id}`, { auth: true })
          toast.success('Товар удалён')
          onChanged()
        } catch (e: any) {
          toast.error('Не удалось удалить', { description: e?.message })
        } finally { setDeleting(false) }
      },
    })
  }

  const pricingLabel = PRICING_TYPES.find((t) => t.value === product.pricingType)?.label || product.pricingType

  return (
    <div className="rounded-xl border border-border/60 glass overflow-hidden">
      <div className="p-4 flex items-start gap-3">
        <button
          onClick={toggleExpand}
          className="mt-0.5 p-1 rounded hover:bg-accent transition-colors"
          aria-label={expanded ? 'Свернуть' : 'Развернуть'}
        >
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold truncate">{product.name}</span>
            <Badge variant={product.isActive ? 'default' : 'secondary'}>
              {product.isActive ? 'Активен' : 'Скрыт'}
            </Badge>
            <Badge variant="outline">{pricingLabel}</Badge>
            {product.category && <Badge variant="outline">{product.category.name}</Badge>}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {product.basePrice} {product.currency}
            {product.maxPrice != null && ` – ${product.maxPrice} ${product.currency}`}
            {' · '}
            {product._count?.services ?? 0} услуг
            {' · '}
            {product._count?.faqs ?? 0} FAQ
          </div>
          {product.shortSummary && (
            <p className="text-sm text-muted-foreground mt-1 line-clamp-1">{product.shortSummary}</p>
          )}
        </div>
        <div className="flex gap-1 shrink-0">
          <Button size="sm" variant="ghost" onClick={onEdit}><Pencil className="h-4 w-4" /></Button>
          <Button size="sm" variant="ghost" onClick={handleDelete} disabled={deleting}>
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      </div>
      {expanded && (
        <div className="border-t border-border/40 px-4 py-3 bg-muted/20 space-y-3">
          {loadingServices ? (
            <div className="flex justify-center py-2"><Loader2 className="h-4 w-4 animate-spin" /></div>
          ) : (
            <>
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-1">Услуги</div>
                {services.length === 0 ? (
                  <div className="text-xs text-muted-foreground">Нет услуг — добавьте в редакторе.</div>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {services.map((s) => (
                      <Badge key={s.id} variant="outline" className="text-xs">
                        {s.name} — {s.pricingType === 'percent' ? `${s.price}%` : `${s.price} ₽`}
                        {s.isDefault && <span className="ml-1 text-primary">•</span>}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
              {product.aiInstruction && (
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
                    <Bot className="h-3 w-3" /> Инструкция для AI
                  </div>
                  <p className="text-xs text-foreground/80 whitespace-pre-wrap">{product.aiInstruction}</p>
                </div>
              )}
              {product.formula && (
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-1">Формула</div>
                  <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{product.formula}</code>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* P1-5 fix: accessible confirm dialog */}
      <StudioConfirmDialog dialog={confirmDialog} onClose={closeConfirm} />
    </div>
  )
}

// ---------------------------------------------------------------------------
//  PRODUCT EDIT DIALOG
// ---------------------------------------------------------------------------
function ProductEditDialog({ product, categories, onClose, onSaved }: {
  product: KBProduct | null
  categories: KBCategory[]
  onClose: () => void
  onSaved: () => void
}) {
  const isEdit = !!product
  const [form, setForm] = useState<Partial<KBProduct>>(() => product ? { ...product } : {
    name: '',
    slug: '',
    description: '',
    shortSummary: '',
    materials: '[]',
    specs: '{}',
    leadTime: '',
    warranty: '',
    pricingType: 'fixed',
    basePrice: 0,
    maxPrice: null,
    currency: 'RUB',
    minOrderValue: null,
    formula: '',
    formulaSpec: '{}',
    aiInstruction: '',
    images: '[]',
    isActive: true,
    sortOrder: 0,
    categoryId: null,
  })
  const [materialsText, setMaterialsText] = useState(() => {
    try { return (JSON.parse(form.materials || '[]') as string[]).join('\n') } catch { return '' }
  })
  const [specsText, setSpecsText] = useState(() => {
    try { return JSON.stringify(JSON.parse(form.specs || '{}'), null, 2) } catch { return form.specs || '{}' }
  })
  const [saving, setSaving] = useState(false)

  const set = <K extends keyof KBProduct>(k: K, v: KBProduct[K]) => setForm((f) => ({ ...f, [k]: v }))

  const handleSave = async () => {
    if (!form.name?.trim()) {
      toast.error('Введите название товара')
      return
    }
    setSaving(true)
    try {
      const materials = JSON.stringify(materialsText.split('\n').map((s) => s.trim()).filter(Boolean))
      let specs = '{}'
      try { specs = JSON.stringify(JSON.parse(specsText || '{}')) }
      catch { toast.error('Характеристики: неверный JSON'); setSaving(false); return }

      const payload = { ...form, materials, specs }
      if (isEdit && product) {
        await api.put(`/api/ai/products/${product.id}`, { json: payload as any, auth: true })
        toast.success('Товар обновлён')
      } else {
        await api.post('/api/ai/products', { json: payload as any, auth: true })
        toast.success('Товар создан')
      }
      onSaved()
    } catch (e: any) {
      toast.error('Не удалось сохранить', { description: e?.message })
    } finally { setSaving(false) }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Редактировать товар' : 'Новый товар'}</DialogTitle>
          <DialogDescription>
            Все данные используются AI-ассистентом. Изменения применяются мгновенно — без перезагрузки.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Basics */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Название *</Label>
              <Input value={form.name || ''} onChange={(e) => set('name', e.target.value)} placeholder="Баннер" />
            </div>
            <div className="space-y-1.5">
              <Label>Slug (URL)</Label>
              <Input value={form.slug || ''} onChange={(e) => set('slug', e.target.value)} placeholder="auto" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Краткое описание (1 абзац)</Label>
            <Input value={form.shortSummary || ''} onChange={(e) => set('shortSummary', e.target.value)} placeholder="Печатная реклама на баннерной ткани…" />
          </div>

          <div className="space-y-1.5">
            <Label>Полное описание</Label>
            <Textarea value={form.description || ''} onChange={(e) => set('description', e.target.value)} rows={3} />
          </div>

          {/* Pricing */}
          <div className="rounded-lg border border-border/60 p-3 space-y-3 bg-muted/20">
            <div className="text-sm font-medium">Ценообразование</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label>Тип цены</Label>
                <select
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                  value={form.pricingType || 'fixed'}
                  onChange={(e) => set('pricingType', e.target.value as any)}
                >
                  {PRICING_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>{form.pricingType === 'percent' ? 'Процент (%)' : 'Базовая цена (₽)'}</Label>
                <Input type="number" value={form.basePrice ?? 0} onChange={(e) => set('basePrice', Number(e.target.value))} />
              </div>
              {form.pricingType === 'range' && (
                <div className="space-y-1.5">
                  <Label>Макс. цена (₽)</Label>
                  <Input type="number" value={form.maxPrice ?? 0} onChange={(e) => set('maxPrice', Number(e.target.value))} />
                </div>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label>Валюта</Label>
                <Input value={form.currency || 'RUB'} onChange={(e) => set('currency', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Мин. сумма заказа (₽)</Label>
                <Input type="number" value={form.minOrderValue ?? ''} onChange={(e) => set('minOrderValue', e.target.value ? Number(e.target.value) : null)} />
              </div>
              <div className="space-y-1.5">
                <Label>Категория</Label>
                <select
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                  value={form.categoryId || ''}
                  onChange={(e) => set('categoryId', e.target.value || null)}
                >
                  <option value="">— Без категории —</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Формула расчёта (текстом)</Label>
              <Input value={form.formula || ''} onChange={(e) => set('formula', e.target.value)} placeholder="Ширина × Высота × Цена_за_м² + Дизайн + Монтаж + Доставка" />
              <p className="text-xs text-muted-foreground">Показывается AI, чтобы понимать логику расчёта.</p>
            </div>
          </div>

          {/* Materials & specs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Материалы (по одному на строку)</Label>
              <Textarea
                value={materialsText}
                onChange={(e) => setMaterialsText(e.target.value)}
                rows={4}
                placeholder={'ПВХ 440 г/м²\nПВХ 510 г/м²\nСетка mesh 270 г/м²'}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Характеристики (JSON)</Label>
              <Textarea
                value={specsText}
                onChange={(e) => setSpecsText(e.target.value)}
                rows={4}
                className="font-mono text-xs"
                placeholder={'{\n  "Вес": "1.2 кг",\n  "Срок службы": "5 лет"\n}'}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Срок изготовления</Label>
              <Input value={form.leadTime || ''} onChange={(e) => set('leadTime', e.target.value)} placeholder="2–4 рабочих дня" />
            </div>
            <div className="space-y-1.5">
              <Label>Гарантия</Label>
              <Input value={form.warranty || ''} onChange={(e) => set('warranty', e.target.value)} placeholder="12 месяцев" />
            </div>
          </div>

          {/* AI Instruction */}
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-primary">
              <Wand2 className="h-4 w-4" />
              Инструкция для AI
            </div>
            <Textarea
              value={form.aiInstruction || ''}
              onChange={(e) => set('aiInstruction', e.target.value)}
              rows={5}
              placeholder={'Если клиент не указал размеры — сначала спросить ширину и высоту. Потом предложить дизайн. Потом монтаж. Потом доставку.'}
            />
            <p className="text-xs text-muted-foreground">
              Эта инструкция видна только AI. Он будет следовать ей при расчёте стоимости и общении с клиентом.
            </p>
          </div>

          {/* Status */}
          <div className="flex items-center gap-2">
            <Switch checked={form.isActive ?? true} onCheckedChange={(v) => set('isActive', v)} />
            <Label>Товар активен (доступен AI)</Label>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Отмена</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Save className="h-4 w-4 mr-1.5" />}
            Сохранить
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ===========================================================================
//  CATEGORIES TAB
// ===========================================================================
function CategoriesTab() {
  const [items, setItems] = useState<KBCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<KBCategory | null>(null)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  // P1-5 fix: useConfirmDialog instead of native confirm()
  const { dialog: confirmDialog, confirm, close: closeConfirm } = useConfirmDialog()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await api.get<{ items: KBCategory[] }>('/api/ai/categories')
      setItems(r.items)
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const handleSave = async () => {
    if (!name.trim()) { toast.error('Введите название'); return }
    try {
      if (editing) {
        await api.put(`/api/ai/categories/${editing.id}`, { json: { name, description }, auth: true })
        toast.success('Категория обновлена')
      } else {
        await api.post('/api/ai/categories', { json: { name, description }, auth: true })
        toast.success('Категория создана')
      }
      setEditing(null); setCreating(false); setName(''); setDescription('')
      load()
    } catch (e: any) {
      toast.error('Не удалось сохранить', { description: e?.message })
    }
  }

  const handleDelete = async (id: string, n: string) => {
    confirm({
      title: `Удалить категорию «${n}»?`,
      message: 'Это действие нельзя отменить.',
      confirmLabel: 'Удалить',
      variant: 'danger',
      onConfirm: async () => {
        closeConfirm()
        try {
          await api.delete(`/api/ai/categories/${id}`, { auth: true })
          toast.success('Удалено')
          load()
        } catch (e: any) {
          toast.error('Не удалось удалить', { description: e?.message })
        }
      },
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm text-muted-foreground">Группировка товаров в каталоге AI.</div>
        <Button onClick={() => { setCreating(true); setName(''); setDescription('') }}>
          <Plus className="h-4 w-4 mr-1.5" /> Категория
        </Button>
      </div>

      {loading ? (
        <div className="py-20 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {items.map((c) => (
            <div key={c.id} className="rounded-xl border border-border/60 glass p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold truncate">{c.name}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {c._count?.products ?? 0} товаров · /{c.slug}
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => { setEditing(c); setName(c.name); setDescription(c.description || '') }}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => handleDelete(c.id, c.name)}>
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              </div>
              {c.description && <p className="text-sm text-muted-foreground mt-2">{c.description}</p>}
            </div>
          ))}
        </div>
      )}

      {(creating || editing) && (
        <Dialog open onOpenChange={(o) => { if (!o) { setCreating(false); setEditing(null) } }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{editing ? 'Редактировать категорию' : 'Новая категория'}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Название</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Печать и баннеры" />
              </div>
              <div className="space-y-1.5">
                <Label>Описание</Label>
                <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => { setCreating(false); setEditing(null) }}>Отмена</Button>
              <Button onClick={handleSave}>Сохранить</Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* P1-5 fix: accessible confirm dialog */}
      <StudioConfirmDialog dialog={confirmDialog} onClose={closeConfirm} />
    </div>
  )
}

// ===========================================================================
//  FAQ TAB
// ===========================================================================
function FAQsTab() {
  const [items, setItems] = useState<KBFAQ[]>([])
  const [products, setProducts] = useState<KBProduct[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<KBFAQ | null>(null)
  const [creating, setCreating] = useState(false)
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [productId, setProductId] = useState<string>('')
  const [isActive, setIsActive] = useState(true)
  // P1-5 fix: useConfirmDialog instead of native confirm()
  const { dialog: confirmDialog, confirm, close: closeConfirm } = useConfirmDialog()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [f, p] = await Promise.all([
        api.get<{ items: KBFAQ[] }>('/api/ai/faqs', { auth: true }),
        api.get<{ items: KBProduct[] }>('/api/ai/products', { auth: true }),
      ])
      setItems(f.items)
      setProducts(p.items)
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const openCreate = () => {
    setCreating(true); setEditing(null)
    setQuestion(''); setAnswer(''); setProductId(''); setIsActive(true)
  }
  const openEdit = (f: KBFAQ) => {
    setEditing(f); setCreating(false)
    setQuestion(f.question); setAnswer(f.answer); setProductId(f.productId || ''); setIsActive(f.isActive)
  }

  const handleSave = async () => {
    if (!question.trim() || !answer.trim()) { toast.error('Заполните вопрос и ответ'); return }
    try {
      const body = { question, answer, productId: productId || null, isActive }
      if (editing) {
        await api.put(`/api/ai/faqs/${editing.id}`, { json: body, auth: true })
        toast.success('FAQ обновлён')
      } else {
        await api.post('/api/ai/faqs', { json: body, auth: true })
        toast.success('FAQ создан')
      }
      setCreating(false); setEditing(null); load()
    } catch (e: any) { toast.error('Не удалось сохранить', { description: e?.message }) }
  }

  const handleDelete = async (id: string) => {
    confirm({
      title: 'Удалить FAQ?',
      message: 'Это действие нельзя отменить.',
      confirmLabel: 'Удалить',
      variant: 'danger',
      onConfirm: async () => {
        closeConfirm()
        try { await api.delete(`/api/ai/faqs/${id}`, { auth: true }); toast.success('Удалено'); load() }
        catch (e: any) { toast.error('Не удалось удалить', { description: e?.message }) }
      },
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm text-muted-foreground">Частые вопросы и авторитетные ответы для AI.</div>
        <Button onClick={openCreate}><Plus className="h-4 w-4 mr-1.5" /> Вопрос</Button>
      </div>

      {loading ? (
        <div className="py-20 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : items.length === 0 ? (
        <div className="py-20 text-center text-muted-foreground">
          <HelpCircle className="h-12 w-12 mx-auto mb-3 opacity-40" />
          <p>Нет вопросов в базе знаний.</p>
        </div>
      ) : (
        <div className="grid gap-2">
          {items.map((f) => (
            <div key={f.id} className="rounded-lg border border-border/60 glass p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-sm">{f.question}</span>
                    <Badge variant={f.isActive ? 'default' : 'secondary'}>{f.isActive ? 'Активен' : 'Скрыт'}</Badge>
                    {f.product && <Badge variant="outline">{f.product.name}</Badge>}
                  </div>
                  <p className="text-sm text-muted-foreground line-clamp-2">{f.answer}</p>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button size="sm" variant="ghost" onClick={() => openEdit(f)}><Pencil className="h-3.5 w-3.5" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => handleDelete(f.id)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {(creating || editing) && (
        <Dialog open onOpenChange={(o) => { if (!o) { setCreating(false); setEditing(null) } }}>
          <DialogContent className="max-w-xl">
            <DialogHeader>
              <DialogTitle>{editing ? 'Редактировать FAQ' : 'Новый FAQ'}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Вопрос</Label>
                <Input value={question} onChange={(e) => setQuestion(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Ответ</Label>
                <Textarea value={answer} onChange={(e) => setAnswer(e.target.value)} rows={4} />
              </div>
              <div className="space-y-1.5">
                <Label>Привязка к товару (опционально)</Label>
                <select
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                  value={productId}
                  onChange={(e) => setProductId(e.target.value)}
                >
                  <option value="">— Глобальный (для всех) —</option>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={isActive} onCheckedChange={setIsActive} />
                <Label>Активен</Label>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => { setCreating(false); setEditing(null) }}>Отмена</Button>
              <Button onClick={handleSave}>Сохранить</Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* P1-5 fix: accessible confirm dialog */}
      <StudioConfirmDialog dialog={confirmDialog} onClose={closeConfirm} />
    </div>
  )
}

// ===========================================================================
//  SETTINGS TAB
// ===========================================================================
function SettingsTab() {
  const [settings, setSettings] = useState<KBSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const s = await api.get<KBSettings>('/api/ai/settings')
      setSettings(s)
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const handleSave = async () => {
    if (!settings) return
    setSaving(true)
    try {
      await api.put('/api/ai/settings', { json: settings, auth: true })
      toast.success('Настройки AI сохранены')
    } catch (e: any) {
      toast.error('Не удалось сохранить', { description: e?.message })
    } finally { setSaving(false) }
  }

  if (loading || !settings) {
    return <div className="py-20 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium text-primary">
          <Bot className="h-4 w-4" />
          Системный промпт AI
        </div>
        <p className="text-xs text-muted-foreground">
          Этот текст подаётся модели DeepSeek перед каждым разговором. Здесь задаются «личность»
          ассистента, правила общения и бизнес-логика. Меняйте аккуратно.
        </p>
        <Textarea
          value={settings.systemPrompt}
          onChange={(e) => setSettings({ ...settings, systemPrompt: e.target.value })}
          rows={10}
          className="font-mono text-xs"
        />
      </div>

      <div className="space-y-1.5">
        <Label>Имя ассистента</Label>
        <Input
          value={settings.assistantName}
          onChange={(e) => setSettings({ ...settings, assistantName: e.target.value })}
        />
      </div>

      <div className="space-y-1.5">
        <Label>Приветствие</Label>
        <Textarea
          value={settings.greeting}
          onChange={(e) => setSettings({ ...settings, greeting: e.target.value })}
          rows={2}
        />
        <p className="text-xs text-muted-foreground">Показывается при открытии ассистента, до того как пользователь что-то написал.</p>
      </div>

      <div className="space-y-1.5">
        <Label>Ответ-заглушка</Label>
        <Textarea
          value={settings.fallbackMessage}
          onChange={(e) => setSettings({ ...settings, fallbackMessage: e.target.value })}
          rows={2}
        />
        <p className="text-xs text-muted-foreground">Используется, когда AI не может помочь по запросу.</p>
      </div>

      <div className="flex justify-end pt-2">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Save className="h-4 w-4 mr-1.5" />}
          Сохранить настройки
        </Button>
      </div>
    </div>
  )
}
