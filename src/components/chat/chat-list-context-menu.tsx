'use client'

// ============================================================================
// ChatListContextMenu — bottom sheet для действий над чатом в списке диалогов.
// ----------------------------------------------------------------------------
// Открывается при долгом нажатии на чат в списке.
// Содержит:
//   • Удалить чат
//   • Очистить историю
//   • Архивировать
//   • Закрепить
// ============================================================================

import { motion, AnimatePresence } from 'framer-motion'
import { Trash2, Eraser, Archive, Pin, X } from 'lucide-react'
import { useRef, useEffect } from 'react'
import { useScrollLock } from '@/lib/use-scroll-lock'
import { haptic } from '@/lib/haptic'

// v25.26: защитное окно увеличено 450 → 900мс и добавлен ДОКУМЕНТНЫЙ
// capture-перехват. Сценарий: меню открывается ЕЩЁ во время удержания пальца;
// при отпускании браузер успевает синтезировать click/mouseup, а на Android
// ещё и повторный contextmenu — и шит мгновенно закрывался (жалоба владельца
// воспроизводилась даже с guard 450мс). Теперь ЛЮБОЙ синтетический клик в
// пределах 900мс после открытия гасится на capture-фазе, кроме кликов
// внутри самого шита.
const OPEN_GUARD_MS = 900

interface ChatListContextMenuProps {
  open: boolean
  conversationTitle: string
  isPinned: boolean
  // v25.24: чат в архиве — пункт меняется на «Разархивировать»
  isArchived?: boolean
  onClose: () => void
  onDelete: () => void
  onClearHistory: () => void
  onArchive: () => void
  onTogglePin: () => void
}

