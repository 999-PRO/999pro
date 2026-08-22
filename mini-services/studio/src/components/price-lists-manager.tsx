'use client'

/**
 * v25.12 — PriceListsManager (Studio).
 *
 * Админка для загрузки прайс-листов (PDF, Word, Excel, изображения).
 * Поддерживает:
 *   - Загрузка файла (drag-and-drop или клик)
 *   - Авто-определение типа файла (pdf/word/excel/image)
 *   - Заголовок, описание, категория
 *   - Сортировка (drag up/down)
 *   - Скрытие/показ
 *   - Удаление (с удалением файла с диска)
 *
 * API: /api/price-lists (public) + /api/price-lists/all (admin) +
 *      /api/price-lists/upload (multipart) + /api/price-lists/reorder
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Plus, Trash2, Pencil, ArrowUp, ArrowDown, Eye, EyeOff, Loader2,
  FileText, FileSpreadsheet, FileImage, Upload, ExternalLink, File,
} from 'lucide-react'
import { api, assetUrl, buildUploadUrl } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useConfirmDialog, StudioConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { toast } from '@/lib/notifications'
import { cn } from '@/lib/utils'
// v25.13 (login+upload regression fix): auth store for upload token
import { useAuthStore } from '@/lib/auth-store'

interface PriceList {
  id: string
  title: string
  description: string | null
  fileUrl: string
  fileType: string
  thumbnail: string | null
  category: string | null
  fileSize: number | null
  visible: boolean
  sortOrder: number
  expiresAt: string | null
  createdAt: string
}

const FILE_TYPE_ICONS: Record<string, any> = {
  pdf: FileText,
  word: FileText,
  excel: FileSpreadsheet,
  image: FileImage,
  other: File,
}

const FILE_TYPE_COLORS: Record<string, string> = {
  pdf: 'from-[#DC2626] to-[#B91C1C]',
  word: 'from-[#2563EB] to-[#1D4ED8]',
  excel: 'from-[#16A34A] to-[#15803D]',
  image: 'from-[#A855F7] to-[#9333EA]',
  other: 'from-[#64748B] to-[#475569]',
}

const FILE_TYPE_LABELS: Record<string, string> = {
  pdf: 'PDF',
  word: 'Word',
  excel: 'Excel',
  image: 'Изображение',
  other: 'Файл',
}

function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`
}

export function PriceListsManager() {
  const [items, setItems] = useState<PriceList[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState<PriceList | null>(null)
  const [creating, setCreating] = useState(false)
  // v25.13 (price-lists runtime crash fix): useConfirmDialog() returns
  // { dialog, confirm, close }. Previously this destructured `confirm` as
  // `openConfirm` and called it WITHOUT arguments (`openConfirm()`) — but
  // the hook's `confirm` signature is `(opts: Omit<ConfirmDialogState, 'open'>) => void`.
  // Calling it with no arguments set `dialog.title`/`dialog.message`/`dialog.onConfirm`
  // all to `undefined`, then `<StudioConfirmDialog {...dialog} title="..." onConfirm={...}/>` was
  // passed as FLAT PROPS instead of `dialog={dialog} onClose={closeConfirm}` — which crashed
  // the StudioConfirmDialog component with:
  //   "TypeError: Cannot read properties of undefined (reading 'open')"
  // the moment the PriceListsManager mounted. After this fix, the manager loads.
  const { dialog: confirmDialog, confirm: openConfirm, close: closeConfirm } = useConfirmDialog()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const d = await api.get<{ items: PriceList[] }>('/api/price-lists/all', { auth: true })
      setItems(d.items || [])
    } catch {
      toast.error('Не удалось загрузить прайс-листы')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleDelete = async (id: string) => {
    try {
      await api.delete(`/api/price-lists/${id}`, { auth: true })
      toast.success('Прайс-лист удалён')
      setItems(items.filter((i) => i.id !== id))
    } catch {
      toast.error('Ошибка удаления')
    } finally {
      closeConfirm()
    }
  }

  // v25.13: trigger the confirm dialog with proper arguments. Previously
  // this was `setDeleteId(item.id); openConfirm()` — openConfirm() was
  // called with no arguments, leaving dialog.title/message/onConfirm all
  // undefined and crashing StudioConfirmDialog.
  const requestDelete = (item: PriceList) => {
    openConfirm({
      title: 'Удалить прайс-лист?',
      message: 'Файл будет удалён с сервера. Это действие нельзя отменить.',
      confirmLabel: 'Удалить',
      variant: 'danger',
      onConfirm: () => { void handleDelete(item.id) },
    })
  }

  const moveBlock = async (idx: number, dir: -1 | 1) => {
    const newIdx = idx + dir
    if (newIdx < 0 || newIdx >= items.length) return
    const reordered = [...items]
    ;[reordered[idx], reordered[newIdx]] = [reordered[newIdx], reordered[idx]]
    const renumbered = reordered.map((it, i) => ({ ...it, sortOrder: i }))
    setItems(renumbered)
    setSaving(true)
    try {
      await api.post('/api/price-lists/reorder', {
        json: { items: renumbered.map((it) => ({ id: it.id, sortOrder: it.sortOrder })) },
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

  const toggleVisible = async (item: PriceList) => {
    const newVisible = !item.visible
    setItems(items.map((i) => i.id === item.id ? { ...i, visible: newVisible } : i))
    try {
      await api.patch(`/api/price-lists/${item.id}`, { json: { visible: newVisible }, auth: true })
      toast.success(newVisible ? 'Прайс-лист виден' : 'Прайс-лист скрыт')
    } catch {
      toast.error('Ошибка')
      load()
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
    <div className="px-4 md:px-6 py-6 pb-28 max-w-3xl">
      {/* Header */}
      <div className="mb-5 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">Прайс-листы</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Загружайте PDF, Word, Excel или изображения с прайсами для клиентов
          </p>
        </div>
        <Button onClick={() => setCreating(true)} className="rounded-full gradient-brand text-white shadow-glow">
          <Plus className="h-4 w-4 mr-1" /> Добавить
        </Button>
      </div>

      {/* Info */}
      <div className="mb-4 rounded-2xl border border-border/40 bg-card p-3 text-xs text-muted-foreground space-y-1">
        <p>📄 Поддерживаемые форматы: <b>PDF, DOC/DOCX, XLS/XLSX, JPG/PNG/GIF/WebP</b></p>
        <p>📦 Максимальный размер файла: <b>50 МБ</b></p>
        <p>👁 <b>Скрытые</b> прайс-листы не видны клиентам. Порядок меняется кнопками ↑↓.</p>
      </div>

      {items.length === 0 ? (
        <div className="text-center py-16 rounded-2xl border border-dashed border-border">
          <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
          <p className="text-muted-foreground mb-3">Пока нет прайс-листов</p>
          <Button onClick={() => setCreating(true)} className="rounded-full gradient-brand text-white">
            <Plus className="h-4 w-4 mr-1" /> Загрузить первый
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item, idx) => {
            const Icon = FILE_TYPE_ICONS[item.fileType] || File
            const colorClass = FILE_TYPE_COLORS[item.fileType] || FILE_TYPE_COLORS.other
            return (
              <div
                key={item.id}
                className={cn(
                  'rounded-2xl border bg-card p-3 flex items-center gap-3 transition-all',
                  item.visible ? 'border-border/40' : 'border-border/40 opacity-60',
                )}
              >
                {/* Up/Down */}
                <div className="flex flex-col shrink-0">
                  <button onClick={() => moveBlock(idx, -1)} disabled={idx === 0 || saving} className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30">
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => moveBlock(idx, 1)} disabled={idx === items.length - 1 || saving} className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30">
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                </div>

                {/* File icon */}
                <div className={cn('h-12 w-12 rounded-xl bg-gradient-to-br grid place-items-center shrink-0 text-white shadow-md', colorClass)}>
                  <Icon className="h-6 w-6" />
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate flex items-center gap-1.5">
                    {item.title}
                    <span className="px-1.5 py-0.5 rounded bg-foreground/5 text-[10px] font-medium text-muted-foreground">
                      {FILE_TYPE_LABELS[item.fileType] || item.fileType}
                    </span>
                  </div>
                  <div className="text-[11px] text-muted-foreground truncate">
                    {item.category && <span>{item.category} · </span>}
                    {formatFileSize(item.fileSize)}
                    {item.description && <span> · {item.description}</span>}
                  </div>
                  <div className={cn('text-[10px] font-medium mt-0.5', item.visible ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground')}>
                    {item.visible ? '● Видим' : '○ Скрыт'}
                  </div>
                </div>

                {/* Open external */}
                <a
                  href={assetUrl(item.fileUrl)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="h-9 w-9 rounded-lg grid place-items-center bg-foreground/5 text-muted-foreground hover:bg-foreground/10 transition-colors shrink-0"
                  title="Открыть файл"
                >
                  <ExternalLink className="h-4 w-4" />
                </a>

                {/* Visibility toggle */}
                <button
                  onClick={() => toggleVisible(item)}
                  title={item.visible ? 'Скрыть' : 'Показать'}
                  className={cn('h-9 w-9 rounded-lg grid place-items-center transition-colors shrink-0', item.visible ? 'bg-emerald-500/15 text-emerald-600' : 'bg-foreground/5 text-muted-foreground hover:bg-foreground/10')}
                >
                  {item.visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                </button>

                {/* Edit */}
                <button
                  onClick={() => setEditing(item)}
                  title="Редактировать"
                  className="h-9 w-9 rounded-lg grid place-items-center bg-foreground/5 text-muted-foreground hover:bg-foreground/10 transition-colors shrink-0"
                >
                  <Pencil className="h-4 w-4" />
                </button>

                {/* Delete */}
                <button
                  onClick={() => requestDelete(item)}
                  title="Удалить"
                  className="h-9 w-9 rounded-lg grid place-items-center bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors shrink-0"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            )
          })}
        </div>
      )}

      {saving && (
        <div className="fixed bottom-4 right-4 flex items-center gap-2 px-4 py-2 rounded-xl bg-background/90 backdrop-blur-md border border-border/40 shadow-lg text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Сохранение…
        </div>
      )}

      {(creating || editing) && (
        <PriceListEditor
          priceList={editing}
          onClose={() => { setCreating(false); setEditing(null) }}
          onSaved={() => { setCreating(false); setEditing(null); load() }}
        />
      )}

      {/* v25.13: pass dialog + onClose to StudioConfirmDialog (correct API).
          Previously this was `<StudioConfirmDialog {...confirmDialog} title=... />`
          which spread dialog state as FLAT PROPS — but StudioConfirmDialog
          expects exactly `{ dialog, onClose }` and crashed when it tried to
          read `dialog.open` from undefined. */}
      <StudioConfirmDialog dialog={confirmDialog} onClose={closeConfirm} />
    </div>
  )
}

