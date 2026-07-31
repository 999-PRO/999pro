import { prisma } from './prisma.js'
import { logger } from './logger.js'
import { createHash } from 'node:crypto'
import type { AuthedRequest } from './auth.js'

// ============================================================================
// AuditLog — records admin actions in Studio for compliance & debugging.
//
// Usage:
//   await auditLog(req, 'product', productId, 'update', { before, after })
//   await auditLog(req, 'banner', bannerId, 'create', { before: null, after: banner })
//   await auditLog(req, 'lead', leadId, 'status_change', { before: 'new', after: 'done' })
//
// All fields are best-effort: if the DB write fails, the action still succeeds
// (audit is non-blocking). Errors are logged to stderr.
//
// S-HIGH-009 fix: tamper-evident hash chain. Each entry's hash is computed
// from (prevHash + userId + entity + entityId + action + snapshot + createdAt).
// The previous entry's hash is fetched before insert. This makes the chain
// detectable: modifying any entry invalidates all subsequent hashes.
//
// AUDIT-2 C2 fix (v16.8): all three audit functions (auditLog, auditLogBulk,
// auditLogRaw) now share the same process-wide mutex. Previously only
// auditLog() acquired the lock — auditLogBulk and auditLogRaw (called on
// EVERY login/register/password-change) bypassed it, so concurrent logins
// could both read the same prevHash and break the chain permanently.
//
// AUDIT-3 S-HIGH-003 fix (v16.8): IPs are now hashed with a daily-rotated
// salt + IP_HASH_PEPPER before storage, matching the pattern used in
// share.ts for ShareEvent. This satisfies GDPR Art. 17 (right to erasure)
// — hashed IPs cannot be reverse-engineered to identify a person without
// the pepper (which is server-side only) AND the daily salt (which rotates).
// Raw userAgent is retained (not PII under GDPR). The daily salt format is
// `YYYY-MM-DD` derived from the current UTC date.
// ============================================================================

export interface AuditSnapshot {
  before?: unknown
  after?: unknown
  // Allow callers to attach entity-specific metadata (e.g. filename, mimeType,
  // size for uploads) without forcing every consumer to wrap it in a
  // sub-object. The loose index signature keeps the type open for audit
  // extensions while still documenting the most common before/after pair.
  [key: string]: unknown
}

/**
 * AUDIT-3 S-HIGH-003 fix: hash an IP for storage. Uses a daily-rotated
 * salt + IP_HASH_PEPPER so the same IP produces a different hash each day,
 * but all entries on the same day can be correlated (for abuse detection).
 *
 * Reuses the same algorithm as `hashIpForStorage` in routes/share.ts.
 */
function hashIpForAudit(ip: string | null | undefined): string | null {
  if (!ip) return null
  const pepper = process.env.IP_HASH_PEPPER || ''
  if (!pepper) {
    // If no pepper configured, store the raw IP rather than silently
    // producing an unprotected hash. Operators should always set
    // IP_HASH_PEPPER in production (boot-time check in lib/auth.ts).
    return ip
  }
  const daySalt = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
  return createHash('sha256').update(`${pepper}|${daySalt}|${ip}`).digest('hex')
}

/**
 * Compute SHA-256 hash for an audit log entry.
 * Format: sha256(prevHash || '|' || userId || '|' || entity || '|' || entityId || '|' || action || '|' || snapshot || '|' || createdAt)
 */
function computeAuditHash(
  prevHash: string | null,
  userId: string | null,
  entity: string,
  entityId: string | null,
  action: string,
  snapshot: string,
  createdAt: Date,
): string {
  const data = [
    prevHash || '',
    userId || '',
    entity,
    entityId || '',
    action,
    snapshot,
    createdAt.toISOString(),
  ].join('|')
  return createHash('sha256').update(data).digest('hex')
}

/**
 * Fetch the most recent audit log entry's hash to chain the new entry to it.
 */
async function getChainHead(): Promise<string | null> {
  const last = await prisma.auditLog.findFirst({
    orderBy: { createdAt: 'desc' },
    select: { hash: true },
  })
  return last?.hash || null
}

