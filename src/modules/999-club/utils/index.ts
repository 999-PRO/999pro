/**
 * 999 CLUB — utilities.
 *
 * Pure helpers used by CLUB components. No side effects, no React.
 */

import { CLUB_CONFIG } from '../config'
import type { ClubCardKind, ClubCardMeta } from '../types'

/** Build the CSS gradient string for the CLUB accent. */
export function clubAccentGradient(angle: number = 135): string {
  const { from, via, to } = CLUB_CONFIG.accent
  return `linear-gradient(${angle}deg, ${from} 0%, ${via} 50%, ${to} 100%)`
}

/** Metadata for each card category shown on the landing page. */
export const CLUB_CARDS: ClubCardMeta[] = [
  {
    kind: 'gifts',
    emoji: '🎁',
    title: 'Подарки',
    subtitle: 'Эксклюзивные подарки для участников клуба',
    icon: 'Gift',
    accent: 'amber',
  },
  {
    kind: 'promos',
    emoji: '🔥',
    title: 'Акции',
    subtitle: 'Ограниченные по времени скидки и предложения',
    icon: 'Flame',
    accent: 'rose',
  },
  {
    kind: 'giveaways',
    emoji: '🏆',
    title: 'Розыгрыши',
    subtitle: 'Участвуйте и выигрывайте ценные призы',
    icon: 'Trophy',
    accent: 'amber',
  },
  {
    kind: 'bonuses',
    emoji: '⭐',
    title: 'Бонусы',
    subtitle: 'Накапливайте баллы и обменивайте на подарки',
    icon: 'Star',
    accent: 'violet',
  },
  {
    kind: 'referrals',
    emoji: '👥',
    title: 'Пригласи друга',
    subtitle: 'Бонусы за каждого приглашённого участника',
    icon: 'Users',
    accent: 'emerald',
  },
  {
    kind: 'tasks',
    emoji: '🎯',
    title: 'Задания',
    subtitle: 'Выполняйте задания и получайте награды',
    icon: 'Target',
    accent: 'sky',
  },
  {
    kind: 'coupons',
    emoji: '🎟',
    title: 'Купоны',
    subtitle: 'Промокоды и скидочные купоны',
    icon: 'Ticket',
    accent: 'pink',
  },
  {
    kind: 'events',
    emoji: '📅',
    title: 'События',
    subtitle: 'Эксклюзивные мероприятия для участников',
    icon: 'CalendarDays',
    accent: 'violet',
  },
]

/** Get a card's metadata by kind. */
export function getCardMeta(kind: ClubCardKind): ClubCardMeta | undefined {
  return CLUB_CARDS.find((c) => c.kind === kind)
}

/**
 * Map an accent name to a CSS gradient. Each accent is a 3-stop linear
 * gradient tuned to feel premium and on-brand with 999 — Три девятки's existing
 * palette.
 */
export function accentGradient(accent: ClubCardMeta['accent']): string {
  switch (accent) {
    case 'amber':
      return 'linear-gradient(135deg, #f59e0b 0%, #f97316 50%, #ef4444 100%)'
    case 'rose':
      return 'linear-gradient(135deg, #f43f5e 0%, #ec4899 50%, #d946ef 100%)'
    case 'violet':
      return 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 50%, #6366f1 100%)'
    case 'emerald':
      return 'linear-gradient(135deg, #10b981 0%, #059669 50%, #047857 100%)'
    case 'sky':
      return 'linear-gradient(135deg, #0ea5e9 0%, #3b82f6 50%, #6366f1 100%)'
    case 'pink':
      return 'linear-gradient(135deg, #ec4899 0%, #d946ef 50%, #a855f7 100%)'
    default:
      return clubAccentGradient()
  }
}

/** Format a date range (e.g. "7–14 июля"). */
export function formatDateRange(start?: string, end?: string): string {
  if (!start && !end) return ''
  const fmt = (d?: string) => {
    if (!d) return ''
    const date = new Date(d)
    return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
  }
  if (start && end) return `${fmt(start)} — ${fmt(end)}`
  return fmt(start || end)
}
