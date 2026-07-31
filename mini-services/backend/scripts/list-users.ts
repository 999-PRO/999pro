import { prisma } from '../src/lib/prisma.js'

async function main() {
  const users = await prisma.user.findMany({
    select: { id: true, email: true, username: true, phone: true, role: true, displayName: true },
    orderBy: { createdAt: 'asc' },
  })
  console.log('=== USERS IN DB ===')
  console.log(JSON.stringify(users, null, 2))
  console.log(`Total: ${users.length}`)
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
