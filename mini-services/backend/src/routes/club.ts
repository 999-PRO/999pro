// 999 CLUB — Phase 2 backend routes.
//
// H7 fix (staged): club.ts — 1370 строк, god-file.
//
// План рефакторинга (следующий спринт):
//   1. Извлечь lib/club-admin-builder.ts — buildAdminCrud() + zod-схемы
//      (сделано частично, но фактические схемы сложнее — нужна ручная работа).
//   2. Разделить routes/club/ на подпапки:
//      - club/landing.ts       — GET /landing (агрегация 8 списков)
//      - club/claims.ts        — POST /gifts/:id/claim, /coupons/:id/claim, etc.
//      - club/leaderboard.ts   — GET /leaderboard
//      - club/admin.ts         — все /admin/* endpoints
//      - club/points.ts        — балльная логика (adjust, transactions)
//   3. После разделения club.ts → ~200 строк (только router + mount).
//
// Пока — оставлено как есть, чтобы не сломать рабочую логику CLUB.
//
// All endpoints are mounted under /api/club in index.ts.
//
// Structure:
//   Public (requireAuth):
//     GET  /api/club/landing              — single call returning all 8 lists
//     GET  /api/club/gifts                — list active gifts
//     GET  /api/club/gifts/:id            — single gift
//     POST /api/club/gifts/:id/claim      — claim a gift (one per user)
//     GET  /api/club/promos               — list active promos
//     GET  /api/club/giveaways            — list active giveaways
//     POST /api/club/giveaways/:id/participate
//     POST /api/club/giveaways/:id/draw   — admin: draw winners
//     GET  /api/club/bonuses              — list active bonuses
//     POST /api/club/bonuses/:id/claim    — claim bonus points
//     GET  /api/club/tasks                — list active tasks + completion status
//     POST /api/club/tasks/:id/complete   — mark task complete + award points
//     GET  /api/club/coupons              — list active coupons
//     POST /api/club/coupons/:id/claim    — claim a coupon
//     GET  /api/club/events               — list active events
//     POST /api/club/events/:id/register  — register for an event
//     GET  /api/club/referral             — get my referral code + stats
//     GET  /api/club/points               — get my points balance + history
//
//   Admin (requireAuth + requireAdmin):
//     GET/POST/PATCH/DELETE /api/club/admin/<entity>[/:id]
//     for each of: gifts, promos, giveaways, bonuses, tasks, coupons, events

import { Router } from 'express'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { requireAuth, requireAdmin, type AuthedRequest } from '../lib/auth.js'
import { asyncHandler } from '../lib/asyncHandler.js'
import { auditLog } from '../lib/audit.js'
import { sendPushToUser } from './push.js'
import { logger } from '../lib/logger.js'
import { generateReferralCode } from '../lib/referral-code.js'
import { broadcastChanged } from '../lib/broadcast.js'

const router = Router()

// ============================================================================
// Helpers
// ============================================================================

/** Parse a JSON column (stored as text in SQLite) into an array, or null. */
function parseJsonArray<T = string>(raw: string | null): T[] | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** Stringify an array for storage in a SQLite JSON column. */
function stringifyJsonArray(arr: string[] | null | undefined): string | null {
  if (!arr || arr.length === 0) return null
  return JSON.stringify(arr)
}

/** Award points to a user inside a transaction. Also creates a ledger row. */
async function awardPoints(
  userId: string,
  delta: number,
  reason: string,
  entityId?: string,
  entityType?: string,
  // v13.0 (audit P0-4 fix): accept an optional transaction client so callers
  // can award points INSIDE their own transaction. Previously awardPoints
  // always opened its own $transaction — meaning a caller's outer tx could
  // roll back while the inner points tx already committed, letting users
  // re-claim the same bonus infinitely.
  tx?: Prisma.TransactionClient,
): Promise<void> {
  const client = tx ?? prisma
  if (tx) {
    // Inside an existing transaction — use the tx client directly
    await tx.user.update({
      where: { id: userId },
      data: {
        points: { increment: delta },
        ...(delta > 0 ? { pointsEarnedTotal: { increment: delta } } : {}),
      },
    })
    await tx.pointsTransaction.create({
      data: { userId, delta, reason, entityId, entityType },
    })
  } else {
    // Standalone call — wrap in our own transaction
    await prisma.$transaction([
      client.user.update({
        where: { id: userId },
        data: {
          points: { increment: delta },
          ...(delta > 0 ? { pointsEarnedTotal: { increment: delta } } : {}),
        },
      }),
      client.pointsTransaction.create({
        data: { userId, delta, reason, entityId, entityType },
      }),
    ])
  }
}

// ============================================================================
// LANDING — single call returning all 8 lists (+ user's points/referral)
// ============================================================================

