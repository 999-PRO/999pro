import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  // Add updatedAt + category columns via raw SQL (SQLite ALTER TABLE)
  await prisma.$executeRawUnsafe('ALTER TABLE "Order" ADD COLUMN "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP').catch(() => {})
  await prisma.$executeRawUnsafe('ALTER TABLE "Order" ADD COLUMN "category" TEXT').catch(() => {})
  // Migrate old statuses
  await prisma.$executeRawUnsafe('UPDATE "Order" SET status = \'new\' WHERE status = \'pending\'').catch(() => {})
  await prisma.$executeRawUnsafe('UPDATE "Order" SET status = \'in_work\' WHERE status = \'paid\'').catch(() => {})
  await prisma.$executeRawUnsafe('UPDATE "Order" SET status = \'in_delivery\' WHERE status = \'shipped\'').catch(() => {})
  await prisma.$executeRawUnsafe('UPDATE "Order" SET status = \'done\' WHERE status = \'delivered\'').catch(() => {})
  console.log('✓ Order columns added + statuses migrated')
  await prisma.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
