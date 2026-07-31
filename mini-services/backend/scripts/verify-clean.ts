// Verify DB state after cleanup
import { prisma } from '../src/lib/prisma.js'

async function check() {
  const tables = [
    'user','product','productView','searchHistory','favorite','cartItem',
    'order','orderStatusHistory','orderItem','deliveryZone','story',
    'conversation','conversationParticipant','message','call','banner',
    'appSetting','pushSubscription','review','lead','auditLog',
    'shareLink','shareEvent','clubGift','clubGiftClaim','clubPromo',
    'clubGiveaway','clubGiveawayParticipant','clubBonus','clubBonusClaim',
    'clubTask','clubTaskCompletion','clubCoupon','clubCouponClaim',
    'clubEvent','clubEventRegistration','pointsTransaction',
  ] as const

  console.log('=== POST-CLEANUP DB STATE (non-empty tables only) ===')
  let total = 0
  for (const t of tables) {
    const c = await (prisma[t] as any).count()
    if (c > 0) {
      console.log(`  ${t.padEnd(28)} ${c}`)
      total += c
    }
  }
  console.log(`  ${'TOTAL'.padEnd(28)} ${total}`)
  console.log('')

  console.log('=== Users remaining (should be only admin) ===')
  const users = await prisma.user.findMany({
    select: { id: true, email: true, username: true, role: true, totpEnabled: true, deletedAt: true, points: true },
  })
  for (const u of users) {
    console.log(`  ${u.email.padEnd(25)} role=${u.role}  totp=${u.totpEnabled}  points=${u.points}  deleted=${u.deletedAt ? 'YES' : 'no'}`)
  }
  console.log('')

  console.log('=== Integrity check: referential sanity ===')
  const orphaned = await prisma.user.count({ where: { deletedAt: { not: null } } })
  console.log(`  Soft-deleted users: ${orphaned}`)
  console.log('')
  await prisma.$disconnect()
}

check().catch((e) => {
  console.error('Verify failed:', e)
  process.exit(1)
})