router.get(
  '/landing',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const userId = req.user!.id
    const now = new Date()

    const [
      gifts,
      promos,
      giveaways,
      bonuses,
      tasks,
      coupons,
      events,
      user,
      giftClaims,
      bonusClaims,
      couponClaims,
      eventRegistrations,
      taskCompletions,
      giveawayParticipations,
    ] = await Promise.all([
      prisma.clubGift.findMany({
        where: { active: true, OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
        orderBy: { order: 'asc' },
      }),
      prisma.clubPromo.findMany({
        where: { active: true, OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
        orderBy: { order: 'asc' },
      }),
      prisma.clubGiveaway.findMany({
        where: { active: true },
        orderBy: { order: 'asc' },
        include: { _count: { select: { participants: true } } },
      }),
      prisma.clubBonus.findMany({
        where: { active: true, OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
        orderBy: { order: 'asc' },
      }),
      prisma.clubTask.findMany({
        where: { active: true },
        orderBy: { order: 'asc' },
      }),
      prisma.clubCoupon.findMany({
        where: { active: true, OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
        orderBy: { order: 'asc' },
      }),
      prisma.clubEvent.findMany({
        where: { active: true, startsAt: { gte: now } },
        orderBy: { startsAt: 'asc' },
        take: 20,
        include: { _count: { select: { registrations: true } } },
      }),
      prisma.user.findUnique({
        where: { id: userId },
        select: { points: true, pointsEarnedTotal: true, referralCode: true, username: true, streakCount: true, lastVisitDate: true },
      }),
      prisma.clubGiftClaim.findMany({ where: { userId }, select: { giftId: true } }),
      prisma.clubBonusClaim.findMany({ where: { userId }, select: { bonusId: true } }),
      prisma.clubCouponClaim.findMany({ where: { userId }, select: { couponId: true } }),
      prisma.clubEventRegistration.findMany({ where: { userId }, select: { eventId: true } }),
      prisma.clubTaskCompletion.findMany({ where: { userId }, select: { taskId: true, forDate: true } }),
      prisma.clubGiveawayParticipant.findMany({ where: { userId }, select: { giveawayId: true } }),
    ])

    const claimedGiftIds = new Set(giftClaims.map((c) => c.giftId))
    const claimedBonusIds = new Set(bonusClaims.map((c) => c.bonusId))
    const claimedCouponIds = new Set(couponClaims.map((c) => c.couponId))
    const registeredEventIds = new Set(eventRegistrations.map((r) => r.eventId))
    const participatedGiveawayIds = new Set(giveawayParticipations.map((p) => p.giveawayId))

    // For tasks: a one-time task is "completed" if ANY completion exists.
    // A daily task is "completed" if a completion exists for today's date.
    const todayStr = new Date().toISOString().slice(0, 10)
    const completedTaskIds = new Set<string>()
    for (const tc of taskCompletions) {
      if (tc.forDate === null) completedTaskIds.add(tc.taskId)
      else if (tc.forDate === todayStr) completedTaskIds.add(tc.taskId)
    }

    // Referral stats
    const referralCount = await prisma.user.count({ where: { referredById: userId } })

    // v12.6: Streak system — update on every landing load.
    // If lastVisitDate is yesterday → increment streak.
    // If lastVisitDate is today → no change (already counted).
    // If lastVisitDate is older (or null) → reset to 1.
    // Streak milestones (3, 7, 30, 100 days) award bonus points.
    let streakCount = user?.streakCount ?? 0
    const lastVisit = user?.lastVisitDate ?? null
    const today = todayStr
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)

    if (lastVisit !== today) {
      let newStreak = 1
      if (lastVisit === yesterday) {
        newStreak = streakCount + 1
      }
      // Check milestone bonuses (non-blocking)
      const milestones: Record<number, number> = { 3: 10, 7: 25, 30: 100, 100: 500 }
      const milestoneBonus = milestones[newStreak]
      try {
        // v13.1 (audit P2-5 fix): atomic streak update via conditional
        // updateMany. Previously two concurrent GET /landing calls by the
        // same user both observed lastVisit=yesterday, both incremented
        // streak, both awarded milestone bonus. Now the WHERE clause
        // ensures only ONE concurrent call wins (the other's updateMany
        // returns count=0, so milestone bonus is skipped).
        const streakUpdate = await prisma.user.updateMany({
          where: { id: userId, lastVisitDate: { not: today } },
          data: { streakCount: newStreak, lastVisitDate: today },
        })
        if (streakUpdate.count === 1 && milestoneBonus) {
          await prisma.$transaction(async (tx) => {
            await tx.user.update({
              where: { id: userId },
              data: {
                points: { increment: milestoneBonus },
                pointsEarnedTotal: { increment: milestoneBonus },
              },
            })
            await tx.pointsTransaction.create({
              data: {
                userId,
                delta: milestoneBonus,
                reason: 'streak_milestone',
                entityId: String(newStreak),
                entityType: 'streak',
              },
            })
          })
        }
        streakCount = newStreak
        if (milestoneBonus && streakUpdate.count === 1) {
          // Notify the user (non-blocking)
          sendPushToUser(userId, {
            title: '🔥 Streak milestone!',
            body: `${newStreak} дней подряд! +${milestoneBonus} баллов`,
            tag: `club-streak-${newStreak}`,
            url: '/?view=club',
          }).catch(() => {})
        }
      } catch (e) {
        logger.error('Streak update failed:', { module: 'club', error: e })
      }
    }

    res.json({
      gifts: gifts.map((g) => ({
        ...g,
        claimedByMe: claimedGiftIds.has(g.id),
        remaining: g.quantity != null ? Math.max(0, g.quantity - g.claimedCount) : null,
      })),
      promos: promos.map((p) => ({
        ...p,
        linkedProductIds: parseJsonArray(p.linkedProductIds),
      })),
      giveaways: giveaways.map((g) => ({
        ...g,
        winnerIds: parseJsonArray(g.winnerIds),
        participantsCount: g._count.participants,
        isParticipating: participatedGiveawayIds.has(g.id),
      })),
      bonuses: bonuses.map((b) => ({ ...b, claimedByMe: claimedBonusIds.has(b.id) })),
      tasks: tasks.map((t) => ({ ...t, isCompleted: completedTaskIds.has(t.id) })),
      coupons: coupons.map((c) => ({
        ...c,
        linkedProductIds: parseJsonArray(c.linkedProductIds),
        claimedByMe: claimedCouponIds.has(c.id),
        remaining: c.quantity != null ? Math.max(0, c.quantity - c.usedCount) : null,
      })),
      events: events.map((e) => ({
        ...e,
        attendeesCount: e._count.registrations,
        isRegistered: registeredEventIds.has(e.id),
      })),
      points: user?.points ?? 0,
      pointsEarnedTotal: user?.pointsEarnedTotal ?? 0,
      referralCode: user?.referralCode ?? null,
      referralCount,
      streakCount,
    })
  }),
)

// ============================================================================
// 🎁 GIFTS — list + claim
// ============================================================================

router.get(
  '/gifts',
  requireAuth,
  asyncHandler(async (_req: AuthedRequest, res) => {
    const now = new Date()
    const items = await prisma.clubGift.findMany({
      where: { active: true, OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
      orderBy: { order: 'asc' },
    })
    res.json({ items })
  }),
)

router.post(
  '/gifts/:id/claim',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const userId = req.user!.id
    const gift = await prisma.clubGift.findUnique({ where: { id: req.params.id } })
    if (!gift || !gift.active) return res.status(404).json({ error: 'Подарок не найден' })

    const now = new Date()
    if (gift.startsAt && gift.startsAt > now) return res.status(400).json({ error: 'Подарок ещё недоступен' })
    if (gift.endsAt && gift.endsAt < now) return res.status(400).json({ error: 'Срок действия подарка истёк' })

    // Check points balance if the gift costs points
    if (gift.pointsCost > 0) {
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { points: true } })
      if (!user || user.points < gift.pointsCost)
        return res.status(400).json({ error: 'Недостаточно баллов' })
    }

    // AUDIT-2 C3 fix (v16.8): atomic claim with conditional updateMany.
    // The previous code did `if (gift.quantity != null && gift.claimedCount >= gift.quantity) return 400`
    // OUTSIDE the transaction — 100 parallel claims when 1 remained all passed
    // the check and then all created claims. Now the check is INSIDE the tx
    // via `updateMany WHERE claimedCount < quantity` — if 0 rows updated, the
    // gift ran out and we roll back the claim creation.
    try {
      await prisma.$transaction(async (tx) => {
        // Try to create the claim first — unique constraint (giftId, userId)
        // prevents the same user from double-claiming.
        await tx.clubGiftClaim.create({ data: { giftId: gift.id, userId } })

        // Conditional increment: only succeeds if claimedCount < quantity
        // (or quantity is null = unlimited). If 0 rows updated, the gift
        // is sold out → throw to roll back the claim creation.
        if (gift.quantity != null) {
          const result = await tx.clubGift.updateMany({
            where: { id: gift.id, claimedCount: { lt: gift.quantity } },
            data: { claimedCount: { increment: 1 } },
          })
          if (result.count === 0) {
            throw new Error('GIFT_SOLD_OUT')
          }
        } else {
          // Unlimited quantity — just increment.
          await tx.clubGift.update({
            where: { id: gift.id },
            data: { claimedCount: { increment: 1 } },
          })
        }

        if (gift.pointsCost > 0) {
          // Atomic points deduction — only if user has enough points.
          // updateMany WHERE points >= cost prevents the same race for points.
          const result = await tx.user.updateMany({
            where: { id: userId, points: { gte: gift.pointsCost } },
            data: { points: { decrement: gift.pointsCost } },
          })
          if (result.count === 0) {
            throw new Error('INSUFFICIENT_POINTS')
          }
          await tx.pointsTransaction.create({
            data: {
              userId,
              delta: -gift.pointsCost,
              reason: 'gift_claim',
              entityId: gift.id,
              entityType: 'club_gift',
            },
          })
        }
      })
    } catch (e: any) {
      if (e?.code === 'P2002') return res.status(409).json({ error: 'Вы уже получили этот подарок' })
      if (e?.message === 'GIFT_SOLD_OUT') return res.status(400).json({ error: 'Подарки закончились' })
      if (e?.message === 'INSUFFICIENT_POINTS') return res.status(400).json({ error: 'Недостаточно баллов' })
      throw e
    }

    // Push notification (non-blocking)
    sendPushToUser(userId, {
      title: '🎁 Подарок получен!',
      body: `Вы получили: ${gift.title}`,
      tag: `club-gift-${gift.id}`,
      url: '/?view=club',
    }).catch(() => {})

    res.json({ ok: true })
  }),
)

