import { PrismaClient } from '@prisma/client'
import { logger } from './logger.js'

// Single Prisma client instance shared across the app (avoids connection
// pool exhaustion in dev with hot-reloading).
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  })

// Phase 12: SQLite performance pragmas — applied once on client creation.
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
async function applySqlitePragmas() {
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

// Apply pragmas asynchronously — don't block module load.
// The first query might race with this, but Prisma queues internally.
void applySqlitePragmas()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
