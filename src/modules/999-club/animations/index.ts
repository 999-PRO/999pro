/**
 * 999 CLUB — Phase 3 animation variants.
 *
 * Rich, premium animations for each card type. Each variant is tuned to
 * feel unique — gifts bounce, promos slide, giveaways spin, etc.
 */

import type { Variants } from 'framer-motion'

/** Page-level entrance: fade + slight upward slide. */
export const pageEnter: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.32, ease: [0.22, 1, 0.36, 1] },
  },
  exit: {
    opacity: 0,
    y: -8,
    transition: { duration: 0.2, ease: [0.4, 0, 1, 1] },
  },
}

/** Card entrance: stagger children so cards cascade in. */
export const cardContainer: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.06, delayChildren: 0.05 },
  },
}

/** Individual card entrance — fade + scale up slightly. */
export const cardItem: Variants = {
  hidden: { opacity: 0, y: 16, scale: 0.97 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] },
  },
}

/** Badge pulse — used by the bottom-nav CLUB badge when hasUnread=true. */
export const badgePulse: Variants = {
  idle: { scale: 1, opacity: 1 },
  pulse: {
    scale: [1, 1.12, 1],
    opacity: [1, 0.85, 1],
    transition: { duration: 2.4, repeat: Infinity, ease: 'easeInOut' },
  },
}

/** Soft glow ring — used around the CLUB icon in the bottom nav. */
export const glowRing: Variants = {
  idle: { boxShadow: '0 0 0 0px rgba(245, 158, 11, 0)' },
  glow: {
    boxShadow: [
      '0 0 0 0px rgba(245, 158, 11, 0)',
      '0 0 12px 2px rgba(245, 158, 11, 0.45)',
      '0 0 0 0px rgba(245, 158, 11, 0)',
    ],
    transition: { duration: 2.8, repeat: Infinity, ease: 'easeOut' },
  },
}

// ===== Phase 3: per-card-type animations =====

/** 🎁 Gift box — bouncy entrance + idle wobble. */
export const giftEntrance: Variants = {
  hidden: { opacity: 0, y: 30, rotate: -5 },
  visible: {
    opacity: 1,
    y: 0,
    rotate: 0,
    transition: { type: 'spring', stiffness: 300, damping: 15 },
  },
}

/** 🎁 Gift unwrapping — burst effect on claim. */
export const giftBurst: Variants = {
  idle: { scale: 1, opacity: 1 },
  burst: {
    scale: [1, 1.15, 0.9, 1],
    opacity: [1, 1, 1, 1],
    transition: { duration: 0.6, ease: [0.34, 1.56, 0.64, 1] },
  },
}

/** 🔥 Promo — slide-in from right + flame flicker. */
export const promoEntrance: Variants = {
  hidden: { opacity: 0, x: 40 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] },
  },
}

/** 🔥 Flame flicker — subtle scale oscillation. */
export const flameFlicker: Variants = {
  idle: { scale: 1, rotate: 0 },
  flicker: {
    scale: [1, 1.08, 0.95, 1.05, 1],
    rotate: [0, 2, -1, 1, 0],
    transition: { duration: 1.5, repeat: Infinity, ease: 'easeInOut' },
  },
}

/** 🏆 Giveaway — spinning entrance (like a lottery wheel). */
export const giveawayEntrance: Variants = {
  hidden: { opacity: 0, rotateY: -90 },
  visible: {
    opacity: 1,
    rotateY: 0,
    transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] },
  },
}

/** 🏆 Ticket print — slides up from bottom like a printed ticket. */
export const ticketPrint: Variants = {
  hidden: { opacity: 0, y: 60, scaleY: 0.3 },
  visible: {
    opacity: 1,
    y: 0,
    scaleY: 1,
    transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] },
  },
}

/** ⭐ Bonus — coin-flip entrance. */
export const bonusEntrance: Variants = {
  hidden: { opacity: 0, rotateY: 180 },
  visible: {
    opacity: 1,
    rotateY: 0,
    transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] },
  },
}

/** ⭐ Points fly — coin flies from card to balance counter. */
export const pointsFly: Variants = {
  idle: { opacity: 0, scale: 0, x: 0, y: 0 },
  fly: (target: { x: number; y: number }) => ({
    opacity: [0, 1, 1, 0],
    scale: [0, 1.2, 1, 0.3],
    x: [0, target.x * 0.5, target.x],
    y: [0, target.y * 0.5, target.y],
    transition: { duration: 0.8, ease: 'easeInOut' },
  }),
}

/** 🎯 Task complete — checkmark draw + satisfaction bounce. */
export const taskComplete: Variants = {
  idle: { scale: 1 },
  complete: {
    scale: [1, 1.1, 0.95, 1],
    transition: { duration: 0.5, ease: [0.34, 1.56, 0.64, 1] },
  },
}

/** 🎟 Coupon tear — slight rotate + slide when "tearing off". */
export const couponTear: Variants = {
  idle: { rotate: 0, y: 0, opacity: 1 },
  tear: {
    rotate: [0, 3, -2, 0],
    y: [0, -8, 4, 0],
    opacity: [1, 1, 1, 1],
    transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] },
  },
}

/** 📅 Event timeline — staggered slide-in from left. */
export const eventTimeline: Variants = {
  hidden: { opacity: 0, x: -30 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] },
  },
}

/** Confetti burst — used on gift claim + giveaway win. */
export const confettiBurst: Variants = {
  idle: { opacity: 0, scale: 0 },
  burst: {
    opacity: [0, 1, 0],
    scale: [0, 1.5, 2],
    transition: { duration: 1, ease: 'easeOut' },
  },
}

/** Sheet entrance — slide up from bottom with spring. */
export const sheetEntrance: Variants = {
  hidden: { opacity: 0, y: '100%' },
  visible: {
    opacity: 1,
    y: 0,
    transition: { type: 'spring', stiffness: 260, damping: 30 },
  },
  exit: {
    opacity: 0,
    y: '100%',
    transition: { duration: 0.25, ease: [0.4, 0, 1, 1] },
  },
}

/** Number counter — animated number increment. */
export const numberPop: Variants = {
  idle: { scale: 1 },
  pop: {
    scale: [1, 1.2, 1],
    transition: { duration: 0.4, ease: [0.34, 1.56, 0.64, 1] },
  },
}
