// ============================================================================
// 999 PRO — setup.js
// ----------------------------------------------------------------------------
// One-time setup: generates .env files with cryptographically-strong secrets
// for the backend, frontend (root), and studio.
//
// Run: `npm run setup` (or `node scripts/setup.js`)
//
// v25.2: PostgreSQL is the ONLY production database provider.
// The backend reads its connection string from `DATABASE_URL`.
//
// Idempotent: if .env files already exist, they will NOT be overwritten.
// Pass --force to regenerate (WARNING: rotates all secrets — existing JWTs
// become invalid, push subscriptions break, etc.).
//
// Flags:
//   --force | -f       Regenerate all .env files (rotates secrets)
//   --db=URL           Set DATABASE_URL explicitly (overrides default placeholder)
//
// NOTE on SQLite: SQLite is no longer a setup.js flag. The production code
// path requires PostgreSQL. If you want to use SQLite for local dev, see
// scripts/use-sqlite.js — but be aware that this is a dev-only convenience
// and is NOT supported in production.
// ============================================================================

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const BACKEND = path.join(ROOT, 'mini-services', 'backend');
const STUDIO = path.join(ROOT, 'mini-services', 'studio');

const args = process.argv.slice(2);
const FORCE = args.includes('--force') || args.includes('-f');
const DB_FLAG = args.find((a) => a.startsWith('--db='));
const EXPLICIT_DB_URL = DB_FLAG ? DB_FLAG.slice(4) : process.env.DATABASE_URL;

// Reject --sqlite silently — operator should know it's no longer supported.
if (args.includes('--sqlite') || process.env.DB_PROVIDER === 'sqlite') {
  console.error('✗ SQLite is no longer a setup.js option (v25.2).');
  console.error('  PostgreSQL is the only production database provider.');
  console.error('  For local-dev SQLite, see scripts/use-sqlite.js — but be aware');
  console.error('  that the production runtime no longer supports it.');
  process.exit(1);
}

// ---------- helpers ----------
function randHex(bytes) {
  return crypto.randomBytes(bytes).toString('hex');
}

function genVapidKeys() {
  // P-256 ECDSA keypair, raw bytes encoded as base64url — what web-push expects.
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    publicKey: ecdh.getPublicKey().toString('base64url'),
    privateKey: ecdh.getPrivateKey().toString('base64url'),
  };
}

function writeIfMissing(filePath, content, label) {
  if (fs.existsSync(filePath) && !FORCE) {
    console.log(`  ✓ ${label}: ${path.relative(ROOT, filePath)} (already exists — skipped)`);
    return false;
  }
  fs.writeFileSync(filePath, content, { mode: 0o600 });
  console.log(`  ✓ ${label}: ${path.relative(ROOT, filePath)} (${FORCE ? 'regenerated' : 'created'})`);
  return true;
}

// ---------- determine DATABASE_URL ----------
function determineDbUrl() {
  // 1. Explicit --db=URL wins
  if (EXPLICIT_DB_URL) return EXPLICIT_DB_URL;
  // 2. Existing .env value (preserve on re-runs)
  const envPath = path.join(BACKEND, '.env');
  if (fs.existsSync(envPath)) {
    const existing = fs.readFileSync(envPath, 'utf8');
    // Match either DATABASE_URL (new) or BACKEND_DATABASE_URL (legacy).
    const m = existing.match(/^(?:BACKEND_)?DATABASE_URL=(.+)$/m);
    if (m) {
      const v = m[1].trim().replace(/^"|"$/g, '');
      if (v) return v;
    }
  }
  // 3. Default PostgreSQL placeholder — operator must edit before deploy.
  //    We can't auto-generate real PG credentials, so we put a clear
  //    placeholder + comment in .env. The deploy will fail-fast with a
  //    helpful message if this isn't replaced.
  return 'postgresql://USER:PASSWORD@localhost:5432/999pro?schema=public&connection_limit=10&pool_timeout=10';
}

// ---------- generate secrets ----------
console.log('\n🔐 Generating secrets...');

const JWT_SECRET = randHex(48);
const FIRST_RUN_TOKEN = randHex(32);
const RESET_ADMIN_TOKEN = randHex(32);
const IP_HASH_PEPPER = randHex(32);
const vapid = genVapidKeys();

