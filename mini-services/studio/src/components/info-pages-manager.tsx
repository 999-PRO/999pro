'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  Plus, Trash2, Pencil, ArrowUp, ArrowDown, Eye, EyeOff,
  FileText, ExternalLink, GripVertical, Menu, Eye as EyeIcon,
  Shield as ShieldIcon, BookOpen as BookOpenIcon,
} from 'lucide-react'
import { api } from '@/lib/api'
import type { InfoPage } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { useConfirmDialog, StudioConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { ImageUploader } from './image-uploader'
import { cn } from '@/lib/utils'
import { toast } from '@/lib/notifications'

// ============================================================================
// InfoPagesManager — Studio section for managing editable info pages.
//
// Features:
//   - List all pages (active + drafts)
//   - Create new page (Dialog)
//   - Edit existing page (Dialog)
//   - Reorder via up/down arrows
//   - Toggle publish status
//   - Toggle "show in menu"
//   - Delete with confirmation
//   - HTML content editor (Textarea + preview)
//   - Image attachments (optional)
//   - Slug, title, subtitle, icon, metaDescription
// ============================================================================

// Available lucide-react icon names for the page icon picker.
// Limited to a sensible subset; admin can also type a custom name.
const ICON_OPTIONS = [
  { id: 'FileText', label: 'Документ' },
  { id: 'Info', label: 'Информация' },
  { id: 'Shield', label: 'Щит' },
  { id: 'Cookie', label: 'Cookie' },
  { id: 'UserCheck', label: 'Пользователь' },
  { id: 'Mail', label: 'Почта' },
  { id: 'HelpCircle', label: 'Помощь' },
  { id: 'Building2', label: 'Здание' },
  { id: 'Phone', label: 'Телефон' },
  { id: 'Lock', label: 'Замок' },
  { id: 'BookOpen', label: 'Книга' },
  { id: 'AlertCircle', label: 'Внимание' },
]

export function InfoPagesManager() {
  const [items, setItems] = useState<InfoPage[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<InfoPage | null>(null)
  const [creating, setCreating] = useState(false)
  // v25.6 (Task #6): when the admin clicks a legal-doc shortcut (privacy/
  // terms/rules) and the page doesn't exist yet, we pre-seed the editor
  // with the slug + a default title so the admin only needs to enter content.
  const [presetSlug, setPresetSlug] = useState<string | null>(null)
  const [presetTitle, setPresetTitle] = useState<string>('')
  const [moving, setMoving] = useState(false)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [menuTogglingId, setMenuTogglingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
const { dialog: confirmDlg, confirm: openConfirm, close: closeConfirm } = useConfirmDialog()

  // v25.6 (Task #6): open the editor pre-filled with a slug + title for one
  // of the 3 system legal documents (privacy / terms / rules). Used when
  // the page doesn't exist yet — the admin clicks the shortcut card and
  // the editor opens with the slug locked in.
  const setCreatingWithSlug = useCallback((slug: string, title: string, _desc?: string) => {
    setPresetSlug(slug)
    setPresetTitle(title)
    setCreating(true)
  }, [])

  const refresh = useCallback(() => {
    setLoading(true)
    api.get<{ items: InfoPage[] }>('/api/info-pages/all', { auth: true })
      .then((d) => setItems(d.items))
      .catch((e) => {
        console.error('[info-pages-manager] refresh failed:', e)
        setItems([])
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const handleDelete = (id: string) => {
    if (deletingId) return
    openConfirm({
      title: 'Удалить страницу?',
      message: 'Это действие нельзя отменить. Страница будет удалена навсегда.',
      confirmLabel: 'Удалить',
      variant: 'danger',
      onConfirm: async () => {
        setDeletingId(id)
        try {
          await api.delete(`/api/info-pages/${id}`, { auth: true })
          setItems((cur) => cur.filter((p) => p.id !== id))
          toast.success('Страница удалена')
        } catch (e: unknown) {
          toast.error('Ошибка', { description: e instanceof Error ? e.message : String(e) })
        } finally {
          setDeletingId(null)
        }
      },
    })
  }

  const togglePublished = async (p: InfoPage) => {
    if (togglingId) return
    setTogglingId(p.id)
    try {
      await api.patch(`/api/info-pages/${p.id}`, { json: { isPublished: !p.isPublished }, auth: true })
      setItems((cur) => cur.map((x) => x.id === p.id ? { ...x, isPublished: !x.isPublished } : x))
    } catch (e: unknown) {
      toast.error('Ошибка', { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setTogglingId(null)
    }
  }

  const toggleMenu = async (p: InfoPage) => {
    if (menuTogglingId) return
    setMenuTogglingId(p.id)
    try {
      await api.patch(`/api/info-pages/${p.id}`, { json: { showInMenu: !p.showInMenu }, auth: true })
      setItems((cur) => cur.map((x) => x.id === p.id ? { ...x, showInMenu: !x.showInMenu } : x))
    } catch (e: unknown) {
      toast.error('Ошибка', { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setMenuTogglingId(null)
    }
  }

  const move = async (p: InfoPage, dir: -1 | 1) => {
    if (moving) return
    const idx = items.findIndex((x) => x.id === p.id)
    const target = idx + dir
    if (target < 0 || target >= items.length) return
    const next = [...items]
    ;[next[idx], next[target]] = [next[target], next[idx]]
    const reordered = next.map((x, i) => ({ id: x.id, order: i }))
    setItems(next)
    setMoving(true)
    try {
      await api.post('/api/info-pages/reorder', { json: reordered, auth: true })
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
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">Информационные страницы</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {items.length} страниц · {items.filter((p) => p.isPublished).length} опубликовано · {items.filter((p) => p.showInMenu).length} в меню
          </p>
        </div>
        <Button
          onClick={() => {
            // v25.6: clear any preset slug/title so the "Add" button starts
            // a clean new page (not pre-filled with a legal-doc slug).
            setPresetSlug(null)
            setPresetTitle('')
            setCreating(true)
          }}
          className="rounded-full gradient-brand text-white shadow-glow h-11 px-5"
        >
          <Plus className="h-4 w-4" /> Добавить
        </Button>
      </div>

      <div className="glass rounded-2xl p-3 mb-4 text-xs text-muted-foreground">
        <strong className="text-foreground">Как это работает:</strong> Создавайте и редактируйте информационные страницы (Политика, О приложении, Контакты и т.д.).
        Изменения применяются мгновенно в приложении. Slug — это URL страницы: <code className="font-mono text-primary">/info/&lt;slug&gt;</code>.
        Содержимое поддерживает HTML (заголовки, списки, ссылки).
      </div>

      {/* v25.6 (Task #6): Quick-access shortcuts to the 3 system legal documents.
          These are not separate entities — they're regular info pages with
          reserved slugs (privacy / terms / rules) that the app's PrivacyView
          loads dynamically. Clicking opens the existing editor on that page. */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
        {[
          { slug: 'privacy', title: 'Политика конфиденциальности', desc: 'Сбор, использование, защита данных', icon: ShieldIcon },
          { slug: 'terms',   title: 'Пользовательское соглашение',  desc: 'Права и обязанности сторон',     icon: FileText },
          { slug: 'rules',   title: 'Правила сервиса',              desc: 'Правила поведения на платформе', icon: BookOpenIcon },
        ].map((doc) => {
          const page = items.find((p) => p.slug === doc.slug)
          return (
            <button
              key={doc.slug}
              onClick={() => {
                if (page) {
                  setEditing(page)
                } else {
                  toast.info('Страница будет создана из шаблона при первом сохранении', {
                    description: `Slug: ${doc.slug}`,
                  })
                  // Pre-fill the editor with the slug so the admin only needs
                  // to enter the title + content. We simulate a "new page"
                  // with the slug pre-set.
                  setCreatingWithSlug(doc.slug, doc.title, doc.desc)
                }
              }}
              className="glass rounded-2xl p-4 text-left hover:bg-accent/40 active:bg-accent/60 transition-colors group"
            >
              <div className="flex items-start gap-3">
                <div className="h-10 w-10 rounded-xl gradient-brand grid place-items-center text-white shrink-0">
                  <doc.icon className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-sm">{doc.title}</div>
                  <div className="text-xs text-muted-foreground truncate">{doc.desc}</div>
                  <div className="text-[10px] text-muted-foreground/70 mt-1">
                    {page ? (
                      <>Обновлено: {new Date(page.updatedAt).toLocaleDateString('ru-RU')}</>
                    ) : (
                      <span className="text-amber-600 dark:text-amber-400">Не создано — нажмите чтобы создать</span>
                    )}
                  </div>
                </div>
              </div>
            </button>
          )
        })}
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-20 rounded-2xl skeleton" />)}
        </div>
      ) : items.length === 0 ? (
        <div className="py-16 text-center">
          <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
          <p className="text-muted-foreground mb-4">Нет информационных страниц</p>
          <Button
            onClick={() => {
              setPresetSlug(null)
              setPresetTitle('')
              setCreating(true)
            }}
            className="rounded-full gradient-brand text-white"
          >
            <Plus className="h-4 w-4" /> Создать первую
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((p, idx) => (
            <div key={p.id} className="rounded-2xl glass overflow-hidden animate-fade-in-up">
              <div className="p-4 flex items-start gap-3">
                <div className="flex flex-col items-center gap-1 pt-1">
                  <GripVertical className="h-4 w-4 text-muted-foreground/50" />
                  <span className="text-xs text-muted-foreground font-mono">#{idx + 1}</span>
                </div>
                <div className="h-10 w-10 rounded-xl gradient-brand grid place-items-center text-white shrink-0">
                  <FileText className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="font-bold text-base truncate">{p.title}</div>
                    <Badge variant={p.isPublished ? 'success' : 'destructive'} className="text-[10px]">
                      {p.isPublished ? 'Опубл.' : 'Черновик'}
                    </Badge>
                    {p.showInMenu && (
                      <Badge variant="outline" className="text-[10px]">
                        <Menu className="h-3 w-3 mr-1" /> В меню
                      </Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5 truncate">
                    <code className="font-mono text-primary">/info/{p.slug}</code>
                    {p.subtitle && <span className="ml-2">· {p.subtitle}</span>}
                  </div>
                  {p.metaDescription && (
                    <div className="text-xs text-muted-foreground/70 mt-1 line-clamp-1">
                      SEO: {p.metaDescription}
                    </div>
                  )}
                  <div className="text-[10px] text-muted-foreground/60 mt-1">
                    Обновлено: {new Date(p.updatedAt).toLocaleString('ru-RU')}
                  </div>
                </div>
              </div>
              <div className="px-2 py-2 flex items-center gap-1 border-t border-border/40">
                <Button variant="ghost" size="icon" className="rounded-full h-9 w-9" onClick={() => move(p, -1)} disabled={idx === 0} aria-label="Вверх">
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" className="rounded-full h-9 w-9" onClick={() => move(p, 1)} disabled={idx === items.length - 1} aria-label="Вниз">
                  <ArrowDown className="h-4 w-4" />
                </Button>
                <div className="flex-1" />
                <Button variant="ghost" size="icon" className="rounded-full h-9 w-9" onClick={() => toggleMenu(p)} aria-label="Показ в меню" title={p.showInMenu ? 'Скрыть из меню' : 'Показывать в меню'}>
                  {p.showInMenu ? <Menu className="h-4 w-4" /> : <EyeIcon className="h-4 w-4 opacity-40" />}
                </Button>
                <Button variant="ghost" size="icon" className="rounded-full h-9 w-9" onClick={() => togglePublished(p)} aria-label="Видимость" title={p.isPublished ? 'Скрыть (в черновик)' : 'Опубликовать'}>
                  {p.isPublished ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                </Button>
                <a
                  href={`/info/${p.slug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center h-9 w-9 rounded-full hover:bg-accent transition-colors"
                  aria-label="Открыть в приложении"
                  title="Открыть в приложении"
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
                <Button variant="ghost" size="icon" className="rounded-full h-9 w-9" onClick={() => setEditing(p)} aria-label="Редактировать">
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" className="rounded-full h-9 w-9 text-destructive" onClick={() => handleDelete(p.id)} aria-label="Удалить">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {(editing || creating) && (
        <InfoPageEditor
          page={editing}
          presetSlug={creating ? presetSlug : null}
          presetTitle={creating ? presetTitle : ''}
          onClose={() => {
            setEditing(null)
            setCreating(false)
            setPresetSlug(null)
            setPresetTitle('')
          }}
          onSaved={() => {
            setEditing(null)
            setCreating(false)
            setPresetSlug(null)
            setPresetTitle('')
            refresh()
          }}
        />
      )}

      <StudioConfirmDialog dialog={confirmDlg} onClose={closeConfirm} />
    </div>
  )
}

// ============================================================================
// InfoPageEditor — Dialog for creating/editing an info page.
// ============================================================================

function InfoPageEditor({
  page,
  presetSlug,
  presetTitle,
  onClose,
  onSaved,
}: {
  page: InfoPage | null
  // v25.6 (Task #6): when creating a new page from a legal-doc shortcut,
  // these pre-fill the slug + title fields (slug is locked, can't be edited).
  presetSlug?: string | null
  presetTitle?: string
  onClose: () => void
  onSaved: () => void
}) {
  const [slug, setSlug] = useState(page?.slug || presetSlug || '')
  const [title, setTitle] = useState(page?.title || presetTitle || '')
  const [subtitle, setSubtitle] = useState(page?.subtitle || '')
  const [content, setContent] = useState(page?.content || '')
  // v25.6: choose icon based on presetSlug (privacy→Shield, terms/rules→FileText).
  const defaultIcon = presetSlug === 'privacy' ? 'Shield' : 'FileText'
  const [icon, setIcon] = useState(page?.icon || defaultIcon)
  const [customIcon, setCustomIcon] = useState(!ICON_OPTIONS.some((o) => o.id === (page?.icon || defaultIcon)))
  const [images, setImages] = useState<string[]>(page?.images || [])
  const [isPublished, setIsPublished] = useState(page?.isPublished ?? true)
  const [showInMenu, setShowInMenu] = useState(page?.showInMenu ?? true)
  const [metaDescription, setMetaDescription] = useState(page?.metaDescription || '')
  const [saving, setSaving] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
// Auto-generate slug from title (only for new pages, when slug is empty
// AND there's no preset slug from a legal-doc shortcut).
  useEffect(() => {
    if (!page && !slug && !presetSlug && title) {
      // Транслитерация базовая — заменяем пробелы на дефисы, lowercase
      const generated = title
        .toLowerCase()
        .replace(/[^a-z0-9а-яё\s-]/gi, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
      if (generated) setSlug(generated)
    }
  }, [title, slug, page, presetSlug])

  const save = async () => {
    if (!title.trim()) return toast.error('Введите заголовок')
    if (!slug.trim()) return toast.error('Введите slug (URL)')
    if (!/^[a-z0-9][a-z0-9-]{0,99}$/.test(slug)) {
      return toast.error('Некорректный slug', { description: 'Только латинские буквы (a-z)' })
    }
    setSaving(true)
    try {
      const body = {
        slug: slug.trim(),
        title: title.trim(),
        subtitle: subtitle.trim() || null,
        content,
        images,
        icon: customIcon ? icon.trim() || 'FileText' : icon,
        isPublished,
        showInMenu,
        metaDescription: metaDescription.trim() || null,
      }
      if (page) {
        await api.patch(`/api/info-pages/${page.id}`, { json: body, auth: true })
        toast.success('Страница обновлена')
      } else {
        await api.post('/api/info-pages', { json: body, auth: true })
        toast.success('Страница создана')
      }
      onSaved()
    } catch (e: unknown) {
      toast.error('Ошибка', { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={true} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-2xl rounded-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{page ? 'Редактировать страницу' : 'Новая информационная страница'}</DialogTitle>
          <DialogDescription>
            Страница будет доступна в приложении по адресу <code className="font-mono text-primary">/info/{slug || '<slug>'}</code>
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {/* Title */}
          <div className="space-y-1.5">
            <Label htmlFor="title">Заголовок *</Label>
            <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} className="rounded-2xl" placeholder="Политика конфиденциальности" />
          </div>

          {/* Slug */}
          <div className="space-y-1.5">
            <Label htmlFor="slug">Slug (URL) *</Label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground font-mono">/info/</span>
              <Input
                id="slug"
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                className="rounded-2xl flex-1 font-mono"
                placeholder="privacy"
                // v25.6: disabled when editing an existing page OR when the
                // slug was pre-set from a legal-doc shortcut (presetSlug).
                disabled={!!page || !!presetSlug}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Только латиница (a-z), цифры и дефисы. После создания slug нельзя изменить.
              {presetSlug && (
                <span className="block mt-1 text-primary font-medium">
                  Системный slug для юридического документа.
                </span>
              )}
            </p>
          </div>

          {/* Subtitle */}
          <div className="space-y-1.5">
            <Label htmlFor="subtitle">Подзаголовок (необязательно)</Label>
            <Input id="subtitle" value={subtitle} onChange={(e) => setSubtitle(e.target.value)} className="rounded-2xl" placeholder="Как мы обрабатываем ваши данные" />
          </div>

          {/* Icon picker */}
          <div className="space-y-1.5">
            <Label>Иконка (для меню и списка)</Label>
            <div className="flex flex-wrap gap-2">
              {ICON_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => { setIcon(opt.id); setCustomIcon(false) }}
                  className={cn(
                    'rounded-xl px-3 py-2 text-xs font-medium border-2 transition-all',
                    !customIcon && icon === opt.id
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border/40 text-muted-foreground hover:bg-accent/40',
                  )}
                >
                  {opt.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setCustomIcon(true)}
                className={cn(
                  'rounded-xl px-3 py-2 text-xs font-medium border-2 transition-all',
                  customIcon ? 'border-primary bg-primary/10 text-primary' : 'border-border/40 text-muted-foreground hover:bg-accent/40',
                )}
              >
                Своя…
              </button>
            </div>
            {customIcon && (
              <Input
                value={icon}
                onChange={(e) => setIcon(e.target.value)}
                className="rounded-2xl font-mono text-sm"
                placeholder="IconName (lucide-react)"
              />
            )}
            <p className="text-xs text-muted-foreground">
              Имя иконки из <code className="font-mono">lucide-react</code> (например: Shield, FileText, Cookie, Mail).
            </p>
          </div>

          {/* Content (HTML) */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="content">Содержимое (HTML)</Label>
              <button
                type="button"
                onClick={() => setShowPreview((v) => !v)}
                className="text-xs text-primary font-semibold hover:underline"
              >
                {showPreview ? '← Редактор' : 'Предпросмотр →'}
              </button>
            </div>
            {showPreview ? (
              <div
                className="glass rounded-2xl p-4 prose prose-sm dark:prose-invert max-w-none min-h-[200px]"
                dangerouslySetInnerHTML={{ __html: content || '<p class="text-muted-foreground">Пусто</p>' }}
              />
            ) : (
              <Textarea
                id="content"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="rounded-2xl font-mono text-sm min-h-[280px] resize-y"
                placeholder={'<h2>Заголовок</h2>\n<p>Текст страницы...</p>\n<ul>\n  <li>Пункт 1</li>\n  <li>Пункт 2</li>\n</ul>'}
              />
            )}
            <p className="text-xs text-muted-foreground">
              Поддерживается HTML: <code className="font-mono">&lt;h2&gt;</code>, <code className="font-mono">&lt;p&gt;</code>, <code className="font-mono">&lt;ul&gt;</code>, <code className="font-mono">&lt;ol&gt;</code>, <code className="font-mono">&lt;strong&gt;</code>, <code className="font-mono">&lt;a href="..."&gt;</code>.
            </p>
          </div>

          {/* Images (optional) */}
          <div className="space-y-1.5">
            <Label>Изображения (необязательно)</Label>
            <ImageUploader value={images} onChange={setImages} aspect="free" label="Изображения для страницы" />
            <p className="text-xs text-muted-foreground">
              Можно загрузить до 20 изображений. Они будут отображаться в теле страницы.
            </p>
          </div>

          {/* Meta description (SEO) */}
          <div className="space-y-1.5">
            <Label htmlFor="metaDescription">SEO meta description (необязательно)</Label>
            <Textarea
              id="metaDescription"
              value={metaDescription}
              onChange={(e) => setMetaDescription(e.target.value)}
              className="rounded-2xl text-sm min-h-[60px]"
              placeholder="Краткое описание для поисковых систем (до 160 символов)"
              maxLength={500}
            />
          </div>

          {/* Toggles */}
          <div className="glass rounded-2xl p-3 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">Опубликована</div>
                <div className="text-xs text-muted-foreground">
                  {isPublished ? 'Видна пользователям в приложении' : 'Скрыта (черновик)'}
                </div>
              </div>
              <Switch checked={isPublished} onCheckedChange={setIsPublished} />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">Показывать в меню «Ещё»</div>
                <div className="text-xs text-muted-foreground">
                  {showInMenu ? 'Отображается в боковом меню приложения' : 'Доступна только по прямой ссылке'}
                </div>
              </div>
              <Switch checked={showInMenu} onCheckedChange={setShowInMenu} />
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-2 sticky bottom-0 bg-background/80 backdrop-blur p-2 -mx-2 rounded-2xl">
            <Button variant="outline" className="flex-1 rounded-full h-11" onClick={onClose}>Отмена</Button>
            <Button className="flex-1 rounded-full gradient-brand text-white shadow-glow h-11" onClick={save} disabled={saving}>
              {saving ? 'Сохранение…' : 'Сохранить'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
