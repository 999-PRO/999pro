/**
 * 999 CLUB — Studio types mirror.
 *
 * Mirrors the main app's CLUB types so Studio can render/POST the same
 * shapes. Keep in sync with src/modules/999-club/types/index.ts.
 */

export interface ClubGift {
  id: string
  title: string
  description?: string | null
  image?: string | null
  pointsCost: number
  quantity?: number | null
  claimedCount: number
  startsAt?: string | null
  endsAt?: string | null
  active: boolean
  order: number
  createdAt: string
  updatedAt: string
}

export interface ClubPromo {
  id: string
  title: string
  description?: string | null
  image?: string | null
  promoCode?: string | null
  discountPercent?: number | null
  linkedProductIds?: string[] | null
  ctaText: string
  ctaUrl?: string | null
  startsAt?: string | null
  endsAt?: string | null
  active: boolean
  order: number
  createdAt: string
  updatedAt: string
}

export interface ClubGiveaway {
  id: string
  title: string
  description?: string | null
  image?: string | null
  winnersCount: number
  drawAt: string
  drawnAt?: string | null
  winnerIds?: string[] | null
  active: boolean
  order: number
  createdAt: string
  updatedAt: string
}

export interface ClubBonus {
  id: string
  title: string
  description?: string | null
  image?: string | null
  pointsReward: number
  startsAt?: string | null
  endsAt?: string | null
  active: boolean
  order: number
  createdAt: string
  updatedAt: string
}

export interface ClubTask {
  id: string
  title: string
  description?: string | null
  taskType: 'daily' | 'one-time'
  pointsReward: number
  giftRewardId?: string | null
  actionKey?: string | null
  active: boolean
  order: number
  createdAt: string
  updatedAt: string
}

export interface ClubCoupon {
  id: string
  title: string
  description?: string | null
  image?: string | null
  code?: string | null
  discountType: 'percent' | 'fixed'
  discountValue: number
  category?: string | null
  linkedProductIds?: string[] | null
  quantity?: number | null
  usedCount: number
  startsAt?: string | null
  endsAt?: string | null
  active: boolean
  order: number
  createdAt: string
  updatedAt: string
}

export interface ClubEvent {
  id: string
  title: string
  description?: string | null
  image?: string | null
  location?: string | null
  startsAt: string
  endsAt?: string | null
  maxAttendees?: number | null
  active: boolean
  order: number
  createdAt: string
  updatedAt: string
}

export type ClubEntityType = 'gifts' | 'promos' | 'giveaways' | 'bonuses' | 'tasks' | 'coupons' | 'events'

export interface ClubCategoryMeta {
  kind: ClubEntityType
  emoji: string
  title: string
  desc: string
  accent: string
}
