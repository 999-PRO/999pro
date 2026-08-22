'use client'

// ============================================================================
//  QrModal — modal showing a QR code for the share URL.
//  ----------------------------------------------------------------------------
//  Uses a pure-JS QR code generator (no external deps) so it works offline.
//  The QR encodes the deep link URL — on iOS/Android with the app installed,
//  scanning opens the app at this specific product.
// ============================================================================

import { motion } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
// v25.4 (TZ-2 task #1): render via portal so the QR modal is always on top.
import { createPortal } from 'react-dom'
import { X, Download, Copy, Check } from 'lucide-react'
import { toast } from '@/lib/notifications'
import { generateQrMatrix, drawQrToCanvas } from './qr-renderer'

interface Props {
  open: boolean
  onClose: () => void
  url: string
  title: string
  shortId: string
}

export function QrModal({ open, onClose, url, title, shortId }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!open || !canvasRef.current) return
    // Generate a QR matrix (Type 8, version auto-selected by length).
    const matrix = generateQrMatrix(url)
    if (matrix) {
      drawQrToCanvas(canvasRef.current, matrix, {
        // Brand colors — dark navy QR on white background for max scan reliability.
        foreground: '#0f172a',
        background: '#ffffff',
        padding: 32,
        // Center logo overlay (small 999PRO logo) — drawn after the QR.
        // The logo is small enough (32×32 in a 256px QR) that error correction
        // handles the occluded modules.
        logo: true,
      })
    }
  }, [open, url])

  // Lock body scroll
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  if (!open) return null

  const handleDownload = () => {
    if (!canvasRef.current) return
    canvasRef.current.toBlob((blob) => {
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `999pro-${shortId}-qr.png`
      a.click()
      URL.revokeObjectURL(url)
      toast.success('QR-код сохранён')
    }, 'image/png')
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard?.writeText(url)
      setCopied(true)
      toast.success('Ссылка скопирована')
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Не удалось скопировать')
    }
  }

  // v25.4 (TZ-2 task #1): render via portal at document.body with z-[9999]
  // so the QR modal appears above the share sheet (z-[9999] too — sibling).
  return createPortal(
    <motion.div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      <motion.div
        className="relative bg-white dark:bg-slate-950 rounded-3xl shadow-2xl overflow-hidden max-w-sm w-full"
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        transition={{ duration: 0.2 }}
      >
        <div className="px-5 py-4 flex items-center justify-between border-b border-slate-200/60 dark:border-slate-800/60">
          <div className="flex items-center gap-2.5">
            <div>
              <div className="font-bold text-sm leading-tight">QR-код товара</div>
              <div className="text-xs text-slate-500 truncate max-w-[200px]">{title}</div>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Закрыть"
            className="h-8 w-8 rounded-full bg-slate-100 dark:bg-slate-800 grid place-items-center hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-6">
          {/* QR canvas — 320×320 CSS pixels, rendered at 2x for retina */}
          <div className="relative mx-auto w-fit">
            <canvas
              ref={canvasRef}
              width={640}
              height={640}
              className="w-72 h-72 rounded-2xl bg-white shadow-lg"
            />
            {/* Brand corner badge */}
            <div className="absolute -bottom-2 -right-2 h-12 w-12 rounded-2xl bg-gradient-to-br from-sky-400 via-blue-500 to-violet-600 grid place-items-center text-white font-extrabold shadow-lg border-4 border-white dark:border-slate-950">
              9
            </div>
          </div>

          <div className="mt-4 text-center">
            <div className="text-xs text-slate-500 mb-1">Отсканируйте, чтобы открыть товар</div>
            <div className="text-xs font-mono text-slate-600 dark:text-slate-300 truncate">{url}</div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-2">
            <button
              onClick={handleDownload}
              className="h-11 rounded-2xl bg-gradient-to-r from-blue-600 to-violet-600 text-white text-sm font-semibold flex items-center justify-center gap-1.5 hover:scale-[1.02] transition-transform"
            >
              <Download className="h-4 w-4" /> Скачать PNG
            </button>
            <button
              onClick={handleCopy}
              className="h-11 rounded-2xl bg-slate-100 dark:bg-slate-800 text-sm font-semibold flex items-center justify-center gap-1.5 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? 'Скопировано' : 'Копировать'}
            </button>
          </div>

          {/* App promo */}
          <div className="mt-4 rounded-2xl bg-gradient-to-br from-sky-500 via-blue-600 to-violet-700 p-3 text-white text-center">
            <div className="text-xs font-semibold">999PRO</div>
            <div className="text-[11px] text-white/80 mt-0.5">Открой больше товаров в приложении 999PRO</div>
          </div>
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  )
}
