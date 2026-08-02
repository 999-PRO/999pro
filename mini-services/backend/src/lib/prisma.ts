import { PrismaClient } from '@prisma/client'
import { logger } from './logger.js'

// ============================================================================
// Prisma client singleton — PostgreSQL (production) only.
// ----------------------------------------------------------------------------
// v25.2: SQLite support removed from production code path. The backend now
// talks exclusively to PostgreSQL via the `DATABASE_URL` environment
// variable. SQLite remains available as an optional local-dev fallback
// (see scripts/use-sqlite.js) but the production runtime no longer
// branches on the URL scheme — it assumes PostgreSQL.
//
// Why PostgreSQL-only:
//   • True concurrent writes (MVCC — readers never block writers).
//   • Connection pooling (PgBouncer / Prisma's built-in pool).
//   • Native Decimal / JSONB / full-text search / row-level locking.
//   • No "database is locked" errors under concurrent registrations.
//   • No file-system permission issues (the v25.2 "readonly database"
//     bug was SQLite-specific — it cannot occur with PostgreSQL because
//     the DB runs as a separate process, not as a file the backend writes).
//
// Connection pool:
//   Prisma 6 manages its own pool internally. The pool size is controlled
//   by the `connection_limit` query-string param on DATABASE_URL, e.g.
//   `postgresql://user:pass@host:5432/db?connection_limit=10&pool_timeout=10`.
//   Default (no param): NumCPUs * 2 + 1 (e.g. 5 on a 2-core VPS).
//
// Anti-leak: the singleton pattern below ensures only ONE PrismaClient is
// created per process. In dev (with hot-reload), we stash it on globalThis
// to survive module reloads — without this, every reload creates a new
// client and leaks connections until the pool is exhausted.
// ============================================================================

const DATABASE_URL = process.env.DATABASE_URL || ''

if (!DATABASE_URL) {
  // Hard-fail at import time — PrismaClient would throw a less helpful
  // error ("Environment variable not found: DATABASE_URL") on first query.
  // We surface the issue immediately with actionable guidance.
  const msg =
    'FATAL: DATABASE_URL environment variable is not set. ' +
    'The backend requires a PostgreSQL connection string, e.g. ' +
    'postgresql://user:password@localhost:5432/ninepro?schema=public&connection_limit=10&pool_timeout=10. ' +
    'Set it in mini-services/backend/.env (run `npm run setup` to generate).'
  console.error(`[prisma] ${msg}`)
  throw new Error(msg)
}

// v25.3-test: allow SQLite (file: URLs) when NODE_ENV !== 'production'.
// The original guard rejected file: URLs unconditionally to prevent SQLite
// from accidentally running in production. For local/test builds (which
// is exactly what this task asks for — "prepare a test build"), we relax
// the check so the operator can run the project without installing
// PostgreSQL. Production deployments still require PostgreSQL — the
// guard fires when NODE_ENV === 'production'.
const isSqlite = DATABASE_URL.startsWith('file:')
const isProd = process.env.NODE_ENV === 'production'
if (isProd && isSqlite) {
  const msg =
    'FATAL: SQLite (file:) DATABASE_URL is not allowed in production. ' +
    'Set DATABASE_URL to a postgresql:// connection string.'
  console.error(`[prisma] ${msg}`)
  throw new Error(msg)
}
if (!isSqlite && !DATABASE_URL.startsWith('postgres://') && !DATABASE_URL.startsWith('postgresql://')) {
  const msg =
    'FATAL: DATABASE_URL must be a PostgreSQL connection string (start with "postgres://" or "postgresql://") ' +
    'OR a SQLite file: URL for local dev. Got: ' + DATABASE_URL.slice(0, 32) + '... '
  console.error(`[prisma] ${msg}`)
  throw new Error(msg)
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  })

// ============================================================================
// PostgreSQL connection health check — logged once on boot so the operator
// can see whether the pool initialised correctly. Non-blocking; failures
// are logged but don't crash (the first real query will surface them).
// v25.3-test: skipped for SQLite (file: URLs) — SQLite has no server version
// to query, and the SELECT current_setting() syntax is PostgreSQL-specific.
// ============================================================================
async function logPgConnectInfo() {
  if (isSqlite) {
    logger.info('SQLite connected (local-dev mode)', {
      module: 'prisma',
      url: DATABASE_URL.replace(/\/\/[^@]+@/, '//***@'),
    })
    return
  }
  try {
    const result = await prisma.$queryRaw<{ server_version?: string }[]>`
      SELECT current_setting('server_version') AS server_version
    `.catch(() => [] as { server_version?: string }[])
    if (result.length > 0 && result[0].server_version) {
      logger.info('PostgreSQL connected', {
        module: 'prisma',
        server_version: result[0].server_version,
        pool: 'prisma-managed (see DATABASE_URL?connection_limit=)',
      })
    } else {
      logger.warn('PostgreSQL connection check returned no version — verify DATABASE_URL', {
        module: 'prisma',
      })
    }
  } catch (e) {
    // Surface the error loudly — the first request will fail anyway.
    logger.error('PostgreSQL connection check failed', {
      module: 'prisma',
      error: e instanceof Error ? e : new Error(String(e)),
    })
  }
}

// Fire the health check asynchronously — don't block module load.
// The first query might race with this, but Prisma queues internally.
void logPgConnectInfo()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
