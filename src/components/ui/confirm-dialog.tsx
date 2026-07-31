'use client'

import { useEffect, useRef } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useFocusTrap } from '@/lib/use-focus-trap'
import { useScrollLock } from '@/lib/use-scroll-lock'

export interface ConfirmDialogProps {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'danger' | 'default'
  onConfirm: () => void
  onCancel: () => void
}

/**
 * ConfirmDialog — accessible replacement for native window.confirm().
 *
 * Phase 10: Six places in the app used native confirm() which:
 *   - Blocks the main thread
 *   - Can't be styled to match the app
 *   - Looks foreign (browser chrome)
 *   - Not accessible to screen readers
 *
 * This component provides:
 *   - Focus trap (keyboard users can Tab between Cancel/Confirm)
 *   - ARIA dialog pattern (role="dialog", aria-modal="true")
 *   - Escape key cancels
 *   - Click outside cancels
 *   - Styled to match the app (glass, gradient, safe-area aware)
 *   - danger variant for destructive actions (red Confirm button)
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Подтвердить',
  cancelLabel = 'Отмена',
  variant = 'default',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  useFocusTrap(containerRef, open)
  useScrollLock(open)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[400] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}
      onClick={onCancel}
    >
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="glass-strong border border-border/40 rounded-3xl shadow-2xl max-w-sm w-full p-6 space-y-4"
        style={{
          background: 'var(--background, #0f172a)',
          animation: 'dialog-in 0.2s ease-out',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          {variant === 'danger' && (
            <div className="shrink-0 h-10 w-10 rounded-full bg-destructive/10 grid place-items-center">
              <AlertTriangle className="h-5 w-5 text-destructive" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-bold text-foreground">{title}</h2>
            <p className="text-sm text-muted-foreground mt-1">{message}</p>
          </div>
        </div>
        <div className="flex gap-2 justify-end pt-2">
          <button
            onClick={onCancel}
            className="px-4 h-10 rounded-xl glass hover:bg-accent transition-colors text-sm font-medium text-foreground"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            autoFocus
            className={
              variant === 'danger'
                ? 'px-4 h-10 rounded-xl bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors text-sm font-medium'
                : 'px-4 h-10 rounded-xl gradient-brand text-white hover:opacity-90 transition-opacity text-sm font-medium'
            }
          >
            {confirmLabel}
          </button>
        </div>
      </div>
      <style jsx>{`
        @keyframes dialog-in {
          from {
            opacity: 0;
            transform: scale(0.95) translateY(10px);
          }
          to {
            opacity: 1;
            transform: scale(1) translateY(0);
          }
        }
      `}</style>
    </div>
  )
}
