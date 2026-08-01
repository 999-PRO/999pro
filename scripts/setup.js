// ============================================================================
// 999 PRO — setup.js
// ----------------------------------------------------------------------------
// One-time setup: generates .env files with cryptographically-strong secrets
// for the backend, frontend (root), and studio.
//
// Run: `npm run setup` (or `node scripts/setup.js`)
//
// v25.1: PostgreSQL is the default database provider. SQLite is still
// supported for local dev — pass `--sqlite` to use it. The script also
// auto-swaps prisma/schema.prisma to match the chosen provider.
//
// Idempotent: if .env files already exist, they will NOT be overwritten.
// Pass --force to regenerate (WARNING: rotates all secrets — existing JWTs
// become invalid, push subscriptions break, etc.).
//
// Flags:
//   --force | -f       Regenerate all .env files (rotates secrets)
//   --sqlite           Use SQLite instead of PostgreSQL (local dev only)
//   --db=URL           Set BACKEND_DATABASE_URL explicitly (overrides default)
// ============================================================================

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const BACKEND = path.join(ROOT, 'mini-services', 'backend');
const STUDIO = path.join(ROOT, 'mini-services', 'studio');
const PRISMA_DIR = path.join(BACKEND, 'prisma');

const args = process.argv.slice(2);
const FORCE = args.includes('--force') || args.includes('-f');
const USE_SQLITE = args.includes('--sqlite') || process.env.DB_PROVIDER === 'sqlite';
const DB_FLAG = args.find((a) => a.startsWith('--db='));
const EXPLICIT_DB_URL = DB_FLAG ? DB_FLAG.slice(4) : process.env.BACKEND_DATABASE_URL;

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

// ----------------------------------------------------------------------------
// v25.1: Prisma schema provider swap.
// The active schema is always prisma/schema.prisma. We keep two templates:
//   - schema.prisma          (PostgreSQL — production default)
//   - schema.sqlite.prisma   (SQLite — local dev fallback)
// When the operator picks SQLite (via --sqlite or BACKEND_DATABASE_URL=file:...),
// we copy schema.sqlite.prisma → schema.prisma so Prisma reads the correct
// provider. When they pick PostgreSQL, we restore the Postgres template.
// ----------------------------------------------------------------------------
function swapPrismaSchema(useSqlite) {
  const activePath = path.join(PRISMA_DIR, 'schema.prisma');
  const sqliteTemplate = path.join(PRISMA_DIR, 'schema.sqlite.prisma');
  // The Postgres template is what we shipped as schema.prisma — to make
  // the swap reversible, we keep a pristine copy as schema.postgres.prisma.
  const postgresTemplate = path.join(PRISMA_DIR, 'schema.postgres.prisma');

  // First run: bootstrap the postgres template by copying the shipped schema.
  if (!fs.existsSync(postgresTemplate)) {
    fs.copyFileSync(activePath, postgresTemplate);
  }

  const wantPath = useSqlite ? sqliteTemplate : postgresTemplate;
  if (!fs.existsSync(wantPath)) {
    console.error(`✗ Schema template not found: ${path.relative(ROOT, wantPath)}`);
    process.exit(1);
  }

  // Compare contents — only overwrite if different (avoids touching mtime
  // on every setup run, which would force a Prisma client regenerate).
  const currentContent = fs.readFileSync(activePath, 'utf8');
  const wantContent = fs.readFileSync(wantPath, 'utf8');
  if (currentContent === wantContent) {
    console.log(`  ✓ Prisma schema: ${useSqlite ? 'SQLite' : 'PostgreSQL'} (already active)`);
    return;
  }

  fs.copyFileSync(wantPath, activePath);
  console.log(`  ✓ Prisma schema: switched to ${useSqlite ? 'SQLite' : 'PostgreSQL'}`);
}

// ---------- determine database URL ----------
function determineDbUrl() {
  // 1. Explicit --db=URL wins
  if (EXPLICIT_DB_URL) return EXPLICIT_DB_URL;
  // 2. Existing .env value (preserve on re-runs)
  const envPath = path.join(BACKEND, '.env');
  if (fs.existsSync(envPath)) {
    const existing = fs.readFileSync(envPath, 'utf8');
    const m = existing.match(/^BACKEND_DATABASE_URL=(.+)$/m);
    if (m) {
      const v = m[1].trim().replace(/^"|"$/g, '');
      if (v) return v;
    }
  }
  // 3. Default based on --sqlite flag
  if (USE_SQLITE) return 'file:./dev.db';
  // 4. PostgreSQL default — placeholder the operator must edit
  //    We can't auto-generate real PG credentials, so we put a clear
  //    placeholder + comment in .env. The build will fail-fast with a
  //    helpful message if this isn't replaced.
  return 'postgresql://USER:PASSWORD@localhost:5432/999pro?schema=public&connection_limit=10&pool_timeout=10';
}

function isSqliteUrl(url) {
  return url.startsWith('file:');
}

