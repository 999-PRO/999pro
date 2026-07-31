// ============================================================================
// 999 PRO — start.js
// ----------------------------------------------------------------------------
// Starts all three services (backend, frontend, studio) as long-running
// child processes. Logs from each service are prefixed with [backend],
// [frontend], [studio] for easy identification.
//
// Run: `npm run start` (or `node scripts/start.js`)
//
// Behavior:
//   - All services start in parallel.
//   - Logs are interleaved on stdout/stderr with prefix tags.
//   - Ctrl+C sends SIGTERM to all services, waits 5s, then SIGKILL.
//   - If any service exits with non-zero, the others are stopped and the
//     process exits with that code.
//
// Environment:
//   - Reads .env files in each service's directory (backend/.env, root/.env,
//     studio/.env). These are loaded by the services themselves (backend via
//     dotenv, frontend/studio via Next.js built-in .env support).
//   - NODE_ENV=production is set automatically.
//
// For production deployment behind Nginx/Caddy, see README.md → "Production
// setup" for systemd unit files that auto-restart on crash.
// ============================================================================

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

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
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
};

const COLORS = {
  backend: ANSI.cyan,
  frontend: ANSI.green,
  studio: ANSI.magenta,
};

// ---------- pre-flight checks ----------
function exists(p) {
  return fs.existsSync(p);
}

function fail(msg) {
  console.error(`${ANSI.red}✗ ${msg}${ANSI.reset}`);
  process.exit(1);
}

const artifacts = [
  { label: 'backend', path: path.join(BACKEND, 'dist', 'index.js') },
  { label: 'frontend', path: path.join(ROOT, '.next', 'standalone', 'server.js') },
  { label: 'studio', path: path.join(STUDIO, '.next', 'standalone', 'server.js') },
];

console.log(`\n${ANSI.bold}▶ Pre-flight checks${ANSI.reset}`);
console.log('─'.repeat(80));
const missing = artifacts.filter((a) => !exists(a.path));
if (missing.length > 0) {
  fail(`Missing build artifacts: ${missing.map((m) => m.label).join(', ')}. Run 'npm run build' first.`);
}
artifacts.forEach((a) => {
  console.log(`  ${ANSI.green}✓${ANSI.reset} ${a.label.padEnd(10)} → ${path.relative(ROOT, a.path)}`);
});

// ---------- start services ----------
const services = [
  {
    name: 'backend',
    cmd: 'node',
    args: ['dist/index.js'],
    cwd: BACKEND,
    port: 4000,
  },
  {
    name: 'frontend',
    cmd: 'node',
    args: ['.next/standalone/server.js'],
    cwd: ROOT,
    port: 3000,
    env: { PORT: '3000', HOSTNAME: '0.0.0.0' },
  },
  {
    name: 'studio',
    cmd: 'node',
    args: ['.next/standalone/server.js'],
    cwd: STUDIO,
    port: 3001,
    env: { PORT: '3001', HOSTNAME: '0.0.0.0' },
  },
];

const procs = [];
let shuttingDown = false;
let exitCode = 0;

function startService(s) {
  const env = { ...process.env, NODE_ENV: 'production', ...s.env };
  const proc = spawn(s.cmd, s.args, {
    cwd: s.cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const color = COLORS[s.name] || '';
  const prefix = `${color}[${s.name}]${ANSI.reset}`;

  proc.stdout.on('data', (d) => {
    d.toString().split('\n').forEach((line) => {
      if (line.trim()) console.log(`${prefix} ${line}`);
    });
  });
  proc.stderr.on('data', (d) => {
    d.toString().split('\n').forEach((line) => {
      if (line.trim()) console.error(`${prefix} ${line}`);
    });
  });
  proc.on('exit', (code, signal) => {
    if (shuttingDown) return;
    console.log(`${prefix} ${ANSI.yellow}exited (code=${code}, signal=${signal})${ANSI.reset}`);
    if (code !== 0 && code !== null) {
      exitCode = code;
      shutdown();
    }
  });

  procs.push({ ...s, proc });
  console.log(`  ${ANSI.green}✓${ANSI.reset} ${s.name.padEnd(10)} started (PID ${proc.pid}, port ${s.port})`);
}

console.log(`\n${ANSI.bold}▶ Starting services${ANSI.reset}`);
console.log('─'.repeat(80));
services.forEach(startService);

console.log(`\n${ANSI.bold}${ANSI.green}═`.repeat(80));
console.log(`${ANSI.bold}${ANSI.green}  ✅ ALL SERVICES RUNNING${ANSI.reset}`);
console.log(`${ANSI.bold}${ANSI.green}${'═'.repeat(80)}${ANSI.reset}`);
console.log(`
  ${ANSI.bold}Endpoints:${ANSI.reset}
    Frontend:  ${ANSI.cyan}http://localhost:3000${ANSI.reset}
    Studio:    ${ANSI.magenta}http://localhost:3001/studio${ANSI.reset}
    Backend:   ${ANSI.green}http://localhost:4000/api/health${ANSI.reset}

  ${ANSI.dim}Press Ctrl+C to stop all services.${ANSI.reset}
`);

// ---------- shutdown handler ----------
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n${ANSI.yellow}▶ Shutting down services...${ANSI.reset}`);

  procs.forEach(({ name, proc }) => {
    if (!proc.killed) {
      console.log(`  ${ANSI.dim}sending SIGTERM to ${name} (PID ${proc.pid})${ANSI.reset}`);
      proc.kill('SIGTERM');
    }
  });

  // Force-kill after 5s
  setTimeout(() => {
    procs.forEach(({ name, proc }) => {
      try {
        if (!proc.killed) {
          console.log(`  ${ANSI.red}force-killing ${name} (PID ${proc.pid})${ANSI.reset}`);
          proc.kill('SIGKILL');
        }
      } catch {}
    });
    process.exit(exitCode);
  }, 5000);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
