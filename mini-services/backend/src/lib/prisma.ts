import { PrismaClient } from '@prisma/client'
import { logger } from './logger.js'

// ============================================================================
// Prisma client singleton + connection pool configuration
// ----------------------------------------------------------------------------
// v25.1: PostgreSQL is the default provider. SQLite remains supported for
// local dev (auto-detected from BACKEND_DATABASE_URL).
//
// PostgreSQL connection pool:
//   Prisma 6 manages its own pool internally. The pool size is controlled by
//   the `connection_limit` query-string param on BACKEND_DATABASE_URL, e.g.
//   `postgresql://user:pass@host:5432/db?connection_limit=10&pool_timeout=10`.
//   Default (no param): NumCPUs * 2 + 1 (e.g. 5 on a 2-core VPS).
//
//   We DON'T force a connection_limit here because:
//     1. The operator may have a PgBouncer in front with its own pool.
//     2. Production vs dev have very different optimal sizes.
//   Instead, setup.js appends sensible defaults (?connection_limit=10) to
//   BACKEND_DATABASE_URL when generating .env. The operator can edit .env
//   to tune.
//
// Anti-leak: the singleton pattern below ensures only ONE PrismaClient is
// created per process. In dev (with hot-reload), we stash it on globalThis
// to survive module reloads — without this, every reload creates a new
// client and leaks connections until the pool is exhausted.
// ============================================================================

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

// Detect provider from BACKEND_DATABASE_URL so we know whether to apply
// SQLite pragmas. Prisma itself parses the URL at client creation; we just
// need a hint for the pragma step.
const DB_URL = process.env.BACKEND_DATABASE_URL || ''
const IS_SQLITE = DB_URL.startsWith('file:')
const IS_POSTGRES = DB_URL.startsWith('postgres://') || DB_URL.startsWith('postgresql://')

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  })

// ============================================================================
// SQLite performance pragmas — applied ONLY when using SQLite.
// ----------------------------------------------------------------------------
// These dramatically improve concurrent read/write performance and prevent
// SQLITE_BUSY errors under load.
//
//   WAL (Write-Ahead Logging):
//     - Readers don't block writers, writers don't block readers
//     - Replaces default DELETE journal mode (which locks the entire DB file)
//     - Required for any multi-user app with SQLite
//
//   busy_timeout=5000:
//     - If a write lock is held, wait up to 5 seconds before returning SQLITE_BUSY
//     - Default is 500ms which is too short under load
//     - Prevents Prisma P2024 "Timed out fetching a connection" errors
//
//   foreign_keys=ON:
//     - Enforces foreign key constraints at the SQLite level
//     - Prisma enables this by default, but we set it explicitly for safety
//
//   synchronous=NORMAL:
//     - In WAL mode, NORMAL is safe and ~2x faster than FULL
//     - Only fsyncs at checkpoint, not on every commit
//     - Trade-off: on power loss, could lose last few transactions (acceptable for most apps)
//
// NOTE: PRAGMA journal_mode returns a result (the mode name), so we must use
// $queryRaw instead of $executeRawUnsafe (which fails with "Execute returned
// results, which is not allowed in SQLite").
// ============================================================================
async function applySqlitePragmas() {
  if (!IS_SQLITE) return // PostgreSQL doesn't use PRAGMAs
  try {
    // journal_mode returns the new mode — use $queryRaw
    await prisma.$queryRaw`PRAGMA journal_mode=WAL`
    // These don't return results, but $queryRaw works for both
    await prisma.$queryRaw`PRAGMA busy_timeout=5000`
    await prisma.$queryRaw`PRAGMA foreign_keys=ON`
    await prisma.$queryRaw`PRAGMA synchronous=NORMAL`
  } catch (e) {
    // Non-fatal — the app will still work, just with default (slower) settings.
    logger.error('SQLite pragmas failed', { module: 'prisma', error: e instanceof Error ? e : new Error(String(e)) })
  }
}

// ============================================================================
// PostgreSQL connection health check — logged once on boot so the operator
// can see whether the pool initialised correctly. Non-blocking; failures
// are logged but don't crash (the first real query will surface them).
// ============================================================================
async function logPgConnectInfo() {
  if (!IS_POSTGRES) return
  try {
    const result = await prisma.$queryRaw<{ server_version?: string }[]>`
      SELECT current_setting('server_version') AS server_version
    `.catch(() => [] as { server_version?: string }[])
    if (result.length > 0 && result[0].server_version) {
      logger.info('PostgreSQL connected', {
        module: 'prisma',
        server_version: result[0].server_version,
        pool: 'prisma-managed (see BACKEND_DATABASE_URL?connection_limit=)',
      })
    }
  } catch {
    // Ignore — the first real query will surface any real connection error.
  }
}

// Apply pragmas / log info asynchronously — don't block module load.
// The first query might race with this, but Prisma queues internally.
void applySqlitePragmas()
void logPgConnectInfo()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
