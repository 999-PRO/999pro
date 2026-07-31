/**
 * 999 CLUB — module barrel (Phase 2).
 *
 * The ONLY public surface of the module. The rest of the app imports
 * exclusively from `@/modules/999-club`.
 */

export { ClubView } from './components/club-view'
export { ClubNavBadge } from './components/club-nav-badge'
export { CLUB_CONFIG, CLUB_FEATURES } from './config'
export type { ClubCardKind, ClubCardMeta, ClubGift, ClubPromo, ClubGiveaway, ClubBonus, ClubTask, ClubCoupon, ClubEvent, ClubReferral, ClubPoints, PointsTransaction, ClubLanding } from './types'
export { useClubStore } from './store'
export { clubApi } from './api'
