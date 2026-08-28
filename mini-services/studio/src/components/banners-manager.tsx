'use client'

import { useEffect, useState, useCallback } from 'react'
import { Plus, Trash2, Pencil, RectangleHorizontal, ArrowUp, ArrowDown, Eye, EyeOff } from 'lucide-react'
import { api, assetUrl } from '@/lib/api'
import type { Banner } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useConfirmDialog, StudioConfirmDialog } from '@/components/ui/confirm-dialog'
import { Badge } from '@/components/ui/badge'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { StudioAIAssistant } from './studio-ai-assistant'
import { ImageUploader } from './image-uploader'
import { cn } from '@/lib/utils'
import { toast } from '@/lib/notifications'

const GRADIENTS = [
  { id: 'from-sky-400 via-blue-500 to-indigo-600', label: 'Голубой', class: 'from-sky-400 via-blue-500 to-indigo-600' },
  { id: 'from-fuchsia-500 via-purple-500 to-indigo-600', label: 'Фиолетовый', class: 'from-fuchsia-500 via-purple-500 to-indigo-600' },
  { id: 'from-emerald-400 via-teal-500 to-cyan-600', label: 'Зелёный', class: 'from-emerald-400 via-teal-500 to-cyan-600' },
  { id: 'from-amber-400 via-orange-500 to-red-600', label: 'Оранжевый', class: 'from-amber-400 via-orange-500 to-red-600' },
  { id: 'from-pink-400 via-rose-500 to-red-600', label: 'Розовый', class: 'from-pink-400 via-rose-500 to-red-600' },
]

