'use client'

import { useState, useRef, useEffect } from 'react'
import { FileText, Image as ImageIcon, Video, File, Download } from 'lucide-react'
import { cn } from '@/lib/utils'
import { assetUrl } from '@/lib/api'
import { formatBytes } from '@/lib/format'
import { haptic } from '@/lib/haptic'
import type { Attachment } from '@/lib/types'

// ============================================================================
// AttachmentGroup — v12 multi-file message card.
//
// Renders a group of attachments (photos, videos, documents, mixed) as a
// single beautiful card instead of separate messages. The card adapts its
// layout based on the attachment types:
//
//   • Photos only (1)        → single large photo (PhotoGrid)
//   • Photos only (2+)       → gallery: big photo + horizontal thumbnail
//                              strip (PhotoGallery) — v12.2
//   • Documents only         → vertical list with file icons + names
//   • Mixed                  → summary card with counts per type
//
// When the user taps a photo, the gallery lightbox opens (handled by parent).
// When the user taps a document, it downloads directly.
// ============================================================================

interface AttachmentGroupProps {
  attachments: Attachment[]
  isOwn: boolean
  onImageClick?: (imageUrl: string) => void
}

export function AttachmentGroup({ attachments, isOwn, onImageClick }: AttachmentGroupProps) {
  const images = attachments.filter((a) => a.type === 'image')
  const videos = attachments.filter((a) => a.type === 'video')
  const documents = attachments.filter((a) => a.type === 'file')
  const audios = attachments.filter((a) => a.type === 'audio')

  // Pure photo group — gallery layout
  // v12-multi-gallery: for 2+ photos use the new gallery layout
  // (one big photo + horizontal thumbnail strip). For single photo keep
  // the original large photo rendering.
  if (images.length > 0 && videos.length === 0 && documents.length === 0 && audios.length === 0) {
    if (images.length === 1) {
      return <PhotoGrid photos={images} isOwn={isOwn} onImageClick={onImageClick} />
    }
    return <PhotoGallery photos={images} isOwn={isOwn} onImageClick={onImageClick} />
  }

  // Pure document group — vertical list
  if (documents.length > 0 && images.length === 0 && videos.length === 0 && audios.length === 0) {
    return <DocumentList docs={documents} isOwn={isOwn} />
  }

  // Mixed or other combinations — summary card
  return <MixedSummary images={images} videos={videos} documents={documents} audios={audios} isOwn={isOwn} onImageClick={onImageClick} />
}

// ============================================================================
// PhotoGrid — single-photo card (large).
// v12-multi-gallery: previously handled 1-5+ photos as a grid; now multi-photo
// layouts are rendered by PhotoGallery below. Only the single-photo case
// remains here (used directly by AttachmentGroup for count===1).
// ============================================================================
function PhotoGrid({ photos, isOwn, onImageClick }: {
  photos: Attachment[]
  isOwn: boolean
  onImageClick?: (imageUrl: string) => void
}) {
  return (
    <div className="relative rounded-[20px] overflow-hidden" style={{ maxWidth: 280 }}>
      <button
        onClick={() => onImageClick?.(photos[0].url)}
        className="block w-full"
        aria-label="Открыть фото"
      >
        <img
          src={assetUrl(photos[0].url)}
          alt="Фото"
          className="w-full h-auto max-h-80 object-cover cursor-zoom-in"
          loading="lazy"
          decoding="async"
        />
      </button>
    </div>
  )
}