// ---------- detect domain ----------
// v25.5 (config audit): default to tri-999.online (the actual production
// domain). Previously defaulted to 'localhost' — operators who ran setup.js
// without setting APP_DOMAIN ended up with VAPID_SUBJECT=mailto:admin@localhost
// (iOS push silently fails) and CLIENT_ORIGIN with localhost (CORS rejects
// real domain). Now the default is the real production domain, and operators
// deploying elsewhere can override via APP_DOMAIN env var.
const DEFAULT_DOMAIN = process.env.APP_DOMAIN || 'tri-999.online';
const APP_PUBLIC_URL = process.env.APP_PUBLIC_URL || (DEFAULT_DOMAIN === 'localhost'
  ? 'http://localhost:3000'
  : `https://${DEFAULT_DOMAIN}`);

// v25.5: warn if APP_DOMAIN wasn't explicitly set AND we're not on localhost.
// This is just a reminder — the default (tri-999.online) is correct for the
// primary production deployment, but operators deploying to a different
// domain MUST set APP_DOMAIN or the generated .env will have wrong values.
if (!process.env.APP_DOMAIN && DEFAULT_DOMAIN !== 'localhost') {
  console.log(`  ℹ Using default domain: ${DEFAULT_DOMAIN}`);
  console.log(`    To override, set APP_DOMAIN=yourdomain.com before running setup.`);
}

// ---------- determine DATABASE_URL ----------
const DATABASE_URL = determineDbUrl();
const isPostgres = DATABASE_URL.startsWith('postgres://') || DATABASE_URL.startsWith('postgresql://');

console.log('\n📦 Database provider:');
if (!isPostgres) {
  console.error(`  ✗ DATABASE_URL must be a postgresql:// URL. Got: ${DATABASE_URL}`);
  console.error('    SQLite (file:) is NOT supported in production (v25.2).');
  console.error('    Edit mini-services/backend/.env and set DATABASE_URL to a');
  console.error('    valid PostgreSQL connection string, then re-run setup.');
  process.exit(1);
}
const maskedUrl = DATABASE_URL.replace(/(\/\/[^:]+:)[^@]+(@)/, '$1****$2');
console.log(`  → PostgreSQL (${maskedUrl})`);

// ---------- backend .env ----------
console.log('\n📝 Writing .env files...');

const backendEnv = `# 999 PRO Backend — .env (auto-generated by scripts/setup.js)
# Generated: ${new Date().toISOString()}
# Edit values below as needed. NEVER commit this file.

# ---- Runtime ----
NODE_ENV=production
PORT=4000

# ---- Database (PostgreSQL — production) ----
# v25.2: PostgreSQL is the ONLY production database provider.
# Format:
#   postgresql://USER:PASSWORD@HOST:5432/DBNAME?schema=public&connection_limit=10&pool_timeout=10
#
# - connection_limit: max simultaneous connections (Prisma's internal pool).
#                     10 is good for a 2-4 GB VPS. Increase for bigger hosts.
# - pool_timeout:     seconds to wait for a free connection before erroring.
#
# Example for a local Postgres install:
#   postgresql://postgres:postgres@localhost:5432/999pro?schema=public&connection_limit=10&pool_timeout=10
#
# Example for Beget VPS (PostgreSQL add-on):
#   postgresql://USER:PASSWORD@localhost:5432/USER_999pro?schema=public&connection_limit=10&pool_timeout=10
DATABASE_URL="${DATABASE_URL}"

# ---- CORS ----
# Comma-separated list of allowed origins. For production with a domain:
#   CLIENT_ORIGIN="https://YOUR_DOMAIN,https://studio.YOUR_DOMAIN"
# v25.5: auto-generated from APP_DOMAIN — includes both the main app and
# studio (served at /studio on the same domain).
CLIENT_ORIGIN="${DEFAULT_DOMAIN === 'localhost' ? 'http://localhost:3000,http://localhost:3001' : `https://${DEFAULT_DOMAIN}`}"

# ---- Trust proxy (set to "true" if behind Nginx/Caddy/Cloudflare) ----
# v25.5: default to true when a real domain is configured (production is
# always behind a reverse proxy). localhost dev stays false.
TRUST_PROXY=${DEFAULT_DOMAIN === 'localhost' ? 'false' : 'true'}