// ---------- generate secrets ----------
console.log('\n🔐 Generating secrets...');

const JWT_SECRET = randHex(48);
const FIRST_RUN_TOKEN = randHex(32);
const RESET_ADMIN_TOKEN = randHex(32);
const IP_HASH_PEPPER = randHex(32);
const vapid = genVapidKeys();

// ---------- detect domain ----------
const DEFAULT_DOMAIN = process.env.APP_DOMAIN || 'localhost';
const APP_PUBLIC_URL = process.env.APP_PUBLIC_URL || (DEFAULT_DOMAIN === 'localhost'
  ? 'http://localhost:3000'
  : `https://${DEFAULT_DOMAIN}`);

// ---------- determine DB provider ----------
const BACKEND_DATABASE_URL = determineDbUrl();
const USING_SQLITE = isSqliteUrl(BACKEND_DATABASE_URL);

console.log('\n📦 Database provider:');
if (USING_SQLITE) {
  console.log(`  → SQLite (${BACKEND_DATABASE_URL})`);
  console.log('    WARNING: SQLite is for local dev only. Use PostgreSQL for production.');
} else {
  // Mask the password in the log output
  const maskedUrl = BACKEND_DATABASE_URL.replace(/(\/\/[^:]+:)[^@]+(@)/, '$1****$2');
  console.log(`  → PostgreSQL (${maskedUrl})`);
}

// Swap the Prisma schema file to match the provider.
console.log('\n🔧 Configuring Prisma schema...');
swapPrismaSchema(USING_SQLITE);

// ---------- backend .env ----------
console.log('\n📝 Writing .env files...');

const backendEnv = `# 999 PRO Backend — .env (auto-generated by scripts/setup.js)
# Generated: ${new Date().toISOString()}
# Edit values below as needed. NEVER commit this file.

# ---- Runtime ----
NODE_ENV=production
PORT=4000

# ---- Database ----
# v25.1: PostgreSQL is the default provider. SQLite is supported for local
# dev — to switch, run \`npm run setup -- --sqlite\` (or set DB_PROVIDER=sqlite).
#
# PostgreSQL connection string format:
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
BACKEND_DATABASE_URL="${BACKEND_DATABASE_URL}"

# ---- CORS ----
# Comma-separated list of allowed origins. For production with a domain:
#   CLIENT_ORIGIN="https://YOUR_DOMAIN,https://studio.YOUR_DOMAIN"
CLIENT_ORIGIN="http://localhost:3000,http://localhost:3001"

# ---- Trust proxy (set to "true" if behind Nginx/Caddy/Cloudflare) ----
TRUST_PROXY=false

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

# ---- Public API base ----
# Empty = use relative /api/* paths (recommended when behind Nginx reverse proxy)
NEXT_PUBLIC_API_BASE=

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

// ---------- summary ----------
console.log('\n' + '='.repeat(80));
console.log('✅ Setup complete');
console.log('='.repeat(80));

if (USING_SQLITE) {
  console.log(`
Database: SQLite (${BACKEND_DATABASE_URL})
  ⚠ SQLite is fine for local dev but NOT recommended for production.
    For production, switch to PostgreSQL:
      1. Install PostgreSQL on your server (or use Beget's PostgreSQL add-on).
      2. Edit mini-services/backend/.env and set BACKEND_DATABASE_URL to
         postgresql://USER:PASSWORD@HOST:5432/DBNAME?schema=public&connection_limit=10
      3. Run: npm run setup -- --force
      4. Run: npm run build && npm run start
`);
} else {
  // Check whether the URL is still a placeholder
  const isPlaceholder = BACKEND_DATABASE_URL.includes('USER:PASSWORD');
  if (isPlaceholder) {
    console.log(`
Database: PostgreSQL (PLACEHOLDER — you MUST edit .env before building!)

  ⚠ The BACKEND_DATABASE_URL in mini-services/backend/.env is still the
    auto-generated placeholder. Before running \`npm run build\`:

    1. Install PostgreSQL on your server (or use Beget's PostgreSQL add-on).
    2. Create a database + user:
         sudo -u postgres psql
         CREATE USER ninepro WITH PASSWORD 'your-strong-password';
         CREATE DATABASE ninepro OWNER ninepro;
         \\q
    3. Edit mini-services/backend/.env and replace BACKEND_DATABASE_URL with:
         postgresql://ninepro:your-strong-password@localhost:5432/ninepro?schema=public&connection_limit=10&pool_timeout=10
    4. Run: npm run build && npm run start
    5. Open http://localhost:3001/studio — the first-run setup wizard
       opens automatically (no curl, no tokens, no terminal commands).
`);
  } else {
    console.log(`
Database: PostgreSQL (configured)
  ✓ BACKEND_DATABASE_URL is set. Ready to build.
`);
  }
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

To switch database provider:
  npm run setup -- --sqlite      # use SQLite (local dev)
  npm run setup -- --force       # use PostgreSQL (production default)
`);
