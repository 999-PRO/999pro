'use client'

/**
 * ClubNavBadge — the CLUB button for the bottom nav (mobile) and sidebar
 * (desktop).
 *
 * Visual identity (matches 999 — Три девятки's design language, NOT copied from
 * any other app):
 *   - The icon sits in a gradient chip (amber→pink→violet) so it stands
 *     out from the other nav items (which are flat icons).
 *   - When `hasUnread` is true, a small amber dot pulses in the top-right
 *     corner and a soft glow ring breathes around the chip.
 *   - Hover lifts the chip slightly (no aggressive scale).
 *   - The active state uses the same `mobile-nav-pill-active` class as
 *     the other nav items so it feels native to the existing nav.
 *
 * The badge is intentionally calm — no flashing, no bounce. Just a
 * gentle pulse + glow that signals "something new in CLUB" without
 * being annoying.
 */

import { motion } from 'framer-motion'
import { Crown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { haptic } from '@/lib/haptic'
import { useClubStore } from '../store'
import { badgePulse, glowRing } from '../animations'

interface ClubNavBadgeProps {
  active: boolean
  onClick: () => void
  /** Whether to render the label under the icon (mobile bottom nav). */
  showLabel?: boolean
  label?: string
}

export function ClubNavBadge({
  active,
  onClick,
  showLabel = true,
  label = 'CLUB',
}: ClubNavBadgeProps) {
  const hasUnread = useClubStore((s) => s.hasUnread)

  return (
    <button
      type="button"
      onClick={() => {
        haptic.tap()
        onClick()
      }}
      className={cn(
        'relative flex flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] transition-colors mobile-nav-item',
        active && 'mobile-nav-item-active',
      )}
      aria-current={active ? 'page' : undefined}
      aria-label="999 CLUB"
    >
      <motion.span
        variants={glowRing}
        initial={false}
        animate={hasUnread && !active ? 'glow' : 'idle'}
        className={cn(
          'relative grid place-items-center h-8 w-11 rounded-full transition-all',
          active && 'mobile-nav-pill-active',
        )}
        style={
          !active
            ? {
                // Subtle gradient wash on the chip so CLUB stands out even
                // when inactive. Active state uses the standard pill style.
                backgroundImage:
                  'linear-gradient(135deg, rgba(245,158,11,0.12) 0%, rgba(236,72,153,0.10) 50%, rgba(139,92,246,0.12) 100%)',
              }
            : undefined
        }
      >
        <Crown
          className="h-5 w-5"
          strokeWidth={active ? 2.4 : 2}
          style={{
            // Tint the icon with the CLUB gradient when inactive.
            color: active ? 'currentColor' : '#d97706',
          }}
        />

        {/* Unread badge — a small amber dot that pulses. */}
        {hasUnread && (
          <motion.span
            variants={badgePulse}
            initial={false}
            animate="pulse"
            className="absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full"
            style={{
              background: 'linear-gradient(135deg, #f59e0b 0%, #ec4899 100%)',
              boxShadow: '0 0 8px rgba(245, 158, 11, 0.6)',
            }}
            aria-hidden
          />
        )}
      </motion.span>

      {showLabel && <span className="font-medium leading-none">{label}</span>}
    </button>
  )
}
