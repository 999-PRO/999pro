'use client'

import { useState, useRef } from 'react'
import { Upload, X } from 'lucide-react'
import { api, assetUrl } from '@/lib/api'
import { cn } from '@/lib/utils'
import { compressImage } from '@/lib/compress-image'
import { toast } from '@/lib/notifications'

type FileKind = 'image' | 'video' | 'any'

interface ImageUploaderProps {
  /** Existing image URL(s) — string for single, string[] for multiple */
  value?: string | string[]
  onChange: (urls: string[]) => void
  multiple?: boolean
  /** Max number of files (only relevant when multiple=true) */
  max?: number
  label?: string
  aspect?: 'square' | 'video' | 'banner' | 'free'
  /**
   * What kind of files to accept.
   * - 'image' (default): PNG/JPG/WebP/GIF/AVIF
   * - 'video': MP4/WebM/MOV
   * - 'any': both images and videos (for stories/posts that can be either)
   */
  kind?: FileKind
}

const MAX_FILE_BYTES = 50 * 1024 * 1024 // 50 MB (matches backend limit)

const ACCEPT_BY_KIND: Record<FileKind, string> = {
  image: 'image/*',
  video: 'video/*',
  any: 'image/*,video/*',
}

const HINT_BY_KIND: Record<FileKind, string> = {
  image: 'PNG, JPG, WebP до 50 МБ',
  video: 'MP4, WebM, MOV до 50 МБ',
  any: 'PNG, JPG, WebP, MP4, WebM до 50 МБ',
}

function isVideoUrl(url: string): boolean {
  return /\.(mp4|webm|mov)(\?|$)/i.test(url)
}

/**
 * File uploader with preview.
 * Supports images and videos depending on the `kind` prop.
 */
