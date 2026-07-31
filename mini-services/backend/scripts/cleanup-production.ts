// ============================================================================
// Production cleanup script — wipes ALL test/dev data from the database.
//
// Run BEFORE first production deploy to start with a clean state.
// Preserves only the admin account (so you can log in to Studio).
// Removes: products, banners, stories, hero, orders, leads, chat messages,
// conversations, reviews, favorites, cart, club data, share links, audit log,
// delivery zones, settings, push subscriptions, ALL non-admin users.
//
// Usage:
//   bunx tsx scripts/cleanup-production.ts
//   bunx tsx scripts/cleanup-production.ts --keep-admin-email=admin@999.pro
// ============================================================================

import { prisma } from '../src/lib/prisma.js'

async function main() {
  const keepAdminEmail = process.argv
    .find((a) => a.startsWith('--keep-admin-email='))
    ?.split('=')[1] || 'admin@999.pro'

  console.log('='.repeat(60))
  console.log('  999 PRO — Production Cleanup')
  console.log('='.repeat(60))
  console.log(`Keeping admin: ${keepAdminEmail}`)
  console.log('')

  // Track counts for the summary.
  const counts: Record<string, number> = {}

  // Helper: deleteMany returns { count: N } — extract the count.
  const del = async (table: string, fn: () => Promise<{ count: number }>) => {
    const r = await fn()
    counts[table] = r.count
  }

  // Order matters: child tables first, parent tables last (FK constraints).
  // Many of these have ON DELETE CASCADE for their parent, but explicit
  // deleteMany is safer + gives accurate counts.

  // 1. Club data — transactions, claims, completions, registrations
  await del('pointsTransaction', () => prisma.pointsTransaction.deleteMany({}))
  await del('clubGiftClaim', () => prisma.clubGiftClaim.deleteMany({}))
  await del('clubBonusClaim', () => prisma.clubBonusClaim.deleteMany({}))
  await del('clubTaskCompletion', () => prisma.clubTaskCompletion.deleteMany({}))
  await del('clubCouponClaim', () => prisma.clubCouponClaim.deleteMany({}))
  await del('clubGiveawayParticipant', () => prisma.clubGiveawayParticipant.deleteMany({}))
  await del('clubEventRegistration', () => prisma.clubEventRegistration.deleteMany({}))
  await del('clubGift', () => prisma.clubGift.deleteMany({}))
  await del('clubBonus', () => prisma.clubBonus.deleteMany({}))
  await del('clubTask', () => prisma.clubTask.deleteMany({}))
  await del('clubCoupon', () => prisma.clubCoupon.deleteMany({}))
  await del('clubGiveaway', () => prisma.clubGiveaway.deleteMany({}))
  await del('clubEvent', () => prisma.clubEvent.deleteMany({}))
  await del('clubPromo', () => prisma.clubPromo.deleteMany({}))

  // 2. Share + analytics
  await del('shareEvent', () => prisma.shareEvent.deleteMany({}))
  await del('shareLink', () => prisma.shareLink.deleteMany({}))

  // 3. Audit log (will be regenerated as admins act)
  await del('auditLog', () => prisma.auditLog.deleteMany({}))
  // Clear the audit chain checkpoint so verifyAuditChain() starts fresh.
  await prisma.appSetting.deleteMany({ where: { id: 'audit:checkpoint' } }).catch(() => {})

  // 4. Calls (chat calls)
  await del('call', () => prisma.call.deleteMany({}))

  // 5. Chat — messages first, then participants, then conversations
  await del('message', () => prisma.message.deleteMany({}))
  await del('conversationParticipant', () => prisma.conversationParticipant.deleteMany({}))
  await del('conversation', () => prisma.conversation.deleteMany({}))

  // 6. Reviews
  await del('review', () => prisma.review.deleteMany({}))

  // 7. Leads
  await del('lead', () => prisma.lead.deleteMany({}))

  // 8. Orders — items + history first, then orders
  await del('orderStatusHistory', () => prisma.orderStatusHistory.deleteMany({}))
  await del('orderItem', () => prisma.orderItem.deleteMany({}))
  await del('order', () => prisma.order.deleteMany({}))

  // 9. Cart + favorites
  await del('cartItem', () => prisma.cartItem.deleteMany({}))
  await del('favorite', () => prisma.favorite.deleteMany({}))

  // 10. Product views + search history (analytics)
  await del('productView', () => prisma.productView.deleteMany({}))
  await del('searchHistory', () => prisma.searchHistory.deleteMany({}))

  // 11. Stories
  await del('story', () => prisma.story.deleteMany({}))

  // 12. Products
  await del('product', () => prisma.product.deleteMany({}))

  // 13. Banners
  await del('banner', () => prisma.banner.deleteMany({}))

  // 14. Delivery zones
  await del('deliveryZone', () => prisma.deliveryZone.deleteMany({}))

  // 15. Push subscriptions (clients will re-subscribe on next visit)
  await del('pushSubscription', () => prisma.pushSubscription.deleteMany({}))

  // 16. App settings — keep only the audit:checkpoint we already cleared.
  // Settings include homeLayout, appTitle, headerImage, etc. — these are
  // admin-configured and should be reset for a fresh production deploy.
  await del('appSetting', () => prisma.appSetting.deleteMany({}))

  // 17. Users — delete ALL non-admin users + admin accounts WITHOUT TOTP
  // enrolled (these are test admins from seed/dev). Keep only admins with
  // TOTP enrolled — those are the real production admins.
  // Pass --keep-admin-email=you@example.com to force-keep a specific admin
  // even if they don't have TOTP yet (e.g. first production deploy).
  const keepAdminEmails = new Set([keepAdminEmail.toLowerCase()])
  await del('user', () =>
    prisma.user.deleteMany({
      where: {
        OR: [
          { role: { not: 'admin' } }, // all non-admins
          { role: 'admin', totpEnabled: false, email: { notIn: [...keepAdminEmails] } }, // test admins without TOTP
        ],
      },
    }),
  )
  // Reset admin account: clear points, failedLoginCount, set isOnline=false.
  // Keep TOTP secret so the admin can still log in if already enrolled.
  await prisma.user.updateMany({
    where: { role: 'admin' },
    data: {
      points: 0,
      pointsEarnedTotal: 0,
      isOnline: false,
      failedLoginCount: 0,
      lockedUntil: null,
    },
  })

  // Print summary
  console.log('Cleanup summary (rows deleted):')
  console.log('-'.repeat(60))
  let total = 0
  for (const [table, count] of Object.entries(counts)) {
    if (count > 0) {
      console.log(`  ${table.padEnd(28)} ${count}`)
      total += count
    }
  }
  console.log('-'.repeat(60))
  console.log(`  ${'TOTAL'.padEnd(28)} ${total}`)
  console.log('')
  console.log('✓ Database cleaned. Admin account preserved.')
  console.log('')
  console.log('Next steps:')
  console.log('  1. Delete all files in mini-services/backend/uploads/')
  console.log('  2. Restart the backend')
  console.log('  3. Log in to Studio as admin to configure products, banners, etc.')
  console.log('')
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error('Cleanup failed:', e)
    prisma.$disconnect()
    process.exit(1)
  })
