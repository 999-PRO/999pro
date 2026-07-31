// Quick DB inspection script — uses the BACKEND Prisma client.
// Run from project root:  bun run scripts/db-inspect.ts
//
// This script imports from mini-services/backend/node_modules — make sure
// dependencies are installed there (`cd mini-services/backend && bun install`).
import { PrismaClient } from '../mini-services/backend/node_modules/@prisma/client/index.js'

async function main() {
  const p = new PrismaClient({
    // Wave 2 (C-SCRIPT-001): corrected DB path — was /home/z/my-project/mini-services/backend/db/marketplace.db
    datasources: { db: { url: 'file:' + (process.env.DB_PATH || '/home/z/my-project/999pro/mini-services/backend/prisma/dev.db') } },
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