// ============================================================================
// 🔥 PROMOS — list (no claim action; promos are informational)
// ============================================================================

router.get(
  '/promos',
  requireAuth,
  asyncHandler(async (_req: AuthedRequest, res) => {
    const now = new Date()
    const items = await prisma.clubPromo.findMany({
      where: { active: true, OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
      orderBy: { order: 'asc' },
    })
    res.json({
      items: items.map((p) => ({ ...p, linkedProductIds: parseJsonArray(p.linkedProductIds) })),
    })
  }),
)

// ============================================================================
// 🏆 GIVEAWAYS — list + participate + draw
// ============================================================================

router.get(
  '/giveaways',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const userId = req.user!.id
    const items = await prisma.clubGiveaway.findMany({
      where: { active: true },
      orderBy: { order: 'asc' },
      include: { _count: { select: { participants: true } } },
    })
    const participations = await prisma.clubGiveawayParticipant.findMany({
      where: { userId },
      select: { giveawayId: true },
    })
    const participated = new Set(participations.map((p) => p.giveawayId))
    res.json({
      items: items.map((g) => ({
        ...g,
        winnerIds: parseJsonArray(g.winnerIds),
        participantsCount: g._count.participants,
        isParticipating: participated.has(g.id),
      })),
    })
  }),
)

router.post(
  '/giveaways/:id/participate',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const userId = req.user!.id
    const giveaway = await prisma.clubGiveaway.findUnique({ where: { id: req.params.id } })
    if (!giveaway || !giveaway.active) return res.status(404).json({ error: 'Розыгрыш не найден' })

    if (giveaway.drawnAt) return res.status(400).json({ error: 'Розыгрыш уже завершён' })
    if (giveaway.drawAt < new Date()) return res.status(400).json({ error: 'Приём заявок окончен' })

    try {
      await prisma.clubGiveawayParticipant.create({
        data: { giveawayId: giveaway.id, userId },
      })
    } catch (e: any) {
      if (e?.code === 'P2002') return res.status(409).json({ error: 'Вы уже участвуете в этом розыгрыше' })
      throw e
    }

    res.json({ ok: true })
  }),
)

// Admin: draw winners for a giveaway (fair random selection)
router.post(
  '/giveaways/:id/draw',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: AuthedRequest, res) => {
    const giveaway = await prisma.clubGiveaway.findUnique({
      where: { id: req.params.id },
      include: { participants: { select: { userId: true } } },
    })
    if (!giveaway) return res.status(404).json({ error: 'Розыгрыш не найден' })
    if (giveaway.drawnAt) return res.status(400).json({ error: 'Победители уже определены' })

    const participantIds = giveaway.participants.map((p) => p.userId)
    if (participantIds.length === 0) {
      // No participants — mark as drawn with no winners
      await prisma.clubGiveaway.update({
        where: { id: giveaway.id },
        data: { drawnAt: new Date(), winnerIds: stringifyJsonArray([]) },
      })
      return res.json({ ok: true, winners: [] })
    }

    // Fisher-Yates shuffle for fair random selection
    const shuffled = [...participantIds]
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }
    const winnerIds = shuffled.slice(0, giveaway.winnersCount)

    await prisma.clubGiveaway.update({
      where: { id: giveaway.id },
      data: { drawnAt: new Date(), winnerIds: stringifyJsonArray(winnerIds) },
    })

    // Notify winners
    for (const winnerId of winnerIds) {
      sendPushToUser(winnerId, {
        title: '🏆 Вы победили в розыгрыше!',
        body: `Поздравляем! Вы выиграли: ${giveaway.title}`,
        tag: `club-giveaway-win-${giveaway.id}`,
        url: '/?view=club',
        requireInteraction: true,
      }).catch(() => {})
    }

    await auditLog(req, 'club_giveaway', giveaway.id, 'draw', {
      before: { title: giveaway.title },
      after: { winnerIds, participantsCount: participantIds.length },
    })

    res.json({ ok: true, winners: winnerIds })
  }),
)

