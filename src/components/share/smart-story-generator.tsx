'use client'

// ============================================================================
//  SmartStoryGenerator — generates branded 1080×1920 story images on canvas.
//  ----------------------------------------------------------------------------
//  For a product with N images, generates a series of N+1 stories:
//    Stories 1..N: one per product photo, with branded overlay
//    Story N+1: cover slide with price, QR, logo, CTA
//
//  Each story has:
//    • The product image as background (cropped to 1080×1920)
//    • A subtle dark gradient overlay (top + bottom) for text readability
//    • TRI999 logo top-left
//    • App tagline ("TRI999")
//    • A glass card with product title + price at the bottom
//    • Last story: large QR code + "Смотреть в TRI999" CTA
//
//  Outputs:
//    • PNG download (single story)
//    • Web Share API with files (Android Chrome — opens Instagram/FB stories)
//    • Zip of all stories (uses CompressionStream + a minimal zip builder)
// ============================================================================

import { useEffect, useState, useRef, useCallback } from 'react'
import { motion } from 'framer-motion'
import { X, ChevronLeft, ChevronRight, Download, Share2, Sparkles, Image as ImageIcon } from 'lucide-react'
import { toast } from '@/lib/notifications'
import { cn } from '@/lib/utils'
import { assetUrl } from '@/lib/api'
import { formatPrice } from '@/lib/format'
import { generateQrMatrix, drawQrToCanvas } from './qr-renderer'

interface ProductShare {
  id: string
  title: string
  description?: string | null
  price: number
  oldPrice?: number | null
  currency?: string
  images: string[]
  rating: number
  reviewsCount: number
}

interface Props {
  open: boolean
  onClose: () => void
  product: ProductShare
  shareUrl: string
  deepLinkUrl: string
  shortId: string
}

// v25.4 (share card audit): changed from 9:16 (1080×1920) to 3:4 (1080×1440).
// 3:4 is the standard portrait share-card ratio — fits Instagram feed (4:5 is
// 1080×1350, also acceptable), WhatsApp/Telegram link previews, and prints
// better on product cards. All downstream layout constants are re-tuned below.
const STORY_W = 1080
const STORY_H = 1440
const TAGLINE = 'TRI999'

