/**
 * 999 CLUB — Phase 2 type definitions.
 *
 * All types used inside the module. These mirror the Prisma models on the
 * backend. The `landing` endpoint returns these shapes with additional
 * per-user flags (`claimedByMe`, `isParticipating`, `isCompleted`, etc.).
 */

/** Common fields shared by every CLUB entity. */
export interface ClubEntityBase {
  id: string
  title: string
  description?: string | null
  image?: string | null
  startsAt?: string | null
  endsAt?: string | null
  active: boolean
  order: number
  createdAt: string
  updatedAt: string
}

// ===== 🎁 GIFTS =====
export interface ClubGift extends ClubEntityBase {
  pointsCost: number
  quantity?: number | null
  claimedCount: number
  /** Whether the current user has already claimed this gift. */
  claimedByMe?: boolean
  /** Remaining quantity (null = unlimited). */
  remaining?: number | null
}

// ===== 🔥 PROMOS =====
export interface ClubPromo extends ClubEntityBase {
  promoCode?: string | null
  discountPercent?: number | null
  linkedProductIds?: string[] | null
  ctaText: string
  ctaUrl?: string | null
}

// ===== 🏆 GIVEAWAYS =====
export interface ClubGiveaway extends ClubEntityBase {
  winnersCount: number
  // Override drawAt to be required (giveaways always have a draw date)
  drawAt: string
  drawnAt?: string | null
  winnerIds?: string[] | null
  participantsCount?: number
  isParticipating?: boolean
}

// ===== ⭐ BONUSES =====
export interface ClubBonus extends ClubEntityBase {
  pointsReward: number
  claimedByMe?: boolean
}

// ===== 👥 REFERRALS =====
export interface ClubReferral {
  referralCode: string
  referralCount: number
  pointsFromReferrals: number
}

// ===== 🎯 TASKS =====
export interface ClubTask extends ClubEntityBase {
  taskType: 'daily' | 'one-time'
  pointsReward: number
  giftRewardId?: string | null
  actionKey?: string | null
  isCompleted?: boolean
}

// ===== 🎟 COUPONS =====
export interface ClubCoupon extends ClubEntityBase {
  code?: string | null
  discountType: 'percent' | 'fixed'
  discountValue: number
  category?: string | null
  linkedProductIds?: string[] | null
  quantity?: number | null
  usedCount: number
  remaining?: number | null
  claimedByMe?: boolean
}

// ===== 📅 EVENTS =====
export interface ClubEvent extends ClubEntityBase {
  // Override startsAt to be required (events always have a start date)
  startsAt: string
  location?: string | null
  endsAt?: string | null
  maxAttendees?: number | null
  attendeesCount?: number
  isRegistered?: boolean
}

// ===== POINTS =====
export interface PointsTransaction {
  id: string
  userId: string
  delta: number
  reason: string
  entityId?: string | null
  entityType?: string | null
  createdAt: string
}

export interface ClubPoints {
  balance: number
  earnedTotal: number
  transactions: PointsTransaction[]
}

// ===== LANDING (single call returning everything) =====
export interface ClubLanding {
  gifts: ClubGift[]
  promos: ClubPromo[]
  giveaways: ClubGiveaway[]
  bonuses: ClubBonus[]
  tasks: ClubTask[]
  coupons: ClubCoupon[]
  events: ClubEvent[]
  points: number
  pointsEarnedTotal: number
  referralCode: string | null
  referralCount: number
  streakCount: number
}

// ===== LEADERBOARD =====
export interface LeaderboardEntry {
  rank: number
  id: string
  username: string
  displayName?: string | null
  avatar?: string | null
  pointsEarnedTotal: number
  streakCount: number
  isMe: boolean
}

export interface LeaderboardData {
  leaderboard: LeaderboardEntry[]
  myRank: number
}

/** The card categories shown on the CLUB landing page. */
export type ClubCardKind =
  | 'gifts'
  | 'promos'
  | 'giveaways'
  | 'bonuses'
  | 'referrals'
  | 'tasks'
  | 'coupons'
  | 'events'

/** Metadata for a card category (used by the landing page grid). */
export interface ClubCardMeta {
  kind: ClubCardKind
  emoji: string
  title: string
  subtitle: string
  icon: string
  accent: 'amber' | 'pink' | 'violet' | 'emerald' | 'sky' | 'rose'
}