export function ImageUploader({
  value,
  onChange,
  multiple = false,
  max = 8,
  label = 'Изображения',
  aspect = 'square',
  kind = 'image',
}: ImageUploaderProps) {
  const urls: string[] = Array.isArray(value) ? value : value ? [value] : []
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  // v13.2 (audit P1-9 fix): ref mirror of urls so the upload loop always
  // reads the latest value. Previously the loop captured `urls` at the
  // time handleFiles was called — if the parent state changed mid-batch
  // (e.g. user removed an item), the final onChange would overwrite the
  // parent's newer state with [...oldUrls, ...newUploads].
  const urlsRef = useRef(urls)
  urlsRef.current = urls
const aspectClass =
    aspect === 'square'
      ? 'aspect-square'
      : aspect === 'video'
        ? 'aspect-video'
        : aspect === 'banner'
          ? 'aspect-[3/1]'
          : 'aspect-auto'

  const validateFile = (file: File): string | null => {
    if (file.size > MAX_FILE_BYTES) {
      return `Файл «${file.name}» слишком большой (макс 50 МБ)`
    }
    const isImage = file.type.startsWith('image/')
    const isVideo = file.type.startsWith('video/')
    if (kind === 'image' && !isImage) return `«${file.name}» — не изображение`
    if (kind === 'video' && !isVideo) return `«${file.name}» — не видео`
    if (kind === 'any' && !isImage && !isVideo) return `«${file.name}» — неподдерживаемый тип`
    return null
  }

  const handleFiles = async (files: FileList | File[]) => {
    const arr = Array.from(files)
    if (!arr.length) return

    if (!multiple && arr.length > 1) {
      toast.error('Можно загрузить только один файл')
      return
    }

    if (urls.length + arr.length > max) {
      toast.error(`Максимум ${max} файлов`)
      return
    }

    // Client-side validation — fail fast before uploading
    const rejected: string[] = []
    const valid: File[] = []
    for (const file of arr) {
      const err = validateFile(file)
      if (err) rejected.push(err)
      else valid.push(file)
    }
    if (rejected.length) {
      toast.error(`Отклонено: ${rejected.length}`, { description: rejected.join('; ') })
      if (!valid.length) return
    }

    setUploading(true)
    try {
      // Compress images before upload. This is critical for mobile —
      // phone cameras produce 5-10MB photos that would otherwise be
      // stored and served at full resolution, causing:
      //   1. Slow page loads on mobile data
      //   2. High memory usage causing UI jank
      //   3. Product cards appearing "huge" while the browser struggles
      //      to decode a 4000×3000px image into a 170×227px card
      // Compression reduces to max 1280px wide, ~200-400KB — perfect for
      // display while being 10-20x smaller.
      const processed: File[] = []
      for (const file of valid) {
        if (file.type.startsWith('image/') && file.type !== 'image/gif') {
          try {
            const compressed = await compressImage(file, 1280, 0.8)
            processed.push(compressed)
          } catch (e) {
            // S-LOW-008: previously `catch {` — silent failure.
            // If compression fails, fall back to the original file, but
            // log the error so we can diagnose codec/Canvas issues.
            console.error('[image-uploader] compressImage failed, using original:', e)
            processed.push(file)
          }
        } else {
          // Videos and GIFs are uploaded as-is
          processed.push(file)
        }
      }

      // v13.1 (audit P1-6 fix): re-validate size AFTER compression.
      // Previously a 60MB DSLR JPEG was rejected before compression even
      // though compression would shrink it to ~3MB. Now we validate the
      // COMPRESSED file — if compression somehow didn't get it under
      // MAX_FILE_BYTES, we still reject, but legitimate photos that
      // compress well are accepted.
      const postCompressionRejected: string[] = []
      const postCompressionValid: File[] = []
      for (const file of processed) {
        if (file.size > MAX_FILE_BYTES) {
          postCompressionRejected.push(
            `Файл «${file.name}» слишком большой даже после сжатия (${Math.round(file.size / 1024 / 1024)} МБ, макс ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} МБ)`,
          )
        } else {
          postCompressionValid.push(file)
        }
      }
      if (postCompressionRejected.length) {
        toast.error(`Отклонено после сжатия: ${postCompressionRejected.length}`, { description: postCompressionRejected.join('; ') })
        if (!postCompressionValid.length) {
          setUploading(false)
          return
        }
      }
      // Replace processed with the post-compression-valid list
      processed.length = 0
      processed.push(...postCompressionValid)

      // Upload each processed file. If any fails, keep the successful ones.
      const uploaded: string[] = []
      const failed: string[] = []
      for (const file of processed) {
        try {
          const formData = new FormData()
          formData.append('file', file)
          const data = await api.post<{ url: string }>('/api/upload', {
            form: formData,
            auth: true,
          })
          uploaded.push(data.url)
        } catch (e: unknown) {
          failed.push(`${file.name}: ${(e instanceof Error ? e.message : String(e)) || 'ошибка'}`)
        }
      }

      if (uploaded.length) {
        // v13.3 (duplication fix): previously an in-loop onChange was
        // called after each upload, AND a final onChange was called after
        // the loop. By the time the final onChange ran, urlsRef.current
        // already contained the uploaded URLs (via the in-loop calls) —
        // so spreading both produced [url1, url2, url1, url2] (2x dup).
        // Repeated batches compounded the duplication ("sometimes more").
        //
        // Now we commit ONCE at the end. urlsRef.current is the user's
        // latest state (so mid-upload deletions are respected — the
        // original v13.2 concern), and `uploaded` holds only the new
        // files from this batch. Concatenating them is always correct.
        const next = multiple ? [...urlsRef.current, ...uploaded] : uploaded
        onChange(next)
        toast.success(`Загружено: ${uploaded.length}`)
      }
      if (failed.length) {
        toast.error(`Не удалось загрузить: ${failed.length}`, { description: failed.join('; ') })
      }
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const removeAt = (idx: number) => {
    const next = urls.filter((_, i) => i !== idx)
    onChange(next)
  }

  const moveItem = (from: number, to: number) => {
    if (to < 0 || to >= urls.length) return
    const next = [...urls]
    const [it] = next.splice(from, 1)
    next.splice(to, 0, it)
    onChange(next)
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium">{label}</label>
        {multiple && (
          <span className="text-xs text-muted-foreground">
            {urls.length} / {max}
          </span>
        )}
      </div>

      {/* Drop zone — v13.0 (audit P0-5 fix): keyboard accessible.
          Previously only mouse-click worked (div with onClick, no role/tabIndex/
          onKeyDown). Now keyboard users can Tab to focus and press Enter/Space
          to open the file picker (WCAG 2.1.1). */}
      <div
        role="button"
        tabIndex={0}
        aria-label="Загрузить изображение"
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files)
        }}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            inputRef.current?.click()
          }
        }}
        className={cn(
          'relative rounded-2xl border-2 border-dashed cursor-pointer transition-colors p-6 flex flex-col items-center justify-center gap-2 text-center outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          dragOver
            ? 'border-primary bg-primary/5'
            : 'border-border hover:border-primary/50 hover:bg-accent/30',
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT_BY_KIND[kind]}
          multiple={multiple}
          className="hidden"
          onChange={(e) => e.target.files?.length && handleFiles(e.target.files)}
        />
        <div className="h-12 w-12 rounded-full gradient-soft grid place-items-center">
          {uploading ? (
            <div className="h-5 w-5 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
          ) : (
            <Upload className="h-5 w-5 text-primary" />
          )}
        </div>
        <div className="text-sm font-medium">
          {uploading ? 'Загрузка…' : 'Нажмите или перетащите файлы'}
        </div>
        <div className="text-xs text-muted-foreground">{HINT_BY_KIND[kind]}</div>
      </div>

      {/* Preview grid */}
      {urls.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {urls.map((url, idx) => (
            <div
              key={idx}
              className={cn(
                'relative group rounded-xl overflow-hidden border border-border/60 bg-muted/30',
                aspectClass,
              )}
            >
              {isVideoUrl(url) ? (
                <video
                  src={assetUrl(url)}
                  className="w-full h-full object-cover"
                  muted
                  playsInline
                  preload="metadata"
                />
              ) : (
                <img
                  src={assetUrl(url)}
                  alt={`Медиа ${idx + 1}`}
                  className="w-full h-full object-cover"
                />
              )}
              {/* Remove */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  removeAt(idx)
                }}
                className="absolute top-1.5 right-1.5 h-7 w-7 rounded-full bg-black/60 text-white grid place-items-center hover:bg-destructive transition-colors opacity-0 group-hover:opacity-100"
                aria-label="Удалить"
              >
                <X className="h-3.5 w-3.5" />
              </button>
              {/* Order controls (multiple only) */}
              {multiple && urls.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      moveItem(idx, idx - 1)
                    }}
                    disabled={idx === 0}
                    className="absolute bottom-1.5 left-1.5 h-6 w-6 rounded-full bg-black/60 text-white grid place-items-center hover:bg-primary transition-colors disabled:opacity-30"
                    aria-label="Влево"
                  >
                    ←
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      moveItem(idx, idx + 1)
                    }}
                    disabled={idx === urls.length - 1}
                    className="absolute bottom-1.5 right-1.5 h-6 w-6 rounded-full bg-black/60 text-white grid place-items-center hover:bg-primary transition-colors disabled:opacity-30"
                    aria-label="Вправо"
                  >
                    →
                  </button>
                </>
              )}
              {/* Order badge */}
              {multiple && (
                <div className="absolute top-1.5 left-1.5 h-5 min-w-5 px-1 rounded-full bg-black/60 text-white text-[10px] font-bold grid place-items-center">
                  {idx + 1}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
