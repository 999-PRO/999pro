'use client'

import { useEffect, useState, useCallback } from 'react'
import { Plus, Trash2, Image as ImageIcon, Eye, X, Layers, CheckSquare, Square, CheckCheck } from 'lucide-react'
import { api, assetUrl } from '@/lib/api'
import type { Story } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { useConfirmDialog, StudioConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { ImageUploader } from './image-uploader'
import { timeAgo } from '@/lib/utils'
import { useAuthStore } from '@/lib/auth-store'
import { cn } from '@/lib/utils'
import { toast } from '@/lib/notifications'
// v8: Studio AI Assistant — встроенный AI-помощник для редактора Stories
import { StudioAIAssistant } from './studio-ai-assistant'

// Soft pastel gradient per category — kept in sync with the main app's
// src/lib/gradients.ts::getStoryPaletteForCategory
interface StoryPalette {
  ring: string
  glow: string
  solid: string
  cardBg: string
  cardText: string
  chipBg: string
}
const CATEGORY_PALETTES: Record<string, StoryPalette> = {
  'Акция': { ring: 'linear-gradient(135deg, #fb7185 0%, #f97316 50%, #fbbf24 100%)', glow: 'rgba(251,113,133,0.45)', solid: '#fb7185', cardBg: 'linear-gradient(135deg, rgba(251,113,133,0.92) 0%, rgba(249,115,22,0.92) 100%)', cardText: '#ffffff', chipBg: 'linear-gradient(135deg, #fb7185 0%, #f97316 100%)' },
  'Новости': { ring: 'linear-gradient(135deg, #38bdf8 0%, #3b82f6 50%, #6366f1 100%)', glow: 'rgba(56,189,248,0.45)', solid: '#3b82f6', cardBg: 'linear-gradient(135deg, rgba(56,189,248,0.92) 0%, rgba(99,102,241,0.92) 100%)', cardText: '#ffffff', chipBg: 'linear-gradient(135deg, #38bdf8 0%, #6366f1 100%)' },
  'Лето': { ring: 'linear-gradient(135deg, #fde047 0%, #fb923c 50%, #f43f5e 100%)', glow: 'rgba(251,146,60,0.45)', solid: '#fb923c', cardBg: 'linear-gradient(135deg, rgba(253,224,71,0.92) 0%, rgba(244,63,94,0.92) 100%)', cardText: '#ffffff', chipBg: 'linear-gradient(135deg, #fde047 0%, #fb923c 100%)' },
  'Зима': { ring: 'linear-gradient(135deg, #a5f3fc 0%, #67e8f9 50%, #38bdf8 100%)', glow: 'rgba(165,243,252,0.5)', solid: '#22d3ee', cardBg: 'linear-gradient(135deg, rgba(165,243,252,0.92) 0%, rgba(56,189,248,0.92) 100%)', cardText: '#0f172a', chipBg: 'linear-gradient(135deg, #a5f3fc 0%, #38bdf8 100%)' },
  'Весна': { ring: 'linear-gradient(135deg, #f9a8d4 0%, #c4b5fd 50%, #a5f3fc 100%)', glow: 'rgba(249,168,212,0.5)', solid: '#f472b6', cardBg: 'linear-gradient(135deg, rgba(249,168,212,0.92) 0%, rgba(196,181,253,0.92) 100%)', cardText: '#ffffff', chipBg: 'linear-gradient(135deg, #f9a8d4 0%, #c4b5fd 100%)' },
  'Осень': { ring: 'linear-gradient(135deg, #fdba74 0%, #f97316 50%, #b45309 100%)', glow: 'rgba(253,186,116,0.45)', solid: '#f97316', cardBg: 'linear-gradient(135deg, rgba(253,186,116,0.92) 0%, rgba(180,83,9,0.92) 100%)', cardText: '#ffffff', chipBg: 'linear-gradient(135deg, #fdba74 0%, #f97316 100%)' },
  'Все': { ring: 'linear-gradient(135deg, #38bdf8 0%, #818cf8 50%, #c084fc 100%)', glow: 'rgba(99,102,241,0.45)', solid: '#6366f1', cardBg: 'linear-gradient(135deg, rgba(56,189,248,0.92) 0%, rgba(192,132,252,0.92) 100%)', cardText: '#ffffff', chipBg: 'linear-gradient(135deg, #38bdf8 0%, #c084fc 100%)' },
}
const PASTEL_POOL: StoryPalette[] = [
  { ring: 'linear-gradient(135deg, #6ee7b7 0%, #34d399 50%, #10b981 100%)', glow: 'rgba(52,211,153,0.45)', solid: '#10b981', cardBg: 'linear-gradient(135deg, rgba(110,231,183,0.92) 0%, rgba(16,185,129,0.92) 100%)', cardText: '#ffffff', chipBg: 'linear-gradient(135deg, #6ee7b7 0%, #10b981 100%)' },
  { ring: 'linear-gradient(135deg, #ddd6fe 0%, #c4b5fd 50%, #a78bfa 100%)', glow: 'rgba(167,139,250,0.45)', solid: '#8b5cf6', cardBg: 'linear-gradient(135deg, rgba(221,214,254,0.92) 0%, rgba(167,139,250,0.92) 100%)', cardText: '#ffffff', chipBg: 'linear-gradient(135deg, #ddd6fe 0%, #a78bfa 100%)' },
  { ring: 'linear-gradient(135deg, #fed7aa 0%, #fdba74 50%, #fb923c 100%)', glow: 'rgba(251,146,60,0.45)', solid: '#fb923c', cardBg: 'linear-gradient(135deg, rgba(254,215,170,0.92) 0%, rgba(251,146,60,0.92) 100%)', cardText: '#ffffff', chipBg: 'linear-gradient(135deg, #fed7aa 0%, #fb923c 100%)' },
  { ring: 'linear-gradient(135deg, #fda4af 0%, #fb7185 50%, #f43f5e 100%)', glow: 'rgba(251,113,133,0.45)', solid: '#f43f5e', cardBg: 'linear-gradient(135deg, rgba(253,164,175,0.92) 0%, rgba(244,63,94,0.92) 100%)', cardText: '#ffffff', chipBg: 'linear-gradient(135deg, #fda4af 0%, #f43f5e 100%)' },
  { ring: 'linear-gradient(135deg, #bae6fd 0%, #7dd3fc 50%, #38bdf8 100%)', glow: 'rgba(56,189,248,0.45)', solid: '#0ea5e9', cardBg: 'linear-gradient(135deg, rgba(186,230,253,0.92) 0%, rgba(56,189,248,0.92) 100%)', cardText: '#ffffff', chipBg: 'linear-gradient(135deg, #bae6fd 0%, #38bdf8 100%)' },
  { ring: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 50%, #fbbf24 100%)', glow: 'rgba(251,191,36,0.45)', solid: '#f59e0b', cardBg: 'linear-gradient(135deg, rgba(254,243,199,0.92) 0%, rgba(251,191,36,0.92) 100%)', cardText: '#1f2937', chipBg: 'linear-gradient(135deg, #fef3c7 0%, #fbbf24 100%)' },
  { ring: 'linear-gradient(135deg, #f5d0fe 0%, #e879f9 50%, #c026d3 100%)', glow: 'rgba(232,121,249,0.45)', solid: '#c026d3', cardBg: 'linear-gradient(135deg, rgba(245,208,254,0.92) 0%, rgba(192,38,211,0.92) 100%)', cardText: '#ffffff', chipBg: 'linear-gradient(135deg, #f5d0fe 0%, #c026d3 100%)' },
  { ring: 'linear-gradient(135deg, #d9f99d 0%, #bef264 50%, #84cc16 100%)', glow: 'rgba(190,242,100,0.45)', solid: '#65a30d', cardBg: 'linear-gradient(135deg, rgba(217,249,157,0.92) 0%, rgba(132,204,22,0.92) 100%)', cardText: '#1f2937', chipBg: 'linear-gradient(135deg, #d9f99d 0%, #84cc16 100%)' },
]
function hashString(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i)
    h |= 0
  }
  return Math.abs(h)
}
function getStoryPaletteForCategory(category: string | null | undefined): StoryPalette {
  if (category && CATEGORY_PALETTES[category]) return CATEGORY_PALETTES[category]
  const key = (category || 'default').toLowerCase()
  return PASTEL_POOL[hashString(key) % PASTEL_POOL.length]
}