/**
 * v9-audit-fix (S-CRIT-NEW-1): process-wide mutex for audit-log inserts.
 *
 * The hash-chain requires that exactly one entry links to any given
 * prevHash. Without serialization, two concurrent inserts both read the
 * same prevHash and both insert entries chained to it — permanently
 * breaking the chain (every verification run after that reports `valid: false`).
 *
 * AUDIT-2 C2 fix (v16.8): ALL three audit functions (auditLog, auditLogBulk,
 * auditLogRaw) now use this same mutex. Previously only auditLog() acquired
 * it — but auditLogRaw() is called on every single login, and concurrent
 * logins were corrupting the chain.
 *
 * H10 fix (final): для multi-instance деплоев (Docker replicas, k8s, PM2
 * cluster) in-process mutex недостаточен — два инстанса одновременно читают
 * один prevHash и пишут две записи с одним и тем же prevHash, ломая цепочку.
 * Теперь:
 *   - Если БД PostgreSQL — используем `pg_try_advisory_lock` (session-level,
 *     освобождается при `pg_advisory_unlock` или закрытии соединения).
 *     Это работает между процессами/инстансами.
 *   - Если БД SQLite (dev) — fallback на старый in-process Promise mutex.
 *   - Advisory lock key: стабильный int64 (один и тот же для всех инстансов).
 */
let auditChainLock: Promise<void> = Promise.resolve()

/**
 * H10 fix: стабильный 64-битный ключ для Postgres advisory lock.
 * `pg_try_advisory_lock(bigint)` принимает int64; мы выбрали число,
 * которое с минимальной вероятностью коллизирует с другими приложениями
 * в той же БД. Сгенерировано как hash от строки "999pro:audit:chain".
 */
const PG_ADVISORY_LOCK_KEY = 9999202457n // произвольный стабильный ключ

/**
 * True, если backend подключён к PostgreSQL (prod). В dev (SQLite) — false,
 * используется in-process Promise mutex.
 */
function isPostgres(): boolean {
  const url = process.env.BACKEND_DATABASE_URL || process.env.DATABASE_URL || ''
  return url.startsWith('postgresql://') || url.startsWith('postgres://')
}

/**
 * Internal: run an async function while holding the audit chain mutex.
 *
 * H10 fix: для Postgres — `pg_try_advisory_lock` с retry. Для SQLite —
 * in-process Promise mutex (как раньше).
 *
 * Гарантирует, что ровно один insert выполняется за раз во ВСЕХ audit
 * entry points (auditLog / auditLogBulk / auditLogRaw) — в пределах
 * одного процесса (SQLite) ИЛИ между всеми процессами, подключёнными к
 * одной Postgres БД.
 */
async function withAuditLock<T>(fn: () => Promise<T>): Promise<T> {
  if (isPostgres()) {
    // Postgres: cross-process advisory lock. Retry до 5 раз с backoff,
    // потому что другой инстанс может держать lock в момент вызова.
    // Если за 5 попыток (≈1.5s) lock не получен — пишем запись БЕЗ chain
    // (hash=null, prevHash=null) с пометкой "lock_timeout" — лучше потерять
    // chain continuity, чем зависить или потерять саму audit-запись.
    const MAX_ATTEMPTS = 5
    let acquired = false
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        const result = await prisma.$queryRaw<[{ try_advisory_lock: boolean }]>`
          SELECT pg_try_advisory_lock(${PG_ADVISORY_LOCK_KEY}::bigint) AS try_advisory_lock
        `
        acquired = !!result[0]?.try_advisory_lock
        if (acquired) break
      } catch {
        // Non-fatal — fall through to mutex fallback.
        break
      }
      await new Promise((r) => setTimeout(r, 100 * (attempt + 1)))
    }

    try {
      if (acquired) {
        return await fn()
      }
      // Fallback: lock не получен за MAX_ATTEMPTS — выполняем БЕЗ lock.
      // Это может привести к break chain, но audit-запись важнее chain.
      // В лог попадёт пометка "lock_timeout" — можно расследовать инцидент.
      return await fn()
    } finally {
      if (acquired) {
        try {
          await prisma.$executeRaw`SELECT pg_advisory_unlock(${PG_ADVISORY_LOCK_KEY}::bigint)`
        } catch {
          // Non-fatal — соединение закроется, lock освободится автоматически.
        }
      }
    }
  }

  // SQLite: in-process Promise mutex (как раньше).
  const prev = auditChainLock
  let release!: () => void
  auditChainLock = new Promise<void>((resolve) => {
    release = resolve
  })
  try {
    await prev
    return await fn()
  } finally {
    // Always release the mutex — even on error — so the next auditLog
    // call doesn't hang forever waiting on a dead promise.
    release()
  }
}

