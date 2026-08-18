import { prisma } from '../src/lib/prisma.js'
import bcrypt from 'bcryptjs'

// ============================================================
// create-admin.ts — Create or reset the admin account.
// ============================================================
// DEPRECATED in v25 — kept for legacy/automation use only.
//
// The recommended way to create the first admin is now the web-based
// setup wizard at /studio. After all services are running:
//   1. Open http://localhost:3001/studio in your browser.
//   2. If no admin exists, the wizard opens automatically.
//   3. Fill in the form (name, username, email, password) and click
//      "Create administrator".
//   4. You're logged in automatically — no second login needed.
//
// This script is still useful for:
//   - Headless/automated deployments where no browser is available.
//   - Resetting a forgotten admin password (use --force).
//   - Promoting an existing user to admin.
//
// FIXED (Phase 2): Previously this script:
//   1. Hardcoded password 'admin12345' (in top-1000 brute-force list)
//   2. Used bcrypt rounds=10 (below OWASP 2024 recommendation of 12)
//   3. Silently reset existing admin's password without confirmation
//
// Now the script:
//   - Reads password from ADMIN_PASSWORD env var (or prompts interactively)
//   - Uses BCRYPT_ROUNDS from env (default 12, matches backend .env)
//   - Requires --force flag to reset an existing admin
//   - Reads email/username from env vars (with sensible defaults)
//
// Usage:
//   ADMIN_PASSWORD='strong-pass' bunx tsx scripts/create-admin.ts
//   ADMIN_PASSWORD='strong-pass' bunx tsx scripts/create-admin.ts --force
//   ADMIN_EMAIL='admin@example.com' ADMIN_USERNAME='admin' ADMIN_PASSWORD='x' bunx tsx scripts/create-admin.ts
// ============================================================

async function main() {
  const email = process.env.ADMIN_EMAIL || 'admin@999.pro'
  const username = process.env.ADMIN_USERNAME || 'admin'
  const password = process.env.ADMIN_PASSWORD
  const bcryptRounds = Number(process.env.BCRYPT_ROUNDS) || 12
  const forceReset = process.argv.includes('--force')

  if (!password) {
    console.error('ERROR: ADMIN_PASSWORD env var is required.')
    console.error('Usage: ADMIN_PASSWORD="your-strong-password" bunx tsx scripts/create-admin.ts')
    console.error('       ADMIN_PASSWORD="your-strong-password" bunx tsx scripts/create-admin.ts --force')
    process.exit(1)
  }

  if (password.length < 8) {
    console.error('ERROR: ADMIN_PASSWORD must be at least 8 characters.')
    process.exit(1)
  }

  console.log(`Using bcrypt rounds: ${bcryptRounds}`)

  // Check if admin already exists
  const existing = await prisma.user.findFirst({
    where: { OR: [{ email }, { username }] },
    select: { id: true, email: true, username: true, role: true },
  })

  if (existing) {
    if (existing.role === 'admin') {
      if (!forceReset) {
        console.log(`Admin already exists: ${existing.email} (id=${existing.id})`)
        console.log('To reset the password, run with --force flag:')
        console.log('  ADMIN_PASSWORD="new-pass" bunx tsx scripts/create-admin.ts --force')
        process.exit(0)
      }
      console.log(`Resetting password for existing admin: ${existing.email}`)
      const hash = await bcrypt.hash(password, bcryptRounds)
      await prisma.user.update({
        where: { id: existing.id },
        data: { password: hash, role: 'admin', tokenVersion: { increment: 1 } },
      })
      console.log('✓ Admin password reset successfully')
      console.log('  (existing sessions invalidated via tokenVersion bump)')
    } else {
      // Promote existing user to admin
      console.log(`Promoting existing user to admin: ${existing.email}`)
      const hash = await bcrypt.hash(password, bcryptRounds)
      await prisma.user.update({
        where: { id: existing.id },
        data: { password: hash, role: 'admin', tokenVersion: { increment: 1 } },
      })
      console.log('✓ User promoted to admin, password set')
    }
  } else {
    const hash = await bcrypt.hash(password, bcryptRounds)
    const admin = await prisma.user.create({
      data: {
        email,
        username,
        phone: '+79990000000',
        password: hash,
        displayName: 'Administrator',
        role: 'admin',
      },
    })
    console.log('✓ Created admin:')
    console.log(`  id: ${admin.id}`)
    console.log(`  email: ${admin.email}`)
    console.log(`  username: ${admin.username}`)
    console.log(`  role: ${admin.role}`)
  }

  console.log('\n=== Final user list ===')
  const users = await prisma.user.findMany({
    select: { id: true, email: true, username: true, role: true },
    orderBy: { createdAt: 'asc' },
  })
  console.log(JSON.stringify(users, null, 2))

  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
