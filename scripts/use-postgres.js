// ============================================================================
// 999 PRO — use-postgres.js
// ----------------------------------------------------------------------------
// Quick helper to switch the Prisma schema provider back to PostgreSQL after
// using scripts/use-sqlite.js for local dev.
//
// v25.2: PostgreSQL is the production default. The shipped schema.prisma IS
// the PostgreSQL schema — there is no longer a separate template file.
// This script restores schema.prisma from the backup created by use-sqlite.js
// (schema.prisma.pg.bak), or if no backup exists, it rewrites the provider
// inline.
//
// Run: `node scripts/use-postgres.js`
// ============================================================================

const fs = require('node:fs');
const path = require('node:path');

const PRISMA_DIR = path.resolve(__dirname, '..', 'mini-services', 'backend', 'prisma');
const ACTIVE = path.join(PRISMA_DIR, 'schema.prisma');
const BACKUP = path.join(PRISMA_DIR, 'schema.prisma.pg.bak');

if (!fs.existsSync(ACTIVE)) {
  console.error(`✗ Active schema not found: ${ACTIVE}`);
  process.exit(1);
}

// If a backup exists (created by use-sqlite.js), restore from it.
if (fs.existsSync(BACKUP)) {
  fs.copyFileSync(BACKUP, ACTIVE);
  fs.unlinkSync(BACKUP);
  console.log('✓ Restored schema.prisma from backup (schema.prisma.pg.bak).');
  console.log('  Active schema: prisma/schema.prisma (provider = postgresql)');
} else {
  // No backup — rewrite the provider inline.
  const current = fs.readFileSync(ACTIVE, 'utf8');
  if (/provider\s*=\s*"sqlite"/.test(current)) {
    const restored = current.replace(/provider\s*=\s*"sqlite"/, 'provider = "postgresql"');
    fs.writeFileSync(ACTIVE, restored);
    console.log('✓ Switched schema.prisma to PostgreSQL (inline rewrite).');
  } else {
    console.log('✓ schema.prisma already uses PostgreSQL.');
  }
}

console.log('');
console.log('To use SQLite for LOCAL DEV (not production): node scripts/use-sqlite.js');
