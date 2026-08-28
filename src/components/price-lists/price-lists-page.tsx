'use client'

import { useState, useEffect } from 'react'
import { FileText, FileSpreadsheet, FileImage, File, Download, Eye, Calendar, Tag } from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { haptic } from '@/lib/haptic'
import { Loader2 } from 'lucide-react'
import { PriceListsViewer } from './price-lists-viewer'
import { ImageLightbox } from '../image-lightbox'

// v25.12: PriceListsPage — публичная страница со списком прайс-листов.
// Клиенты видят только видимые прайс-листы, могут просмотреть/скачать файл.
// v25.21 (owner): просмотр переделан — БОЛЬШЕ НЕТ window.open (на мобиле/PWA
// он давал белый экран без выхода). Все файлы открываются во встроенном
// полноэкранном PriceListsViewer каруселью: свайп между прайсами, PDF
// рендерится через pdf.js, у всего есть крестик/скачивание.
//
// v25.22 (owner): «картинки хочу КАК В ЛЕНТЕ — на весь экран, со свайпом
// и щипком, и PDF тоже». Теперь:
//  • тап по КАРТИНКЕ открывает ЛЕНТОВЫЙ ImageLightbox (тот самый, из ленты:
//    pinch-zoom, двойной тап, свайп вниз-закрыть, миниатюры внизу) — галерея
//    составлена из ВСЕХ картинок-прайсов, свайп листает между ними;
//  • PDF/Word/Excel — прежний просмотрщик-карусель (владельцу он нравится),
//    но страницы PDF теперь во всю ширину экрана, без рамок и скруглений —
//    тот же «лентовый» полноэкранный вид.

interface PriceList {
  id: string
  title: string
  description: string | null
  fileUrl: string
  fileType: string
  thumbnail: string | null
  category: string | null
  fileSize: number | null
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

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
  } catch { return '' }
}

interface PriceListsPageProps {
  onNavigate?: (v: string) => void
}