export function StoriesManager() {
  const [items, setItems] = useState<Story[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [preview, setPreview] = useState<Story | null>(null)
  const [existingCategories, setExistingCategories] = useState<string[]>([])
const { dialog: confirmDlg, confirm: openConfirm, close: closeConfirm } = useConfirmDialog()

  // Multi-select state for bulk operations
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const refresh = useCallback(() => {
    setLoading(true)
    Promise.all([
      api.get<{ items: Story[] }>('/api/stories', { auth: true }),
      api.get<{ items: string[] }>('/api/stories/categories', { auth: true }).catch(() => ({ items: [] as string[] })),
    ])
      .then(([d, cats]) => {
        setItems(d.items)
        setExistingCategories(cats.items || [])
      })
      .catch((e) => {
        // S-LOW-008: was `.catch(() => setItems([]))` — silent failure.
        // Log the error so we can diagnose backend/network issues.
        console.error('[stories-manager] refresh failed:', e)
        setItems([])
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const handleDelete = (id: string) => {
    openConfirm({
      title: 'Удалить сторис?',
      message: 'Это действие нельзя отменить.',
      confirmLabel: 'Удалить',
      variant: 'danger',
      onConfirm: async () => {
        try {
          await api.delete(`/api/stories/${id}`, { auth: true })
          setItems((cur) => cur.filter((s) => s.id !== id))
          toast.success('Сторис удалена')
        } catch (e: unknown) {
          toast.error('Ошибка', { description: e instanceof Error ? e.message : String(e) })
        }
      },
    })
  }

  // Bulk delete — uses /api/stories/bulk endpoint
  const handleBulkDelete = () => {
    if (selected.size === 0) return
    openConfirm({
      title: `Удалить ${selected.size} ${pluralizeStories(selected.size)}?`,
      message: 'Это действие нельзя отменить.',
      confirmLabel: 'Удалить',
      variant: 'danger',
      onConfirm: async () => {
        try {
          const ids = Array.from(selected)
          const r = await api.delete<{ ok: boolean; deleted: number; notFound: string[] }>('/api/stories/bulk', {
            auth: true,
            json: { ids },
          })
          setItems((cur) => cur.filter((s) => !selected.has(s.id)))
          toast.success(`Удалено: ${r.deleted}`, { description: r.notFound.length > 0 ? `Не найдено: ${r.notFound.length}` : undefined })
          setSelected(new Set())
          setSelectMode(false)
        } catch (e: unknown) {
          toast.error('Ошибка', { description: e instanceof Error ? e.message : String(e) })
        }
      },
    })
  }

  // Delete ALL stories
  const handleDeleteAll = () => {
    if (items.length === 0) return
    openConfirm({
      title: `Удалить ВСЕ ${items.length} сторис?`,
      message: 'Это действие нельзя отменить! Все сторис будут удалены безвозвратно.',
      confirmLabel: 'Удалить всё',
      variant: 'danger',
      onConfirm: async () => {
        try {
          const r = await api.delete<{ ok: boolean; deleted: number }>('/api/stories/all', { auth: true })
          setItems([])
          toast.success(`Удалено сторис: ${r.deleted}`)
          setSelected(new Set())
          setSelectMode(false)
        } catch (e: unknown) {
          toast.error('Ошибка', { description: e instanceof Error ? e.message : String(e) })
        }
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
  const selectAll = () => setSelected(new Set(items.map((s) => s.id)))
  const deselectAll = () => setSelected(new Set())

  // Group stories by category for display
  const groupedByCategory = items.reduce<Record<string, Story[]>>((acc, s) => {
    const cat = s.category || 'Без категории'
    if (!acc[cat]) acc[cat] = []
    acc[cat].push(s)
    return acc
  }, {})

  return (
    <div className="px-4 md:px-6 py-6 pb-28 page-top-padding">
      <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">Сторис</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {items.length} активных сторис
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

      {/* Bulk actions bar */}
      {selectMode && (
        <div className="flex items-center gap-2 mb-4 flex-wrap">
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
        <div className="mb-4">
          <Button variant="outline" size="sm" className="rounded-full h-9 text-destructive hover:bg-destructive/10" onClick={handleDeleteAll}>
            <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Очистить все
          </Button>
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="aspect-[9/16] rounded-2xl skeleton" />)}
        </div>
      ) : items.length === 0 ? (
        <div className="py-16 text-center">
          <ImageIcon className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
          <p className="text-muted-foreground">Нет сторис</p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(groupedByCategory).map(([cat, stories]) => {
            const palette = getStoryPaletteForCategory(cat === 'Без категории' ? null : cat)
            const totalMedia = stories.reduce((sum, s) => sum + s.media.length, 0)
            return (
            <div key={cat}>
              <div className="flex items-center gap-2 mb-3">
                <span
                  className="h-3.5 w-3.5 rounded-full"
                  style={{ background: palette.ring, boxShadow: `0 0 8px ${palette.glow}` }}
                />
                <h2 className="text-lg font-bold">{cat}</h2>
                <Badge variant="outline" className="text-[10px]">{stories.length}</Badge>
                {totalMedia > stories.length && (
                  <Badge className="text-[10px]" style={{ background: palette.chipBg, color: palette.cardText, border: 'none' }}>
                    {totalMedia} фото
                  </Badge>
                )}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {stories.map((s) => {
                  const isSelected = selected.has(s.id)
                  return (
                  <div
                    key={s.id}
                    className={cn(
                      'rounded-2xl overflow-hidden glass animate-fade-in-up transition-all',
                      isSelected && 'ring-2 ring-primary'
                    )}
                  >
                    <div className="relative aspect-[9/16] bg-black">
                      {s.mediaType === 'video' ? (
                        <video src={assetUrl(s.media[0])} className="w-full h-full object-cover" muted />
                      ) : (
                        <img src={assetUrl(s.media[0])} alt={s.caption || 'Story'} className="w-full h-full object-cover" />
                      )}
                      {/* Multi-image indicator */}
                      {s.media.length > 1 && (
                        <div className="absolute top-2 left-2 flex items-center gap-1 px-2 py-1 rounded-full bg-black/60 backdrop-blur text-white text-[10px] font-bold">
                          <Layers className="h-3 w-3" /> {s.media.length}
                        </div>
                      )}
                      <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-black/80 to-transparent">
                        <div className="text-white text-xs font-medium truncate">{s.user.displayName || s.user.username}</div>
                        <div className="text-white/70 text-[10px]">{timeAgo(s.createdAt)} · 👁 {s.views}</div>
                      </div>
                      {selectMode ? (
                        <button
                          onClick={() => toggleSelected(s.id)}
                          className="absolute inset-0 grid place-items-center bg-black/30 hover:bg-black/40 transition-colors"
                          aria-label={isSelected ? 'Снять выделение' : 'Выбрать'}
                        >
                          <div className={cn(
                            'h-10 w-10 rounded-full grid place-items-center border-2 transition-all',
                            isSelected ? 'bg-primary border-primary text-white' : 'bg-black/50 border-white text-white'
                          )}>
                            {isSelected ? <CheckCheck className="h-5 w-5" /> : <Square className="h-5 w-5" />}
                          </div>
                        </button>
                      ) : (
                        <div className="absolute top-2 right-2 flex gap-1">
                          <button onClick={() => setPreview(s)} className="h-7 w-7 rounded-full bg-black/60 text-white grid place-items-center hover:bg-primary" aria-label="Просмотр">
                            <Eye className="h-3.5 w-3.5" />
                          </button>
                          <button onClick={() => handleDelete(s.id)} className="h-7 w-7 rounded-full bg-black/60 text-white grid place-items-center hover:bg-destructive" aria-label="Удалить">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                    {s.caption && <div className="p-2 text-xs text-muted-foreground line-clamp-2">{s.caption}</div>}
                  </div>
                  )
                })}
              </div>
            </div>
            )
          })}
        </div>
      )}

      {creating && <StoryEditor existingCategories={existingCategories} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); refresh() }} />}
      {preview && <StoryPreview story={preview} onClose={() => setPreview(null)} />}

      {/* Phase 28: custom confirm dialog */}
      <StudioConfirmDialog dialog={confirmDlg} onClose={closeConfirm} />
    </div>
  )
}

// S-LOW-001 fix: "сторис" is indeclinable in Russian (loanword).
// All four branches of the original pluralize function returned the same string.
// Replaced with a simple inline constant for clarity.
function pluralizeStories(_n: number): string {
  return 'сторис'
}

function StoryEditor({ existingCategories, onClose, onSaved }: {
  existingCategories: string[]
  onClose: () => void
  onSaved: () => void
}) {
  const [media, setMedia] = useState<string[]>([])
  const [caption, setCaption] = useState('')
  const [category, setCategory] = useState('')
  const [saving, setSaving] = useState(false)
  const user = useAuthStore((s) => s.user)

  // v8: AI Assistant — обработчик применения suggestion к полям Story
  // Для Story поддерживаются поля: title (→ caption) и description (→ caption)
  const handleAIApply = useCallback((field: string, value: string) => {
    switch (field) {
      case 'title':
      case 'description':
        setCaption(value)
        toast.success('Подпись обновлена из AI')
        break
      default:
        toast.info(`Поле ${field}: ${value.slice(0, 80)}…`)
    }
  }, [])

  // v8: функция отдаёт свежие данные карточки для контекста AI
  const getAIData = useCallback(() => ({
    title: caption, // для AI title = caption (в Story только один текст)
    description: caption,
    category,
    images: media,
  }), [caption, category, media])

const save = async () => {
    if (!media.length) return toast.error('Загрузите хотя бы одно фото или видео')
    if (!user) return toast.error('Войдите в аккаунт')
    setSaving(true)
    try {
      // Backend creates ONE separate Story per URL (was: one Story with N
      // slides). mediaType is detected per-URL on the backend, so a mixed
      // image+video batch is handled correctly.
      await api.post('/api/stories', {
        json: {
          media,
          mediaType: 'image',
          caption: caption.trim() || undefined,
          category: category.trim() || undefined,
          durationHours: 24,
        },
        auth: true,
      })
      toast.success(media.length > 1 ? `Опубликовано сторис: ${media.length}` : 'Сторис опубликована')
      onSaved()
    } catch (e: unknown) {
      toast.error('Ошибка', { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={true} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md rounded-3xl">
        <DialogHeader>
          <DialogTitle>Новая сторис</DialogTitle>
          <DialogDescription>Живёт 24 часа. Каждое загруженное фото станет отдельной сторис.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <ImageUploader value={media} onChange={setMedia} multiple max={10} aspect="video" label="Медиа (каждое фото — отдельная сторис)" kind="any" />
          <div className="space-y-1.5">
            <Label htmlFor="category">Категория (необязательно)</Label>
            <Input
              id="category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="rounded-2xl"
              placeholder="Например: Акция, Новости, Лето…"
              list="story-category-suggestions"
            />
            <datalist id="story-category-suggestions">
              {existingCategories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            {existingCategories.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {existingCategories.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCategory(c)}
                    className={cn(
                      'px-2.5 py-1 rounded-full text-[11px] font-medium transition-all',
                      category === c ? 'gradient-brand text-white shadow-glow' : 'glass text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {c}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="caption">Подпись (необязательно)</Label>
            <Input id="caption" value={caption} onChange={(e) => setCaption(e.target.value)} className="rounded-2xl" placeholder="Подпись…" />
          </div>
          <div className="flex gap-2 pt-2">
            <Button variant="outline" className="flex-1 rounded-full h-11" onClick={onClose}>Отмена</Button>
            <Button className="flex-1 rounded-full gradient-brand text-white shadow-glow h-11" onClick={save} disabled={saving}>
              {saving ? 'Публикация…' : 'Опубликовать'}
            </Button>
          </div>
        </div>
      </DialogContent>

      {/* v8: Studio AI Assistant — плавающая кнопка + drawer с чатом для Story */}
      <StudioAIAssistant
        type="story"
        getData={getAIData}
        onApply={handleAIApply}
        title={caption || 'Новая Story'}
      />
    </Dialog>
  )
}

function StoryPreview({ story, onClose }: { story: Story; onClose: () => void }) {
  const [idx, setIdx] = useState(0)
  const total = story.media.length
  const go = (delta: number) => setIdx((i) => Math.max(0, Math.min(total - 1, i + delta)))
  return (
    <div className="fixed inset-0 z-[60] bg-black/90 backdrop-blur-md flex items-center justify-center p-4" onClick={onClose}>
      <button className="absolute top-4 right-4 h-10 w-10 rounded-full glass grid place-items-center text-white z-10" onClick={onClose} aria-label="Закрыть">
        <X className="h-5 w-5" />
      </button>
      <div className="relative w-full max-w-md aspect-[9/16] rounded-3xl overflow-hidden bg-black" onClick={(e) => e.stopPropagation()}>
        {/* Progress bars for multi-image story */}
        {total > 1 && (
          <div className="absolute top-2 left-2 right-2 z-20 flex gap-1">
            {story.media.map((_, i) => (
              <div key={i} className="flex-1 h-0.5 rounded-full bg-white/30 overflow-hidden">
                <div className={cn('h-full bg-white transition-all', i === idx ? 'w-full' : i < idx ? 'w-full opacity-60' : 'w-0')} />
              </div>
            ))}
          </div>
        )}
        {story.mediaType === 'video' ? (
          <video src={assetUrl(story.media[idx])} className="w-full h-full object-cover" autoPlay controls />
        ) : (
          <img src={assetUrl(story.media[idx])} alt={story.caption || 'Story'} className="w-full h-full object-cover" />
        )}
        {/* Multi-image nav arrows */}
        {total > 1 && (
          <>
            <button
              onClick={() => go(-1)}
              disabled={idx === 0}
              className="absolute left-2 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full glass grid place-items-center text-white disabled:opacity-30"
              aria-label="Предыдущее"
            >
              ‹
            </button>
            <button
              onClick={() => go(1)}
              disabled={idx === total - 1}
              className="absolute right-2 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full glass grid place-items-center text-white disabled:opacity-30"
              aria-label="Следующее"
            >
              ›
            </button>
          </>
        )}
        <div className="absolute top-6 left-4 right-4 z-10 flex items-center gap-2">
          <div className="h-9 w-9 rounded-full bg-white/20 backdrop-blur-md grid place-items-center text-white text-xs font-bold">
            {(story.user.displayName || story.user.username).slice(0, 2).toUpperCase()}
          </div>
          <div>
            <div className="text-white text-sm font-semibold">{story.user.displayName || story.user.username}</div>
            <div className="text-white/70 text-xs">{timeAgo(story.createdAt)} · 👁 {story.views}</div>
          </div>
        </div>
        {story.caption && (
          <div className="absolute bottom-0 inset-x-0 p-5 bg-gradient-to-t from-black/80 to-transparent">
            <p className="text-white text-sm">{story.caption}</p>
          </div>
        )}
      </div>
    </div>
  )
}
