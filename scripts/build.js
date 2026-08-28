// ============================================================================
// 999 PRO — build.js
// ----------------------------------------------------------------------------
// Single command that builds all three services in the correct order:
//   1. backend: prisma generate + tsc → dist/
//   2. frontend: next build → .next/standalone/server.js
//   3. studio: next build → .next/standalone/server.js
//
// Run: `npm run build` (or `node scripts/build.js`)
//
// If .env files don't exist yet, runs `node scripts/setup.js` first.
// If node_modules don't exist yet in any service, runs `npm install` first.
// ============================================================================

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const BACKEND = path.join(ROOT, 'mini-services', 'backend');
const STUDIO = path.join(ROOT, 'mini-services', 'studio');

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};

function log(msg, color = '') {
  console.log(`${color}${msg}${ANSI.reset}`);
}

function runStep(label, fn) {
  console.log('');
  log(`▶ ${label}`, ANSI.bold + ANSI.cyan);
  console.log('─'.repeat(80));
  const start = Date.now();
  try {
    fn();
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    log(`✓ ${label} (${elapsed}s)`, ANSI.green);
  } catch (e) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    log(`✗ ${label} FAILED (${elapsed}s)`, ANSI.red);
    console.error(e.message);
    process.exit(1);
  }
}

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...opts,
  });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${cmd} ${args.join(' ')} (exit code ${result.status})`);
  }
}

function exists(p) {
  return fs.existsSync(p);
}

function ensureInstalled(dir, label) {
  if (!exists(path.join(dir, 'node_modules'))) {
    log(`  node_modules missing in ${label} — running npm install...`, ANSI.yellow);
    run('npm', ['install', '--no-audit', '--no-fund', '--include=dev'], {
      cwd: dir,
      env: { ...process.env, NODE_ENV: 'development' },
    });
  } else {
    log(`  node_modules present in ${label}`, ANSI.dim);
  }
}

// ---------- 0. Pre-flight: ensure .env files + node_modules ----------
runStep('Pre-check: .env files + dependencies', () => {
  // .env files
  const envFiles = [
    path.join(ROOT, '.env'),
    path.join(BACKEND, '.env'),
    path.join(STUDIO, '.env'),
  ];
  const missing = envFiles.filter((p) => !exists(p));
  if (missing.length > 0) {
    log('  .env files missing — running setup first...', ANSI.yellow);
    run('node', [path.join(__dirname, 'setup.js')], { cwd: ROOT });
  } else {
    log('  All .env files present.', ANSI.dim);
  }

  // node_modules (each service has its own — no workspaces)
  ensureInstalled(ROOT, 'frontend (root)');
  ensureInstalled(BACKEND, 'backend');
  ensureInstalled(STUDIO, 'studio');
});

// ---------- 1. Backend: prisma generate + tsc ----------
runStep('Build backend (prisma generate + tsc)', () => {
  log('  Running prisma generate...', ANSI.dim);
  run('npx', ['prisma', 'generate'], { cwd: BACKEND });

  // v25.2: PostgreSQL-only. Always run `prisma migrate deploy` — it applies
  // the baseline + any new migrations idempotently. SQLite is no longer
  // supported in production; if a developer has swapped the schema to
  // sqlite via scripts/use-sqlite.js, they are responsible for running
  // `prisma db push` manually (build.js assumes production PostgreSQL).
  log('  Running prisma migrate deploy (PostgreSQL)...', ANSI.dim);
  run('npx', ['prisma', 'migrate', 'deploy'], { cwd: BACKEND });

  log('  Running tsc...', ANSI.dim);
  run('npx', ['tsc'], { cwd: BACKEND });

  if (!exists(path.join(BACKEND, 'dist', 'index.js'))) {
    throw new Error('Backend build failed: dist/index.js not found');
  }
  log('  → dist/index.js created', ANSI.green);
});

// ---------- 2. Frontend: next build ----------
runStep('Build frontend (next build --webpack → standalone)', () => {
  // v25.27: --webpack — Turbopack-сборка этого проекта требует >4GB RAM и
  // падает по OOM на хостах 4GB; webpack-сборка стабильно проходит и даёт
  // идентичный результат (проверено на v25.27).
  log('  Running next build (--webpack)...', ANSI.dim);
  run('npx', ['next', 'build', '--webpack'], { cwd: ROOT, env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=2560' } });

  const standaloneDir = path.join(ROOT, '.next', 'standalone');
  if (!exists(path.join(standaloneDir, 'server.js'))) {
    throw new Error('Frontend build failed: .next/standalone/server.js not found (check turbopack.root in next.config.ts)');
  }
  // Copy static + public assets (not included in standalone by default)
  const staticSrc = path.join(ROOT, '.next', 'static');
  const staticDst = path.join(standaloneDir, '.next', 'static');
  if (exists(staticSrc)) {
    fs.cpSync(staticSrc, staticDst, { recursive: true });
  }
  const publicSrc = path.join(ROOT, 'public');
  const publicDst = path.join(standaloneDir, 'public');
  if (exists(publicSrc)) {
    fs.cpSync(publicSrc, publicDst, { recursive: true });
  }
  log('  → .next/standalone/server.js created', ANSI.green);
});

// ---------- 2b. Legacy CSS downlevel (TV / old browsers) ----------
// v25.27: владелец reported «на телевизоре приложение открывается без CSS».
// Tailwind v4 выдаёт @layer/oklch/color-mix, которые старые ТВ-браузеры
// выбрасывают целиком. Скрипт разворачивает слои и понижает цвет/вложенность
// прямо в .next/static/css (после копирования в standalone).
runStep('Legacy CSS downlevel (TV / old browsers)', () => {
  run('node', [path.join(__dirname, 'legacy-css.mjs')], { cwd: ROOT });

  // Повторяем копирование статиков в standalone — с уже сконвертированным CSS.
  const staticSrc2 = path.join(ROOT, '.next', 'static');
  const staticDst2 = path.join(ROOT, '.next', 'standalone', '.next', 'static');
  if (exists(staticSrc2) && exists(staticDst2)) {
    fs.cpSync(staticSrc2, staticDst2, { recursive: true });
  }
});

// ---------- 3. Studio: next build ----------
runStep('Build studio (next build → standalone)', () => {
  log('  Running next build...', ANSI.dim);
  run('npx', ['next', 'build'], { cwd: STUDIO });

  const standaloneDir = path.join(STUDIO, '.next', 'standalone');
  if (!exists(path.join(standaloneDir, 'server.js'))) {
    throw new Error('Studio build failed: .next/standalone/server.js not found (check turbopack.root in next.config.ts)');
  }
  const staticSrc = path.join(STUDIO, '.next', 'static');
  const staticDst = path.join(standaloneDir, '.next', 'static');
  if (exists(staticSrc)) {
    fs.cpSync(staticSrc, staticDst, { recursive: true });
  }
  const publicSrc = path.join(STUDIO, 'public');
  const publicDst = path.join(standaloneDir, 'public');
  if (exists(publicSrc)) {
    fs.cpSync(publicSrc, publicDst, { recursive: true });
  }
  log('  → .next/standalone/server.js created', ANSI.green);
});

// ---------- 3b. Studio: legacy CSS downlevel (TV / old browsers) ----------
runStep('Studio: legacy CSS downlevel (TV / old browsers)', () => {
  run('node', [path.join(__dirname, 'legacy-css.mjs'), path.join(STUDIO, '.next', 'static')], { cwd: ROOT });
});

// ---------- done ----------
console.log('');
log('═'.repeat(80), ANSI.bold + ANSI.green);
log('  ✅ BUILD COMPLETE', ANSI.bold + ANSI.green);
log('═'.repeat(80), ANSI.bold + ANSI.green);
console.log(`
  Built artifacts:
    backend:    mini-services/backend/dist/index.js
    frontend:   .next/standalone/server.js
    studio:     mini-services/studio/.next/standalone/server.js

  Next: npm run start
`);
