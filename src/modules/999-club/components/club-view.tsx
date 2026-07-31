'use client'

/**
 * ClubView — the main page of the 999 CLUB module (Phase 3).
 *
 * Spectacular hero with animated gradient + floating particles + points
 * counter. 8-card grid where each card has its own unique accent. Tapping
 * a card opens a BESPOKE sheet for that card type (no two sheets look
 * alike).
 */

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Crown, Sparkles, Star, Flame, Trophy } from 'lucide-react'
import { CLUB_CONFIG, CLUB_FEATURES } from '../config'
import { CLUB_CARDS } from '../utils'
import { useClubStore } from '../store'
import { useClubLanding } from '../hooks'
import { clubApi } from '../api'
import { pageEnter, cardContainer, cardItem } from '../animations'
import { ClubCard } from './club-card'
import { ClubSkeleton } from './club-skeleton'
import { ClubSheetErrorBoundary } from './club-sheet-error-boundary'
import { ClubSheetWrapper } from './sheets/club-sheet-wrapper'
import type { ClubCardKind } from '../types'
// v16.8 final: unified auth gate — replaces the misleading "Не удалось
// загрузить, проверьте подключение к интернету" error. When the user is
// not authenticated, we show a friendly login screen instead of a fake
// network-error state.
import { useAuthStore } from '@/lib/auth-store'
import { AuthRequiredView } from '@/components/auth-required-view'

const FEATURE_TO_KIND: Record<ClubCardKind, keyof typeof CLUB_FEATURES> = {
  gifts: 'gifts',
  promos: 'promos',
  giveaways: 'giveaways',
  bonuses: 'bonuses',
  referrals: 'referrals',
  tasks: 'tasks',
  coupons: 'coupons',
  events: 'events',
}