export function SmartStoryGenerator({ open, onClose, product, shareUrl, deepLinkUrl, shortId }: Props) {
  const [stories, setStories] = useState<HTMLCanvasElement[]>([])
  const [activeIdx, setActiveIdx] = useState(0)
  const [loading, setLoading] = useState(true)
  const previewRef = useRef<HTMLCanvasElement>(null)

  // Generate all story canvases when opened.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setStories([])
    canvasesRef.current = []

    ;(async () => {
      try {
        const canvases: HTMLCanvasElement[] = []
        // One story per product image.
        for (let i = 0; i < product.images.length; i++) {
          if (cancelled) return
          const canvas = await renderProductStory({
            imageUrl: product.images[i],
            title: product.title,
            price: product.price,
            oldPrice: product.oldPrice,
            currency: product.currency,
            rating: product.rating,
            reviewsCount: product.reviewsCount,
            imageIndex: i,
            totalImages: product.images.length,
            shareUrl,
            isCover: false,
          })
          canvases.push(canvas)
        }
        // Final cover story with QR + CTA.
        if (!cancelled) {
          const cover = await renderProductStory({
            imageUrl: product.images[0],
            title: product.title,
            price: product.price,
            oldPrice: product.oldPrice,
            currency: product.currency,
            rating: product.rating,
            reviewsCount: product.reviewsCount,
            imageIndex: product.images.length,
            totalImages: product.images.length,
            shareUrl,
            deepLinkUrl,
            isCover: true,
          })
          canvases.push(cover)
        }
        if (!cancelled) {
          setStories(canvases)
          // P-MED-009: keep a ref to the canvases so the close handler can
          // release their backing-store memory. See the comment on
          // `canvasesRef` below for why we write here (not in a separate
          // effect synced from `stories`).
          canvasesRef.current = canvases
          setLoading(false)
        }
      } catch (e) {
        console.error('[SmartStory] Generation failed:', e)
        if (!cancelled) {
          toast.error('Не удалось создать Stories')
          setLoading(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [open, product, shareUrl, deepLinkUrl])

  // Render the active story to the preview canvas.
  useEffect(() => {
    if (!previewRef.current || !stories[activeIdx]) return
    const ctx = previewRef.current.getContext('2d')
    if (!ctx) return
    // Scale down to fit preview (preserves aspect ratio).
    const scale = previewRef.current.width / STORY_W
    previewRef.current.height = STORY_H * scale
    ctx.clearRect(0, 0, previewRef.current.width, previewRef.current.height)
    ctx.drawImage(stories[activeIdx], 0, 0, previewRef.current.width, previewRef.current.height)
  }, [stories, activeIdx])

  // Lock body scroll
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  // P-MED-009: Release canvas backing-store memory when the modal closes.
  // Each story canvas is 1080×1920×4 bytes ≈ 8 MB of GPU/bitmap memory. With
  // N+1 stories per product, a 5-image product holds ~48 MB in `stories`
  // state — and that memory was never released because `stories` was only
  // cleared on the NEXT open. Setting width/height to 0 forces the browser
  // to discard the backing store immediately (per spec), and clearing the
  // array drops the JS references so GC can collect the canvas objects.
  //
  // `canvasesRef` is set DIRECTLY by the generator effect below (not synced
  // from `stories` state). This is critical: if we did
  // `canvasesRef.current = stories` in a separate effect, the React Compiler
  // would still treat `canvasesRef.current` as state-tracked and flag the
  // `c.width = 0` mutation. By writing to the ref synchronously inside the
  // generator effect (alongside the `setStories` call), the ref never
  // aliases a state value through an effect dependency, so the compiler
  // treats it as an independent mutable container.
  const canvasesRef = useRef<HTMLCanvasElement[]>([])

  const handleClose = useCallback(() => {
    const canvases = canvasesRef.current
    // `canvasesRef` is an intentionally-mutable container for canvas DOM
    // nodes. The `react-hooks/immutability` rule fires because we wrote to
    // this ref in the generator effect, but the whole POINT of the ref is to
    // allow us to reach the canvases from this close handler (without
    // re-rendering) and release their GPU backing store. Suppression is the
    // only option short of leaking 8 MB × N+1 of GPU memory per modal open.
    /* eslint-disable-next-line react-hooks/immutability */
    canvasesRef.current = []
    for (const c of canvases) {
      if (c instanceof HTMLCanvasElement) {
        c.width = 0
        c.height = 0
      }
    }
    setStories([])
    setActiveIdx(0)
    onClose()
  }, [onClose])

  const downloadCurrent = useCallback(() => {
    if (!stories[activeIdx]) return
    stories[activeIdx].toBlob((blob) => {
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `999pro-story-${shortId}-${activeIdx + 1}.png`
      a.click()
      URL.revokeObjectURL(url)
      toast.success('Story сохранена')
    }, 'image/png')
  }, [stories, activeIdx, shortId])

  const shareCurrent = useCallback(async () => {
    if (!stories[activeIdx]) return
    if (typeof navigator === 'undefined' || !navigator.share) {
      toast.error('Web Share API не поддерживается')
      return
    }
    try {
      const blob: Blob = await new Promise((resolve) => {
        stories[activeIdx].toBlob((b) => resolve(b!), 'image/png')
      })
      const file = new File([blob], `999pro-${shortId}-${activeIdx + 1}.png`, { type: 'image/png' })
      const shareData: ShareData = {
        title: product.title,
        text: `${product.title} — ${formatPrice(product.price, product.currency)}\n${shareUrl}`,
      }
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        shareData.files = [file]
      }
      await navigator.share(shareData)
    } catch {
      // User cancelled
    }
  }, [stories, activeIdx, product.title, product.price, product.currency, shareUrl, shortId])

  if (!open) return null

  return (
    <motion.div
      className="fixed inset-0 z-[120] flex items-center justify-center p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="absolute inset-0 bg-black/80 backdrop-blur-md" onClick={handleClose} />

      <motion.div
        className="relative bg-white dark:bg-slate-950 rounded-3xl shadow-2xl overflow-hidden max-w-2xl w-full max-h-[92vh] flex flex-col"
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        transition={{ duration: 0.2 }}
      >
        {/* Header */}
        <div className="px-5 py-4 flex items-center justify-between border-b border-slate-200/60 dark:border-slate-800/60">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-fuchsia-500 via-pink-500 to-amber-500 grid place-items-center text-white">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <div className="font-bold text-sm leading-tight">Smart Story</div>
              <div className="text-xs text-slate-500">{product.images.length + 1} истории · 1080×1920</div>
            </div>
          </div>
          <button
            onClick={handleClose}
            aria-label="Закрыть"
            className="h-8 w-8 rounded-full bg-slate-100 dark:bg-slate-800 grid place-items-center hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="h-12 w-12 rounded-full border-4 border-pink-500/30 border-t-pink-500 animate-spin" />
              <p className="text-sm text-slate-500 mt-4">Генерация Stories с фирменным стилем TRI999…</p>
            </div>
          ) : (
            <div className="flex flex-col items-center">
              {/* Preview canvas — 9:16 aspect ratio, max height 480px */}
              <div className="relative">
                <canvas
                  ref={previewRef}
                  width={270}
                  className="rounded-2xl shadow-2xl"
                  style={{ aspectRatio: '3 / 4', height: 'auto', maxHeight: '60vh' }}
                />

                {/* Navigation arrows */}
                {stories.length > 1 && (
                  <>
                    <button
                      onClick={() => setActiveIdx((i) => (i - 1 + stories.length) % stories.length)}
                      aria-label="Предыдущая"
                      className="absolute left-2 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full bg-white/80 dark:bg-slate-900/80 backdrop-blur grid place-items-center hover:scale-105 transition-transform"
                    >
                      <ChevronLeft className="h-5 w-5" />
                    </button>
                    <button
                      onClick={() => setActiveIdx((i) => (i + 1) % stories.length)}
                      aria-label="Следующая"
                      className="absolute right-2 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full bg-white/80 dark:bg-slate-900/80 backdrop-blur grid place-items-center hover:scale-105 transition-transform"
                    >
                      <ChevronRight className="h-5 w-5" />
                    </button>
                  </>
                )}

                {/* Story counter */}
                <div className="absolute top-2 left-1/2 -translate-x-1/2 px-2.5 py-1 rounded-full bg-black/60 backdrop-blur text-white text-xs font-semibold">
                  {activeIdx + 1} / {stories.length}
                </div>
              </div>

              {/* Story thumbnails */}
              <div className="mt-4 flex gap-2 overflow-x-auto no-scrollbar max-w-full">
                {stories.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setActiveIdx(i)}
                    className={cn(
                      'shrink-0 h-16 w-9 rounded-md overflow-hidden border-2 transition-all',
                      i === activeIdx
                        ? 'border-pink-500 ring-2 ring-pink-500/30'
                        : 'border-transparent opacity-70 hover:opacity-100',
                    )}
                  >
                    <canvas
                      ref={(el) => {
                        if (el && stories[i]) {
                          const ctx = el.getContext('2d')
                          if (ctx) {
                            // v25.4: 3:4 thumbnails (was 36×64 for 9:16)
                            el.width = 36
                            el.height = 48
                            ctx.drawImage(stories[i], 0, 0, 36, 48)
                          }
                        }
                      }}
                      className="w-full h-full object-cover"
                    />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer with actions */}
        {!loading && (
          <div className="px-5 py-4 border-t border-slate-200/60 dark:border-slate-800/60 grid grid-cols-2 gap-2">
            <button
              onClick={downloadCurrent}
              className="h-11 rounded-2xl bg-slate-100 dark:bg-slate-800 text-sm font-semibold hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors flex items-center justify-center gap-1.5"
            >
              <Download className="h-4 w-4" /> Скачать PNG
            </button>
            <button
              onClick={shareCurrent}
              className="h-11 rounded-2xl bg-gradient-to-r from-fuchsia-500 via-pink-500 to-amber-500 text-white text-sm font-bold shadow-lg shadow-pink-500/30 hover:scale-[1.02] transition-transform flex items-center justify-center gap-1.5"
            >
              <Share2 className="h-4 w-4" /> Поделиться
            </button>
          </div>
        )}
      </motion.div>
    </motion.div>
  )
}

// ----------------------------------------------------------------------------
//  Story renderer — draws a single 1080×1920 story on a canvas.
// ----------------------------------------------------------------------------
async function renderProductStory(opts: {
  imageUrl: string
  title: string
  price: number
  oldPrice?: number | null
  currency?: string
  rating: number
  reviewsCount: number
  imageIndex: number
  totalImages: number
  shareUrl: string
  deepLinkUrl?: string
  isCover: boolean
}): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas')
  canvas.width = STORY_W
  canvas.height = STORY_H
  const ctx = canvas.getContext('2d')!

  // 1. Background — load product image and draw it covering the canvas.
  const img = await loadImage(assetUrl(opts.imageUrl))
  // Cover fit
  const scale = Math.max(STORY_W / img.width, STORY_H / img.height)
  const drawW = img.width * scale
  const drawH = img.height * scale
  const dx = (STORY_W - drawW) / 2
  const dy = (STORY_H - drawH) / 2
  ctx.drawImage(img, dx, dy, drawW, drawH)

  // 2. Gradient overlay (top + bottom) for text readability.
  // v25.12: changed from dark slate to pink-purple for brand consistency.
  const topGrad = ctx.createLinearGradient(0, 0, 0, 300)
  topGrad.addColorStop(0, 'rgba(88, 28, 135, 0.85)')
  topGrad.addColorStop(1, 'rgba(88, 28, 135, 0)')
  ctx.fillStyle = topGrad
  ctx.fillRect(0, 0, STORY_W, 300)

  const bottomGrad = ctx.createLinearGradient(0, STORY_H - 560, 0, STORY_H)
  bottomGrad.addColorStop(0, 'rgba(88, 28, 135, 0)')
  bottomGrad.addColorStop(0.5, 'rgba(88, 28, 135, 0.75)')
  bottomGrad.addColorStop(1, 'rgba(76, 29, 149, 0.95)')
  ctx.fillStyle = bottomGrad
  ctx.fillRect(0, STORY_H - 560, STORY_W, 560)

  // 3. Brand text top-left — just "TRI999" wordmark, no badge.
  ctx.fillStyle = '#ffffff'
  ctx.font = `800 36px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillText('TRI999', 60, 65)

  // 4. (tagline removed — TRI999 is already shown above)

  // 5. Image counter (top-right).
  if (opts.totalImages > 1 && !opts.isCover) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)'
    ctx.font = `600 28px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`
    ctx.textAlign = 'right'
    ctx.fillText(`${opts.imageIndex + 1} / ${opts.totalImages}`, STORY_W - 60, 75)
  }

  // 6. Glass card with product info at the bottom.
  if (opts.isCover) {
    // Cover slide — large QR + CTA
    drawCoverCard(ctx, opts)
  } else {
    // Regular slide — product title + price
    drawProductCard(ctx, opts)
  }

  return canvas
}

function drawProductCard(ctx: CanvasRenderingContext2D, opts: any) {
  // v25.4: re-tuned card dimensions for 1440px height (was 380/320 for 1920px).
  const cardX = 60
  const cardY = STORY_H - 320
  const cardW = STORY_W - 120
  const cardH = 260

  // Glass card — semi-transparent white with blur effect (canvas doesn't
  // have native backdrop-blur, so we approximate with a subtle gradient).
  ctx.save()
  roundRectPath(ctx, cardX, cardY, cardW, cardH, 28)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.12)'
  ctx.fill()
  // Border
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)'
  ctx.lineWidth = 2
  ctx.stroke()
  ctx.restore()

  // Title — v25.4: 42→36px font, 52→46 line height (proportional to shorter card)
  ctx.fillStyle = '#ffffff'
  ctx.font = `700 36px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  wrapText(ctx, opts.title, cardX + 28, cardY + 28, cardW - 56, 44, 2)

  // Rating row — v25.4: 145→120 (proportional)
  if (opts.rating > 0) {
    const starY = cardY + 120
    drawStars(ctx, cardX + 28, starY, 26, Math.round(opts.rating))
    ctx.fillStyle = '#fbbf24'
    ctx.font = `600 24px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`
    ctx.textAlign = 'left'
    ctx.fillText(`${opts.rating.toFixed(1)}`, cardX + 28 + 5 * 30 + 14, starY + 2)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)'
    ctx.font = `400 20px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`
    ctx.fillText(`· ${opts.reviewsCount} отзывов`, cardX + 28 + 5 * 30 + 70, starY + 4)
  }

  // Price — v25.4: 64→52px (proportional)
  const priceY = cardY + cardH - 80
  ctx.fillStyle = '#ffffff'
  ctx.font = `800 52px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`
  ctx.textAlign = 'left'
  ctx.fillText(formatPrice(opts.price, opts.currency), cardX + 28, priceY)

  if (opts.oldPrice && opts.oldPrice > opts.price) {
    const priceW = ctx.measureText(formatPrice(opts.price, opts.currency)).width
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)'
    ctx.font = `400 30px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`
    ctx.fillText(formatPrice(opts.oldPrice, opts.currency), cardX + 28 + priceW + 20, priceY + 18)
    // Strikethrough
    const oldPriceW = ctx.measureText(formatPrice(opts.oldPrice, opts.currency)).width
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(cardX + 28 + priceW + 20, priceY + 34)
    ctx.lineTo(cardX + 28 + priceW + 20 + oldPriceW, priceY + 34)
    ctx.stroke()
  }

  // CTA hint
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)'
  ctx.font = `500 22px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`
  ctx.textAlign = 'right'
  ctx.fillText('Открой в TRI999 →', cardX + cardW - 28, cardY + cardH - 44)
}