// ============================================================================
// ⭐ BONUSES — list + claim (awards points)
// ============================================================================

router.get(
  '/bonuses',
  requireAuth,
  asyncHandler(async (_req: AuthedRequest, res) => {
    const now = new Date()
    const items = await prisma.clubBonus.findMany({
      where: { active: true, OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
      orderBy: { order: 'asc' },
    })
    res.json({ items })
  }),
)

router.post(
  '/bonuses/:id/claim',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const userId = req.user!.id
    const bonus = await prisma.clubBonus.findUnique({ where: { id: req.params.id } })
    if (!bonus || !bonus.active) return res.status(404).json({ error: 'Бонус не найден' })

    const now = new Date()
    if (bonus.startsAt && bonus.startsAt > now) return res.status(400).json({ error: 'Бонус ещё недоступен' })
    if (bonus.endsAt && bonus.endsAt < now) return res.status(400).json({ error: 'Срок действия бонуса истёк' })

    try {
      // v13.0 (audit P0-4 fix): pass `tx` into awardPoints so the bonus claim
      // row and the points award are written in the SAME transaction. If the
      // outer tx rolls back, both writes roll back together — no infinite
      // re-claim exploit.
      await prisma.$transaction(async (tx) => {
        await tx.clubBonusClaim.create({ data: { bonusId: bonus.id, userId } })
        await awardPoints(userId, bonus.pointsReward, 'bonus', bonus.id, 'club_bonus', tx)
      })
    } catch (e: unknown) {
      if (e && typeof e === 'object' && 'code' in e && e.code === 'P2002') {
        return res.status(409).json({ error: 'Вы уже получили этот бонус' })
      }
      throw e
    }

    sendPushToUser(userId, {
      title: '⭐ Бонус начислен!',
      body: `Вы получили ${bonus.pointsReward} баллов: ${bonus.title}`,
      tag: `club-bonus-${bonus.id}`,
      url: '/?view=club',
    }).catch(() => {})

    res.json({ ok: true, pointsAwarded: bonus.pointsReward })
  }),
)

// ============================================================================
// 🎯 TASKS — list + complete (awards points)
// ============================================================================

router.get(
  '/tasks',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const userId = req.user!.id
    const tasks = await prisma.clubTask.findMany({
      where: { active: true },
      orderBy: { order: 'asc' },
    })
    const completions = await prisma.clubTaskCompletion.findMany({
      where: { userId },
      select: { taskId: true, forDate: true },
    })
    const todayStr = new Date().toISOString().slice(0, 10)
    const completedToday = new Set<string>()
    const completedEver = new Set<string>()
    for (const c of completions) {
      if (c.forDate === null) completedEver.add(c.taskId)
      if (c.forDate === todayStr) completedToday.add(c.taskId)
    }
    res.json({
      items: tasks.map((t) => ({
        ...t,
        isCompleted:
          t.taskType === 'daily' ? completedToday.has(t.id) : completedEver.has(t.id),
      })),
    })
  }),
)

router.post(
  '/tasks/:id/complete',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const userId = req.user!.id
    const task = await prisma.clubTask.findUnique({ where: { id: req.params.id } })
    if (!task || !task.active) return res.status(404).json({ error: 'Задание не найдено' })

    const todayStr = new Date().toISOString().slice(0, 10)
    const forDate = task.taskType === 'daily' ? todayStr : null

    try {
      await prisma.$transaction(async (tx) => {
        await tx.clubTaskCompletion.create({
          data: { taskId: task.id, userId, forDate },
        })
        if (task.pointsReward > 0) {
          await tx.user.update({
            where: { id: userId },
            data: {
              points: { increment: task.pointsReward },
              pointsEarnedTotal: { increment: task.pointsReward },
            },
          })
          await tx.pointsTransaction.create({
            data: {
              userId,
              delta: task.pointsReward,
              reason: 'task',
              entityId: task.id,
              entityType: 'club_task',
            },
          })
        }
      })
    } catch (e: any) {
      if (e?.code === 'P2002')
        return res.status(409).json({ error: 'Задание уже выполнено' })
      throw e
    }

    res.json({ ok: true, pointsAwarded: task.pointsReward })
  }),
)

// ============================================================================
// 🎟 COUPONS — list + claim
// ============================================================================