export function ClubView() {
  const markRead = useClubStore((s) => s.markRead)
  const setPoints = useClubStore((s) => s.setPoints)
  const { data, loading, error, refresh } = useClubLanding()
  const [openKind, setOpenKind] = useState<ClubCardKind | null>(null)
  const [showLeaderboard, setShowLeaderboard] = useState(false)

  // v16.8 final: auth gate — the entire CLUB module requires authentication.
  // If the user is not signed in, we render the unified AuthRequiredView
  // BEFORE attempting any data fetch. This replaces the old "Не удалось
  // загрузить, проверьте подключение к интернету" error state, which was
  // misleading — the issue was never the network, it was that CLUB endpoints
  // return 401 for anonymous users.
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const token = useAuthStore((s) => s.token)
  const user = useAuthStore((s) => s.user)
  const authed = isAuthenticated || (!!token && !!user)

  useEffect(() => {
    if (authed) markRead()
  }, [markRead, authed])

  useEffect(() => {
    if (data) setPoints(data.points)
  }, [data, setPoints])

  const visibleCards = CLUB_CARDS.filter((c) => CLUB_FEATURES[FEATURE_TO_KIND[c.kind]])

  // v16.8 final: not authenticated → friendly login screen (NOT a network
  // error). We check this BEFORE the skeleton so the user never sees a
  // loading state that will inevitably fail with 401.
  if (!authed) {
    return (
      <AuthRequiredView
        title="Войдите в аккаунт"
        description="CLUB доступен только авторизованным пользователям. Войдите, чтобы получать подарки, бонусы, участвовать в розыгрышах и копить баллы."
      />
    )
  }

  // v12.6: Show skeleton during initial load (much more premium than a spinner)
  if (loading && !data) {
    return <ClubSkeleton />
  }

  // v12.6: Graceful error state
  if (error && !data) {
    return (
      <div className="pb-28 md:pb-12 page-top-padding px-4 md:px-6 pt-8">
        <div className="rounded-2xl glass p-6 text-center">
          <div className="text-4xl mb-3">😕</div>
          <h3 className="font-bold text-lg mb-1">Не удалось загрузить</h3>
          <p className="text-sm text-muted-foreground mb-4">Проверьте подключение к интернету</p>
          <button
            onClick={() => window.location.reload()}
            className="px-6 py-2.5 rounded-full gradient-brand text-white font-semibold text-sm shadow-glow"
          >
            Повторить
          </button>
        </div>
      </div>
    )
  }

  return (
    <motion.div
      variants={pageEnter}
      initial="hidden"
      animate="visible"
      exit="exit"
      className="pb-28 md:pb-12 page-top-padding"
    >
      {/* ===== Spectacular Hero ===== */}
      <div className="px-4 md:px-6 pt-4 md:pt-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="relative overflow-hidden rounded-[32px] p-6 md:p-10 shadow-glow-lg"
          style={{
            backgroundImage: 'linear-gradient(135deg, rgba(245,158,11,0.20) 0%, rgba(236,72,153,0.16) 50%, rgba(139,92,246,0.20) 100%)',
            backdropFilter: 'blur(20px) saturate(160%)',
            WebkitBackdropFilter: 'blur(20px) saturate(160%)',
            border: '1px solid rgba(255,255,255,0.15)',
          }}
        >
          {/* Animated floating particles */}
          <motion.div
            aria-hidden
            className="absolute top-6 right-8"
            animate={{ y: [0, -8, 0], rotate: [0, 10, 0] }}
            transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
          >
            <Sparkles className="h-5 w-5 text-amber-400/70" />
          </motion.div>
          <motion.div
            aria-hidden
            className="absolute bottom-8 right-20"
            animate={{ y: [0, 6, 0], opacity: [0.6, 1, 0.6] }}
            transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
          >
            <Sparkles className="h-3 w-3 text-pink-400/70" />
          </motion.div>
          <motion.div
            aria-hidden
            className="absolute top-1/2 right-4"
            animate={{ y: [0, -10, 0], rotate: [0, -15, 0] }}
            transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
          >
            <Sparkles className="h-4 w-4 text-violet-400/60" />
          </motion.div>

          {/* Glow blobs */}
          <div aria-hidden className="absolute -top-16 -left-16 h-40 w-40 rounded-full bg-amber-500/20 blur-3xl" />
          <div aria-hidden className="absolute -bottom-16 -right-16 h-48 w-48 rounded-full bg-violet-500/20 blur-3xl" />

          <div className="relative">
            <div className="flex items-center gap-3 mb-4">
              <motion.div
                initial={{ scale: 0, rotate: -180 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: 'spring', stiffness: 260, damping: 20, delay: 0.1 }}
                className="h-12 w-12 rounded-2xl grid place-items-center shadow-glow"
                style={{ backgroundImage: 'linear-gradient(135deg, #f59e0b 0%, #ec4899 50%, #8b5cf6 100%)' }}
              >
                <Crown className="h-6 w-6 text-white" strokeWidth={2.4} />
              </motion.div>
              <motion.span
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.2 }}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-foreground/5 text-[11px] font-bold tracking-wide"
              >
                {CLUB_CONFIG.emoji} {CLUB_CONFIG.fullName}
              </motion.span>
            </div>

            <motion.h1
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }}
              className="text-3xl md:text-4xl font-extrabold tracking-tight mb-2"
            >
              {CLUB_CONFIG.fullName}
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="text-sm md:text-base text-muted-foreground max-w-md"
            >
              {CLUB_CONFIG.tagline}
            </motion.p>

            {/* Points balance + streak — animated counter */}
            {data && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.3, type: 'spring', stiffness: 260, damping: 20 }}
                className="mt-5 flex flex-wrap items-center gap-3"
              >
                <div className="inline-flex items-center gap-3 px-5 py-3 rounded-2xl glass-strong border border-border/40 shadow-glow">
                  <motion.div
                    animate={{ rotate: [0, 10, -10, 0] }}
                    transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
                  >
                    <Star className="h-5 w-5 text-amber-500" fill="currentColor" />
                  </motion.div>
                  <div>
                    <motion.div
                      key={data.points}
                      initial={{ scale: 1.3, color: '#f59e0b' }}
                      animate={{ scale: 1, color: 'currentColor' }}
                      transition={{ duration: 0.4 }}
                      className="text-2xl font-extrabold tabular-nums leading-none"
                    >
                      {data.points}
                    </motion.div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">баллов</div>
                  </div>
                  <div className="h-8 w-px bg-border/40" />
                  <div>
                    <div className="text-lg font-bold tabular-nums leading-none">{data.referralCount}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">рефералов</div>
                  </div>
                </div>

                {/* Streak badge — with flame */}
                {data.streakCount > 0 && (
                  <motion.div
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.4 }}
                    className="inline-flex items-center gap-2 px-4 py-3 rounded-2xl glass-strong border border-orange-500/30 shadow-glow"
                  >
                    <motion.div
                      animate={{ scale: [1, 1.15, 1], rotate: [0, 3, -3, 0] }}
                      transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
                    >
                      <Flame className="h-5 w-5 text-orange-500" fill="currentColor" />
                    </motion.div>
                    <div>
                      <div className="text-lg font-extrabold tabular-nums leading-none text-orange-500">
                        {data.streakCount}
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">дней подряд</div>
                    </div>
                  </motion.div>
                )}

                {/* Leaderboard button */}
                <motion.button
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.5 }}
                  onClick={() => setShowLeaderboard(true)}
                  className="inline-flex items-center gap-2 px-4 py-3 rounded-2xl glass-strong border border-border/40 hover:shadow-glow transition-all"
                >
                  <Trophy className="h-5 w-5 text-amber-500" />
                  <div className="text-left">
                    <div className="text-xs font-bold">Топ-10</div>
                    <div className="text-[10px] text-muted-foreground">лидерборд</div>
                  </div>
                </motion.button>
              </motion.div>
            )}
          </div>
        </motion.div>
      </div>

      {/* ===== Card grid ===== */}
      <div className="px-4 md:px-6 pt-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl md:text-2xl font-bold tracking-tight">Возможности</h2>
          {loading && <span className="text-xs text-muted-foreground animate-pulse">Загрузка…</span>}
        </div>

        <motion.div
          variants={cardContainer}
          initial="hidden"
          animate="visible"
          className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4"
        >
          {visibleCards.map((meta) => {
            // Show count badge per card if data is loaded
            const count = data ? getCountForKind(data, meta.kind) : null
            return (
              <motion.div key={meta.kind} variants={cardItem}>
                <ClubCard meta={meta} onClick={() => setOpenKind(meta.kind)} count={count || undefined} />
              </motion.div>
            )
          })}
        </motion.div>
      </div>

      {/* ===== Footer note ===== */}
      <div className="px-4 md:px-6 pt-8">
        <div className="rounded-2xl glass p-4 md:p-5 text-center text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-amber-500" />
            Баллы начисляются за активность · Не выводятся · Только для покупок внутри приложения
          </span>
        </div>
      </div>

      {/* ===== Bespoke sheet router (wrapped in error boundary) ===== */}
      {data && openKind && (
        <ClubSheetErrorBoundary onClose={() => setOpenKind(null)}>
          <SheetRouter
            kind={openKind}
            data={data}
            onClose={() => setOpenKind(null)}
            refresh={refresh}
          />
        </ClubSheetErrorBoundary>
      )}

      {/* ===== Leaderboard sheet (wrapped in error boundary) ===== */}
      {showLeaderboard && (
        <ClubSheetErrorBoundary onClose={() => setShowLeaderboard(false)}>
          <LeaderboardSheet onClose={() => setShowLeaderboard(false)} />
        </ClubSheetErrorBoundary>
      )}
    </motion.div>
  )
}

