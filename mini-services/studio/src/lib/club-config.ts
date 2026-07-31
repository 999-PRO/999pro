/**
 * 999 CLUB — Studio configuration mirror.
 *
 * This mirrors the main app's `src/modules/999-club/config.ts` so the Studio
 * admin panel can render CLUB-branded headers without importing across the
 * app/studio boundary (which Next.js doesn't support — they're separate
 * Next.js apps with separate `src/` trees).
 *
 * Keep these two files in sync when rebranding the module.
 */

export const CLUB_CONFIG = {
  name: 'CLUB',
  fullName: '999 CLUB',
  tagline: 'VIP-зона привилегий, подарков и акций',
  icon: 'Crown' as const,
  emoji: '💎',
  accent: {
    from: '#f59e0b',
    via: '#ec4899',
    to: '#8b5cf6',
  },
} as const
