'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Trash2, Timer, Square, Check } from 'lucide-react'
import { VoiceWaveVisualizer } from './voice-wave-visualizer'
// Wave 2 (F-BUG-003): use the shared useScrollLock hook instead of direct
// body.style.overflow manipulation. The hook uses a module-level lockCount
// so multiple overlapping locks (e.g. ProductPage + VoiceRecordPanel) don't
// prematurely release each other.
import { useScrollLock } from '@/lib/use-scroll-lock'
import { haptic } from '@/lib/haptic'

// ============================================================================
// VoiceRecordPanel — premium iOS-style recording panel.
//
// v16.8-final: правая кнопка заменена на ⏱️ Таймер автоудаления.
//   Layout (top → bottom):
//   • Red dot + timer + "Идет запись" subtitle
//   • Organic waveform (VoiceWaveVisualizer) — fills the centre, reacts to mic
//   • DELETE (left) — STOP (centre, large) — TIMER (right)
//   • Tiny hint: "Голосовое удалится автоматически"
//
// При нажатии на правую кнопку открывается компактное glassmorphism-меню
// с 5 вариантами времени автоудаления. Выбранное значение отображается
// рядом с кнопкой и передаётся наверх через onChangeSelfDestruct.
// ============================================================================

// v16.8-final: allowed self-destruct options.
// 0 = Никогда (no auto-delete).
export type SelfDestructMinutes = 0 | 60 | 720 | 1440 | 10080

interface SelfDestructOption {
  value: SelfDestructMinutes
  label: string
  hint: string
}

const SELF_DESTRUCT_OPTIONS: SelfDestructOption[] = [
  { value: 0, label: 'Никогда', hint: 'Хранить без удаления' },
  { value: 60, label: 'Через 1 час', hint: '60 минут' },
  { value: 720, label: 'Через 12 часов', hint: '720 минут' },
  { value: 1440, label: 'Через 24 часа', hint: '1440 минут' },
  { value: 10080, label: 'Через 7 дней', hint: '10080 минут' },
]

// Returns a short label like "1ч", "12ч", "24ч", "7д" for the chosen timer.
// Used in the compact badge next to the timer button.
function shortLabel(value: SelfDestructMinutes): string {
  switch (value) {
    case 0:
      return ''
    case 60:
      return '1ч'
    case 720:
      return '12ч'
    case 1440:
      return '24ч'
    case 10080:
      return '7д'
  }
}

interface VoiceRecordPanelProps {
  open: boolean
  amplitudeRef: React.MutableRefObject<number>
  recordSeconds: number
  onStop: () => void
  onCancel: () => void
  onLock?: () => void
  // v16.8-final: self-destruct state + setter. Controlled by the parent.
  selfDestructMinutes: SelfDestructMinutes
  onChangeSelfDestruct: (value: SelfDestructMinutes) => void
}