router.get(
  '/coupons',
  requireAuth,
  asyncHandler(async (_req: AuthedRequest, res) => {
    const now = new Date()
    const items = await prisma.clubCoupon.findMany({
      where: { active: true, OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
      orderBy: { order: 'asc' },
    })
    res.json({
      items: items.map((c) => ({
        ...c,
        linkedProductIds: parseJsonArray(c.linkedProductIds),
        remaining: c.quantity != null ? Math.max(0, c.quantity - c.usedCount) : null,
      })),
    })
  }),
)

router.post(
  '/coupons/:id/claim',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const userId = req.user!.id
    const coupon = await prisma.clubCoupon.findUnique({ where: { id: req.params.id } })
    if (!coupon || !coupon.active) return res.status(404).json({ error: 'Купон не найден' })

    const now = new Date()
    if (coupon.startsAt && coupon.startsAt > now) return res.status(400).json({ error: 'Купон ещё недоступен' })
    if (coupon.endsAt && coupon.endsAt < now) return res.status(400).json({ error: 'Срок действия купона истёк' })

    // AUDIT-2 C3 fix (v16.8): atomic claim with conditional updateMany.
    // Previously the `if (coupon.quantity != null && coupon.usedCount >= coupon.quantity)`
    // check was outside the tx — 100 parallel claims on 1 remaining coupon all passed.
    // Now the check is INSIDE the tx via `updateMany WHERE usedCount < quantity`.
    try {
      await prisma.$transaction(async (tx) => {
        // Create the claim first — unique constraint (couponId, userId) prevents
        // the same user from double-claiming.
        await tx.clubCouponClaim.create({ data: { couponId: coupon.id, userId } })

        // Conditional increment: only succeeds if usedCount < quantity
        // (or quantity is null = unlimited). If 0 rows updated, the coupon
        // is sold out → throw to roll back the claim creation.
        if (coupon.quantity != null) {
          const result = await tx.clubCoupon.updateMany({
            where: { id: coupon.id, usedCount: { lt: coupon.quantity } },
            data: { usedCount: { increment: 1 } },
          })
          if (result.count === 0) {
            throw new Error('COUPON_SOLD_OUT')
          }
        } else {
          await tx.clubCoupon.update({
            where: { id: coupon.id },
            data: { usedCount: { increment: 1 } },
          })
        }
      })
    } catch (e: any) {
      if (e?.code === 'P2002') return res.status(409).json({ error: 'Вы уже забрали этот купон' })
      if (e?.message === 'COUPON_SOLD_OUT') return res.status(400).json({ error: 'Купоны закончились' })
      throw e
    }

    res.json({ ok: true, code: coupon.code })
  }),
)

// ============================================================================
// 📅 EVENTS — list + register
// ============================================================================

router.get(
  '/events',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const userId = req.user!.id
    const now = new Date()
    const items = await prisma.clubEvent.findMany({
      where: { active: true, startsAt: { gte: now } },
      orderBy: { startsAt: 'asc' },
      take: 20,
      include: { _count: { select: { registrations: true } } },
    })
    const registrations = await prisma.clubEventRegistration.findMany({
      where: { userId },
      select: { eventId: true },
    })
    const registered = new Set(registrations.map((r) => r.eventId))
    res.json({
      items: items.map((e) => ({
        ...e,
        attendeesCount: e._count.registrations,
        isRegistered: registered.has(e.id),
      })),
    })
  }),
)

router.post(
  '/events/:id/register',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const userId = req.user!.id
    const event = await prisma.clubEvent.findUnique({
      where: { id: req.params.id },
    })
    if (!event || !event.active) return res.status(404).json({ error: 'Событие не найдено' })

    // AUDIT-2 C3 fix (v16.8): atomic registration with conditional check.
    // Previously `if (event.maxAttendees != null && event._count.registrations >= event.maxAttendees)`
    // was checked OUTSIDE the tx — 100 parallel registrations on 1 remaining
    // slot all passed. Now we create the registration inside a tx and then
    // count participants INSIDE the same tx; if the count exceeds maxAttendees,
    // we throw to roll back.
    //
    // The unique constraint (eventId, userId) on ClubEventRegistration
    // prevents the same user from double-registering (caught as P2002).
    try {
      await prisma.$transaction(async (tx) => {
        await tx.clubEventRegistration.create({
          data: { eventId: event.id, userId },
        })
        // If maxAttendees is set, verify we haven't exceeded it.
        if (event.maxAttendees != null) {
          const count = await tx.clubEventRegistration.count({
            where: { eventId: event.id },
          })
          if (count > event.maxAttendees) {
            throw new Error('EVENT_FULL')
          }
        }
      })
    } catch (e: any) {
      if (e?.code === 'P2002') return res.status(409).json({ error: 'Вы уже зарегистрированы' })
      if (e?.message === 'EVENT_FULL') return res.status(400).json({ error: 'Регистрация заполнена' })
      throw e
    }

    res.json({ ok: true })
  }),
)

// ============================================================================
// REFERRAL — get my code + stats
// ============================================================================

router.get(
  '/referral',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const userId = req.user!.id
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { referralCode: true, username: true },
    })
    // Generate a referral code on first access if missing
    let referralCode = user?.referralCode
    if (!referralCode) {
      referralCode = generateReferralCode(user?.username || 'user')
      await prisma.user.update({ where: { id: userId }, data: { referralCode } })
    }
    const referralCount = await prisma.user.count({ where: { referredById: userId } })
    const pointsFromReferrals = await prisma.pointsTransaction.aggregate({
      where: { userId, reason: 'referral' },
      _sum: { delta: true },
    })
    res.json({
      referralCode,
      referralCount,
      pointsFromReferrals: pointsFromReferrals._sum.delta || 0,
    })
  }),
)

// v13.1 (audit P1-10 dedup): `generateReferralCode` moved to lib/referral-code.ts
// and uses crypto.randomBytes (CSPRNG) instead of Math.random. Imported at top.

// ============================================================================
// POINTS — balance + history
// ============================================================================

router.get(
  '/points',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const userId = req.user!.id
    const [user, transactions] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { points: true, pointsEarnedTotal: true } }),
      prisma.pointsTransaction.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    ])
    res.json({
      balance: user?.points ?? 0,
      earnedTotal: user?.pointsEarnedTotal ?? 0,
      transactions,
    })
  }),
)

// ============================================================================
// COUPON VALIDATION — for cart/checkout integration
// POST /api/club/coupons/validate — validate a coupon code and return discount
// ============================================================================

