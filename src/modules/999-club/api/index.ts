/**
 * 999 CLUB — Phase 2 API client.
 *
 * All methods hit the real backend at /api/club/*. The client uses the
 * main app's `api` helper (which adds the Bearer token via `{ auth: true }`
 * and handles 401 globally).
 */

import { api } from '@/lib/api'
import type {
  ClubLanding,
  ClubGift,
  ClubPromo,
  ClubGiveaway,
  ClubBonus,
  ClubTask,
  ClubCoupon,
  ClubEvent,
  ClubReferral,
  ClubPoints,
} from '../types'

export const clubApi = {
  // ===== Landing (single call) =====
  async getLanding(): Promise<ClubLanding> {
    return api.get<ClubLanding>('/api/club/landing', { auth: true })
  },

  // ===== 🎁 Gifts =====
  async listGifts(): Promise<ClubGift[]> {
    const res = await api.get<{ items: ClubGift[] }>('/api/club/gifts', { auth: true })
    return res.items
  },
  async claimGift(giftId: string): Promise<void> {
    await api.post(`/api/club/gifts/${giftId}/claim`, { json: {}, auth: true })
  },

  // ===== 🔥 Promos =====
  async listPromos(): Promise<ClubPromo[]> {
    const res = await api.get<{ items: ClubPromo[] }>('/api/club/promos', { auth: true })
    return res.items
  },

  // ===== 🏆 Giveaways =====
  async listGiveaways(): Promise<ClubGiveaway[]> {
    const res = await api.get<{ items: ClubGiveaway[] }>('/api/club/giveaways', { auth: true })
    return res.items
  },
  async participateInGiveaway(giveawayId: string): Promise<void> {
    await api.post(`/api/club/giveaways/${giveawayId}/participate`, { json: {}, auth: true })
  },

  // ===== ⭐ Bonuses =====
  async listBonuses(): Promise<ClubBonus[]> {
    const res = await api.get<{ items: ClubBonus[] }>('/api/club/bonuses', { auth: true })
    return res.items
  },
  async claimBonus(bonusId: string): Promise<{ pointsAwarded: number }> {
    return api.post<{ pointsAwarded: number }>(`/api/club/bonuses/${bonusId}/claim`, {
      json: {},
      auth: true,
    })
  },

  // ===== 👥 Referral =====
  async getReferral(): Promise<ClubReferral> {
    return api.get<ClubReferral>('/api/club/referral', { auth: true })
  },

  // ===== 🎯 Tasks =====
  async listTasks(): Promise<ClubTask[]> {
    const res = await api.get<{ items: ClubTask[] }>('/api/club/tasks', { auth: true })
    return res.items
  },
  async completeTask(taskId: string): Promise<{ pointsAwarded: number }> {
    return api.post<{ pointsAwarded: number }>(`/api/club/tasks/${taskId}/complete`, {
      json: {},
      auth: true,
    })
  },

  // ===== 🎟 Coupons =====
  async listCoupons(): Promise<ClubCoupon[]> {
    const res = await api.get<{ items: ClubCoupon[] }>('/api/club/coupons', { auth: true })
    return res.items
  },
  async claimCoupon(couponId: string): Promise<{ code: string | null }> {
    return api.post<{ code: string | null }>(`/api/club/coupons/${couponId}/claim`, {
      json: {},
      auth: true,
    })
  },
  /** Validate a coupon code for cart/checkout — returns discount info. */
  async validateCoupon(code: string, cartTotal: number): Promise<{
    valid: boolean
    couponId: string
    title: string
    discount: number
    newTotal: number
  }> {
    return api.post(`/api/club/coupons/validate`, {
      json: { code, cartTotal },
      auth: true,
    })
  },

  // ===== 📅 Events =====
  async listEvents(): Promise<ClubEvent[]> {
    const res = await api.get<{ items: ClubEvent[] }>('/api/club/events', { auth: true })
    return res.items
  },
  async registerForEvent(eventId: string): Promise<void> {
    await api.post(`/api/club/events/${eventId}/register`, { json: {}, auth: true })
  },

  // ===== Points =====
  async getPoints(): Promise<ClubPoints> {
    return api.get<ClubPoints>('/api/club/points', { auth: true })
  },

  // ===== Leaderboard =====
  async getLeaderboard(): Promise<{
    leaderboard: Array<{
      rank: number
      id: string
      username: string
      displayName?: string | null
      avatar?: string | null
      pointsEarnedTotal: number
      streakCount: number
      isMe: boolean
    }>
    myRank: number
  }> {
    return api.get('/api/club/leaderboard', { auth: true })
  },

  // ===== Achievements =====
  async getAchievements(): Promise<{
    achievements: Array<{
      key: string
      icon: string
      title: string
      desc: string
      unlocked: boolean
      progress?: number
      total?: number
    }>
    stats: {
      giftClaims: number
      bonusClaims: number
      taskCompletions: number
      orders: number
      referrals: number
      streak: number
    }
  }> {
    return api.get('/api/club/achievements', { auth: true })
  },
}
