// ============================================================================
// 999 PRO — use-sqlite.js
// ----------------------------------------------------------------------------
// Quick helper to switch the Prisma schema provider to SQLite. Equivalent to
// `npm run setup -- --sqlite` but only touches the schema file (doesn't
// regenerate .env secrets). Useful for local dev when you want to test
// against SQLite without re-running the full setup.
//
// Run: `node scripts/use-sqlite.js`
// ============================================================================

const fs = require('node:fs');
const path = require('node:path');

const PRISMA_DIR = path.resolve(__dirname, '..', 'mini-services', 'backend', 'prisma');
const ACTIVE = path.join(PRISMA_DIR, 'schema.prisma');
const SQLITE_TEMPLATE = path.join(PRISMA_DIR, 'schema.sqlite.prisma');
const POSTGRES_TEMPLATE = path.join(PRISMA_DIR, 'schema.postgres.prisma');

if (!fs.existsSync(SQLITE_TEMPLATE)) {
  console.error('✗ SQLite template not found: schema.sqlite.prisma');
  console.error('  Run `npm run setup` first to bootstrap the schema templates.');
  process.exit(1);
}

// First run: bootstrap the postgres template from the shipped schema.
if (!fs.existsSync(POSTGRES_TEMPLATE) && fs.existsSync(ACTIVE)) {
  fs.copyFileSync(ACTIVE, POSTGRES_TEMPLATE);
  console.log('  ✓ Bootstrapped schema.postgres.prisma from current schema.prisma');
}

fs.copyFileSync(SQLITE_TEMPLATE, ACTIVE);
console.log('✓ Switched Prisma schema to SQLite.');
console.log('  Active schema: prisma/schema.prisma (provider = sqlite)');
console.log('');
console.log('To switch back to PostgreSQL: node scripts/use-postgres.js');
console.log('Or: npm run setup -- --force');
