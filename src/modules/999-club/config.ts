/**
 * 999 CLUB — module configuration.
 *
 * Central place to change the module's display name, accent color, and
 * feature flags. Edit this single file to rebrand the module (e.g. to
 * "999 Центр" or any other name) without touching the components.
 *
 * Design rationale:
 *   - Single source of truth for branding / i18n of the module.
 *   - The `name` field is what users see in the bottom nav and headers.
 *   - The `accent` field drives the gradient used across all CLUB cards
 *     and the badge in the bottom nav.
 *   - Feature flags let us ship the module with empty placeholder cards
 *     (Phase 1) and flip them on later without rewriting components.
 */

export const CLUB_CONFIG = {
  /** Display name shown in the bottom nav, page header, and studio. */
  name: 'CLUB',
  /** Full name shown on the page hero. */
  fullName: '999 CLUB',
  /** Tagline shown under the hero. */
  tagline: 'VIP-зона привилегий, подарков и акций',
  /** Icon name from lucide-react used in the bottom nav. */
  icon: 'Crown' as const,
  /** Emoji used in compact contexts (PWA shortcut, push notifications). */
  emoji: '💎',
  /** Accent gradient stops (CSS hex). Used by .gradient-club utility. */
  accent: {
    from: '#f59e0b', // amber-500
    via: '#ec4899',  // pink-500
    to: '#8b5cf6',   // violet-500
  },
  /** Whether the auto-hide badge in the bottom nav is enabled. */
  badge: {
    enabled: true,
    /** Number of unread CLUB events. Replace with a real store later. */
    count: 0,
  },
} as const

/**
 * Feature flags — each card type can be enabled/disabled independently.
 * In Phase 1 all flags are `true` (cards render as premium placeholders).
 * Future phases will wire each card to real data.
 */
export const CLUB_FEATURES = {
  gifts: true,        // 🎁 Подарки
  promos: true,       // 🔥 Акции
  giveaways: true,    // 🏆 Розыгрыши
  bonuses: true,      // ⭐ Бонусы
  referrals: true,    // 👥 Пригласи друга
  tasks: true,        // 🎯 Задания
  coupons: true,      // 🎟 Купоны
  events: true,       // 📅 События
} as const

export type ClubFeatureKey = keyof typeof CLUB_FEATURES
