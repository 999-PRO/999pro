'use client'

/**
 * ClubEntityCard — a single entity row inside a ClubEntitySheet.
 *
 * Premium glass card with: optional image, title, description, optional
 * meta row (date/count/etc.), and an action button. The parent decides
 * what the action button does (claim, participate, register, etc.).
 */

import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import type { ClubCardMeta } from '../types'
import { accentGradient } from '../utils'

interface ClubEntityCardProps {
  meta: ClubCardMeta
  image?: string | null
  title: string
  description?: string | null
  /** Meta row content (e.g. "Осталось 5 шт." or "До конца: 3 дня"). */
  metaRow?: React.ReactNode
  /** Action button label (e.g. "Получить", "Участвовать"). */
  actionLabel?: string
  /** Whether the action is disabled (e.g. already claimed). */
  actionDisabled?: boolean
  /** Whether the action is in a loading state. */
  actionLoading?: boolean
  onAction?: () => void
  /** Optional badge in the top-right corner (e.g. "Получено ✓"). */
  badge?: string
  children?: React.ReactNode
}

export function ClubEntityCard({
  meta,
  image,
  title,
  description,
  metaRow,
  actionLabel,
  actionDisabled,
  actionLoading,
  onAction,
  badge,
  children,
}: ClubEntityCardProps) {
  const gradient = accentGradient(meta.accent)

  return (
    <div
      className={cn(
        'relative rounded-2xl glass border border-border/40 overflow-hidden',
        'transition-all duration-300',
      )}
    >
      <div className="flex gap-3 p-3">
        {/* Image / icon */}
        {image ? (
          <div className="h-16 w-16 rounded-xl overflow-hidden shrink-0 bg-foreground/5">
            <img src={image} alt="" className="w-full h-full object-cover" loading="lazy" />
          </div>
        ) : (
          <div
            className="h-16 w-16 rounded-xl grid place-items-center shrink-0 shadow-glow"
            style={{ backgroundImage: gradient }}
          >
            <span className="text-2xl">{meta.emoji}</span>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-bold text-sm leading-tight line-clamp-2">{title}</h3>
            {badge && (
              <span className="shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                {badge}
              </span>
            )}
          </div>
          {description && (
            <p className="text-xs text-muted-foreground line-clamp-2 mt-1">{description}</p>
          )}
          {metaRow && (
            <div className="text-[11px] text-muted-foreground mt-1">{metaRow}</div>
          )}
          {children}
        </div>
      </div>

      {/* Action button */}
      {actionLabel && (
        <div className="px-3 pb-3">
          <motion.button
            type="button"
            whileTap={{ scale: 0.98 }}
            onClick={onAction}
            disabled={actionDisabled || actionLoading}
            className={cn(
              'w-full h-10 rounded-xl font-semibold text-sm transition-all',
              actionDisabled
                ? 'bg-foreground/5 text-muted-foreground cursor-not-allowed'
                : 'text-white shadow-glow hover:opacity-90',
            )}
            style={
              !actionDisabled
                ? { backgroundImage: gradient }
                : undefined
            }
          >
            {actionLoading ? '…' : actionLabel}
          </motion.button>
        </div>
      )}
    </div>
  )
}