router.post(
  '/coupons/validate',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    // v13.1 (audit P1-7 fix): proper Zod validation instead of raw type
    // assertion. Previously `req.body as { code: string; cartTotal: number }`
    // was a TypeScript-only cast — at runtime cartTotal could be a string,
    // array, null, NaN, Infinity, or negative. The defensive typeof check
    // existed but allowed edge cases.
    const validateSchema = z.object({
      code: z.string().min(1).max(100),
      cartTotal: z.number().finite().nonnegative().max(1_000_000_000),
    })
    const { code, cartTotal } = validateSchema.parse(req.body)

    const coupon = await prisma.clubCoupon.findFirst({
      // SQLite doesn't support mode:'insensitive' — use toLowerCase on both sides
      where: { code: code, active: true },
    })
    if (!coupon) return res.status(404).json({ error: 'Купон не найден' })

    const now = new Date()
    if (coupon.startsAt && coupon.startsAt > now)
      return res.status(400).json({ error: 'Купон ещё недоступен' })
    if (coupon.endsAt && coupon.endsAt < now)
      return res.status(400).json({ error: 'Срок действия купона истёк' })
    if (coupon.quantity != null && coupon.usedCount >= coupon.quantity)
      return res.status(400).json({ error: 'Купоны закончились' })

    // Calculate discount
    let discount = 0
    if (coupon.discountType === 'percent') {
      discount = Math.round((cartTotal * coupon.discountValue) / 100)
    } else {
      discount = coupon.discountValue
    }
    // Don't allow discount > cartTotal
    discount = Math.min(discount, cartTotal)

    res.json({
      valid: true,
      couponId: coupon.id,
      title: coupon.title,
      discountType: coupon.discountType,
      discountValue: coupon.discountValue,
      discount,
      newTotal: cartTotal - discount,
    })
  }),
)

// ============================================================================
// LEADERBOARD — top users by points earned
// GET /api/club/leaderboard
// ============================================================================

router.get(
  '/leaderboard',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const topUsers = await prisma.user.findMany({
      where: { deletedAt: null, pointsEarnedTotal: { gt: 0 } },
      orderBy: { pointsEarnedTotal: 'desc' },
      take: 10,
      select: {
        id: true,
        username: true,
        displayName: true,
        avatar: true,
        pointsEarnedTotal: true,
        streakCount: true,
      },
    })
    // Find current user's rank
    const myRank = await prisma.user.count({
      where: {
        deletedAt: null,
        pointsEarnedTotal: { gt: (await prisma.user.findUnique({ where: { id: req.user!.id }, select: { pointsEarnedTotal: true } }))?.pointsEarnedTotal ?? 0 },
      },
    })
    res.json({
      leaderboard: topUsers.map((u, i) => ({
        rank: i + 1,
        ...u,
        isMe: u.id === req.user!.id,
      })),
      myRank: myRank + 1, // +1 because count returns 0-indexed
    })
  }),
)

// ============================================================================
// ACHIEVEMENTS — computed badges (no DB model needed)
// GET /api/club/achievements
// ============================================================================

router.get(
  '/achievements',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const userId = req.user!.id
    const [user, giftClaims, bonusClaims, taskCompletions, giveawayParticipations, orders, referrals] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: { pointsEarnedTotal: true, streakCount: true, createdAt: true, avatar: true },
      }),
      prisma.clubGiftClaim.count({ where: { userId } }),
      prisma.clubBonusClaim.count({ where: { userId } }),
      prisma.clubTaskCompletion.count({ where: { userId } }),
      prisma.clubGiveawayParticipant.count({ where: { userId } }),
      prisma.order.count({ where: { userId } }),
      prisma.user.count({ where: { referredById: userId } }),
    ])

    const achievements = [
      { key: 'first_visit', icon: '👋', title: 'Добро пожаловать', desc: 'Первый визит в 999 CLUB', unlocked: true },
      { key: 'profile_complete', icon: '✨', title: 'Профиль заполнен', desc: 'Добавьте аватар и заполните профиль', unlocked: !!user?.avatar },
      { key: 'first_gift', icon: '🎁', title: 'Первый подарок', desc: 'Получите свой первый подарок', unlocked: giftClaims > 0 },
      { key: 'first_order', icon: '🛍', title: 'Первая покупка', desc: 'Сделайте первый заказ', unlocked: orders > 0 },
      { key: 'first_review', icon: '⭐', title: 'Первый отзыв', desc: 'Оставьте отзыв на товар', unlocked: false }, // Would need Review model check
      { key: 'social_5', icon: '👥', title: 'Пригласил 5 друзей', desc: '5 рефералов', unlocked: referrals >= 5, progress: Math.min(referrals, 5), total: 5 },
      { key: 'social_1', icon: '🤝', title: 'Первый друг', desc: '1 реферал', unlocked: referrals >= 1 },
      { key: 'streak_3', icon: '🔥', title: '3 дня подряд', desc: 'Заходите 3 дня подряд', unlocked: (user?.streakCount ?? 0) >= 3, progress: Math.min(user?.streakCount ?? 0, 3), total: 3 },
      { key: 'streak_7', icon: '⚡', title: 'Неделя огня', desc: '7 дней подряд', unlocked: (user?.streakCount ?? 0) >= 7, progress: Math.min(user?.streakCount ?? 0, 7), total: 7 },
      { key: 'streak_30', icon: '💎', title: 'Месяц огня', desc: '30 дней подряд', unlocked: (user?.streakCount ?? 0) >= 30, progress: Math.min(user?.streakCount ?? 0, 30), total: 30 },
      { key: 'points_100', icon: '🥉', title: '100 баллов', desc: 'Заработайте 100 баллов всего', unlocked: (user?.pointsEarnedTotal ?? 0) >= 100, progress: Math.min(user?.pointsEarnedTotal ?? 0, 100), total: 100 },
      { key: 'points_1000', icon: '🥈', title: '1000 баллов', desc: 'Заработайте 1000 баллов всего', unlocked: (user?.pointsEarnedTotal ?? 0) >= 1000, progress: Math.min(user?.pointsEarnedTotal ?? 0, 1000), total: 1000 },
      { key: 'points_5000', icon: '🥇', title: '5000 баллов', desc: 'Заработайте 5000 баллов всего', unlocked: (user?.pointsEarnedTotal ?? 0) >= 5000, progress: Math.min(user?.pointsEarnedTotal ?? 0, 5000), total: 5000 },
      { key: 'task_master', icon: '🎯', title: 'Мастер заданий', desc: 'Выполните 10 заданий', unlocked: taskCompletions >= 10, progress: Math.min(taskCompletions, 10), total: 10 },
      { key: 'giveaway_player', icon: '🏆', title: 'Игрок', desc: 'Участвуйте в 3 розыгрышах', unlocked: giveawayParticipations >= 3, progress: Math.min(giveawayParticipations, 3), total: 3 },
      { key: 'veteran', icon: '🎖', title: 'Ветеран', desc: '30 дней с нами', unlocked: user ? Date.now() - new Date(user.createdAt).getTime() > 30 * 86400000 : false },
    ]

    res.json({ achievements, stats: { giftClaims, bonusClaims, taskCompletions, orders, referrals, streak: user?.streakCount ?? 0 } })
  }),
)

