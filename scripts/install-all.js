// ============================================================================
// 999 PRO — install-all.js
// ----------------------------------------------------------------------------
// Runs `npm install` in the root + backend + studio directories sequentially.
// This is needed because backend and studio are NOT npm workspaces of the
// root (workspaces with `file:` references caused `next/package.json` to be
// unresolvable from studio during build — see issue log in next.config.ts).
//
// Run: `npm run install:all` (or `node scripts/install-all.js`)
//
// Equivalent to:
//   npm install && (cd mini-services/backend && npm install) && (cd mini-services/studio && npm install)
// ============================================================================

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const dirs = [
  { name: 'frontend (root)', cwd: ROOT },
  { name: 'backend',         cwd: path.join(ROOT, 'mini-services', 'backend') },
  { name: 'studio',          cwd: path.join(ROOT, 'mini-services', 'studio') },
];

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
};

console.log(`\n${ANSI.bold}▶ Installing dependencies for all services${ANSI.reset}`);
console.log('─'.repeat(80));

for (const { name, cwd } of dirs) {
  console.log(`\n${ANSI.cyan}▶ ${name}${ANSI.reset} (${path.relative(ROOT, cwd) || '.'})`);
  const result = spawnSync('npm', ['install', '--no-audit', '--no-fund', '--include=dev'], {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, NODE_ENV: 'development' },  // force dev to include devDeps
  });
  if (result.status !== 0) {
    console.error(`${ANSI.red}✗ ${name} install failed${ANSI.reset}`);
    process.exit(result.status ?? 1);
  }
  console.log(`${ANSI.green}✓ ${name} done${ANSI.reset}`);
}

console.log(`\n${ANSI.bold}${ANSI.green}${'═'.repeat(80)}${ANSI.reset}`);
console.log(`${ANSI.bold}${ANSI.green}  ✅ ALL DEPENDENCIES INSTALLED${ANSI.reset}`);
console.log(`${ANSI.bold}${ANSI.green}${'═'.repeat(80)}${ANSI.reset}`);
console.log(`
  Next steps:
    npm run setup   (one-time: generates .env files with secrets)
    npm run build   (builds all 3 services)
    npm run start   (starts all 3 services)
`);