function formatTimer(total: number): string {
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function VoiceRecordPanel({
  open,
  amplitudeRef,
  recordSeconds,
  onStop,
  onCancel,
  // onLock kept for API compat but no longer rendered — replaced by Timer.
  onLock: _onLock,
  selfDestructMinutes,
  onChangeSelfDestruct,
}: VoiceRecordPanelProps) {
  // Wave 2 (F-BUG-003): delegate scroll locking to the shared hook.
  useScrollLock(open)
  const [menuOpen, setMenuOpen] = useState(false)

  const handleSelect = (value: SelfDestructMinutes) => {
    haptic.tap()
    onChangeSelfDestruct(value)
    setMenuOpen(false)
  }

  const selectedLabel = shortLabel(selfDestructMinutes)

  return (
    <motion.div
      className="fixed inset-x-0 bottom-0 z-[70] pointer-events-none"
      initial={false}
      // v10-fix: opacity is ALWAYS 1 — we only animate `y` (position).
      animate={open ? { y: 0, opacity: 1 } : { y: '110%', opacity: 1 }}
      transition={
        open
          ? { type: 'spring', stiffness: 320, damping: 34, mass: 0.9 }
          : { type: 'spring', stiffness: 360, damping: 38, mass: 0.9 }
      }
      aria-hidden={!open}
    >
      <div
        className="pointer-events-auto mx-auto max-w-md px-4 pb-[calc(env(safe-area-inset-bottom,0px)+16px)] pt-3"
        role="dialog"
        aria-modal="false"
        aria-label="Запись голосового сообщения"
      >
        <div
          className="relative rounded-[32px] overflow-hidden"
          style={{
            background: 'color-mix(in oklch, var(--card) 78%, transparent)',
            backdropFilter: 'blur(28px) saturate(160%)',
            WebkitBackdropFilter: 'blur(28px) saturate(160%)',
            border: '1px solid color-mix(in oklch, var(--border) 80%, transparent)',
            boxShadow:
              '0 -20px 60px -20px rgba(15,23,42,0.25), 0 0 0 1px rgba(255,255,255,0.04) inset',
          }}
        >
          {/* Top: status row — red dot + timer + "Идет запись" */}
          <div className="flex items-center justify-center gap-2.5 pt-5 pb-1">
            <motion.span
              className="h-2.5 w-2.5 rounded-full bg-red-500"
              animate={{ opacity: [1, 0.3, 1] }}
              transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
            />
            <span className="text-lg font-semibold tabular-nums tracking-tight text-foreground">
              {formatTimer(recordSeconds)}
            </span>
            {/* v16.8-final: badge с выбранным временем автоудаления.
                Показываем компактную метку рядом с таймером записи. */}
            {selectedLabel && (
              <span
                className="ml-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                style={{
                  background: 'color-mix(in oklch, var(--primary) 14%, transparent)',
                  color: 'var(--primary)',
                  border: '1px solid color-mix(in oklch, var(--primary) 30%, transparent)',
                }}
              >
                <Timer className="h-2.5 w-2.5" />
                {selectedLabel}
              </span>
            )}
          </div>
          <div className="text-center text-[11px] font-medium text-muted-foreground/80 pb-3">
            Идет запись
          </div>

          {/* Center: organic waveform */}
          <div className="px-6 pb-5 h-32">
            <VoiceWaveVisualizer amplitudeRef={amplitudeRef} height={120} />
          </div>

          {/* Bottom: DELETE / STOP / TIMER row */}
          <div className="relative flex items-center justify-center gap-8 pb-5 px-6">
            {/* DELETE — small, red tint */}
            <button
              onClick={onCancel}
              className="h-11 w-11 rounded-full grid place-items-center transition-all active:scale-90 hover:scale-105"
              style={{
                background: 'rgba(239, 68, 68, 0.12)',
                border: '1px solid rgba(239, 68, 68, 0.2)',
              }}
              aria-label="Удалить запись"
            >
              <Trash2 className="h-4 w-4" style={{ color: '#ef4444' }} />
            </button>

            {/* STOP — big, brand blue */}
            <button
              onClick={onStop}
              className="h-16 w-16 rounded-full grid place-items-center transition-all active:scale-90 hover:scale-105 shadow-[0_8px_24px_-6px_rgba(37,99,235,0.5)]"
              style={{
                // v13.3 (audit T-3): use CSS variable for theme-aware brand gradient.
                background: 'var(--gradient-brand)',
                border: '1px solid rgba(255,255,255,0.18)',
              }}
              aria-label="Остановить и отправить"
            >
              <Square className="h-5 w-5 text-white" fill="currentColor" />
            </button>

            {/* TIMER — replaces LOCK button (v16.8-final).
                Toggles a compact glassmorphism menu with 5 auto-delete options. */}
            <div className="relative">
              <button
                onClick={() => {
                  haptic.tap()
                  setMenuOpen((v) => !v)
                }}
                className="h-11 w-11 rounded-full grid place-items-center transition-all active:scale-90 hover:scale-105 bg-foreground/8 border border-border/60 text-muted-foreground"
                aria-label="Таймер автоудаления"
                aria-expanded={menuOpen}
              >
                <Timer className="h-4 w-4" />
              </button>

              {/* Compact glassmorphism menu — pops up ABOVE the timer button.
                  5 options, each a single row with label + checkmark for the
                  currently selected one. Closes on select or outside-click. */}
              <AnimatePresence>
                {menuOpen && (
                  <>
                    {/* Click-away catcher — transparent, full-screen. */}
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setMenuOpen(false)}
                      aria-hidden
                    />
                    <motion.div
                      initial={{ opacity: 0, y: 8, scale: 0.92 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 8, scale: 0.92 }}
                      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                      className="absolute z-50 right-0 bottom-full mb-2 w-[200px] rounded-2xl overflow-hidden"
                      style={{
                        background: 'color-mix(in oklch, var(--card) 86%, transparent)',
                        backdropFilter: 'blur(24px) saturate(160%)',
                        WebkitBackdropFilter: 'blur(24px) saturate(160%)',
                        border: '1px solid color-mix(in oklch, var(--border) 80%, transparent)',
                        boxShadow:
                          '0 12px 32px -8px rgba(15,23,42,0.25), 0 0 0 1px rgba(255,255,255,0.04) inset',
                      }}
                      role="menu"
                      aria-label="Время автоудаления"
                    >
                      <div className="px-3 pt-2.5 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
                        Автоудаление
                      </div>
                      {SELF_DESTRUCT_OPTIONS.map((opt) => {
                        const active = opt.value === selfDestructMinutes
                        return (
                          <button
                            key={opt.value}
                            onClick={() => handleSelect(opt.value)}
                            className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left transition-colors hover:bg-foreground/5"
                            role="menuitemradio"
                            aria-checked={active}
                          >
                            <span className="flex flex-col">
                              <span className="text-[13px] font-medium text-foreground leading-tight">
                                {opt.label}
                              </span>
                              <span className="text-[10px] text-muted-foreground/70 leading-tight">
                                {opt.hint}
                              </span>
                            </span>
                            {active && (
                              <Check
                                className="h-3.5 w-3.5 shrink-0"
                                style={{ color: 'var(--primary)' }}
                                strokeWidth={3}
                              />
                            )}
                          </button>
                        )
                      })}
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Hint */}
          <div className="text-center text-[10px] text-muted-foreground/60 pb-4">
            Голосовое удалится автоматически
          </div>
        </div>
      </div>
    </motion.div>
  )
}
