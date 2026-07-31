// ============================================================================
// Pruning script — run periodically (cron) to clean up unbounded tables.
//
// AUDIT-2 C8 fix (v16.8): ProductView, SearchHistory, ShareEvent have no
// pruning — they grow forever and bloat the DB. AuditLog grows forever too
// (correct for audit), but old entries can be archived + pruned once the
// chain checkpoint is saved (see lib/audit.ts verifyAuditChain checkpoint logic).
//
// Usage:
//   bunx tsx scripts/prune.ts                 # prune with defaults (30 days)
//   bunx tsx scripts/prune.ts --days 60       # prune rows older than 60 days
//   bunx tsx scripts/prune.ts --dry-run       # preview without deleting
//   bunx tsx scripts/prune.ts --audit-days 365 # prune audit log older than 1 year
//
// Recommended cron (runs daily at 03:00 server time):
//   0 3 * * * cd /app && bunx tsx scripts/prune.ts >> logs/prune.log 2>&1
// ============================================================================

import { prisma } from '../src/lib/prisma.js'
import { auditLogBulk } from '../src/lib/audit.js'

async function main() {
  const days = Number(process.argv.find((a) => a.startsWith('--days='))?.split('=')[1] || 30)
  const auditDays = Number(process.argv.find((a) => a.startsWith('--audit-days='))?.split('=')[1] || 365)
  const dryRun = process.argv.includes('--dry-run')

  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  const auditCutoff = new Date(Date.now() - auditDays * 24 * 60 * 60 * 1000)

  console.log(`[PRUNE] Cutoff: ${cutoff.toISOString()} (${days} days)`)
  console.log(`[PRUNE] Audit cutoff: ${auditCutoff.toISOString()} (${auditDays} days)`)
  if (dryRun) console.log('[PRUNE] DRY RUN — no rows will be deleted')

  // 1. ProductView — one row per product page view per user/IP. At 1000 DAU
  //    with 10 product views each, this is 10000 rows/day = 3.6M/year.
  const pvCount = await prisma.productView.count({ where: { createdAt: { lt: cutoff } } })
  console.log(`[PRUNE] ProductView rows older than ${days}d: ${pvCount}`)
  if (!dryRun && pvCount > 0) {
    const r = await prisma.productView.deleteMany({ where: { createdAt: { lt: cutoff } } })
    console.log(`[PRUNE] Deleted ${r.count} ProductView rows`)
  }

  // 2. SearchHistory — one row per search query. Grows with user activity.
  const shCount = await prisma.searchHistory.count({ where: { createdAt: { lt: cutoff } } })
  console.log(`[PRUNE] SearchHistory rows older than ${days}d: ${shCount}`)
  if (!dryRun && shCount > 0) {
    const r = await prisma.searchHistory.deleteMany({ where: { createdAt: { lt: cutoff } } })
    console.log(`[PRUNE] Deleted ${r.count} SearchHistory rows`)
  }

  // 3. ShareEvent — one row per share/open/track event. Grows with sharing.
  const seCount = await prisma.shareEvent.count({ where: { createdAt: { lt: cutoff } } })
  console.log(`[PRUNE] ShareEvent rows older than ${days}d: ${seCount}`)
  if (!dryRun && seCount > 0) {
    const r = await prisma.shareEvent.deleteMany({ where: { createdAt: { lt: cutoff } } })
    console.log(`[PRUNE] Deleted ${r.count} ShareEvent rows`)
  }

  // 4. AuditLog — archive old entries to a checkpoint, then prune.
  //    The checkpoint (hash of last pruned entry) is stored in AppSetting
  //    so verifyAuditChain() can still validate the remaining chain.
  //    See lib/audit.ts verifyAuditChain() for checkpoint logic.
  const auditCount = await prisma.auditLog.count({ where: { createdAt: { lt: auditCutoff } } })
  console.log(`[PRUNE] AuditLog rows older than ${auditDays}d: ${auditCount}`)
  if (!dryRun && auditCount > 0) {
    // Find the last entry we're about to delete — its hash becomes the checkpoint.
    const lastPruned = await prisma.auditLog.findFirst({
      where: { createdAt: { lt: auditCutoff } },
      orderBy: { createdAt: 'desc' },
      select: { hash: true, createdAt: true },
    })
    if (lastPruned) {
      // Save the checkpoint BEFORE deleting.
      const checkpoint = JSON.stringify({
        hash: lastPruned.hash,
        prunedAt: new Date().toISOString(),
        prunedUpTo: lastPruned.createdAt.toISOString(),
      })
      await prisma.appSetting.upsert({
        where: { id: 'audit:checkpoint' },
        update: { value: checkpoint },
        create: { id: 'audit:checkpoint', value: checkpoint },
      })
      const r = await prisma.auditLog.deleteMany({ where: { createdAt: { lt: auditCutoff } } })
      console.log(`[PRUNE] Deleted ${r.count} AuditLog rows (checkpoint saved)`)

      // Record the prune itself in the (now-fresh) audit log.
      await auditLogBulk(null, 'system', 'prune', {
        count: r.count,
        olderThan: auditCutoff.toISOString(),
        checkpointHash: lastPruned.hash,
      })
    }
  }

  // 5. OrderStatusHistory — keep for 2 years (tax/compliance), then prune.
  //    Default 730 days. Override with --order-history-days=N.
  const ohDays = Number(process.argv.find((a) => a.startsWith('--order-history-days='))?.split('=')[1] || 730)
  const ohCutoff = new Date(Date.now() - ohDays * 24 * 60 * 60 * 1000)
  const ohCount = await prisma.orderStatusHistory.count({ where: { createdAt: { lt: ohCutoff } } })
  console.log(`[PRUNE] OrderStatusHistory rows older than ${ohDays}d: ${ohCount}`)
  if (!dryRun && ohCount > 0) {
    const r = await prisma.orderStatusHistory.deleteMany({ where: { createdAt: { lt: ohCutoff } } })
    console.log(`[PRUNE] Deleted ${r.count} OrderStatusHistory rows`)
  }

  // ========================================================================
  // H6 fix: cleanup для протухших Stories, email-verify/reset токенов,
  // и мёртвых PushSubscriptions. Раньше эти записи копились бесконечно.
  // ========================================================================

  // 6. Stories — у каждой Story есть expiresAt (24h по умолчанию). Без
  //    cleanup они остаются в БД навсегда, раздувая каталог.
  const now = new Date()
  const expiredStories = await prisma.story.count({ where: { expiresAt: { lt: now } } })
  console.log(`[PRUNE] Expired Stories (expiresAt < now): ${expiredStories}`)
  if (!dryRun && expiredStories > 0) {
    const r = await prisma.story.deleteMany({ where: { expiresAt: { lt: now } } })
    console.log(`[PRUNE] Deleted ${r.count} expired Stories`)
  }

  // 7. Email-verify токены — хранятся в AppSetting с id="email:verify:<token>".
  //    Срок жизни 24h. Парсим JSON, удаляем протухшие.
  const verifyTokens = await prisma.appSetting.findMany({
    where: { id: { startsWith: 'email:verify:' } },
    select: { id: true, value: true },
  })
  let expiredVerifyCount = 0
  for (const t of verifyTokens) {
    try {
      const data = JSON.parse(t.value) as { userId: string; expires: string }
      if (new Date(data.expires) < now) expiredVerifyCount++
    } catch {
      // Malformed entry — also count it for cleanup.
      expiredVerifyCount++
    }
  }
  console.log(`[PRUNE] Expired email-verify tokens: ${expiredVerifyCount}`)
  if (!dryRun && expiredVerifyCount > 0) {
    for (const t of verifyTokens) {
      let isExpired = false
      try {
        const data = JSON.parse(t.value) as { expires: string }
        isExpired = new Date(data.expires) < now
      } catch {
        isExpired = true
      }
      if (isExpired) {
        await prisma.appSetting.delete({ where: { id: t.id } }).catch(() => {})
      }
    }
    console.log(`[PRUNE] Deleted ${expiredVerifyCount} expired email-verify tokens`)
  }

  // 8. Password-reset токены — хранятся с id="pwd:reset:<token>". Срок 1h.
  const resetTokens = await prisma.appSetting.findMany({
    where: { id: { startsWith: 'pwd:reset:' } },
    select: { id: true, value: true },
  })
  let expiredResetCount = 0
  for (const t of resetTokens) {
    try {
      const data = JSON.parse(t.value) as { userId: string; expires: string }
      if (new Date(data.expires) < now) expiredResetCount++
    } catch {
      expiredResetCount++
    }
  }
  console.log(`[PRUNE] Expired password-reset tokens: ${expiredResetCount}`)
  if (!dryRun && expiredResetCount > 0) {
    for (const t of resetTokens) {
      let isExpired = false
      try {
        const data = JSON.parse(t.value) as { expires: string }
        isExpired = new Date(data.expires) < now
      } catch {
        isExpired = true
      }
      if (isExpired) {
        await prisma.appSetting.delete({ where: { id: t.id } }).catch(() => {})
      }
    }
    console.log(`[PRUNE] Deleted ${expiredResetCount} expired password-reset tokens`)
  }

  // 9. PushSubscriptions — нет automatic cleanup для протухших endpoint'ов.
  //    Бэкенд удаляет 404/410 при попытке отправки, но если пользователь
  //    давно не заходил и никто не триггерил push, мёртвые подписки висят.
  //    Удаляем подписки старше 180 дней без подтверждения активности.
  const psCutoff = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000)
  const psCount = await prisma.pushSubscription.count({ where: { createdAt: { lt: psCutoff } } })
  console.log(`[PRUNE] PushSubscriptions older than 180d (stale): ${psCount}`)
  if (!dryRun && psCount > 0) {
    const r = await prisma.pushSubscription.deleteMany({ where: { createdAt: { lt: psCutoff } } })
    console.log(`[PRUNE] Deleted ${r.count} stale PushSubscriptions`)
  }

  console.log('[PRUNE] Done')
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error('[PRUNE] Failed:', e)
    prisma.$disconnect()
    process.exit(1)
  })
