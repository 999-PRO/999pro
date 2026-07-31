'use client'

/**
 * ClubEntitySheet — generic bottom sheet listing entities of a single
 * CLUB card type. Used when the user taps a card on the landing page.
 *
 * Each card type passes its own `renderItem` function to customise how
 * individual entities look (gift card, promo card, giveaway card, etc.).
 * The sheet itself handles: header, scroll, empty state, loading state,
 * and a close button.
 */

import { motion } from 'framer-motion'
import { X, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ClubCardMeta } from '../types'
import { accentGradient } from '../utils'

interface ClubEntitySheetProps<T> {
  meta: ClubCardMeta
  items: T[]
  loading: boolean
  onClose: () => void
  renderItem: (item: T) => React.ReactNode
  /** Optional extra content above the list (e.g. points balance, referral link). */
  headerExtra?: React.ReactNode
}

export function ClubEntitySheet<T>({
  meta,
  items,
  loading,
  onClose,
  renderItem,
  headerExtra,
}: ClubEntitySheetProps<T>) {
  const gradient = accentGradient(meta.accent)

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-[200] flex items-end md:items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ y: '100%', opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: '100%', opacity: 0 }}
        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        className={cn(
          'relative w-full md:max-w-2xl max-h-[90vh] md:max-h-[85vh] flex flex-col',
          'rounded-t-[28px] md:rounded-[28px] overflow-hidden',
          'glass-strong border border-border/40 shadow-glow-lg',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header with gradient accent */}
        <div className="relative shrink-0 p-5 pb-4 border-b border-border/30">
          <div
            aria-hidden
            className="absolute top-0 left-0 right-0 h-1"
            style={{ backgroundImage: gradient }}
          />
          <div className="flex items-center gap-3">
            <div
              className="h-11 w-11 rounded-2xl grid place-items-center shrink-0 shadow-glow"
              style={{ backgroundImage: gradient }}
            >
              <span className="text-xl">{meta.emoji}</span>
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-xl font-bold tracking-tight truncate">{meta.title}</h2>
              <p className="text-xs text-muted-foreground truncate">{meta.subtitle}</p>
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

        {/* Body — scrollable list */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Загрузка…</p>
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2 text-center">
              <div className="text-4xl opacity-50">{meta.emoji}</div>
              <p className="text-sm text-muted-foreground">
                Пока пусто. Загляните позже — мы готовим для вас что-то особенное.
              </p>
            </div>
          ) : (
            items.map((item, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: i * 0.04 }}
              >
                {renderItem(item)}
              </motion.div>
            ))
          )}
        </div>
      </motion.div>
    </motion.div>
  )
}
