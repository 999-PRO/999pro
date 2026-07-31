/**
 * Cleanup job — prunes old rows from fast-growing tables.
 *
 * Phase 16: ProductView, SearchHistory, and AuditLog grow unbounded.
 * This script should be run daily via cron to:
 *   - Delete ProductView rows older than 30 days
 *   - Delete SearchHistory rows older than 90 days
 *   - Delete AuditLog rows older than 365 days
 *   - Run VACUUM to reclaim disk space (SQLite)
 *
 * Usage:
 *   bunx tsx scripts/cleanup.ts
 *
 * Recommended cron (daily at 04:00):
 *   0 4 * * * cd /path/to/backend && bunx tsx scripts/cleanup.ts >> logs/cleanup.log 2>&1
 */

import { prisma } from '../src/lib/prisma.js'

async function main() {
  const now = new Date()
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
  const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000)

  console.log(`[${now.toISOString()}] Starting cleanup...`)
  console.log(`  ProductView: delete before ${thirtyDaysAgo.toISOString()}`)
  console.log(`  SearchHistory: delete before ${ninetyDaysAgo.toISOString()}`)
  console.log(`  AuditLog: delete before ${oneYearAgo.toISOString()}`)

  // ProductView — 30 days retention
  // These are page-view tracking rows used for personalization. 30 days is
  // enough for "recently viewed" features; older data has no value.
  try {
    const pvDeleted = await prisma.productView.deleteMany({
      where: { createdAt: { lt: thirtyDaysAgo } },
    })
    console.log(`  ✓ ProductView: deleted ${pvDeleted.count} rows`)
  } catch (e) {
    console.error(`  ✗ ProductView cleanup failed:`, e)
  }

  // SearchHistory — 90 days retention
  // Used for search personalization. 90 days covers seasonal trends.
  try {
    const shDeleted = await prisma.searchHistory.deleteMany({
      where: { createdAt: { lt: ninetyDaysAgo } },
    })
    console.log(`  ✓ SearchHistory: deleted ${shDeleted.count} rows`)
  } catch (e) {
    console.error(`  ✗ SearchHistory cleanup failed:`, e)
  }

  // AuditLog — 365 days retention (1 year)
  // Compliance requires keeping audit logs for at least 1 year.
  // After 1 year, old entries have no legal/business value.
  //
  // v9-audit-fix: before pruning, save the hash of the newest entry being
  // deleted as a "checkpoint" in AppSetting. This allows verifyAuditChain()
  // to validate the chain from the checkpoint forward, even after old entries
  // are removed. Without this checkpoint, pruning would break the hash chain
  // (the first remaining entry's prevHash would point to a deleted entry).
  try {
    // Find the newest entry that will be pruned (if any)
    const lastToPrune = await prisma.auditLog.findFirst({
      where: { createdAt: { lt: oneYearAgo } },
      orderBy: { createdAt: 'desc' },
      select: { hash: true, createdAt: true },
    })

    if (lastToPrune?.hash) {
      // Save checkpoint before deleting
      await prisma.appSetting.upsert({
        where: { id: 'audit:checkpoint' },
        update: { value: JSON.stringify({ hash: lastToPrune.hash, prunedAt: now.toISOString() }) },
        create: { id: 'audit:checkpoint', value: JSON.stringify({ hash: lastToPrune.hash, prunedAt: now.toISOString() }) },
      })
      console.log(`  ✓ AuditLog: saved checkpoint (hash=${lastToPrune.hash.slice(0, 16)}...)`)
    }

    const alDeleted = await prisma.auditLog.deleteMany({
      where: { createdAt: { lt: oneYearAgo } },
    })
    console.log(`  ✓ AuditLog: deleted ${alDeleted.count} rows`)
  } catch (e) {
    console.error(`  ✗ AuditLog cleanup failed:`, e)
  }

  // VACUUM — reclaim disk space after deletes
  // SQLite doesn't auto-reclaim space; VACUUM rebuilds the database file.
  // In WAL mode, this also checkpoints the WAL into the main DB.
  try {
    console.log('  Running VACUUM...')
    await prisma.$executeRawUnsafe('VACUUM')
    console.log('  ✓ VACUUM complete')
  } catch (e) {
    // VACUUM can fail if there are active transactions — non-fatal
    console.error('  ⚠ VACUUM failed (non-fatal, will retry next run):', e)
  }

  // ANALYZE — update query planner statistics
  // After large deletes, SQLite's statistics become stale and the query
  // planner may choose suboptimal indexes. ANALYZE refreshes them.
  try {
    console.log('  Running ANALYZE...')
    await prisma.$executeRawUnsafe('ANALYZE')
    console.log('  ✓ ANALYZE complete')
  } catch (e) {
    console.error('  ⚠ ANALYZE failed (non-fatal):', e)
  }

  console.log(`[${new Date().toISOString()}] Cleanup complete.`)
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error('Cleanup failed:', e)
  process.exit(1)
})