# ---- Auth secrets (auto-generated) ----
JWT_SECRET=${JWT_SECRET}
JWT_EXPIRES_IN=7d
# DEPRECATED in v25: FIRST_RUN_TOKEN is no longer read by the backend.
# The /api/auth/setup-admin endpoint is token-less — first admin is
# created through the web wizard at /studio.
FIRST_RUN_TOKEN=${FIRST_RUN_TOKEN}
RESET_ADMIN_TOKEN=${RESET_ADMIN_TOKEN}
IP_HASH_PEPPER=${IP_HASH_PEPPER}

# ---- Bcrypt rounds ----
BCRYPT_ROUNDS=12

# ---- Web Push (VAPID) — auto-generated P-256 keypair ----
VAPID_SUBJECT=mailto:admin@${DEFAULT_DOMAIN}
VAPID_PUBLIC_KEY=${vapid.publicKey}
VAPID_PRIVATE_KEY=${vapid.privateKey}

# ---- Email verification ----
EMAIL_VERIFICATION_REQUIRED=false

# ---- SMTP (required if EMAIL_VERIFICATION_REQUIRED=true) ----
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=no-reply@${DEFAULT_DOMAIN}
SMTP_SECURE=false

# ---- Admin / seed ----
BYPASS_ADMIN_TOTP=false
SEED_USER_PASSWORD=demo12345
ADMIN_EMAIL=admin@${DEFAULT_DOMAIN}
ADMIN_USERNAME=admin

# ---- Public URL ----
APP_PUBLIC_URL=${APP_PUBLIC_URL}

# ---- AI Assistant (optional) ----
DEEPSEEK_API_KEY=
DEEPSEEK_API_BASE=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat
`;

const frontendEnv = `# 999 PRO Frontend — .env (auto-generated by scripts/setup.js)
# Edit values below as needed. NEVER commit this file.

# ---- Backend URL ----
# In production with Nginx: http://localhost:4000 (server-side)
BACKEND_URL=http://localhost:4000

# ---- Studio URL (server-side) ----
# v25.10: used by next.config.ts rewrites for /studio/* paths.
# Default: http://localhost:3001 (single-host prod).
# Set to the studio's public URL on multi-host / Smart-TV deployments.
STUDIO_URL=http://localhost:3001

# ---- Public API base ----
# Empty = use relative /api/* paths (recommended when behind Nginx reverse proxy)
NEXT_PUBLIC_API_BASE=

# ---- Public app URL (REQUIRED for production SEO / OG previews) ----
# v25.10 (P1 fix): previously setup.js did NOT write NEXT_PUBLIC_APP_URL to
# the frontend .env, so metadataBase / openGraph.url / canonical URLs all
# fell back to http://localhost:3000 — breaking share previews in WhatsApp /
# Facebook / X. We now write the resolved APP_PUBLIC_URL here.
NEXT_PUBLIC_APP_URL=${APP_PUBLIC_URL}
APP_PUBLIC_URL=${APP_PUBLIC_URL}

# ---- Yandex Maps API key (optional) ----
NEXT_PUBLIC_YANDEX_MAPS_API_KEY=

# ---- Iframe embedding (false in prod for clickjacking protection) ----
ALLOW_IFRAME=false

# ---- AI Assistant (optional, server-side only) ----
DEEPSEEK_API_KEY=
DEEPSEEK_API_BASE=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat

# ---- Mobile deep linking (optional) ----
APPLE_TEAM_ID=
APPLE_BUNDLE_ID=pro.ninehundred.app
ANDROID_PACKAGE_NAME=pro.ninehundred.app
ANDROID_SHA256_FINGERPRINT=
`;

const studioEnv = `# 999 PRO Studio — .env (auto-generated by scripts/setup.js)
# Edit values below as needed. NEVER commit this file.

# ---- API base URL ----
NEXT_PUBLIC_API_BASE=

# ---- Public app URL ----
NEXT_PUBLIC_APP_URL=${APP_PUBLIC_URL}

# ---- Backend origin (server-side proxy) ----
NEXT_PUBLIC_BACKEND_ORIGIN=http://localhost:4000

# ---- Yandex Maps API key (optional) ----
NEXT_PUBLIC_YANDEX_MAPS_API_KEY=

