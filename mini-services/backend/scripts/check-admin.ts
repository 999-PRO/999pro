import { prisma } from '../src/lib/prisma.js'
async function main() {
  await prisma.user.update({ where: { email: 'admin@999.pro' }, data: { totpEnabled: false, totpSecret: null } })
  const u = await prisma.user.findUnique({ where: { email: 'admin@999.pro' }, select: { email: true, totpEnabled: true, totpSecret: true, role: true } })
  console.log('USER:', JSON.stringify(u, null, 2))
  await prisma.$disconnect()
}
main()