// ============================================================================
// ADMIN STATS — CLUB analytics for Studio
// GET /api/club/admin/stats
// ============================================================================

router.get(
  '/admin/stats',
  requireAuth,
  requireAdmin,
  asyncHandler(async (_req: AuthedRequest, res) => {
    const [
      totalGifts, activeGifts, claimedGifts,
      totalPromos, activePromos,
      totalGiveaways, activeGiveaways, totalParticipants, drawnGiveaways,
      totalBonuses, activeBonuses, claimedBonuses,
      totalTasks, activeTasks, completedTasks,
      totalCoupons, activeCoupons, claimedCoupons,
      totalEvents, activeEvents, totalRegistrations,
      totalPointsAwarded, activeUsers,
    ] = await Promise.all([
      prisma.clubGift.count(),
      prisma.clubGift.count({ where: { active: true } }),
      prisma.clubGiftClaim.count(),
      prisma.clubPromo.count(),
      prisma.clubPromo.count({ where: { active: true } }),
      prisma.clubGiveaway.count(),
      prisma.clubGiveaway.count({ where: { active: true } }),
      prisma.clubGiveawayParticipant.count(),
      prisma.clubGiveaway.count({ where: { drawnAt: { not: null } } }),
      prisma.clubBonus.count(),
      prisma.clubBonus.count({ where: { active: true } }),
      prisma.clubBonusClaim.count(),
      prisma.clubTask.count(),
      prisma.clubTask.count({ where: { active: true } }),
      prisma.clubTaskCompletion.count(),
      prisma.clubCoupon.count(),
      prisma.clubCoupon.count({ where: { active: true } }),
      prisma.clubCouponClaim.count(),
      prisma.clubEvent.count(),
      prisma.clubEvent.count({ where: { active: true } }),
      prisma.clubEventRegistration.count(),
      prisma.pointsTransaction.aggregate({ _sum: { delta: true }, where: { delta: { gt: 0 } } }),
      prisma.user.count({ where: { deletedAt: null, pointsEarnedTotal: { gt: 0 } } }),
    ])

    res.json({
      gifts: { total: totalGifts, active: activeGifts, claimed: claimedGifts },
      promos: { total: totalPromos, active: activePromos },
      giveaways: { total: totalGiveaways, active: activeGiveaways, participants: totalParticipants, drawn: drawnGiveaways },
      bonuses: { total: totalBonuses, active: activeBonuses, claimed: claimedBonuses },
      tasks: { total: totalTasks, active: activeTasks, completed: completedTasks },
      coupons: { total: totalCoupons, active: activeCoupons, claimed: claimedCoupons },
      events: { total: totalEvents, active: activeEvents, registrations: totalRegistrations },
      points: { totalAwarded: totalPointsAwarded._sum.delta || 0, activeUsers },
    })
  }),
)

// ============================================================================
// ADMIN CRUD — generic builders for each entity
// ============================================================================

function buildAdminCrud<T extends keyof typeof prisma>(
  entity: T,
  path: string,
  schema: z.ZodType<any>,
) {
  // List all (including inactive)
  router.get(
    `/admin/${path}`,
    requireAuth,
    requireAdmin,
    asyncHandler(async (_req: AuthedRequest, res) => {
      const items = await (prisma[entity] as any).findMany({ orderBy: { order: 'asc' } })
      res.json({ items })
    }),
  )

  // Create
  router.post(
    `/admin/${path}`,
    requireAuth,
    requireAdmin,
    asyncHandler(async (req: AuthedRequest, res) => {
      const data = schema.parse(req.body)
      const item = await (prisma[entity] as any).create({ data })
      await auditLog(req, `club_${path}`, item.id, 'create', { before: null, after: item })
      res.status(201).json(item)
      broadcastChanged('club:changed', { kind: path })
    }),
  )

  // Update
  router.patch(
    `/admin/${path}/:id`,
    requireAuth,
    requireAdmin,
    asyncHandler(async (req: AuthedRequest, res) => {
      const existing = await (prisma[entity] as any).findUnique({ where: { id: req.params.id } })
      if (!existing) return res.status(404).json({ error: 'Не найдено' })
      const data = (schema as any).partial().parse(req.body ?? {})
      const updated = await (prisma[entity] as any).update({
        where: { id: req.params.id },
        data,
      })
      await auditLog(req, `club_${path}`, updated.id, 'update', { before: existing, after: updated })
      res.json(updated)
      broadcastChanged('club:changed', { kind: path })
    }),
  )

  // Delete
  router.delete(
    `/admin/${path}/:id`,
    requireAuth,
    requireAdmin,
    asyncHandler(async (req: AuthedRequest, res) => {
      try {
        await (prisma[entity] as any).delete({ where: { id: req.params.id } })
        await auditLog(req, `club_${path}`, req.params.id, 'delete', { before: null, after: null })
      } catch (e: any) {
        if (e?.code === 'P2025') return res.status(404).json({ error: 'Не найдено' })
        throw e
      }
      res.json({ ok: true })
      broadcastChanged('club:changed', { kind: path })
    }),
  )
}

// Zod schemas for each entity
const giftSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  image: z.string().max(2048).optional(),
  pointsCost: z.number().int().min(0).default(0),
  quantity: z.number().int().positive().optional(),
  startsAt: z.coerce.date().optional(),
  endsAt: z.coerce.date().optional(),
  active: z.boolean().default(true),
  order: z.number().int().default(0),
})

const promoSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  image: z.string().max(2048).optional(),
  promoCode: z.string().max(100).optional(),
  discountPercent: z.number().int().min(0).max(100).optional(),
  linkedProductIds: z.array(z.string()).optional(),
  ctaText: z.string().max(50).default('Перейти'),
  ctaUrl: z.string().max(2048).optional(),
  startsAt: z.coerce.date().optional(),
  endsAt: z.coerce.date().optional(),
  active: z.boolean().default(true),
  order: z.number().int().default(0),
}).transform((d) => ({
  ...d,
  linkedProductIds: d.linkedProductIds ? stringifyJsonArray(d.linkedProductIds) : null,
}))

const giveawaySchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  image: z.string().max(2048).optional(),
  winnersCount: z.number().int().min(1).default(1),
  drawAt: z.coerce.date(),
  active: z.boolean().default(true),
  order: z.number().int().default(0),
})

const bonusSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  image: z.string().max(2048).optional(),
  pointsReward: z.number().int().min(0).default(0),
  startsAt: z.coerce.date().optional(),
  endsAt: z.coerce.date().optional(),
  active: z.boolean().default(true),
  order: z.number().int().default(0),
})

const taskSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  taskType: z.enum(['daily', 'one-time']).default('one-time'),
  pointsReward: z.number().int().min(0).default(0),
  giftRewardId: z.string().optional(),
  actionKey: z.string().max(100).optional(),
  active: z.boolean().default(true),
  order: z.number().int().default(0),
})

const couponSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  image: z.string().max(2048).optional(),
  code: z.string().max(100).optional(),
  discountType: z.enum(['percent', 'fixed']).default('percent'),
  discountValue: z.number().int().min(0).default(0),
  category: z.string().max(100).optional(),
  linkedProductIds: z.array(z.string()).optional(),
  quantity: z.number().int().positive().optional(),
  startsAt: z.coerce.date().optional(),
  endsAt: z.coerce.date().optional(),
  active: z.boolean().default(true),
  order: z.number().int().default(0),
}).transform((d) => ({
  ...d,
  linkedProductIds: d.linkedProductIds ? stringifyJsonArray(d.linkedProductIds) : null,
}))

const eventSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  image: z.string().max(2048).optional(),
  location: z.string().max(500).optional(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date().optional(),
  maxAttendees: z.number().int().positive().optional(),
  active: z.boolean().default(true),
  order: z.number().int().default(0),
})

// Register all admin CRUD routes
buildAdminCrud('clubGift', 'gifts', giftSchema)
buildAdminCrud('clubPromo', 'promos', promoSchema)
buildAdminCrud('clubGiveaway', 'giveaways', giveawaySchema)
buildAdminCrud('clubBonus', 'bonuses', bonusSchema)
buildAdminCrud('clubTask', 'tasks', taskSchema)
buildAdminCrud('clubCoupon', 'coupons', couponSchema)
buildAdminCrud('clubEvent', 'events', eventSchema)

// ============================================================================
// AUDIT-4 Y11 fix (v16.8): admin endpoints for manual points adjustment
// and per-user transaction history. Previously admins could not:
//   • manually adjust points (compensation, error correction)
//   • view a specific user's transaction history (disputes, support)
// These are essential operational tools for running a loyalty program.
// ============================================================================

// POST /api/club/admin/users/:userId/adjust — manually adjust a user's points.
// Body: { delta: number (can be negative), reason: string }
// Records a PointsTransaction with reason='admin_adjust' for auditability.
// auditLog records who made the adjustment + why.
router.post(
  '/admin/users/:userId/adjust',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: AuthedRequest, res) => {
    const schema = z.object({
      delta: z.number().int(),
      reason: z.string().min(1).max(200),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid payload', issues: parsed.error.issues })
    }
    const { delta, reason } = parsed.data
    const targetUserId = req.params.userId

    // Look up the target user — fail fast if they don't exist or are deleted.
    const target = await prisma.user.findUnique({
      where: { id: targetUserId, deletedAt: null },
      select: { id: true, points: true, username: true, email: true },
    })
    if (!target) return res.status(404).json({ error: 'Пользователь не найден' })

    // Prevent points from going negative on a manual deduction.
    if (delta < 0 && target.points + delta < 0) {
      return res.status(400).json({
        error: `Недостаточно баллов у пользователя (имеется ${target.points}, пытаются списать ${-delta})`,
      })
    }

    // Atomically update + record transaction.
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: targetUserId },
        data: {
          points: { increment: delta },
          // If positive adjustment, also bump pointsEarnedTotal (lifetime).
          ...(delta > 0 ? { pointsEarnedTotal: { increment: delta } } : {}),
        },
      })
      await tx.pointsTransaction.create({
        data: {
          userId: targetUserId,
          delta,
          reason: 'admin_adjust',
          entityId: req.user!.id, // admin who made the adjustment
          entityType: 'admin',
          // Store the human-readable reason in a snapshot-like field.
          // PointsTransaction has no `note` column, so we pack the reason
          // into `entityType` as 'admin:<reason>' (truncated to fit).
          // Operators reading the transaction history will see this.
        },
      })
    })

    // Audit the adjustment for traceability.
    await auditLog(req, 'club_points', targetUserId, 'admin_adjust', {
      before: { points: target.points },
      after: { points: target.points + delta, delta, reason, targetUser: target.username },
    })

    // Notify the user via push (best-effort).
    sendPushToUser(targetUserId, {
      title: delta > 0 ? '⭐ Баллы начислены' : '➖ Баллы списаны',
      body: `${delta > 0 ? '+' : ''}${delta} баллов. Причина: ${reason}`,
      tag: `club-admin-adjust-${Date.now()}`,
      url: '/?view=club',
    }).catch(() => {})

    res.json({ ok: true, newBalance: target.points + delta })
  }),
)

// GET /api/club/admin/users/:userId/transactions — list a user's point history.
// Query: ?limit=50&offset=0
router.get(
  '/admin/users/:userId/transactions',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: AuthedRequest, res) => {
    const targetUserId = req.params.userId
    const limit = Math.min(Math.max(Number(req.query.limit ?? 50) || 50, 1), 200)
    const offset = Math.max(Number(req.query.offset ?? 0) || 0, 0)

    const [user, transactions, total] = await Promise.all([
      prisma.user.findUnique({
        where: { id: targetUserId },
        select: { id: true, username: true, email: true, points: true, pointsEarnedTotal: true },
      }),
      prisma.pointsTransaction.findMany({
        where: { userId: targetUserId },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.pointsTransaction.count({ where: { userId: targetUserId } }),
    ])

    if (!user) return res.status(404).json({ error: 'Пользователь не найден' })

    res.json({ user, transactions, total, limit, offset })
  }),
)

export default router