// ============================================================================
// PhotoGallery — v12 multi-photo gallery card (NEW).
//
// Design (matches the reference mockup and the existing 999 — Три девятки visual
// language):
//
//   ┌─────────────────────────────┐
//   │                             │
//   │       BIG PHOTO             │   ← first photo (or selected)
//   │       (tap → lightbox)      │
//   │                             │
//   ├─────────────────────────────┤
//   │ ▓ │ ▒ │ ▒ │ ▒ │ ▒ │ ▒ │ ▒  │   ← horizontal thumbnail strip
//   └─────────────────────────────┘
//
//   • Big photo is the same width as the chat bubble (maxWidth 320).
//   • Thumbnail strip is horizontally scrollable, ~64px square thumbs
//     with 6px gap, rounded-xl corners.
//   • Active thumbnail has a 2px gradient-brand border (firmennaya ramka).
//   • Tapping a thumbnail swaps the big photo instantly (no animation).
//   • Tapping the big photo opens the fullscreen lightbox at the
//     currently selected index (via onImageClick).
//   • Haptic feedback on thumbnail selection (respects user preference).
//
// No outer card/border — the gallery sits flush in the chat bubble like
// the existing single-photo message. The thumbnail strip is part of the
// same visual unit, not a separate card.
// ============================================================================
function PhotoGallery({ photos, isOwn, onImageClick }: {
  photos: Attachment[]
  isOwn: boolean
  onImageClick?: (imageUrl: string) => void
}) {
  const [activeIndex, setActiveIndex] = useState(0)
  const stripRef = useRef<HTMLDivElement>(null)
  const thumbRefs = useRef<(HTMLButtonElement | null)[]>([])

  // Keep activeIndex in range if photos array changes identity
  useEffect(() => {
    if (activeIndex >= photos.length) setActiveIndex(0)
  }, [photos.length, activeIndex])

  // Scroll the active thumbnail into view (smooth, non-aggressive)
  useEffect(() => {
    // Keep the ref array sized to the photos array (no sparse null slots).
    thumbRefs.current.length = photos.length
    const el = thumbRefs.current[activeIndex]
    if (!el || !stripRef.current) return
    const container = stripRef.current
    const elLeft = el.offsetLeft
    const elRight = elLeft + el.offsetWidth
    const viewLeft = container.scrollLeft
    const viewRight = viewLeft + container.clientWidth
    if (elLeft < viewLeft + 8 || elRight > viewRight - 8) {
      container.scrollTo({
        left: elLeft - container.clientWidth / 2 + el.offsetWidth / 2,
        behavior: 'smooth',
      })
    }
  }, [activeIndex, photos.length])

  const selectThumb = (i: number) => {
    if (i === activeIndex) return
    haptic.select()
    setActiveIndex(i)
  }

  const active = photos[activeIndex]
  if (!active) return null

  return (
    <div
      className="rounded-[20px] overflow-hidden flex flex-col"
      style={{ maxWidth: 320, width: 280 }}
    >
      {/* Big photo — tap opens lightbox at this index */}
      <button
        type="button"
        onClick={() => onImageClick?.(active.url)}
        className="block relative w-full overflow-hidden"
        aria-label={`Открыть фото ${activeIndex + 1} из ${photos.length}`}
        style={{ aspectRatio: '1 / 1' }}
      >
        <img
          src={assetUrl(active.url)}
          alt={`Фото ${activeIndex + 1}`}
          className="absolute inset-0 w-full h-full object-cover cursor-zoom-in"
          loading={activeIndex === 0 ? 'eager' : 'lazy'}
          decoding="async"
          draggable={false}
        />
        {/* Counter chip — top-right corner of big photo (subtle, glass) */}
        <div
          className="absolute top-2 right-2 text-[10px] font-semibold px-2 py-0.5 rounded-full backdrop-blur-md text-white"
          style={{ background: 'rgba(0,0,0,0.45)' }}
        >
          {activeIndex + 1} / {photos.length}
        </div>
      </button>

      {/* Thumbnail strip — horizontally scrollable, flush with big photo */}
      <div
        ref={stripRef}
        className="no-scrollbar flex gap-1.5 overflow-x-auto py-2 px-2 scroll-px-2"
        style={{
          background: isOwn
            ? 'linear-gradient(180deg, rgba(56,189,248,0.10), rgba(124,58,237,0.08))'
            : 'linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02))',
        }}
        onWheel={(e) => {
          // Allow horizontal wheel scroll on desktop (trackpad / shift+wheel)
          if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
            e.currentTarget.scrollLeft += e.deltaY
          }
        }}
      >
        {photos.map((p, i) => {
          const isActive = i === activeIndex
          return (
            <button
              key={i}
              ref={(el) => { thumbRefs.current[i] = el }}
              type="button"
              onClick={() => selectThumb(i)}
              aria-label={`Фото ${i + 1}${isActive ? ' (текущая)' : ''}`}
              aria-current={isActive}
              className={cn(
                'relative shrink-0 rounded-xl overflow-hidden transition-transform',
                isActive ? 'ring-2 ring-offset-0' : 'opacity-70 hover:opacity-100',
              )}
              style={{
                width: 56,
                height: 56,
                // Use the project's brand gradient as the active border
                // (ring color), matching the firmennyy accent used elsewhere.
                ...(isActive
                  ? { boxShadow: '0 0 0 2px var(--primary), 0 0 0 4px rgba(0,0,0,0)' }
                  : {}),
              }}
            >
              <img
                src={assetUrl(p.url)}
                alt=""
                className="w-full h-full object-cover"
                loading="lazy"
                decoding="async"
                draggable={false}
              />
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ============================================================================
// DocumentList — vertical list of documents.
// ============================================================================
function DocumentList({ docs, isOwn }: { docs: Attachment[]; isOwn: boolean }) {
  const handleDownload = (doc: Attachment) => {
    const a = document.createElement('a')
    a.href = assetUrl(doc.url)
    a.download = doc.name || 'document'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  return (
    <div className="flex flex-col gap-1" style={{ minWidth: 260, maxWidth: 320 }}>
      {/* Header */}
      <div className={cn(
        'flex items-center gap-2 px-3 py-2 rounded-t-2xl',
        isOwn ? 'glass-message-outgoing' : 'glass-message-incoming',
      )}>
        <div className="h-9 w-9 rounded-xl bg-blue-500/15 grid place-items-center shrink-0">
          <FileText className="h-5 w-5 text-blue-500" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold">
            📁 Документы ({docs.length})
          </div>
          <div className="text-xs text-muted-foreground">
            {docs.reduce((sum, d) => sum + (d.size || 0), 0) > 0
              ? formatBytes(docs.reduce((sum, d) => sum + (d.size || 0), 0))
              : `${docs.length} файл(ов)`}
          </div>
        </div>
      </div>

      {/* Document items */}
      <div className={cn(
        'flex flex-col divide-y divide-border/20',
        isOwn ? 'glass-message-outgoing' : 'glass-message-incoming',
      )}>
        {docs.slice(0, 5).map((doc, i) => (
          <button
            key={i}
            onClick={() => handleDownload(doc)}
            className="flex items-center gap-2 px-3 py-2 hover:bg-foreground/5 transition-colors text-left"
          >
            <FileIconByExt name={doc.name || doc.url} />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium truncate">
                {doc.name || getFilenameFromUrl(doc.url)}
              </div>
              <div className="text-[10px] text-muted-foreground">
                {doc.size ? formatBytes(doc.size) : getExt(doc.name || doc.url)}
              </div>
            </div>
            <Download className="h-4 w-4 text-muted-foreground shrink-0" />
          </button>
        ))}
        {docs.length > 5 && (
          <div className="px-3 py-2 text-xs text-center text-muted-foreground">
            и ещё {docs.length - 5}…
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// MixedSummary — mixed attachments (photos + videos + documents).
// ============================================================================
function MixedSummary({ images, videos, documents, audios, isOwn, onImageClick }: {
  images: Attachment[]
  videos: Attachment[]
  documents: Attachment[]
  audios: Attachment[]
  isOwn: boolean
  onImageClick?: (imageUrl: string) => void
}) {
  const total = images.length + videos.length + documents.length + audios.length

  return (
    <div className="flex flex-col gap-1" style={{ minWidth: 260, maxWidth: 320 }}>
      {/* Header with counts */}
      <div className={cn(
        'flex items-center gap-2 px-3 py-2.5 rounded-2xl',
        isOwn ? 'glass-message-outgoing' : 'glass-message-incoming',
      )}>
        <div className="h-10 w-10 rounded-xl bg-violet-500/15 grid place-items-center shrink-0">
          <File className="h-5 w-5 text-violet-500" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold">Вложения ({total})</div>
          <div className="text-xs text-muted-foreground flex flex-wrap gap-x-2 gap-y-0.5 mt-0.5">
            {images.length > 0 && <span>📷 Фото: {images.length}</span>}
            {videos.length > 0 && <span>🎥 Видео: {videos.length}</span>}
            {documents.length > 0 && <span>📄 Док: {documents.length}</span>}
            {audios.length > 0 && <span>🎤 Аудио: {audios.length}</span>}
          </div>
        </div>
      </div>

      {/* Photo thumbnails (if any) — show first 4 as a grid */}
      {images.length > 0 && (
        <div className="grid grid-cols-2 gap-0.5 rounded-2xl overflow-hidden">
          {images.slice(0, 4).map((p, i) => (
            <button
              key={i}
              onClick={() => onImageClick?.(p.url)}
              className="block relative aspect-square overflow-hidden"
              aria-label={`Фото ${i + 1}`}
            >
              <img
                src={assetUrl(p.url)}
                alt={`Фото ${i + 1}`}
                className="w-full h-full object-cover cursor-zoom-in"
                loading="lazy"
              />
              {i === 3 && images.length > 4 && (
                <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                  <span className="text-white text-lg font-bold">+{images.length - 4}</span>
                </div>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Video list (if any) */}
      {videos.length > 0 && (
        <div className={cn(
          'flex flex-col divide-y divide-border/20 rounded-2xl',
          isOwn ? 'glass-message-outgoing' : 'glass-message-incoming',
        )}>
          {videos.slice(0, 3).map((v, i) => (
            <div key={i} className="flex items-center gap-2 px-3 py-2">
              <div className="h-8 w-8 rounded-lg bg-rose-500/15 grid place-items-center shrink-0">
                <Video className="h-4 w-4 text-rose-500" />
              </div>
              <div className="flex-1 min-w-0 text-xs truncate">
                {v.name || `Видео ${i + 1}`}
              </div>
              {v.duration && (
                <span className="text-[10px] text-muted-foreground">
                  {Math.floor(v.duration / 60)}:{String(v.duration % 60).padStart(2, '0')}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Document list (if any) */}
      {documents.length > 0 && (
        <div className={cn(
          'flex flex-col divide-y divide-border/20 rounded-2xl',
          isOwn ? 'glass-message-outgoing' : 'glass-message-incoming',
        )}>
          {documents.slice(0, 3).map((d, i) => (
            <a
              key={i}
              href={assetUrl(d.url)}
              download={d.name}
              className="flex items-center gap-2 px-3 py-2 hover:bg-foreground/5 transition-colors"
            >
              <FileIconByExt name={d.name || d.url} />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium truncate">
                  {d.name || getFilenameFromUrl(d.url)}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {d.size ? formatBytes(d.size) : getExt(d.name || d.url)}
                </div>
              </div>
              <Download className="h-4 w-4 text-muted-foreground shrink-0" />
            </a>
          ))}
          {documents.length > 3 && (
            <div className="px-3 py-1.5 text-xs text-center text-muted-foreground">
              и ещё {documents.length - 3}…
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Helpers
// ============================================================================
function getFilenameFromUrl(url: string): string {
  try {
    const u = new URL(url, window.location.origin)
    return u.pathname.split('/').pop() || 'file'
  } catch {
    return url.split('/').pop() || 'file'
  }
}

function getExt(name: string): string {
  const parts = name.split('.')
  return parts.length > 1 ? parts.pop()!.toUpperCase() : 'FILE'
}

function getFileColor(name: string): { bg: string; fg: string } {
  const ext = getExt(name).toLowerCase()
  if (['pdf'].includes(ext)) return { bg: 'bg-rose-500/15', fg: 'text-rose-500' }
  if (['doc', 'docx'].includes(ext)) return { bg: 'bg-blue-500/15', fg: 'text-blue-500' }
  if (['xls', 'xlsx'].includes(ext)) return { bg: 'bg-emerald-500/15', fg: 'text-emerald-500' }
  if (['zip', 'rar', '7z'].includes(ext)) return { bg: 'bg-amber-500/15', fg: 'text-amber-500' }
  if (['apk'].includes(ext)) return { bg: 'bg-green-500/15', fg: 'text-green-500' }
  return { bg: 'bg-slate-500/15', fg: 'text-slate-500' }
}

function FileIconByExt({ name }: { name: string }) {
  const { bg, fg } = getFileColor(name)
  const ext = getExt(name)
  return (
    <div className={cn('h-8 w-8 rounded-lg grid place-items-center shrink-0', bg)}>
      <span className={cn('text-[9px] font-bold', fg)}>{ext.slice(0, 4)}</span>
    </div>
  )
}
