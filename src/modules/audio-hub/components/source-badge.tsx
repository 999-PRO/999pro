'use client'

// ============================================================================
// SourceBadge — small colored chip showing where a track comes from.
// ----------------------------------------------------------------------------
// v16.17: Removed text labels (user feedback: "убери название источников").
//         Now shows ONLY a colored dot + emoji icon. The color identifies the
//         source at a glance, the emoji hints at the source type.
//
// Used in audio-card, audio-full-player, and audio-chat-card.
// ============================================================================

import type { AudioHubTrack } from '@/modules/audio-hub/types'

interface SourceBadgeProps {
  source: AudioHubTrack['source']
  /** Size variant. */
  size?: 'sm' | 'md'
}

interface SourceConfig {
  emoji: string
  /** Tailwind-style inline style for the badge background. */
  bg: string
  color: string
}

const SOURCE_CONFIG: Record<string, SourceConfig> = {
  // hitmos — музыкальный сервис (красный, нота)
  hitmos: {
    emoji: '🎵',
    bg: 'rgba(239, 68, 68, 0.18)',
    color: '#ef4444',
  },
  // muzce — музыкальный сервис с чеченской музыкой (фиолетовый, две ноты)
  muzce: {
    emoji: '🎶',
    bg: 'rgba(168, 85, 247, 0.18)',
    color: '#a855f7',
  },
  // radio — радио (оранжевый, антенна)
  radio: {
    emoji: '📻',
    bg: 'rgba(245, 158, 11, 0.18)',
    color: '#f59e0b',
  },
  // quran — Коран (зелёный, книга)
  quran: {
    emoji: '📖',
    bg: 'rgba(34, 197, 94, 0.18)',
    color: '#22c55e',
  },
}

export function SourceBadge({ source, size = 'sm' }: SourceBadgeProps) {
  const config = SOURCE_CONFIG[source] || {
    emoji: '♪',
    bg: 'rgba(100, 100, 100, 0.18)',
    color: '#6b7280',
  }

  const dim = size === 'sm' ? 16 : 20
  const emojiSize = size === 'sm' ? '10px' : '12px'

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: dim,
        height: dim,
        borderRadius: '50%',
        background: config.bg,
        color: config.color,
        fontSize: emojiSize,
        lineHeight: 1,
        fontWeight: 700,
        whiteSpace: 'nowrap',
        userSelect: 'none',
        flexShrink: 0,
      }}
      aria-label={source}
      title={source}
    >
      {config.emoji}
    </span>
  )
}

export { SOURCE_CONFIG }
