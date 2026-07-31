'use client'

// ============================================================================
// CountBadge — unified count/notification badge for the entire 999 — Три девятки app.
//
// Design:
//   • Blue→blue→purple brand gradient (matches gradient-brand utility)
//   • Glassmorphism: subtle translucent overlay + backdrop-blur
//   • Light digits (white text)
//   • Soft premium shadow
//   • Ring for contrast against any background
//
// Usage:
//   <CountBadge count={5} />
//   <CountBadge count={120} max={99} />  // shows "99+"
//   <CountBadge dot />                    // small dot without number
//
// Replaces all previous red/destructive badges for non-error counters.
// For ERROR/CRITICAL states (e.g. live recording dot) use a dedicated red
// element instead — counters should always use the brand gradient.
// ============================================================================

import { cn } from '@/lib/utils'

export interface CountBadgeProps {
  /** The number to display. 0 or negative → badge not rendered. */
  count?: number
  /** Maximum value before showing "N+". Default: 99. */
  max?: number
  /** Render as a small dot (8px) without a number. */
  dot?: boolean
  /** Extra classes for positioning (e.g. "absolute -top-1 -right-1"). */
  className?: string
  /** Ring color override. Default: white/90 (light) / white/15 (dark). */
  ringClass?: string
  /** Size variant. Default: 'sm' (20px). */
  size?: 'xs' | 'sm' | 'md'
}

const SIZE_CLASSES: Record<NonNullable<CountBadgeProps['size']>, string> = {
  xs: 'h-[16px] min-w-[16px] px-1 text-[9px]',
  sm: 'h-[20px] min-w-[20px] px-1.5 text-[10px]',
  md: 'h-[24px] min-w-[24px] px-2 text-[11px]',
}

export function CountBadge({
  count = 0,
  max = 99,
  dot = false,
  className,
  ringClass,
  size = 'sm',
}: CountBadgeProps) {
  if (!dot && count <= 0) return null

  const display = dot ? null : count > max ? `${max}+` : String(count)

  return (
    <span
      className={cn(
        // Layout
        'absolute grid place-items-center rounded-full font-bold tabular-nums leading-none',
        // Size
        dot ? 'h-2.5 w-2.5' : SIZE_CLASSES[size],
        // Brand gradient + glass overlay
        'gradient-brand text-white',
        // Subtle inner highlight for glass feel
        'before:content-[""] before:absolute before:inset-0 before:rounded-full before:bg-white/10 before:pointer-events-none',
        // Ring for contrast (configurable)
        ringClass ?? 'ring-2 ring-white/90 dark:ring-white/15',
        // Soft shadow
        'shadow-[0_2px_8px_-1px_rgba(37,99,235,0.45),0_1px_2px_-1px_rgba(0,0,0,0.15)]',
        // Enter animation
        'animate-scale-in',
        className,
      )}
      style={{
        // Ensure the gradient stays vibrant in dark mode
        backgroundImage: 'var(--gradient-brand)',
      }}
    >
      {display}
    </span>
  )
}