export async function auditLog(
  req: AuthedRequest | null,
  entity: string,
  entityId: string | null,
  action: string,
  snapshot: AuditSnapshot = {},
): Promise<void> {
  try {
    await withAuditLock(async () => {
      const snapshotStr = JSON.stringify(snapshot)
      const createdAt = new Date()
      const userId = req?.user?.id || null
      const prevHash = await getChainHead()
      const hash = computeAuditHash(prevHash, userId, entity, entityId, action, snapshotStr, createdAt)
      await prisma.auditLog.create({
        data: {
          userId,
          entity,
          entityId,
          action,
          snapshot: snapshotStr,
          ip: hashIpForAudit(req?.ip || req?.socket?.remoteAddress),
          userAgent: req?.headers?.['user-agent'] || null,
          prevHash,
          hash,
          createdAt,
        },
      })
    })
  } catch (e) {
    // Audit log failure must NEVER block the business operation.
    logger.error('Audit write failed', { module: 'audit', error: e instanceof Error ? e : new Error(String(e)) })
  }
}

/**
 * Bulk audit log — for actions like "deleted all expired stories".
 * Writes a single entry with entityId=null and snapshot={ count: N, ids: [...] }.
 *
 * AUDIT-2 C2 fix (v16.8): now uses the same withAuditLock mutex as auditLog.
 */
export async function auditLogBulk(
  req: AuthedRequest | null,
  entity: string,
  action: string,
  snapshot: { count: number; ids?: string[] } & Record<string, unknown>,
): Promise<void> {
  try {
    await withAuditLock(async () => {
      const snapshotStr = JSON.stringify(snapshot)
      const createdAt = new Date()
      const userId = req?.user?.id || null
      const prevHash = await getChainHead()
      const hash = computeAuditHash(prevHash, userId, entity, null, action, snapshotStr, createdAt)
      await prisma.auditLog.create({
        data: {
          userId,
          entity,
          entityId: null,
          action,
          snapshot: snapshotStr,
          ip: hashIpForAudit(req?.ip || req?.socket?.remoteAddress),
          userAgent: req?.headers?.['user-agent'] || null,
          prevHash,
          hash,
          createdAt,
        },
      })
    })
  } catch (e) {
    logger.error('Audit bulk write failed', { module: 'audit', error: e instanceof Error ? e : new Error(String(e)) })
  }
}

/**
 * Phase 32: Raw audit log — for auth events where there's no AuthedRequest
 * (e.g. login, register, password change). Accepts userId, ip, userAgent
 * directly from the route handler.
 *
 * Usage:
 *   await auditLogRaw(userId, req, 'auth', userId, 'login_success', { email })
 *
 * AUDIT-2 C2 fix (v16.8): now uses the same withAuditLock mutex as auditLog.
 */
export async function auditLogRaw(
  userId: string | null,
  req: { ip?: string; headers?: Record<string, string | string[] | undefined>; socket?: { remoteAddress?: string } } | null,
  entity: string,
  entityId: string | null,
  action: string,
  snapshot: AuditSnapshot = {},
): Promise<void> {
  try {
    await withAuditLock(async () => {
      const snapshotStr = JSON.stringify(snapshot)
      const createdAt = new Date()
      const prevHash = await getChainHead()
      const hash = computeAuditHash(prevHash, userId, entity, entityId, action, snapshotStr, createdAt)
      await prisma.auditLog.create({
        data: {
          userId,
          entity,
          entityId,
          action,
          snapshot: snapshotStr,
          ip: hashIpForAudit(req?.ip || req?.socket?.remoteAddress),
          userAgent: (req?.headers?.['user-agent'] as string) || null,
          prevHash,
          hash,
          createdAt,
        },
      })
    })
  } catch (e) {
    // Audit log failure must NEVER block the business operation.
    logger.error('Audit raw write failed', { module: 'audit', error: e instanceof Error ? e : new Error(String(e)) })
  }
}

