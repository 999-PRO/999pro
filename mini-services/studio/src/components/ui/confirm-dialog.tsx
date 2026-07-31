'use client'

import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, X } from 'lucide-react'

export interface ConfirmDialogState {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'danger' | 'default'
  onConfirm: () => void
}

/**
 * useConfirmDialog — hook for managing a confirm dialog in Studio.
 *
 * Phase 25: Replaces native confirm() calls in Studio managers.
 * Usage:
 *   const { dialog, confirm, close } = useConfirmDialog()
 *   ...
 *   <ConfirmDialog {...dialog} onClose={close} />
 *   ...
 *   confirm({ title: 'Удалить?', message: '...', onConfirm: () => delete() })
 */
export function useConfirmDialog() {
  const [dialog, setDialog] = useState<ConfirmDialogState>({
    open: false,
    title: '',
    message: '',
    onConfirm: () => {},
  })

  const confirm = (opts: Omit<ConfirmDialogState, 'open'>) => {
    setDialog({ ...opts, open: true })
  }

  const close = () => {
    setDialog((d) => ({ ...d, open: false }))
  }

  return { dialog, confirm, close }
}

/**
 * ConfirmDialog — accessible confirm dialog for Studio.
 */
export function StudioConfirmDialog({
  dialog,
  onClose,
}: {
  dialog: ConfirmDialogState
  onClose: () => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!dialog.open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dialog.open, onClose])

  if (!dialog.open) return null

  return (
    <div
      className="fixed inset-0 z-[400] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-label={dialog.title}
        // v13.2 (audit P1-11 fix): removed the hardcoded #0f172a fallback.
        // Previously, if --background CSS var failed to load (race during
        // theme init), the dialog fell back to dark navy — wrong in light
        // theme, causing a flash of dark dialog. The `glass-strong` class
        // already uses var(--card) which has a proper theme-aware default.
        className="glass-strong border border-border/40 rounded-3xl shadow-2xl max-w-sm w-full p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          {dialog.variant === 'danger' && (
            <div className="shrink-0 h-10 w-10 rounded-full bg-destructive/10 grid place-items-center">
              <AlertTriangle className="h-5 w-5 text-destructive" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-bold text-foreground">{dialog.title}</h2>
            <p className="text-sm text-muted-foreground mt-1">{dialog.message}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-full hover:bg-accent transition-colors shrink-0"
            aria-label="Закрыть"
          >
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>
        <div className="flex gap-2 justify-end pt-2">
          <button
            onClick={onClose}
            className="px-4 h-10 rounded-xl glass hover:bg-accent transition-colors text-sm font-medium text-foreground"
          >
            {dialog.cancelLabel || 'Отмена'}
          </button>
          <button
            onClick={() => {
              // Wave 2 (S-BUG-001): defer onClose() to a microtask so that
              // dialog.onConfirm() can call confirm(secondOpts) and have its
              // setDialog({open:true,...}) win the batch. Previously, onClose
              // ran synchronously after onConfirm, overwriting open:true → false.
              dialog.onConfirm()
              Promise.resolve().then(() => onClose())
            }}
            autoFocus
            className={
              dialog.variant === 'danger'
                ? 'px-4 h-10 rounded-xl bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors text-sm font-medium'
                : 'px-4 h-10 rounded-xl gradient-brand text-white hover:opacity-90 transition-opacity text-sm font-medium'
            }
          >
            {dialog.confirmLabel || 'Подтвердить'}
          </button>
        </div>
      </div>
    </div>
  )
}
