import { prisma } from '../src/lib/prisma.js'

async function main() {
  // Include soft-deleted counts.
  const products = await prisma.product.count()
  const productsDeleted = await prisma.product.count({ where: { deletedAt: { not: null } } })
  console.log('products total:', products, 'soft-deleted:', productsDeleted)
  const banners = await prisma.banner.count()
  console.log('banners:', banners)
  const users = await prisma.user.count()
  const usersDeleted = await prisma.user.count({ where: { deletedAt: { not: null } } })
  console.log('users total:', users, 'soft-deleted:', usersDeleted)
  console.log('\nAll users:')
  const allUsers = await prisma.user.findMany({
    where: { deletedAt: null },
    select: { id: true, email: true, username: true, role: true, totpEnabled: true, points: true },
    take: 50,
  })
  for (const u of allUsers) {
    console.log(' ', u.email.padEnd(25), '|', u.role.padEnd(6), '| totp:', u.totpEnabled ? 'yes' : 'no ', '| pts:', u.points)
  }
  await prisma.$disconnect()
}
main()
