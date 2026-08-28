'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X, Download, ChevronLeft, ChevronRight, FileText, FileSpreadsheet,
  FileImage, File, Loader2, ExternalLink, AlertTriangle,
} from 'lucide-react'
import { api, assetUrl } from '@/lib/api'
import { cn } from '@/lib/utils'
import { haptic } from '@/lib/haptic'

// ============================================================================
//  v25.21 — PriceListsViewer: полноэкранный просмотрщик прайс-листов.
//
//  Владелец: «PDF открывается белым экраном и из него нет выхода; хочу
//  листать прайсы каруселью и полноэкранный просмотр 9:16».
//
//  Что умеет:
//   • КАРУСЕЛЬ по прайсам-ДОКУМЕНТАМ — свайп на мобиле, стрелки на десктопе,
//     счётчик «n / всего». (v25.22: картинки ушли в лентовый ImageLightbox —
//     владелец хотел их «как в ленте».)
//   • PDF рендерится ВНУТРИ приложения через pdf.js (canvas) — никакого
//     window.open и белых экранов; страницы листаются ‹ 2 / 7 ›.
//     v25.22: страницы PDF — FULL-BLEED во всю ширину экрана, без рамок,
//     скруглений и зазоров — тот же полноэкранный вид, что в ленте.
//   • Word/Excel/прочее — красивая карточка с «Скачать» / «Открыть»
//     (браузер не умеет рендерить doc/xls — честно даём кнопки).
//   • Выход: крестик, Esc, клик по фону. Скачивание — всегда под рукой.
//   • Полный экран (100dvw/100dvh ≈ 9:16 на телефоне).
// ============================================================================

export interface ViewerPriceList {
  id: string
  title: string
  description: string | null
  fileUrl: string
  fileType: string
  category: string | null
}

interface Props {
  items: ViewerPriceList[]
  index: number
  onClose: () => void
  onIndexChange: (i: number) => void
}

