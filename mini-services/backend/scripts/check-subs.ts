import { prisma } from '../src/lib/prisma.js'

async function main() {
  const count = await prisma.pushSubscription.count()
  console.log('Push subscriptions in DB:', count)
  if (count > 0) {
    const subs = await prisma.pushSubscription.findMany({ take: 3, select: { userId: true, endpoint: true, scope: true, userAgent: true } })
    console.log('Sample:', JSON.stringify(subs, null, 2))
  }
  // Also check users
  const users = await prisma.user.count()
  console.log('Users in DB:', users)
  await prisma.$disconnect()
}
main()