// ============================================================================
//  PriceListEditor — create / edit dialog with file upload
// ============================================================================
function PriceListEditor({
  priceList,
  onClose,
  onSaved,
}: {
  priceList: PriceList | null
  onClose: () => void
  onSaved: () => void
}) {
  const isEdit = !!priceList
  const [title, setTitle] = useState(priceList?.title ?? '')
  const [description, setDescription] = useState(priceList?.description ?? '')
  const [category, setCategory] = useState(priceList?.category ?? '')
  const [visible, setVisible] = useState(priceList?.visible ?? true)
  const [fileUrl, setFileUrl] = useState(priceList?.fileUrl ?? '')
  const [fileType, setFileType] = useState(priceList?.fileType ?? 'pdf')
  const [fileSize, setFileSize] = useState<number | null>(priceList?.fileSize ?? null)
  const [fileName, setFileName] = useState<string>('')
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)

  const handleFile = async (file: File) => {
    if (!file) return
    if (file.size > 50 * 1024 * 1024) {
      toast.error('Файл слишком большой (макс. 50 МБ)')
      return
    }
    setUploading(true)
    setFileName(file.name)
    try {
      const formData = new FormData()
      formData.append('file', file)
      // v25.13 (login+upload regression fix): use buildUploadUrl() so the URL
      // gets the /studio prefix (matches the basePath-aware rewrite) and
      // XTransformPort for sandbox preview. Previously this was a raw
      // '/api/price-lists/upload' string which returned 404 in production
      // because the rewrite only matches /studio/api/price-lists/upload.
      // Also fixed: the auth token is now read from the Zustand auth store
      // (single source of truth) instead of the wrong localStorage key
      // '999pro-studio-token' which never existed (the store uses
      // '999pro-studio-auth' with a {state: {token}} JSON shape).
      const token = useAuthStore.getState().token
      const res = await fetch(buildUploadUrl('/api/price-lists/upload'), {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      })
      if (!res.ok) throw new Error('Upload failed')
      const data = await res.json()
      setFileUrl(data.url)
      setFileType(data.type)
      setFileSize(data.size)
      if (!title) setTitle(file.name.replace(/\.[^.]+$/, ''))
      toast.success('Файл загружен')
    } catch (e: any) {
      toast.error(e?.message || 'Ошибка загрузки файла')
      setFileName('')
    } finally {
      setUploading(false)
    }
  }

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) handleFile(file)
  }

  const handleSubmit = async () => {
    if (!title.trim()) { toast.error('Введите название'); return }
    if (!fileUrl) { toast.error('Загрузите файл'); return }
    setSaving(true)
    try {
      const payload = {
        title: title.trim(),
        description: description.trim() || null,
        category: category.trim() || null,
        visible,
        fileUrl,
        fileType,
        fileSize,
      }
      if (isEdit && priceList) {
        await api.patch(`/api/price-lists/${priceList.id}`, { json: payload, auth: true })
        toast.success('Прайс-лист обновлён')
      } else {
        await api.post('/api/price-lists', { json: payload, auth: true })
        toast.success('Прайс-лист создан')
      }
      onSaved()
    } catch (e: any) {
      toast.error(e?.message || 'Ошибка сохранения')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Редактировать прайс-лист' : 'Новый прайс-лист'}</DialogTitle>
          <DialogDescription>
            {isEdit ? 'Измените параметры прайс-листа' : 'Загрузите PDF, Word, Excel или изображение'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2 max-h-[70vh] overflow-y-auto">
          {/* File upload */}
          {!fileUrl ? (
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                'border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all',
                dragOver ? 'border-primary bg-primary/5' : 'border-border/60 hover:border-primary/40',
              )}
            >
              {uploading ? (
                <div className="flex flex-col items-center gap-2">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  <p className="text-sm text-muted-foreground">Загрузка…</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-[#A02070] to-[#9333EA] grid place-items-center">
                    <Upload className="h-6 w-6 text-white" />
                  </div>
                  <p className="text-sm font-medium">Перетащите файл или нажмите</p>
                  <p className="text-xs text-muted-foreground">PDF, DOC/DOCX, XLS/XLSX, JPG/PNG — до 50 МБ</p>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.jpg,.jpeg,.png,.gif,.webp,.bmp,.svg"
                onChange={handleFileInput}
                className="hidden"
              />
            </div>
          ) : (
            <div className="rounded-2xl border border-border/40 bg-card p-3 flex items-center gap-3">
              <div className={cn('h-12 w-12 rounded-xl bg-gradient-to-br grid place-items-center text-white shrink-0', FILE_TYPE_COLORS[fileType] || FILE_TYPE_COLORS.other)}>
                {(() => {
                  const Icon = FILE_TYPE_ICONS[fileType] || File
                  return <Icon className="h-6 w-6" />
                })()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold truncate">{fileName || 'Файл загружен'}</div>
                <div className="text-xs text-muted-foreground">
                  {FILE_TYPE_LABELS[fileType]} · {formatFileSize(fileSize)}
                </div>
              </div>
              <button
                onClick={() => { setFileUrl(''); setFileName(''); setFileSize(null) }}
                className="h-9 w-9 rounded-lg grid place-items-center bg-destructive/10 text-destructive hover:bg-destructive/20"
                title="Удалить файл"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* Title */}
          <div className="space-y-1.5">
            <Label htmlFor="pl-title">Название *</Label>
            <Input
              id="pl-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Например: Прайс на рекламную продукцию"
              maxLength={200}
            />
          </div>

          {/* Category */}
          <div className="space-y-1.5">
            <Label htmlFor="pl-category">Категория (опц.)</Label>
            <Input
              id="pl-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="Например: Реклама, Мебель, Подарки"
              maxLength={100}
            />
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <Label htmlFor="pl-desc">Описание (опц.)</Label>
            <Textarea
              id="pl-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Короткое описание прайс-листа"
              rows={2}
              maxLength={2000}
            />
          </div>

          {/* Visibility */}
          <div className="flex items-center justify-between">
            <Label htmlFor="pl-visible">Видим клиентам</Label>
            <button
              type="button"
              onClick={() => setVisible(!visible)}
              className={cn('relative h-6 w-11 rounded-full transition-colors', visible ? 'bg-primary' : 'bg-muted')}
            >
              <span className={cn('absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform', visible && 'translate-x-5')} />
            </button>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>Отмена</Button>
          <Button onClick={handleSubmit} disabled={saving || !fileUrl} className="gradient-brand text-white">
            {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            {isEdit ? 'Сохранить' : 'Создать'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