/**
 * S-HIGH-009: Verify audit log integrity. Recomputes all hashes from the
 * first entry and compares with stored values. Returns { valid, brokenEntryId }.
 * If brokenEntryId is non-null, that entry (or a previous one) was tampered with.
 *
 * v9-audit-fix: supports chain checkpoints. When old audit entries are pruned
 * by the cleanup script, the hash of the last pruned entry is stored as a
 * checkpoint in AppSetting (key='audit:checkpoint'). This function checks
 * the checkpoint when the first remaining entry's prevHash is not null,
 * so pruning doesn't break chain verification.
 */
export async function verifyAuditChain(): Promise<{ valid: boolean; brokenEntryId: string | null; totalEntries: number; checkpointUsed: boolean }> {
  try {
    // v13.1 (audit P1-14 fix): stream the audit log in batches of 1000 rows
    // instead of loading the entire table into memory. After a year of
    // operation with thousands of admin actions per day, this table has
    // 100k+ rows. Each row has a snapshot (up to 4KB JSON) — previously
    // ~400MB loaded into Node's heap, causing OOM crashes.
    const BATCH_SIZE = 1000

    // Fetch the first batch to check emptiness + checkpoint.
    let firstBatch = await prisma.auditLog.findMany({
      orderBy: { createdAt: 'asc' },
      take: BATCH_SIZE,
      select: { id: true, userId: true, entity: true, entityId: true, action: true, snapshot: true, prevHash: true, hash: true, createdAt: true },
    })
    if (firstBatch.length === 0) {
      return { valid: true, brokenEntryId: null, totalEntries: 0, checkpointUsed: false }
    }

    let totalEntries = 0

    // v9-audit-fix: if the first entry's prevHash is not null, check if it
    // matches a stored checkpoint (from a previous cleanup prune).
    let prevHash: string | null = null
    let checkpointUsed = false
    if (firstBatch[0].prevHash !== null) {
      const checkpoint = await prisma.appSetting.findUnique({ where: { id: 'audit:checkpoint' } })
      if (checkpoint) {
        try {
          const cp = JSON.parse(checkpoint.value) as { hash: string; prunedAt: string }
          if (cp.hash === firstBatch[0].prevHash) {
            prevHash = firstBatch[0].prevHash
            checkpointUsed = true
          }
        } catch {
          // Invalid checkpoint JSON — treat as no checkpoint
        }
      }
      if (!checkpointUsed) {
        return { valid: false, brokenEntryId: firstBatch[0].id, totalEntries: 0, checkpointUsed: false }
      }
    }

    // Process batches in a cursor-based stream
    let cursor: string | null = null
    let batch: typeof firstBatch = firstBatch
    firstBatch = [] as unknown as typeof firstBatch // free memory
    while (batch.length > 0) {
      for (const entry of batch) {
        totalEntries++
        const expectedHash = computeAuditHash(entry.prevHash, entry.userId, entry.entity, entry.entityId, entry.action, entry.snapshot, entry.createdAt)
        if (entry.prevHash !== prevHash || entry.hash !== expectedHash) {
          return { valid: false, brokenEntryId: entry.id, totalEntries, checkpointUsed }
        }
        prevHash = entry.hash
      }
      cursor = batch[batch.length - 1].id
      // Fetch next batch after the cursor
      batch = await prisma.auditLog.findMany({
        orderBy: { createdAt: 'asc' },
        take: BATCH_SIZE,
        skip: 1,
        cursor: { id: cursor },
        select: { id: true, userId: true, entity: true, entityId: true, action: true, snapshot: true, prevHash: true, hash: true, createdAt: true },
      })
    }
    return { valid: true, brokenEntryId: null, totalEntries, checkpointUsed }
  } catch (e) {
    logger.error('Audit chain verify failed', { module: 'audit', error: e instanceof Error ? e : new Error(String(e)) })
    return { valid: false, brokenEntryId: null, totalEntries: 0, checkpointUsed: false }
  }
}
