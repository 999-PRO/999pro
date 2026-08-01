// ============================================================================
// 999 PRO — use-postgres.js
// ----------------------------------------------------------------------------
// Quick helper to switch the Prisma schema provider to PostgreSQL (the
// production default). Equivalent to `npm run setup -- --force` but only
// touches the schema file (doesn't regenerate .env secrets).
//
// Run: `node scripts/use-postgres.js`
// ============================================================================

const fs = require('node:fs');
const path = require('node:path');

const PRISMA_DIR = path.resolve(__dirname, '..', 'mini-services', 'backend', 'prisma');
const ACTIVE = path.join(PRISMA_DIR, 'schema.prisma');
const SQLITE_TEMPLATE = path.join(PRISMA_DIR, 'schema.sqlite.prisma');
const POSTGRES_TEMPLATE = path.join(PRISMA_DIR, 'schema.postgres.prisma');

if (!fs.existsSync(POSTGRES_TEMPLATE)) {
  // Bootstrap: the shipped schema.prisma IS the Postgres template.
  if (fs.existsSync(ACTIVE)) {
    fs.copyFileSync(ACTIVE, POSTGRES_TEMPLATE);
    console.log('  ✓ Bootstrapped schema.postgres.prisma from current schema.prisma');
  } else {
    console.error('✗ Neither schema.prisma nor schema.postgres.prisma found.');
    process.exit(1);
  }
}

fs.copyFileSync(POSTGRES_TEMPLATE, ACTIVE);
console.log('✓ Switched Prisma schema to PostgreSQL.');
console.log('  Active schema: prisma/schema.prisma (provider = postgresql)');
console.log('');
console.log('To switch back to SQLite: node scripts/use-sqlite.js');
console.log('Or: npm run setup -- --sqlite');
