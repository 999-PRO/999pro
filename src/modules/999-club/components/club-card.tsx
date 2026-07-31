'use client'

/**
 * ClubCard — the signature card of the 999 CLUB module (Phase 3).
 *
 * Each card has its OWN unique visual identity based on `meta.accent`:
 *   - The icon chip uses the card's accent gradient
 *   - The corner glow matches the accent
 *   - Hover lift + glow intensify
 *   - A count badge shows how many items are inside
 *
 * Cards are now 2-per-row on mobile (was 1) for a denser, more
 * visually-rich landing grid.
 */

import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { haptic } from '@/lib/haptic'
import { accentGradient } from '../utils'
import type { ClubCardMeta } from '../types'
import {
  Gift, Flame, Trophy, Star, Users, Target, Ticket, CalendarDays,
  type LucideIcon,
} from 'lucide-react'

const ICONS: Record<string, LucideIcon> = {
  Gift, Flame, Trophy, Star, Users, Target, Ticket, CalendarDays,
}

interface ClubCardProps {
  meta: ClubCardMeta
  onClick?: () => void
  /** Optional count badge (number of items inside). */
  count?: number
}

export function ClubCard({ meta, onClick, count }: ClubCardProps) {
  const Icon = ICONS[meta.icon] ?? Gift
  const gradient = accentGradient(meta.accent)

  return (
    <motion.button
      type="button"
      onClick={() => { haptic.tap(); onClick?.() }}
      whileTap={{ scale: 0.96 }}
      whileHover={{ y: -3 }}
      className={cn(
        'group relative w-full text-left overflow-hidden',
        'rounded-3xl p-4',
        'glass-strong border border-border/40',
        'transition-all duration-300',
        'hover:shadow-glow-lg',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary',
      )}
      style={{
        backgroundImage: `radial-gradient(circle at 100% 0%, ${hexWithAlpha(gradientStop(meta.accent), 0.18)} 0%, transparent 55%)`,
      }}
      aria-label={`${meta.title} — ${meta.subtitle}`}
    >
      {/* Icon chip with gradient */}
      <div className="relative mb-3">
        <div
          className="relative h-12 w-12 rounded-2xl grid place-items-center shadow-glow"
          style={{ backgroundImage: gradient }}
        >
          <Icon className="h-6 w-6 text-white" strokeWidth={2.2} />
          {/* Inner highlight */}
          <span
            aria-hidden
            className="absolute inset-0 rounded-2xl"
            style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.25) 0%, rgba(255,255,255,0) 60%)' }}
          />
        </div>
        {/* Count badge */}
        {count != null && count > 0 && (
          <span
            className="absolute -top-1 -right-1 h-5 min-w-5 px-1 rounded-full text-[10px] font-bold grid place-items-center text-white shadow-glow"
            style={{ background: gradient }}
          >
            {count}
          </span>
        )}
      </div>

      {/* Title + subtitle */}
      <h3 className="font-bold text-sm leading-tight mb-0.5 line-clamp-1">{meta.title}</h3>
      <p className="text-[11px] text-muted-foreground line-clamp-2 leading-snug">{meta.subtitle}</p>

      {/* Decorative corner glow on hover */}
      <div
        aria-hidden
        className="absolute -top-10 -right-10 h-24 w-24 rounded-full blur-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
        style={{ background: gradientStop(meta.accent), opacity: 0.2 }}
      />
    </motion.button>
  )
}

function gradientStop(accent: ClubCardMeta['accent']): string {
  switch (accent) {
    case 'amber': return '#f97316'
    case 'rose': return '#ec4899'
    case 'violet': return '#7c3aed'
    case 'emerald': return '#059669'
    case 'sky': return '#3b82f6'
    case 'pink': return '#d946ef'
    default: return '#8b5cf6'
  }
}

function hexWithAlpha(hex: string, alpha: number): string {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