export function ChatListContextMenu({
  open,
  conversationTitle,
  isPinned,
  isArchived,
  onClose,
  onDelete,
  onClearHistory,
  onArchive,
  onTogglePin,
}: ChatListContextMenuProps) {
  useScrollLock(open)

  // v25.20 FIX (owner): «нажимаешь и держишь — меню появляется, отпускаешь —
  // пропадает». v25.26: guard усилен до 900мс + document-level capture.
  const openedAtRef = useRef(0)
  const sheetRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (open) openedAtRef.current = Date.now()
  }, [open])

  // Capture-phase guard: гасим синтетические click/contextmenu ПО ВСЕМУ документу
  // в первые 900мс после открытия, кроме кликов внутри самого шита.
  useEffect(() => {
    if (!open) return
    const swallow = (e: Event) => {
      if (Date.now() - openedAtRef.current >= OPEN_GUARD_MS) return
      const target = e.target as Node | null
      if (target && sheetRef.current && sheetRef.current.contains(target)) return
      e.stopPropagation()
      e.preventDefault()
    }
    document.addEventListener('click', swallow, true)
    document.addEventListener('contextmenu', swallow, true)
    return () => {
      document.removeEventListener('click', swallow, true)
      document.removeEventListener('contextmenu', swallow, true)
    }
  }, [open])

  const requestClose = () => {
    if (Date.now() - openedAtRef.current < OPEN_GUARD_MS) return // палец ещё отпускается
    onClose()
  }

  const handleAction = (action: () => void) => {
    haptic.tap()
    action()
    onClose()
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[95] bg-black/40"
            style={{ backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
            onClick={requestClose}
            onTouchEnd={(e) => {
              // Гасим синтетический клик от пальца, отпущенного после long-press
              e.preventDefault()
              requestClose()
            }}
          />

          {/* Sheet */}
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 360, damping: 36, mass: 0.9 }}
            className="fixed left-0 right-0 bottom-0 z-[96] mx-auto max-w-md"
          >
            <div
              ref={sheetRef}
              className="rounded-t-[28px] overflow-hidden"
              style={{
                background: 'color-mix(in oklch, var(--card) 92%, transparent)',
                backdropFilter: 'blur(28px) saturate(160%)',
                WebkitBackdropFilter: 'blur(28px) saturate(160%)',
                border: '1px solid color-mix(in oklch, var(--border) 60%, transparent)',
                borderBottom: 'none',
                boxShadow: '0 -10px 40px -10px rgba(15,23,42,0.3)',
              }}
            >
              {/* Handle bar */}
              <div className="flex justify-center pt-2.5 pb-1">
                <div className="h-1 w-10 rounded-full bg-foreground/20" />
              </div>

              {/* Title + Close */}
              <div className="flex items-center justify-between px-5 py-2">
                <div className="text-sm font-semibold truncate flex-1 min-w-0">
                  {conversationTitle}
                </div>
                <button
                  onClick={onClose}
                  className="h-8 w-8 rounded-full grid place-items-center hover:bg-foreground/5 active:scale-90 transition-all shrink-0"
                  aria-label="Закрыть"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Actions */}
              <div className="px-3 pb-[calc(env(safe-area-inset-bottom)+16px)] pt-1 space-y-1">
                {/* Pin / Unpin */}
                <button
                  onClick={() => handleAction(onTogglePin)}
                  className="w-full flex items-center gap-3 p-3 rounded-2xl hover:bg-foreground/5 active:scale-[0.98] transition-all text-left"
                >
                  <div
                    className="grid place-items-center h-10 w-10 rounded-xl"
                    style={{ background: 'color-mix(in oklch, var(--primary) 12%, transparent)' }}
                  >
                    <Pin className="h-4 w-4 text-primary" />
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-medium">
                      {isPinned ? 'Открепить' : 'Закрепить'}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {isPinned ? 'Чат появится в общем списке' : 'Чат будет наверху списка'}
                    </div>
                  </div>
                </button>

                {/* Archive */}
                <button
                  onClick={() => handleAction(onArchive)}
                  className="w-full flex items-center gap-3 p-3 rounded-2xl hover:bg-foreground/5 active:scale-[0.98] transition-all text-left"
                >
                  <div
                    className="grid place-items-center h-10 w-10 rounded-xl"
                    style={{ background: 'color-mix(in oklch, var(--primary) 12%, transparent)' }}
                  >
                    <Archive className="h-4 w-4 text-primary" />
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-medium">{isArchived ? 'Разархивировать' : 'Архивировать'}</div>
                    <div className="text-xs text-muted-foreground">
                      {isArchived ? 'Вернуть чат в общий список' : 'Скрыть чат в папке «Архив»'}
                    </div>
                  </div>
                </button>

                {/* Clear history */}
                <button
                  onClick={() => handleAction(onClearHistory)}
                  className="w-full flex items-center gap-3 p-3 rounded-2xl hover:bg-foreground/5 active:scale-[0.98] transition-all text-left"
                >
                  <div
                    className="grid place-items-center h-10 w-10 rounded-xl"
                    style={{ background: 'color-mix(in oklch, #f59e0b 12%, transparent)' }}
                  >
                    <Eraser className="h-4 w-4" style={{ color: '#f59e0b' }} />
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-medium">Очистить историю</div>
                    <div className="text-xs text-muted-foreground">
                      Удалить все сообщения в этом чате
                    </div>
                  </div>
                </button>

                {/* Delete chat */}
                <button
                  onClick={() => handleAction(onDelete)}
                  className="w-full flex items-center gap-3 p-3 rounded-2xl hover:bg-destructive/5 active:scale-[0.98] transition-all text-left"
                >
                  <div
                    className="grid place-items-center h-10 w-10 rounded-xl"
                    style={{ background: 'color-mix(in oklch, #ef4444 12%, transparent)' }}
                  >
                    <Trash2 className="h-4 w-4" style={{ color: '#ef4444' }} />
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-medium text-destructive">Удалить чат навсегда</div>
                    <div className="text-xs text-muted-foreground">
                      Полностью убрать диалог и историю для себя
                    </div>
                  </div>
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