/** Get the count of items for a card kind (for the badge on the landing card). */
function getCountForKind(data: any, kind: ClubCardKind): number {
  switch (kind) {
    case 'gifts': return data.gifts?.length || 0
    case 'promos': return data.promos?.length || 0
    case 'giveaways': return data.giveaways?.length || 0
    case 'bonuses': return data.bonuses?.length || 0
    case 'referrals': return data.referralCount || 0
    case 'tasks': return data.tasks?.length || 0
    case 'coupons': return data.coupons?.length || 0
    case 'events': return data.events?.length || 0
    default: return 0
  }
}

/** Lazy-loaded sheet router — only loads the sheet the user opened. */
function SheetRouter({ kind, data, onClose, refresh }: any) {
  // Dynamic import would be ideal here, but for simplicity we import all
  // sheets at the top of this file via React.lazy. Since this whole module
  // is already code-split via next/dynamic, the sheets load with the module.
  const meta = CLUB_CARDS.find((c) => c.kind === kind)
  if (!meta) return null

  switch (kind) {
    case 'gifts':
      return <LazyGiftSheet gifts={data.gifts} meta={meta} onClose={onClose} onChanged={refresh} />
    case 'promos':
      return <LazyPromoSheet promos={data.promos} meta={meta} onClose={onClose} />
    case 'giveaways':
      return <LazyGiveawaySheet giveaways={data.giveaways} meta={meta} onClose={onClose} onChanged={refresh} />
    case 'bonuses':
      return <LazyBonusSheet bonuses={data.bonuses} meta={meta} points={data.points} pointsEarnedTotal={data.pointsEarnedTotal} onClose={onClose} onChanged={refresh} />
    case 'referrals':
      return <LazyReferralSheet referralCode={data.referralCode} referralCount={data.referralCount} pointsEarnedTotal={data.pointsEarnedTotal} meta={meta} onClose={onClose} />
    case 'tasks':
      return <LazyTaskSheet tasks={data.tasks} meta={meta} onClose={onClose} onChanged={refresh} />
    case 'coupons':
      return <LazyCouponSheet coupons={data.coupons} meta={meta} onClose={onClose} onChanged={refresh} />
    case 'events':
      return <LazyEventSheet events={data.events} meta={meta} onClose={onClose} onChanged={refresh} />
    default:
      return null
  }
}

