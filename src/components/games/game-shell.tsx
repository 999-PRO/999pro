'use client'

// ============================================================================
// v25.24 — ИГРОВОЙ КЛУБ: полноэкранная игровая оболочка (редизайн).
//   • Портал в document.body, fixed, z-[700] — поверх всего приложения.
//   • ПОЛНОСТЬЮ на весь экран: 100dvw/100dvh + safe-area со всех сторон,
//     requestFullscreen вызывается хабом по клику; Esc/✕ = выход.
//   • ТЕМЫ: светлая и тёмная (next-themes). Через CSS-переменные --g-*
//     игры получают фон/карточки/текст/границы — никакой жёсткой «черноты».
//   • Шапка: выход ✕, название, тумблер звука. Фон с ауророй в цвете игры.
// ============================================================================

import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { useTheme } from 'next-themes'
import { X, Volume2, VolumeX } from 'lucide-react'
import { sfx } from '@/lib/games/sfx'
import { useScrollLock } from '@/lib/use-scroll-lock'

export interface GameShellProps {
  title: string
  emoji: string
  /** акцентный цвет игры — для ауроры и шапки, напр. '#F59E0B' */
  accent: string
  onExit: () => void
  children: ReactNode
}

export function GameShell({ title, emoji, accent, onExit, children }: GameShellProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const { resolvedTheme } = useTheme()
  const isLight = resolvedTheme === 'light'
  useScrollLock(true)

  // Esc = выход
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onExit()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onExit])

  // при размонтировании — выходим из системного fullscreen, если включали
  useEffect(() => {
    return () => {
      try {
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
      } catch {}
    }
  }, [])

  const toggleSound = () => {
    const next = !sfx.isMuted()
    sfx.setMuted(next)
    if (!next) sfx.click()
  }

  if (typeof document === 'undefined') return null

  // ---- Тематические токены (передаются через CSS-переменные --g-*) ----
  const vars = isLight
    ? ({
        '--g-bg': 'linear-gradient(180deg,#f7f8fc 0%,#eef0f8 55%,#e9ecf6 100%)',
        '--g-fg': '#161a2b',
        '--g-fg-soft': 'rgba(22,26,43,0.62)',
        '--g-fg-mute': 'rgba(22,26,43,0.42)',
        '--g-card': 'rgba(255,255,255,0.86)',
        '--g-card-solid': '#ffffff',
        '--g-border': 'rgba(22,26,43,0.10)',
        '--g-chip': 'rgba(22,26,43,0.05)',
        '--g-chip-border': 'rgba(22,26,43,0.09)',
        '--g-header-border': 'rgba(22,26,43,0.08)',
        '--g-btn': 'rgba(22,26,43,0.05)',
        '--g-btn-hover': 'rgba(22,26,43,0.10)',
        '--g-accent-soft': `${accent}1c`,
        '--g-shadow': '0 18px 50px -24px rgba(22,26,43,0.28)',
      } as React.CSSProperties)
    : ({
        '--g-bg': 'radial-gradient(120% 90% at 50% 0%, #171a2e 0%, #0b0d18 55%, #07080f 100%)',
        '--g-fg': '#f6f7ff',
        '--g-fg-soft': 'rgba(246,247,255,0.72)',
        '--g-fg-mute': 'rgba(246,247,255,0.45)',
        '--g-card': 'rgba(255,255,255,0.055)',
        '--g-card-solid': '#151829',
        '--g-border': 'rgba(255,255,255,0.10)',
        '--g-chip': 'rgba(255,255,255,0.06)',
        '--g-chip-border': 'rgba(255,255,255,0.11)',
        '--g-header-border': 'rgba(255,255,255,0.07)',
        '--g-btn': 'rgba(255,255,255,0.07)',
        '--g-btn-hover': 'rgba(255,255,255,0.14)',
        '--g-accent-soft': `${accent}30`,
        '--g-shadow': '0 30px 70px -30px rgba(0,0,0,0.8)',
      } as React.CSSProperties)

  return createPortal(
    <motion.div
      ref={rootRef}
      initial={{ opacity: 0, scale: 1.04 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 1.04 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className="fixed inset-0 z-[700] flex flex-col overflow-hidden select-none game-shell"
      style={{
        // надёжное покрытие на мобильных (адресная строка)
        width: '100vw',
        height: '100dvh',
        background: 'var(--g-bg)',
        color: 'var(--g-fg)',
        ...vars,
      }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      {/* аурора в цвете игры */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 w-[80%] h-64"
        style={{ background: `radial-gradient(ellipse at center, ${accent}${isLight ? '20' : '38'} 0%, transparent 70%)`, filter: 'blur(24px)' }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-32 -right-20 w-96 h-96 rounded-full opacity-25"
        style={{ background: `radial-gradient(circle at center, ${accent}${isLight ? '16' : '26'} 0%, transparent 70%)`, filter: 'blur(30px)' }}
      />

      {/* шапка игры */}
      <header
        className="relative z-10 flex items-center gap-3 px-3 pt-[max(env(safe-area-inset-top),0.6rem)] pb-2 md:px-5"
        style={{ borderBottom: '1px solid var(--g-header-border)' }}
      >
        <button
          onClick={() => { sfx.whoosh(-1); onExit() }}
          aria-label="Выйти из игры"
          className="h-10 w-10 shrink-0 rounded-full grid place-items-center bg-[var(--g-btn)] border border-[var(--g-chip-border)] backdrop-blur-md transition-all active:scale-90 hover:bg-[var(--g-btn-hover)]"
          style={{ color: 'var(--g-fg)' }}
        >
          <X className="h-[18px] w-[18px]" strokeWidth={2.4} />
        </button>

        <div className="flex items-center gap-2 min-w-0 flex-1 justify-center">
          <span className="text-xl leading-none shrink-0">{emoji}</span>
          <span className="text-[15px] md:text-base font-extrabold tracking-tight truncate" style={{ color: 'var(--g-fg)' }}>
            {title}
          </span>
        </div>

        <button
          onClick={toggleSound}
          aria-label={sfx.isMuted() ? 'Включить звук' : 'Выключить звук'}
          className="h-10 w-10 shrink-0 rounded-full grid place-items-center bg-[var(--g-btn)] border border-[var(--g-chip-border)] backdrop-blur-md transition-all active:scale-90 hover:bg-[var(--g-btn-hover)]"
          style={{ color: 'var(--g-fg)' }}
        >
          {sfx.isMuted() ? <VolumeX className="h-[17px] w-[17px]" /> : <Volume2 className="h-[17px] w-[17px]" />}
        </button>
      </header>

      {/* игровая зона */}
      <div className="relative z-[5] flex-1 min-h-0 overflow-y-auto overscroll-contain" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 0.5rem)' }}>
        {children}
      </div>
    </motion.div>,
    document.body,
  )
}
