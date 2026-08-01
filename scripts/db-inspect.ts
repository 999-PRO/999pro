// Quick DB inspection script — uses the BACKEND Prisma client against PostgreSQL.
// Run from project root:  bun run scripts/db-inspect.ts
//
// v25.2: PostgreSQL-only. The script reads DATABASE_URL from the environment
// (or mini-services/backend/.env). It no longer accepts DB_PATH for a SQLite
// file.
//
// This script imports from mini-services/backend/node_modules — make sure
// dependencies are installed there (`cd mini-services/backend && npm install`).
import { PrismaClient } from '../mini-services/backend/node_modules/@prisma/client/index.js'
import fs from 'node:fs'
import path from 'node:path'

async function main() {
  // Resolve DATABASE_URL: env var > backend .env > error.
  let dbUrl = process.env.DATABASE_URL
  if (!dbUrl) {
    const envPath = path.resolve(__dirname, '..', 'mini-services', 'backend', '.env')
    if (fs.existsSync(envPath)) {
      const env = fs.readFileSync(envPath, 'utf8')
      const m = env.match(/^DATABASE_URL=(.+)$/m)
      if (m) dbUrl = m[1].trim().replace(/^"|"$/g, '')
    }
  }
  if (!dbUrl) {
    console.error('✗ DATABASE_URL not set. Either export it or set it in mini-services/backend/.env')
    process.exit(1)
  }
  if (!dbUrl.startsWith('postgres://') && !dbUrl.startsWith('postgresql://')) {
    console.error(`✗ DATABASE_URL must be a postgresql:// URL (v25.2). Got: ${dbUrl}`)
    process.exit(1)
  }

  const p = new PrismaClient({
    datasources: { db: { url: dbUrl } },
  })
  try {
    const users = await p.user.findMany({ select: { id: true, username: true, email: true, role: true, displayName: true } })
    console.log('=== Users ===')
    console.log(JSON.stringify(users, null, 2))
    const admins = users.filter((u) => u.role === 'admin')
    console.log(`\nAdmins: ${admins.length}`)
    if (admins.length > 0) console.log('First admin:', admins[0])

    const convs = await p.conversation.findMany({
      select: {
        id: true,
        type: true,
        participants: { select: { userId: true } },
        messages: { select: { id: true, content: true }, take: 1, orderBy: { createdAt: 'desc' } },
      },
      take: 10,
    })
    console.log(`\n=== Conversations (${convs.length}) ===`)
    console.log(JSON.stringify(convs, null, 2))

    const leads = await p.lead.count()
    const products = await p.product.count()
    const banners = await p.banner.count()
    console.log(`\n=== Counts ===`)
    console.log(`Leads: ${leads}, Products: ${products}, Banners: ${banners}`)
  } finally {
    await p.$disconnect()
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