# ---- Iframe embedding (true so the main app can embed /studio) ----
ALLOW_IFRAME=true
`;

writeIfMissing(path.join(BACKEND, '.env'), backendEnv, 'backend .env');
writeIfMissing(path.join(ROOT, '.env'), frontendEnv, 'frontend .env');
writeIfMissing(path.join(STUDIO, '.env'), studioEnv, 'studio .env');

// ---------- migrate legacy BACKEND_DATABASE_URL → DATABASE_URL ----------
// If the backend .env still has BACKEND_DATABASE_URL (from a pre-v25.2
// setup), rename it to DATABASE_URL so the new prisma schema picks it up.
// We do this even when .env already exists (not just on first write).
const envPath = path.join(BACKEND, '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  if (envContent.includes('BACKEND_DATABASE_URL=') && !envContent.match(/^DATABASE_URL=/m)) {
    const migrated = envContent.replace(/^BACKEND_DATABASE_URL=/m, 'DATABASE_URL=');
    fs.writeFileSync(envPath, migrated, { mode: 0o600 });
    console.log('  ✓ Migrated BACKEND_DATABASE_URL → DATABASE_URL in backend .env');
  } else if (envContent.includes('BACKEND_DATABASE_URL=')) {
    // Both vars exist — remove the legacy one to avoid confusion.
    const cleaned = envContent.replace(/^BACKEND_DATABASE_URL=.*\n?/m, '');
    fs.writeFileSync(envPath, cleaned, { mode: 0o600 });
    console.log('  ✓ Removed legacy BACKEND_DATABASE_URL from backend .env (DATABASE_URL is in use)');
  }
}

// ---------- summary ----------
console.log('\n' + '='.repeat(80));
console.log('✅ Setup complete');
console.log('='.repeat(80));

// Check whether the URL is still a placeholder
const isPlaceholder = DATABASE_URL.includes('USER:PASSWORD');
if (isPlaceholder) {
  console.log(`
Database: PostgreSQL (PLACEHOLDER — you MUST edit .env before building!)

  ⚠ The DATABASE_URL in mini-services/backend/.env is still the
    auto-generated placeholder. Before running \`npm run build\`:

    1. Install PostgreSQL on your server (or use Beget's PostgreSQL add-on).
    2. Create a database + user:
         sudo -u postgres psql
         CREATE USER ninepro WITH PASSWORD 'your-strong-password';
         CREATE DATABASE ninepro OWNER ninepro;
         \\q
    3. Edit mini-services/backend/.env and replace DATABASE_URL with:
         postgresql://ninepro:your-strong-password@localhost:5432/ninepro?schema=public&connection_limit=10&pool_timeout=10
    4. Run: npm run build && npm run start
    5. Open http://localhost:3001/studio — the first-run setup wizard
       opens automatically (no curl, no tokens, no terminal commands).
`);
} else {
  console.log(`
Database: PostgreSQL (configured)
  ✓ DATABASE_URL is set. Ready to build.
`);
}

console.log(`Generated files:
  .env                            (frontend)
  mini-services/backend/.env      (backend)
  mini-services/studio/.env       (studio)

NEXT STEPS:
  1. Review and edit .env files (Postgres URL, SMTP, domain, Yandex key, etc.)
     Especially set these in mini-services/backend/.env if you have a domain:
       CLIENT_ORIGIN=https://YOUR_DOMAIN,https://studio.YOUR_DOMAIN
       APP_PUBLIC_URL=https://YOUR_DOMAIN
       SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS  (if email verify on)

  2. Build the project:
       npm run build

     (or use the one-command deploy: \`./deploy.sh\` — see README §7)

  3. Start all services:
       npm run start

  4. Open the app in your browser:
       Frontend: http://localhost:3000
       Studio:   http://localhost:3001/studio
       Backend:  http://localhost:4000/api/health

  5. CREATE THE FIRST ADMIN (web-only, no terminal needed):
       - Open http://localhost:3001/studio in your browser.
       - If no admin exists yet, the "First-run setup wizard" opens
         automatically.
       - Fill in the form (name, username, email, password) and click
         "Create administrator".
       - You will be logged in automatically and redirected to the
         Studio dashboard.

     The wizard is shown ONLY when no admin exists. After the first
     admin is created, the wizard never appears again — all subsequent
     access goes through the regular login form.

To regenerate secrets later (rotates ALL secrets — existing sessions break):
  npm run setup -- --force
`);
