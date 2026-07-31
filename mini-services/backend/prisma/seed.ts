// Production-safe seed script — does NOT create any test data.
//
// This is the default seed (`bun run db:seed`). It is intentionally a no-op:
//   • No demo users
//   • No demo products
//   • No demo banners
//   • No demo club data
//
// For local development with demo data, use seed-demo.ts instead:
//   bunx tsx prisma/seed-demo.ts
//
// Production admins are created via Studio's first-run setup wizard
// (POST /api/auth/setup-admin with FIRST_RUN_TOKEN env), NOT via seed.
//
// AUDIT (v16.8): rewritten for production readiness. The previous seed.ts
// created 4 demo users + 20 demo products + 3 demo banners on every run —
// which silently polluted production databases if an operator ran
// `bun run db:seed` after deploy. The NODE_ENV=production guard existed
// but was easy to miss. Now the default seed is a no-op, and demo data
// lives in a clearly-named seed-demo.ts that operators won't run by accident.

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('«Три девятки» — production-safe seed')
  console.log('=============================')
  console.log('')
  console.log('This seed does NOT create any demo data.')
  console.log('')

  // Report current DB state — useful for operators to verify the DB is empty
  // before first deploy (or to see what's there after cleanup-production.ts).
  const [users, products, banners, orders] = await Promise.all([
    prisma.user.count(),
    prisma.product.count(),
    prisma.banner.count(),
    prisma.order.count(),
  ])
  const admins = await prisma.user.count({ where: { role: 'admin', deletedAt: null } })

  console.log('Current database state:')
  console.log(`  Users:    ${users} (admins: ${admins})`)
  console.log(`  Products: ${products}`)
  console.log(`  Banners:  ${banners}`)
  console.log(`  Orders:   ${orders}`)
  console.log('')

  if (admins === 0) {
    console.log('⚠ No admin account found.')
    console.log('  Create one via Studio first-run wizard:')
    console.log('    1. Open /studio in your browser')
    console.log('    2. Follow the setup flow (requires FIRST_RUN_TOKEN env var)')
    console.log('    3. Or run: ADMIN_PASSWORD="..." bunx tsx scripts/create-admin.ts')
    console.log('')
  } else {
    console.log(`✓ ${admins} admin account(s) present.`)
    console.log('  Log in to /studio with admin credentials to configure products, banners, etc.')
    console.log('')
  }

  console.log('For local development with demo data, run:')
  console.log('  bunx tsx prisma/seed-demo.ts')
  console.log('')
}

main()
  .catch((e) => {
    console.error('Seed failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
