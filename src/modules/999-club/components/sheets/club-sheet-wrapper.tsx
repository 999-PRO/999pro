'use client'

/**
 * ClubSheetWrapper — shared wrapper for all CLUB entity sheets.
 *
 * Provides: backdrop, spring entrance animation, header with gradient
 * accent + emoji + title + close button. The body is scrollable.
 * Each sheet passes its own children.
 */

import { motion } from 'framer-motion'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ClubCardMeta } from '../../types'
import { accentGradient } from '../../utils'
import { sheetEntrance } from '../../animations'

interface ClubSheetWrapperProps {
  meta: ClubCardMeta
  onClose: () => void
  /** Optional extra content in the header (e.g. points balance, countdown). */
  headerExtra?: React.ReactNode
  /** Optional subtitle override. */
  subtitle?: string
  children: React.ReactNode
}

export function ClubSheetWrapper({
  meta,
  onClose,
  headerExtra,
  subtitle,
  children,
}: ClubSheetWrapperProps) {
  const gradient = accentGradient(meta.accent)

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-[200] flex items-end md:items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}
    >
      <motion.div
        variants={sheetEntrance}
        initial="hidden"
        animate="visible"
        exit="exit"
        className={cn(
          'relative w-full md:max-w-2xl max-h-[92vh] md:max-h-[88vh] flex flex-col',
          'rounded-t-[32px] md:rounded-[32px] overflow-hidden',
          'glass-strong border border-border/40 shadow-glow-lg',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top accent bar */}
        <div aria-hidden className="absolute top-0 left-0 right-0 h-1.5" style={{ backgroundImage: gradient }} />

        {/* Drag handle (mobile) */}
        <div className="md:hidden flex justify-center pt-2 pb-1">
          <div className="h-1 w-10 rounded-full bg-foreground/20" />
        </div>

        {/* Header */}
        <div className="shrink-0 p-5 pb-4 border-b border-border/30">
          <div className="flex items-center gap-3">
            <div
              className="h-11 w-11 rounded-2xl grid place-items-center shrink-0 shadow-glow"
              style={{ backgroundImage: gradient }}
            >
              <span className="text-xl">{meta.emoji}</span>
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-xl font-bold tracking-tight truncate">{meta.title}</h2>
              <p className="text-xs text-muted-foreground truncate">{subtitle || meta.subtitle}</p>
            </div>
            <button
              onClick={onClose}
              aria-label="Закрыть"
              className="h-9 w-9 rounded-full grid place-items-center hover:bg-foreground/10 transition-colors shrink-0"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          {headerExtra && <div className="mt-4">{headerExtra}</div>}
        </div>

        {/* Body — scrollable */}
        <div className="flex-1 overflow-y-auto overscroll-contain">
          {children}
        </div>
      </motion.div>
    </motion.div>
  )
}