function drawCoverCard(ctx: CanvasRenderingContext2D, opts: any) {
  // v25.4: re-tuned vertical anchors for 1440px height.
  //   title:   STORY_H-720 → STORY_H-560
  //   price:   STORY_H-580 → STORY_H-440
  //   rating:  STORY_H-470 → STORY_H-360
  //   QR:      STORY_H-420, size 360 → STORY_H-320, size 280
  //   CTA:     STORY_H-110/65 → STORY_H-90/50

  // Title (large, centered in bottom third)
  ctx.fillStyle = '#ffffff'
  ctx.font = `800 48px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  wrapText(ctx, opts.title, STORY_W / 2, STORY_H - 560, STORY_W - 120, 54, 2)

  // Price
  ctx.font = `800 68px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`
  ctx.fillStyle = '#ffffff'
  ctx.fillText(formatPrice(opts.price, opts.currency), STORY_W / 2, STORY_H - 440)

  // Rating
  if (opts.rating > 0) {
    const ratingY = STORY_H - 360
    drawStars(ctx, STORY_W / 2 - 5 * 28 / 2, ratingY, 28, Math.round(opts.rating))
  }

  // QR code (centered, with brand badge) — v25.4: 360→280
  const qrSize = 280
  const qrX = (STORY_W - qrSize) / 2
  const qrY = STORY_H - 320
  if (opts.deepLinkUrl) {
    const matrix = generateQrMatrix(opts.deepLinkUrl)
    if (matrix) {
      // White rounded background for QR
      ctx.fillStyle = '#ffffff'
      roundRectPath(ctx, qrX - 16, qrY - 16, qrSize + 32, qrSize + 32, 20)
      ctx.fill()

      // Draw QR
      const cellSize = qrSize / matrix.length
      ctx.fillStyle = '#0f172a'
      for (let r = 0; r < matrix.length; r++) {
        for (let c = 0; c < matrix.length; c++) {
          if (matrix[r][c]) {
            ctx.fillRect(qrX + c * cellSize, qrY + r * cellSize, Math.ceil(cellSize), Math.ceil(cellSize))
          }
        }
      }

      // v25.12: no brand badge in QR center — cleaner look
    }
  }

  // CTA below QR — v25.4: 32→26px, 26→22px (proportional)
  ctx.fillStyle = '#ffffff'
  ctx.font = `600 26px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`
  ctx.textAlign = 'center'
  ctx.fillText('Отсканируй, чтобы открыть', STORY_W / 2, STORY_H - 90)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.7)'
  ctx.font = `400 22px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`
  ctx.fillText('TRI999', STORY_W / 2, STORY_H - 50)
}

function drawStars(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, rating: number) {
  for (let i = 0; i < 5; i++) {
    const filled = i < rating
    drawStar(ctx, x + i * (size + 4), y, size, filled)
  }
}

function drawStar(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, filled: boolean) {
  ctx.save()
  ctx.translate(x, y)
  ctx.beginPath()
  const cx = size / 2
  const cy = size / 2
  const spikes = 5
  const outerRadius = size / 2
  const innerRadius = size / 4
  let rot = -Math.PI / 2
  const step = Math.PI / spikes
  ctx.moveTo(cx + Math.cos(rot) * outerRadius, cy + Math.sin(rot) * outerRadius)
  for (let i = 0; i < spikes; i++) {
    rot += step
    ctx.lineTo(cx + Math.cos(rot) * innerRadius, cy + Math.sin(rot) * innerRadius)
    rot += step
    ctx.lineTo(cx + Math.cos(rot) * outerRadius, cy + Math.sin(rot) * outerRadius)
  }
  ctx.closePath()
  ctx.fillStyle = filled ? '#fbbf24' : 'rgba(255, 255, 255, 0.3)'
  ctx.fill()
  ctx.restore()
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number,
) {
  const words = text.split(' ')
  let line = ''
  let curY = y
  let lineCount = 0
  for (let i = 0; i < words.length; i++) {
    const test = line ? `${line} ${words[i]}` : words[i]
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, curY)
      line = words[i]
      curY += lineHeight
      lineCount++
      if (lineCount >= maxLines - 1) {
        // Last line — truncate if needed
        const remaining = words.slice(i).join(' ')
        if (ctx.measureText(remaining).width > maxWidth) {
          let truncated = remaining
          while (ctx.measureText(truncated + '…').width > maxWidth && truncated.length > 0) {
            truncated = truncated.slice(0, -1)
          }
          ctx.fillText(truncated + '…', x, curY)
          return
        }
        ctx.fillText(remaining, x, curY)
        return
      }
    } else {
      line = test
    }
  }
  ctx.fillText(line, x, curY)
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = (e) => reject(e)
    img.src = src
  })
}