export function PriceListsPage({ onNavigate }: PriceListsPageProps) {
  const [items, setItems] = useState<PriceList[]>([])
  const [loading, setLoading] = useState(true)
  // v25.21: индекс открытого прайса в отфильтрованном списке (карусель).
  const [viewerIndex, setViewerIndex] = useState<number | null>(null)
  // v25.22: индекс открытой КАРТИНКИ в лентовом ImageLightbox.
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const [filterCategory, setFilterCategory] = useState<string | null>(null)

  useEffect(() => {
    api.get<{ items: PriceList[] }>('/api/price-lists')
      .then((d) => setItems(d.items || []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false))
  }, [])

  const categories = Array.from(new Set(items.map((i) => i.category).filter(Boolean))) as string[]
  const filtered = filterCategory ? items.filter((i) => i.category === filterCategory) : items

  // v25.22: картинки → лентовый лайтбокс; документы → карусель просмотрщика.
  const imageItems = filtered.filter((i) => i.fileType === 'image')
  const docItems = filtered.filter((i) => i.fileType !== 'image')

  const handleOpen = (item: PriceList) => {
    haptic.tap()
    if (item.fileType === 'image') {
      const idx = imageItems.findIndex((i) => i.id === item.id)
      if (idx >= 0) setLightboxIndex(idx)
      return
    }
    const idx = docItems.findIndex((i) => i.id === item.id)
    if (idx >= 0) setViewerIndex(idx)
  }

  if (loading) {
    return (
      <div className="px-4 md:px-6 pt-4 md:pt-6 pb-28 md:pb-12">
        <div className="max-w-4xl mx-auto">
          <div className="h-8 w-48 skeleton rounded-lg mb-4" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-32 skeleton rounded-2xl" />
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="px-4 md:px-6 pt-4 md:pt-6 pb-28 md:pb-12 page-top-padding">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-5">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
            <FileSpreadsheet className="h-3.5 w-3.5" />
            <span>Документы</span>
          </div>
          <h1 className="text-2xl md:text-4xl font-extrabold tracking-tight text-foreground">
            Прайс-листы
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {items.length > 0
              ? `${items.length} ${pluralize(items.length, 'документ', 'документа', 'документов')} доступно для скачивания`
              : 'Пока нет загруженных прайс-листов'}
          </p>
        </div>

        {/* Category filter */}
        {categories.length > 1 && (
          <div className="mb-5 flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1">
            <button
              onClick={() => { haptic.tap(); setFilterCategory(null) }}
              className={cn(
                'shrink-0 inline-flex items-center gap-1.5 h-9 px-4 rounded-full text-sm font-medium transition-all border',
                !filterCategory
                  ? 'bg-primary text-primary-foreground border-primary shadow-md'
                  : 'bg-card text-card-foreground border-border hover:border-primary/40',
              )}
            >
              Все
            </button>
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => { haptic.tap(); setFilterCategory(cat) }}
                className={cn(
                  'shrink-0 inline-flex items-center gap-1.5 h-9 px-4 rounded-full text-sm font-medium transition-all border',
                  filterCategory === cat
                    ? 'bg-primary text-primary-foreground border-primary shadow-md'
                    : 'bg-card text-card-foreground border-border hover:border-primary/40',
                )}
              >
                {cat}
              </button>
            ))}
          </div>
        )}

        {/* Empty state */}
        {items.length === 0 && (
          <div className="py-16 text-center rounded-2xl border border-dashed border-border">
            <div className="h-20 w-20 rounded-full bg-muted grid place-items-center mx-auto mb-4">
              <FileSpreadsheet className="h-10 w-10 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-bold mb-1">Прайс-листы скоро появятся</h3>
            <p className="text-sm text-muted-foreground">
              Админ ещё не загрузил прайс-листы. Загляните позже.
            </p>
          </div>
        )}

        {/* Grid of price lists */}
        {filtered.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
            {filtered.map((item) => {
              const Icon = FILE_TYPE_ICONS[item.fileType] || File
              const colorClass = FILE_TYPE_COLORS[item.fileType] || FILE_TYPE_COLORS.other
              return (
                <button
                  key={item.id}
                  onClick={() => handleOpen(item)}
                  className="group relative overflow-hidden rounded-2xl bg-card border border-border hover:border-primary/40 hover:shadow-[0_8px_24px_-8px_rgba(160,32,112,0.2)] transition-all text-left p-4 flex items-start gap-3"
                >
                  <div className={cn('h-14 w-14 rounded-2xl bg-gradient-to-br grid place-items-center text-white shadow-md shrink-0', colorClass)}>
                    <Icon className="h-7 w-7" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-sm md:text-base text-card-foreground truncate flex-1">
                        {item.title}
                      </h3>
                      <span className="px-1.5 py-0.5 rounded bg-foreground/5 text-[10px] font-medium text-muted-foreground shrink-0">
                        {FILE_TYPE_LABELS[item.fileType] || item.fileType}
                      </span>
                    </div>
                    {item.description && (
                      <p className="text-xs text-muted-foreground line-clamp-2 mb-2">
                        {item.description}
                      </p>
                    )}
                    <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                      {item.category && (
                        <span className="inline-flex items-center gap-1">
                          <Tag className="h-3 w-3" />
                          {item.category}
                        </span>
                      )}
                      {item.fileSize && (
                        <span>{formatFileSize(item.fileSize)}</span>
                      )}
                      <span className="inline-flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {formatDate(item.createdAt)}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <div className="h-8 w-8 rounded-lg bg-foreground/5 grid place-items-center text-muted-foreground" title="Открыть">
                      <Eye className="h-4 w-4" />
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        )}

        {/* CTA */}
        {items.length > 0 && (
          <div className="mt-8 rounded-3xl bg-gradient-to-br from-[#FFF5F7] to-[#FFE4EC] p-6 text-center">
            <h3 className="text-lg font-bold text-foreground mb-1">Не нашли нужный прайс?</h3>
            <p className="text-sm text-muted-foreground mb-4">Свяжитесь с нами — отправим актуальный прайс-лист напрямую</p>
            <button
              onClick={() => { haptic.tap(); onNavigate?.('contacts') }}
              className="inline-flex items-center gap-2 h-11 px-6 rounded-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-sm shadow-[0_6px_20px_-6px_rgba(160,32,112,0.5)] active:scale-95 transition-all"
            >
              Связаться с нами
            </button>
          </div>
        )}
      </div>

      {/* v25.22: КАРТИНКИ-прайсы открываются ЛЕНТОВЫМ лайтбоксом —
          ровно тот же просмотр, что в ленте: pinch-zoom, двойной тап,
          свайп между картинками, свайп вниз — закрыть, миниатюры внизу. */}
      {lightboxIndex !== null && imageItems.length > 0 && (
        <ImageLightbox
          images={imageItems.map((i) => i.fileUrl)}
          initialIndex={lightboxIndex}
          open
          onClose={() => setLightboxIndex(null)}
        />
      )}

      {/* v25.21: полноэкранный просмотрщик-карусель (PDF через pdf.js).
          v25.22: в карусели — только ДОКУМЕНТЫ (картинки ушли в лентовый
          лайтбокс выше), страницы PDF рендерятся full-bleed. */}
      {viewerIndex !== null && docItems.length > 0 && (
        <PriceListsViewer
          items={docItems.map((i) => ({
            id: i.id,
            title: i.title,
            description: i.description,
            fileUrl: i.fileUrl,
            fileType: i.fileType,
            category: i.category,
          }))}
          index={viewerIndex}
          onClose={() => setViewerIndex(null)}
          onIndexChange={setViewerIndex}
        />
      )}
    </div>
  )
}

function pluralize(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few
  return many
}