// Lazy-load all sheets so only the opened one downloads.
import { lazy, Suspense } from 'react'
const LazyGiftSheet = lazy(() => import('./sheets/gift-sheet').then(m => ({ default: m.GiftSheet })))
const LazyPromoSheet = lazy(() => import('./sheets/promo-sheet').then(m => ({ default: m.PromoSheet })))
const LazyGiveawaySheet = lazy(() => import('./sheets/giveaway-sheet').then(m => ({ default: m.GiveawaySheet })))
const LazyBonusSheet = lazy(() => import('./sheets/bonus-sheet').then(m => ({ default: m.BonusSheet })))
const LazyReferralSheet = lazy(() => import('./sheets/referral-sheet').then(m => ({ default: m.ReferralSheet })))
const LazyTaskSheet = lazy(() => import('./sheets/task-sheet').then(m => ({ default: m.TaskSheet })))
const LazyCouponSheet = lazy(() => import('./sheets/coupon-sheet').then(m => ({ default: m.CouponSheet })))
const LazyEventSheet = lazy(() => import('./sheets/event-sheet').then(m => ({ default: m.EventSheet })))

// ============================================================================
// LeaderboardSheet — top-10 users by points earned
// ============================================================================

function LeaderboardSheet({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<{ leaderboard: any[]; myRank: number } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    clubApi.getLeaderboard().then(setData).finally(() => setLoading(false))
  }, [])

  const meta = CLUB_CARDS.find((c) => c.kind === 'bonuses')!

  return (
    <ClubSheetWrapper meta={meta} onClose={onClose} subtitle="Топ-10 участников по баллам">
      <div className="p-4">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-6 w-6 rounded-full border-4 border-amber-500 border-t-transparent animate-spin" />
          </div>
        ) : data && data.leaderboard.length > 0 ? (
          <>
            {/* Podium — top 3 */}
            <div className="flex items-end justify-center gap-2 mb-6">
              {data.leaderboard.slice(0, 3).map((user, i) => {
                const heights = ['h-20', 'h-16', 'h-12']
                const medals = ['🥇', '🥈', '🥉']
                const colors = ['#f59e0b', '#94a3b8', '#a16207']
                return (
                  <motion.div
                    key={user.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.1 }}
                    className="flex flex-col items-center"
                  >
                    <div className="text-2xl mb-1">{medals[i]}</div>
                    <div className="h-10 w-10 rounded-full overflow-hidden border-2 mb-1" style={{ borderColor: colors[i] }}>
                      {user.avatar ? (
                        <img src={user.avatar} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full grid place-items-center bg-foreground/5 text-xs font-bold">
                          {(user.displayName || user.username).slice(0, 2).toUpperCase()}
                        </div>
                      )}
                    </div>
                    <div className="text-[10px] font-bold truncate max-w-[60px]">{user.displayName || user.username}</div>
                    <div className="text-[9px] text-muted-foreground">{user.pointsEarnedTotal} ⭐</div>
                    <div
                      className={`w-16 ${heights[i]} rounded-t-xl mt-1 grid place-items-center`}
                      style={{ background: `linear-gradient(180deg, ${colors[i]}, transparent)` }}
                    >
                      <span className="text-white font-extrabold text-lg">{i + 1}</span>
                    </div>
                  </motion.div>
                )
              })}
            </div>

            {/* Rest of the leaderboard (4-10) */}
            <div className="space-y-2">
              {data.leaderboard.slice(3).map((user, i) => (
                <motion.div
                  key={user.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.3 + i * 0.05 }}
                  className={`flex items-center gap-3 p-3 rounded-2xl ${user.isMe ? 'bg-amber-500/10 border border-amber-500/30' : 'glass'}`}
                >
                  <span className="w-6 text-center font-bold text-sm text-muted-foreground">{user.rank}</span>
                  <div className="h-8 w-8 rounded-full overflow-hidden shrink-0">
                    {user.avatar ? (
                      <img src={user.avatar} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full grid place-items-center bg-foreground/5 text-[10px] font-bold">
                        {(user.displayName || user.username).slice(0, 2).toUpperCase()}
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold truncate">
                      {user.displayName || user.username}
                      {user.isMe && <span className="ml-1 text-[10px] text-amber-500">(вы)</span>}
                    </div>
                    {user.streakCount > 0 && (
                      <div className="text-[10px] text-muted-foreground">🔥 {user.streakCount} дней</div>
                    )}
                  </div>
                  <div className="text-sm font-bold text-amber-500">{user.pointsEarnedTotal} ⭐</div>
                </motion.div>
              ))}
            </div>

            {/* My rank (if not in top 10) */}
            {data.myRank > 10 && (
              <div className="mt-4 p-3 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center gap-3">
                <span className="w-6 text-center font-bold text-sm text-amber-500">{data.myRank}</span>
                <div className="flex-1 text-sm font-semibold">Ваше место в рейтинге</div>
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <Trophy className="h-12 w-12 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground text-center">
              Пока нет участников с баллами. Зарабатывайте баллы — и вы окажетесь здесь!
            </p>
          </div>
        )}
      </div>
    </ClubSheetWrapper>
  )
}