export function PriceListsViewer({ items, index, onClose, onIndexChange }: Props) {
  const item = items[index]
  const [dir, setDir] = useState(1)
  const [pdfState, setPdfState] = useState<
    | { kind: 'idle' }
    | { kind: 'loading' }
    | { kind: 'ready'; numPages: number }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' })
  const [page, setPage] = useState(1)
  const canvasHostRef = useRef<HTMLDivElement>(null)
  const touchStart = useRef<{ x: number; y: number } | null>(null)
  const renderAbort = useRef(false)

  // ---- reset per-item state when switching ----
  useEffect(() => {
    setPdfState({ kind: 'idle' })
    setPage(1)
  }, [item?.id])

  // ---- body scroll lock ----
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  // ---- keyboard ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight' && index < items.length - 1) { setDir(1); onIndexChange(index + 1) }
      if (e.key === 'ArrowLeft' && index > 0) { setDir(-1); onIndexChange(index - 1) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, items.length, onClose, onIndexChange])

  const go = useCallback((delta: 1 | -1) => {
    const next = index + delta
    if (next < 0 || next >= items.length) return
    haptic.select()
    setDir(delta)
    onIndexChange(next)
  }, [index, items.length, onIndexChange])

  // ---- swipe между прайсами (только по фону/шапке, не по канве PDF) ----
  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0]
    touchStart.current = { x: t.clientX, y: t.clientY }
  }
  const onTouchEnd = (e: React.TouchEvent) => {
    if (!touchStart.current) return
    const t = e.changedTouches[0]
    const dx = t.clientX - touchStart.current.x
    const dy = t.clientY - touchStart.current.y
    touchStart.current = null
    if (Math.abs(dx) > 64 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      go(dx < 0 ? 1 : -1)
    }
  }

  // ---- PDF render (pdf.js) ----
  const renderPdf = useCallback(async () => {
    if (!item || item.fileType !== 'pdf') return
    renderAbort.current = false
    setPdfState({ kind: 'loading' })
    try {
      const pdfjs = await import('pdfjs-dist')
      pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'
      const url = assetUrl(item.fileUrl)
      const doc = await pdfjs.getDocument({ url, withCredentials: false }).promise
      if (renderAbort.current) return
      setPdfState({ kind: 'ready', numPages: doc.numPages })
      const host = canvasHostRef.current
      if (!host) return

      for (let p = 1; p <= doc.numPages; p++) {
        if (renderAbort.current) return
        const pageDoc = await doc.getPage(p)
        if (renderAbort.current) return
        const base = pageDoc.getViewport({ scale: 1 })
        const targetW = Math.min(host.clientWidth || 390, 900)
        const scale = Math.min((targetW / base.width) * (window.devicePixelRatio > 1 ? 2 : 1.5), 4)
        const viewport = pageDoc.getViewport({ scale })
        const canvas = document.createElement('canvas')
        canvas.width = Math.floor(viewport.width)
        canvas.height = Math.floor(viewport.height)
        // v25.22: full-bleed, как в ленте — без рамок, скруглений и теней
        canvas.className = 'block mx-auto'
        canvas.style.width = `${Math.floor(viewport.width / (window.devicePixelRatio > 1 ? 2 : 1.5))}px`
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        await pageDoc.render({ canvasContext: ctx, viewport }).promise
        if (renderAbort.current) return
        host.appendChild(canvas)
        if (p === 1) setPdfState((s) => (s.kind === 'ready' ? s : { kind: 'ready', numPages: doc.numPages }))
      }
    } catch (err: any) {
      if (!renderAbort.current) {
        setPdfState({ kind: 'error', message: err?.message || 'Не удалось открыть PDF' })
      }
    }
  }, [item])

  useEffect(() => {
    const host = canvasHostRef.current
    if (host) host.innerHTML = ''
    if (item?.fileType === 'pdf') renderPdf()
    return () => { renderAbort.current = true }
  }, [item?.id, item?.fileType, renderPdf])

  if (!item) return null

  const isImage = item.fileType === 'image'
  const isPdf = item.fileType === 'pdf'
  const TypeIcon = isImage ? FileImage : isPdf ? FileText : item.fileType === 'excel' ? FileSpreadsheet : File

  return (
    typeof document !== 'undefined' && createPortal(
      <AnimatePresence>
        <motion.div
          key="viewer-root"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-[600] bg-black flex flex-col"
          style={{ width: '100dvw', height: '100dvh' }}
          onClick={() => onClose()}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          {/* ── верхняя стеклянная шапка ─────────────────────────────── */}
          <div
            className="relative z-30 shrink-0 flex items-center gap-2 px-3 text-white"
            style={{
              paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.6rem)',
              paddingBottom: '0.6rem',
              background: 'linear-gradient(180deg, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0.45) 70%, transparent 100%)',
              backdropFilter: 'blur(14px)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => { haptic.tap(); onClose() }}
              aria-label="Закрыть просмотр"
              className="h-10 w-10 shrink-0 rounded-full grid place-items-center bg-white/12 hover:bg-white/20 active:scale-90 transition-all"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="flex-1 min-w-0 text-center">
              <div className="text-[10px] uppercase tracking-[0.18em] text-white/50 font-bold flex items-center justify-center gap-1.5">
                <TypeIcon className="h-3 w-3" />
                {item.category || 'Прайс-лист'}
              </div>
              <div className="text-sm font-bold truncate">{item.title}</div>
              <div className="text-[11px] text-white/55 tabular-nums">
                {index + 1} / {items.length}
                {isPdf && pdfState.kind === 'ready' ? ` · стр. ${page} из ${pdfState.numPages}` : ''}
              </div>
            </div>

            <a
              href={assetUrl(item.fileUrl)}
              download={item.title}
              onClick={(e) => e.stopPropagation()}
              aria-label="Скачать файл"
              className="h-10 w-10 shrink-0 rounded-full grid place-items-center bg-white/12 hover:bg-white/20 active:scale-90 transition-all"
            >
              <Download className="h-5 w-5" />
            </a>
          </div>

          {/* ── контент ──────────────────────────────────────────────── */}
          <div className="relative flex-1 min-h-0" onClick={(e) => e.stopPropagation()}>
            <AnimatePresence mode="popLayout" custom={dir}>
              <motion.div
                key={item.id}
                custom={dir}
                initial={{ opacity: 0, x: dir * 70 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: dir * -70 }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                className="absolute inset-0 flex flex-col"
              >
                {isImage && (
                  // v25.22: страховочный full-bleed рендер (в обычном потоке
                  // картинки открываются лентовым ImageLightbox на странице)
                  <div className="flex-1 min-h-0 grid place-items-center overflow-auto">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={assetUrl(item.fileUrl)}
                      alt={item.title}
                      className="max-w-full max-h-full object-contain"
                      draggable={false}
                    />
                  </div>
                )}

                {isPdf && (
                  <div className="flex-1 min-h-0 relative">
                    {pdfState.kind === 'loading' && (
                      <div className="absolute inset-0 grid place-items-center text-white/70">
                        <div className="flex flex-col items-center gap-3">
                          <Loader2 className="h-9 w-9 animate-spin" />
                          <p className="text-xs">Открываем PDF…</p>
                        </div>
                      </div>
                    )}
                    {pdfState.kind === 'error' && (
                      <div className="absolute inset-0 grid place-items-center px-8 text-center">
                        <div className="text-white/80">
                          <AlertTriangle className="h-10 w-10 mx-auto mb-3 text-amber-400" />
                          <p className="text-sm font-semibold mb-1">PDF не открывается</p>
                          <p className="text-xs text-white/55 mb-5">{pdfState.message}</p>
                          <a
                            href={assetUrl(item.fileUrl)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 h-10 px-5 rounded-full bg-white/15 text-white text-sm font-semibold"
                          >
                            <ExternalLink className="h-4 w-4" /> Открыть в новой вкладке
                          </a>
                        </div>
                      </div>
                    )}
                    <div
                      ref={canvasHostRef}
                      className="h-full w-full overflow-y-auto overscroll-contain flex flex-col items-center gap-0"
                    />
                  </div>
                )}

                {!isImage && !isPdf && (
                  <div className="flex-1 min-h-0 grid place-items-center px-8">
                    <div className="text-center text-white">
                      <div className="h-20 w-20 mx-auto rounded-3xl grid place-items-center bg-white/10 border border-white/15 mb-5">
                        <TypeIcon className="h-10 w-10 text-white/85" />
                      </div>
                      <h3 className="text-lg font-extrabold mb-1">{item.title}</h3>
                      <p className="text-sm text-white/60 mb-6">
                        Этот документ — {item.fileType === 'word' ? 'Word' : item.fileType === 'excel' ? 'Excel' : 'файл'}.
                        Скачайте его, чтобы посмотреть содержимое.
                      </p>
                      <div className="flex flex-col sm:flex-row items-center justify-center gap-2.5">
                        <a
                          href={assetUrl(item.fileUrl)}
                          download={item.title}
                          className="inline-flex items-center gap-2 h-11 px-6 rounded-full bg-white text-black text-sm font-bold active:scale-95 transition-transform"
                        >
                          <Download className="h-4 w-4" /> Скачать
                        </a>
                        <a
                          href={assetUrl(item.fileUrl)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 h-11 px-6 rounded-full bg-white/12 border border-white/15 text-white text-sm font-semibold active:scale-95 transition-transform"
                        >
                          <ExternalLink className="h-4 w-4" /> Открыть в новой вкладке
                        </a>
                      </div>
                    </div>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>

            {/* стрелки карусели — десктоп */}
            {index > 0 && (
              <button
                onClick={() => go(-1)}
                aria-label="Предыдущий прайс"
                className="hidden md:grid absolute left-3 top-1/2 -translate-y-1/2 h-11 w-11 rounded-full place-items-center bg-white/12 hover:bg-white/25 text-white backdrop-blur transition-all active:scale-90 z-20"
              >
                <ChevronLeft className="h-6 w-6" />
              </button>
            )}
            {index < items.length - 1 && (
              <button
                onClick={() => go(1)}
                aria-label="Следующий прайс"
                className="hidden md:grid absolute right-3 top-1/2 -translate-y-1/2 h-11 w-11 rounded-full place-items-center bg-white/12 hover:bg-white/25 text-white backdrop-blur transition-all active:scale-90 z-20"
              >
                <ChevronRight className="h-6 w-6" />
              </button>
            )}
          </div>

          {/* ── нижняя навигация: точки-страницы PDF + свайп-подсказка ── */}
          <div
            className="relative z-30 shrink-0 pb-[calc(env(safe-area-inset-bottom,0px)+0.7rem)] pt-2 flex items-center justify-center gap-2"
            style={{ background: 'linear-gradient(0deg, rgba(0,0,0,0.7) 0%, transparent 100%)' }}
            onClick={(e) => e.stopPropagation()}
          >
            {isPdf && pdfState.kind === 'ready' && pdfState.numPages > 1 && (
              <div className="flex items-center gap-2 rounded-full bg-white/12 backdrop-blur px-2 py-1.5 text-white">
                <button
                  onClick={() => { haptic.tap(); setPage((p) => Math.max(1, p - 1)); scrollPdfPage(canvasHostRef.current, page - 1) }}
                  disabled={page <= 1}
                  aria-label="Предыдущая страница PDF"
                  className={cn('h-7 w-7 rounded-full grid place-items-center bg-white/10', page <= 1 ? 'opacity-30' : 'hover:bg-white/25 active:scale-90')}
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="text-xs font-bold tabular-nums min-w-[52px] text-center">{page} / {pdfState.numPages}</span>
                <button
                  onClick={() => { haptic.tap(); setPage((p) => Math.min(pdfState.numPages, p + 1)); scrollPdfPage(canvasHostRef.current, page + 1) }}
                  disabled={page >= pdfState.numPages}
                  aria-label="Следующая страница PDF"
                  className={cn('h-7 w-7 rounded-full grid place-items-center bg-white/10', page >= pdfState.numPages ? 'opacity-30' : 'hover:bg-white/25 active:scale-90')}
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            )}

            {items.length > 1 && (
              <div className="flex items-center gap-1.5">
                {items.slice(0, 9).map((it, i) => (
                  <button
                    key={it.id}
                    onClick={() => { setDir(i > index ? 1 : -1); onIndexChange(i) }}
                    aria-label={`Прайс ${i + 1}`}
                    className={cn(
                      'h-1.5 rounded-full transition-all',
                      i === index ? 'w-5 bg-white' : 'w-1.5 bg-white/35 hover:bg-white/60',
                      i === 8 && items.length > 9 && 'rounded-r-full',
                    )}
                  />
                ))}
                {items.length > 9 && <span className="text-[10px] text-white/50 ml-1">+{items.length - 9}</span>}
              </div>
            )}
          </div>
        </motion.div>
      </AnimatePresence>,
      document.body,
    )
  )
}

// Плавный скролл канвы-хоста к N-й странице (страницы — дочерние canvas).
function scrollPdfPage(host: HTMLDivElement | null, targetPage: number) {
  if (!host) return
  const canvases = host.querySelectorAll('canvas')
  const idx = Math.max(0, Math.min(targetPage - 1, canvases.length - 1))
  canvases[idx]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
