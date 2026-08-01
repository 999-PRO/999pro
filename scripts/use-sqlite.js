// ============================================================================
// 999 PRO — use-sqlite.js  (LOCAL DEV ONLY — DO NOT USE IN PRODUCTION)
// ----------------------------------------------------------------------------
// This script swaps the Prisma schema provider from PostgreSQL to SQLite
// for LOCAL DEVELOPMENT ONLY. It is intended for developers who want to
// test the backend on their laptop without installing PostgreSQL.
//
// ⚠️  WARNING — READ THIS BEFORE RUNNING  ⚠️
//
//   • SQLite is NOT supported in production (v25.2). The production runtime
//     (lib/prisma.ts) hard-fails if DATABASE_URL does not start with
//     "postgres://" or "postgresql://".
//
//   • This script rewrites schema.prisma to use `provider = "sqlite"`.
//     The backend WILL NOT START with this schema in production.
//
//   • To use SQLite in dev you must ALSO:
//       1. Set DATABASE_URL="file:./dev.db" in mini-services/backend/.env
//       2. Comment out the postgres:// guard in src/lib/prisma.ts
//          (or run the backend with NODE_ENV=development which still
//          enforces the guard — you'll need to temporarily relax it).
//       3. Run `npx prisma db push` (NOT migrate deploy — SQLite has no
//          migrations folder).
//
//   • All of the above is YOUR responsibility. The maintainers do not
//     provide support for SQLite deployments.
//
//   • To switch back to PostgreSQL (required for production):
//       git checkout mini-services/backend/prisma/schema.prisma
//       npm run setup -- --force
//
// Run: `node scripts/use-sqlite.js`
// ============================================================================

const fs = require('node:fs');
const path = require('node:path');

const PRISMA_DIR = path.resolve(__dirname, '..', 'mini-services', 'backend', 'prisma');
const ACTIVE = path.join(PRISMA_DIR, 'schema.prisma');

// Print the warning header so the operator sees it prominently.
console.log('');
console.log('============================================================');
console.log('  ⚠  LOCAL DEV ONLY — SQLite is NOT supported in production  ⚠');
console.log('============================================================');
console.log('');
console.log('  This script rewrites schema.prisma to use provider = "sqlite".');
console.log('  The backend WILL NOT START in production with this schema.');
console.log('');
console.log('  Before running this script, you should have a clean working');
console.log('  tree (git status clean) so you can revert with:');
console.log('    git checkout mini-services/backend/prisma/schema.prisma');
console.log('');
console.log('  Press Ctrl+C within 5 seconds to abort…');
console.log('');

// 5-second grace period so the operator can cancel if they ran it by mistake.
const start = Date.now();
while (Date.now() - start < 5000) {
  // busy-wait — this is a CLI tool, not a server.
}

if (!fs.existsSync(ACTIVE)) {
  console.error(`✗ Active schema not found: ${ACTIVE}`);
  process.exit(1);
}

const current = fs.readFileSync(ACTIVE, 'utf8');

// Replace the datasource provider. We do this with a regex so the rest of
// the schema (models, enums, etc.) is preserved.
const sqliteSchema = current
  .replace(/provider\s*=\s*"postgresql"/, 'provider = "sqlite"')
  .replace(/url\s*=\s*env\("DATABASE_URL"\)/, 'url = env("DATABASE_URL")');

if (sqliteSchema === current) {
  console.log('  ✓ Schema already uses SQLite (or no postgresql provider found).');
} else {
  // Backup the original schema so the operator can revert with a single mv.
  const backup = path.join(PRISMA_DIR, 'schema.prisma.pg.bak');
  fs.copyFileSync(ACTIVE, backup);
  fs.writeFileSync(ACTIVE, sqliteSchema);
  console.log(`  ✓ Switched schema.prisma to SQLite.`);
  console.log(`  ✓ Backup saved: ${path.relative(process.cwd(), backup)}`);
}

console.log('');
console.log('  NEXT STEPS (LOCAL DEV ONLY):');
console.log('    1. Set DATABASE_URL="file:./dev.db" in mini-services/backend/.env');
console.log('    2. Run: npx prisma db push');
console.log('    3. Start backend in dev mode: npm run dev');
console.log('');
console.log('  TO REVERT (REQUIRED BEFORE PRODUCTION DEPLOY):');
console.log('    git checkout mini-services/backend/prisma/schema.prisma');
console.log('    # or: mv mini-services/backend/prisma/schema.prisma.pg.bak \\');
console.log('    #      mini-services/backend/prisma/schema.prisma');
console.log('    npm run setup -- --force');
console.log('');
