import { prisma } from '../src/lib/prisma.js'

// v24.6-audit fix: this script was querying `securitySettings` for fields that
// actually live on `AIKB_Settings` (assistantName, greeting). The Prisma type
// for SecuritySettings doesn't include those fields, so `tsc --noEmit` (run
// by Next.js build) failed with TS2339. Fixed to read from the correct model.
async function main() {
  const s = await prisma.aIKB_Settings.findFirst()
  console.log('assistantName:', s?.assistantName)
  console.log('greeting:', s?.greeting)
  await prisma.$disconnect()
}
main()