export function BannersManager() {
  const [items, setItems] = useState<Banner[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Banner | null>(null)
  const [creating, setCreating] = useState(false)
  const [moving, setMoving] = useState(false)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
const { dialog: confirmDlg, confirm: openConfirm, close: closeConfirm } = useConfirmDialog()

  const refresh = useCallback(() => {
    setLoading(true)
    api.get<{ items: Banner[] }>('/api/banners/all', { auth: true })
      .then((d) => setItems(d.items))
      .catch((e) => {
        // S-LOW-008: was `.catch(() => setItems([]))` — silent failure.
        // Log the error so we can diagnose backend/network issues.
        console.error('[banners-manager] refresh failed:', e)
        setItems([])
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { refresh() }, [refresh])

  // v25.19 (owner): «в каталоге тоже сделать бы баннер, но чтобы можно было
  // отключить в студии» — тумблер показа баннерной карусели на странице
  // каталога. Хранится как boolean-настройка catalogBannerEnabled.
  const [catalogBanner, setCatalogBanner] = useState(true)
  const [catalogBannerSaving, setCatalogBannerSaving] = useState(false)
  useEffect(() => {
    api.get<{ value: boolean | null }>('/api/settings/catalogBannerEnabled', { auth: true })
      .then((d) => setCatalogBanner(d.value !== false))
      .catch(() => {})
  }, [])
  const toggleCatalogBanner = async (v: boolean) => {
    setCatalogBannerSaving(true)
    const prev = catalogBanner
    setCatalogBanner(v)
    try {
      await api.put('/api/settings/catalogBannerEnabled', { json: v, auth: true })
      toast.success(v ? 'Баннер в каталоге включён' : 'Баннер в каталоге скрыт')
    } catch (e: unknown) {
      setCatalogBanner(prev)
      toast.error('Ошибка', { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setCatalogBannerSaving(false)
    }
  }

  const handleDelete = (id: string) => {
    if (deletingId) return // prevent double-click
    openConfirm({
      title: 'Удалить баннер?',
      message: 'Это действие нельзя отменить.',
      confirmLabel: 'Удалить',
      variant: 'danger',
      onConfirm: async () => {
        setDeletingId(id)
        try {
          await api.delete(`/api/banners/${id}`, { auth: true })
          setItems((cur) => cur.filter((b) => b.id !== id))
          toast.success('Баннер удалён')
        } catch (e: unknown) {
          toast.error('Ошибка', { description: e instanceof Error ? e.message : String(e) })
        } finally {
          setDeletingId(null)
        }
      },
    })
  }

  const toggleActive = async (b: Banner) => {
    if (togglingId) return // prevent rapid double-clicks (ST-010)
    setTogglingId(b.id)
    try {
      await api.patch(`/api/banners/${b.id}`, { json: { isActive: !b.isActive }, auth: true })
      setItems((cur) => cur.map((x) => x.id === b.id ? { ...x, isActive: !x.isActive } : x))
    } catch (e: unknown) {
      toast.error('Ошибка', { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setTogglingId(null)
    }
  }

  const move = async (b: Banner, dir: -1 | 1) => {
    if (moving) return // lock during in-flight reorder (ST-006)
    const idx = items.findIndex((x) => x.id === b.id)
    const target = idx + dir
    if (target < 0 || target >= items.length) return
    const next = [...items]
    ;[next[idx], next[target]] = [next[target], next[idx]]
    const reordered = next.map((x, i) => ({ id: x.id, order: i }))
    setItems(next)
    setMoving(true)
    try {
      await api.post('/api/banners/reorder', { json: reordered, auth: true })
    } catch (e: unknown) {
      toast.error('Ошибка', { description: e instanceof Error ? e.message : String(e) })
      refresh()
    } finally {
      setMoving(false)
    }
  }

  return (
    <div className="px-4 md:px-6 py-6 pb-28 page-top-padding">
      <div className="flex items-center justify-between gap-4 mb-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">Баннеры</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{items.length} баннеров · {items.filter((b) => b.isActive).length} активных</p>
        </div>
        <Button onClick={() => setCreating(true)} className="rounded-full gradient-brand text-white shadow-glow h-11 px-5">
          <Plus className="h-4 w-4" /> Добавить
        </Button>
      </div>

      {/* v25.19: тумблер показа баннерной карусели в КАТАЛОГЕ (баннеры те же,
          что на главной — управлять показом можно независимо) */}
      <div className="rounded-2xl border border-border/50 bg-card p-4 mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-[#EC4899] to-[#9333EA] grid place-items-center shrink-0">
            <RectangleHorizontal className="h-5 w-5 text-white" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold">Баннер в каталоге</div>
            <div className="text-xs text-muted-foreground">Показывать эту же карусель на странице «Каталог»</div>
          </div>
        </div>
        <Switch
          checked={catalogBanner}
          onCheckedChange={toggleCatalogBanner}
          disabled={catalogBannerSaving}
          aria-label="Баннер в каталоге"
        />
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-32 rounded-2xl skeleton" />)}
        </div>
      ) : items.length === 0 ? (
        <div className="py-16 text-center">
          <RectangleHorizontal className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
          <p className="text-muted-foreground">Нет баннеров</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((b, idx) => (
            <div key={b.id} className="rounded-2xl glass overflow-hidden animate-fade-in-up">
              <div className={cn('relative h-28', b.useGradient ? 'bg-gradient-to-br ' + b.gradient : '')}>
                <img
                  src={assetUrl(b.image)}
                  alt=""
                  className={cn(
                    'absolute inset-0 h-full w-full object-cover',
                    b.useGradient ? 'opacity-40 mix-blend-overlay' : 'opacity-100',
                  )}
                />
                {!b.useGradient && (
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />
                )}
                <div className="relative h-full p-4 flex flex-col justify-between text-white">
                  <div>
                    <div className="font-bold text-lg drop-shadow-sm">{b.title}</div>
                    <div className="text-xs text-white/90">{b.subtitle}</div>
                  </div>
                  <div className="text-xs font-medium bg-white/25 backdrop-blur-sm rounded-full px-3 py-1 w-fit">{b.cta}</div>
                </div>
                <div className="absolute top-2 left-2 flex gap-1">
                  <Badge variant={b.isActive ? 'success' : 'destructive'} className="text-[10px]">{b.isActive ? 'Активен' : 'Скрыт'}</Badge>
                  <Badge variant="outline" className="text-[10px] bg-black/40 text-white border-white/20">#{idx + 1}</Badge>
                  <Badge variant="outline" className="text-[10px] bg-black/40 text-white border-white/20">
                    {b.useGradient ? 'градиент' : 'фото'}
                  </Badge>
                </div>
              </div>
              <div className="p-2 flex items-center gap-1">
                <Button variant="ghost" size="icon" className="rounded-full h-9 w-9" onClick={() => move(b, -1)} disabled={idx === 0} aria-label="Вверх">
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" className="rounded-full h-9 w-9" onClick={() => move(b, 1)} disabled={idx === items.length - 1} aria-label="Вниз">
                  <ArrowDown className="h-4 w-4" />
                </Button>
                <div className="flex-1" />
                <Button variant="ghost" size="icon" className="rounded-full h-9 w-9" onClick={() => toggleActive(b)} aria-label="Видимость">
                  {b.isActive ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                </Button>
                <Button variant="ghost" size="icon" className="rounded-full h-9 w-9" onClick={() => setEditing(b)} aria-label="Редактировать">
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" className="rounded-full h-9 w-9 text-destructive" onClick={() => handleDelete(b.id)} aria-label="Удалить">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {(editing || creating) && (
        <BannerEditor
          banner={editing}
          onClose={() => { setEditing(null); setCreating(false) }}
          onSaved={() => { setEditing(null); setCreating(false); refresh() }}
        />
      )}

      {/* Phase 28: custom confirm dialog */}
      <StudioConfirmDialog dialog={confirmDlg} onClose={closeConfirm} />
    </div>
  )
}

function BannerEditor({ banner, onClose, onSaved }: { banner: Banner | null; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(banner?.title || '')
  const [subtitle, setSubtitle] = useState(banner?.subtitle || '')
  const [cta, setCta] = useState(banner?.cta || '')
  const [link, setLink] = useState(banner?.link || '')
  const [image, setImage] = useState<string[]>(banner?.image ? [banner.image] : [])
  const [gradient, setGradient] = useState(banner?.gradient || GRADIENTS[0].id)
  const [useGradient, setUseGradient] = useState(banner?.useGradient ?? true)
  const [isActive, setIsActive] = useState(banner?.isActive ?? true)
  // v12.6.4: new fields — mode (image-only vs image-text) + objectFit
  const [mode, setMode] = useState<'image-text' | 'image-only'>(banner?.mode || 'image-text')
  const [objectFit, setObjectFit] = useState<'cover' | 'contain'>(banner?.objectFit || 'cover')
  const [saving, setSaving] = useState(false)
const save = async () => {
    // v12.6.4: title is no longer required. Only image is required.
    if (!image.length) return toast.error('Загрузите изображение')
    setSaving(true)
    try {
      const body = {
        // In image-only mode, all text fields are null (not rendered).
        title: mode === 'image-only' ? null : (title.trim() || null),
        subtitle: mode === 'image-only' ? null : (subtitle.trim() || null),
        cta: mode === 'image-only' ? null : (cta.trim() || null),
        link: mode === 'image-only' ? null : (link.trim() || null),
        image: image[0],
        gradient,
        useGradient,
        isActive,
        objectFit,
        mode,
      }
      if (banner) {
        await api.patch(`/api/banners/${banner.id}`, { json: body, auth: true })
        toast.success('Баннер обновлён')
      } else {
        await api.post('/api/banners', { json: body, auth: true })
        toast.success('Баннер создан')
      }
      onSaved()
    } catch (e: unknown) {
      toast.error('Ошибка', { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setSaving(false)
    }
  }

  // v24.3: AI assistant handlers for banners
  const getAIData = useCallback(() => ({
    title,
    subtitle,
    cta,
    description: subtitle, // AI sees subtitle as description context
    link,
    image: image[0] || '',
    mode,
  }), [title, subtitle, cta, link, image, mode])

  const handleAIApply = useCallback((field: string, value: string) => {
    switch (field) {
      case 'title': setTitle(value); break
      case 'subtitle': setSubtitle(value); break
      case 'cta': setCta(value); break
      case 'description': setSubtitle(value); break // description maps to subtitle
    }
  }, [])

  return (
    <Dialog open={true} modal={false} onOpenChange={(v) => !v && onClose()}>
      {/* v24.3: prevent outside-click closing so AI assistant drawer works */}
      <DialogContent
        className="sm:max-w-lg rounded-3xl"
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{banner ? 'Редактировать баннер' : 'Новый баннер'}</DialogTitle>
          <DialogDescription>Промо-баннер на главной странице.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <ImageUploader value={image} onChange={setImage} aspect="banner" label="Изображение" />

          {/* Live preview — mirrors the rendering logic in promo-banner.tsx */}
          {image.length > 0 && (
            <div
              className={cn(
                'relative h-24 rounded-2xl overflow-hidden',
                useGradient && mode === 'image-text' ? 'bg-gradient-to-br ' + gradient : '',
              )}
            >
              <img
                src={assetUrl(image[0])}
                alt=""
                className={cn(
                  'absolute inset-0 h-full w-full',
                  objectFit === 'contain' ? 'object-contain' : 'object-cover',
                  useGradient && mode === 'image-text' ? 'opacity-40 mix-blend-overlay' : 'opacity-100',
                )}
              />
              {mode === 'image-text' && !useGradient && (
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />
              )}
              {mode === 'image-text' && (
                <div className="relative h-full p-3 flex flex-col justify-between text-white">
                  <div>
                    <div className="font-bold text-sm drop-shadow-sm">{title || 'Заголовок'}</div>
                    <div className="text-[10px] text-white/90">{subtitle || 'Подзаголовок'}</div>
                  </div>
                  <div className="text-[10px] font-medium bg-white/25 backdrop-blur-sm rounded-full px-2 py-0.5 w-fit">{cta || 'Кнопка'}</div>
                </div>
              )}
            </div>
          )}

          {/* v12.6.4: Mode toggle — image-only vs image+text */}
          <div className="glass rounded-2xl p-3 space-y-2">
            <div className="text-sm font-semibold">Режим баннера</div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setMode('image-text')}
                className={cn(
                  'rounded-xl px-3 py-2.5 text-sm font-medium border-2 transition-all',
                  mode === 'image-text'
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border/40 text-muted-foreground hover:bg-accent/40',
                )}
              >
                Изображение + текст
              </button>
              <button
                type="button"
                onClick={() => setMode('image-only')}
                className={cn(
                  'rounded-xl px-3 py-2.5 text-sm font-medium border-2 transition-all',
                  mode === 'image-only'
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border/40 text-muted-foreground hover:bg-accent/40',
                )}
              >
                Только изображение
              </button>
            </div>
            {mode === 'image-only' && (
              <div className="text-xs text-muted-foreground">
                Все текстовые поля и кнопки скрыты. Изображение занимает всю область баннера.
              </div>
            )}
          </div>

          {/* v12.6.4: Object-fit selector — cover vs contain */}
          <div className="glass rounded-2xl p-3 space-y-2">
            <div className="text-sm font-semibold">Режим отображения изображения</div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setObjectFit('cover')}
                className={cn(
                  'rounded-xl px-3 py-2.5 text-sm font-medium border-2 transition-all',
                  objectFit === 'cover'
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border/40 text-muted-foreground hover:bg-accent/40',
                )}
              >
                Cover (обрезать)
              </button>
              <button
                type="button"
                onClick={() => setObjectFit('contain')}
                className={cn(
                  'rounded-xl px-3 py-2.5 text-sm font-medium border-2 transition-all',
                  objectFit === 'contain'
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border/40 text-muted-foreground hover:bg-accent/40',
                )}
              >
                Contain (полностью)
              </button>
            </div>
            <div className="text-xs text-muted-foreground">
              {objectFit === 'cover'
                ? 'Изображение обрезается, чтобы заполнить всю область (сохраняются пропорции).'
                : 'Изображение показывается полностью без искажений (могут быть поля).'}
            </div>
          </div>

          {/* Text fields — only shown in image-text mode */}
          {mode === 'image-text' && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="title">Заголовок</Label>
                <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} className="rounded-2xl" placeholder="Лето до -40%" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="subtitle">Подзаголовок</Label>
                <Input id="subtitle" value={subtitle} onChange={(e) => setSubtitle(e.target.value)} className="rounded-2xl" placeholder="Стильная коллекция" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cta">Текст кнопки</Label>
                <Input id="cta" value={cta} onChange={(e) => setCta(e.target.value)} className="rounded-2xl" placeholder="Смотреть" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="link">Ссылка (опционально)</Label>
                <Input id="link" value={link} onChange={(e) => setLink(e.target.value)} className="rounded-2xl" placeholder="https://…" />
              </div>

              {/* Gradient vs original image toggle */}
              <div className="glass rounded-2xl p-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">Использовать градиент</div>
                  <div className="text-xs text-muted-foreground">
                    {useGradient
                      ? 'Да — градиент + изображение с наложением'
                      : 'Нет — оригинальное изображение без обработок'}
                  </div>
                </div>
                <Switch checked={useGradient} onCheckedChange={setUseGradient} />
              </div>

              {/* Gradient picker — only shown when useGradient is true */}
              {useGradient && (
                <div className="space-y-1.5">
                  <Label>Градиент</Label>
                  <div className="flex flex-wrap gap-2">
                    {GRADIENTS.map((g) => (
                      <button
                        key={g.id}
                        type="button"
                        onClick={() => setGradient(g.id)}
                        className={cn(
                          'h-9 w-12 rounded-xl bg-gradient-to-br border-2 transition-all',
                          g.class,
                          gradient === g.id ? 'border-foreground scale-105' : 'border-transparent',
                        )}
                        aria-label={g.label}
                      />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          <div className="flex items-center gap-2">
            <Switch checked={isActive} onCheckedChange={setIsActive} id="active" />
            <Label htmlFor="active">Активен</Label>
          </div>

          <div className="flex gap-2 pt-2">
            <Button variant="outline" className="flex-1 rounded-full h-11" onClick={onClose}>Отмена</Button>
            <Button className="flex-1 rounded-full gradient-brand text-white shadow-glow h-11" onClick={save} disabled={saving}>
              {saving ? 'Сохранение…' : 'Сохранить'}
            </Button>
          </div>
        </div>
      </DialogContent>

      {/* v24.3: AI Assistant for banners — helps with title, subtitle, CTA */}
      <StudioAIAssistant
        type="banner"
        getData={getAIData}
        onApply={handleAIApply}
        title={title || (banner ? 'Без названия' : 'Новый баннер')}
      />
    </Dialog>
  )
}
