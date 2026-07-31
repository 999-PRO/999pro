// Reset admin TOTP state for testing.
import { prisma } from '../src/lib/prisma.js'

async function main() {
  const u = await prisma.user.update({
    where: { email: 'admin@999.pro' },
    data: { totpEnabled: false, totpSecret: null },
    select: { email: true, totpEnabled: true, totpSecret: true },
  })
  console.log('Admin TOTP state reset:', u)
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
