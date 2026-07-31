import { prisma } from '../src/lib/prisma.js'

async function main() {
  console.log('=== Before cleanup ===')
  const before = await prisma.user.findMany({
    select: { id: true, email: true, username: true, role: true },
    orderBy: { createdAt: 'asc' },
  })
  console.log(JSON.stringify(before, null, 2))

  // All known test/verification users created during debugging sessions.
  // The 4 seeded demo users (maria/denis/kate/ivan @999.pro) are NOT in
  // this list — they're the intended demo data and should remain.
  const targets = [
    'superadmin_new@999.pro',
    'firstadmin@999.pro',
    'seconduser@999.pro',
    'test_bun_001@example.com',
    'test_survive_001@example.com',
    'real_test_001@example.com',
    'mainapp_user@example.com',
    'studio_user@example.com',
    'test_register_studio@example.com',
    'verify_stable_001@example.com',
  ]
  for (const email of targets) {
    const u = await prisma.user.findFirst({ where: { email }, select: { id: true, role: true } })
    if (u) {
      try {
        await prisma.user.delete({ where: { id: u.id } })
        console.log(`Deleted ${email} (was role=${u.role})`)
      } catch (e) {
        console.error(`Failed to delete ${email}:`, e instanceof Error ? e.message : e)
      }
    } else {
      console.log(`${email} not found, skipping`)
    }
  }

  console.log('\n=== After cleanup ===')
  const after = await prisma.user.findMany({
    select: { id: true, email: true, username: true, role: true },
    orderBy: { createdAt: 'asc' },
  })
  console.log(JSON.stringify(after, null, 2))

  const adminCount = await prisma.user.count({ where: { role: 'admin' } })
  console.log(`\nAdmins in DB: ${adminCount}`)
  console.log(`Total users: ${after.length}`)

  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
