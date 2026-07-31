# 999 PRO — Production Deployment (No Docker)

> **v25.0** — Pure Node.js deployment. No Docker, no docker-compose, no Bun.
> Just `npm install && npm run build && npm run start`.

This guide covers deploying 999 PRO on a clean Ubuntu Server 22.04+ using
only Node.js and npm.

## 1. Prerequisites

- **Ubuntu Server 22.04+** (or any Linux with Node.js support)
- **2 GB RAM minimum** (4 GB recommended for build)
- **20 GB disk** minimum
- **Node.js 20+** (Node 22 LTS recommended)
- **npm 10+** (ships with Node.js)

### Install Node.js 22 LTS on Ubuntu

```bash
# Install NodeSource repo + Node.js 22 LTS
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify
node --version   # should print v22.x.x
npm --version    # should print 10.x.x or 11.x.x
```

### (Optional) Install build tools for native modules

```bash
sudo apt-get install -y python3 make g++ build-essential
```

This is needed for `argon2` (password hashing) and `sharp` (image optimization)
if prebuilt binaries aren't available for your platform.

## 2. Get the project on the server

```bash
# Upload the zip to the server (e.g. via scp)
scp 999pro-v25-nodocker.zip user@your-server:~/

# SSH in and extract
ssh user@your-server
unzip 999pro-v25-nodocker.zip
cd 999pro
```

## 3. Install dependencies

```bash
# Installs root + backend + studio dependencies (runs npm install in each)
npm run install:all

# Or, equivalently, just run npm install at root — the build step will
# auto-install sub-services if needed:
npm install
```

This takes 2–5 minutes depending on server resources and network speed.

## 4. Generate .env files (one-time)

```bash
npm run setup
```

This generates cryptographically-strong secrets and writes three `.env` files:

- `.env` (frontend / root)
- `mini-services/backend/.env` (backend)
- `mini-services/studio/.env` (studio)

**Review and edit the generated `.env` files** — especially
`mini-services/backend/.env`:

```bash
nano mini-services/backend/.env
```

Settings you likely need to change for production:

```ini
# Database — SQLite is the default (single file, no DB server needed).
# For PostgreSQL, replace with: postgresql://user:password@host:5432/dbname?schema=public
BACKEND_DATABASE_URL="file:./dev.db"

# CORS — comma-separated list of allowed origins
CLIENT_ORIGIN="https://your-domain.com,https://studio.your-domain.com"

# Trust proxy — set to "true" if behind Nginx/Caddy/Cloudflare
TRUST_PROXY=true

# Public URL of the frontend
APP_PUBLIC_URL=https://your-domain.com

# Email verification (set to "true" in production)
EMAIL_VERIFICATION_REQUIRED=false

# SMTP (required if EMAIL_VERIFICATION_REQUIRED=true)
SMTP_HOST=smtp.yandex.ru
SMTP_PORT=587
SMTP_USER=no-reply@your-domain.com
SMTP_PASS=your-smtp-password
SMTP_FROM=no-reply@your-domain.com
SMTP_SECURE=false  # true for port 465, false for 587
```

## 5. Build all services

```bash
npm run build
```

This runs three sub-builds sequentially:

1. **Backend**: `prisma generate` + `prisma migrate deploy` + `tsc` →
   produces `mini-services/backend/dist/index.js`
2. **Frontend**: `next build` → produces `.next/standalone/server.js`
3. **Studio**: `next build` → produces `mini-services/studio/.next/standalone/server.js`

Build takes 1–3 minutes.

## 6. Start all services

```bash
npm run start
```

This starts three long-running Node.js processes:

- **Backend** on port `4000` (Express + Prisma + Socket.IO)
- **Frontend** on port `3000` (Next.js standalone)
- **Studio** on port `3001` (Next.js standalone, served at `/studio`)

Logs from all services are prefixed with `[backend]`, `[frontend]`, `[studio]`
and interleaved on stdout. Press `Ctrl+C` to stop all services gracefully.

### Verify it's running

```bash
# Backend health
curl http://localhost:4000/api/health
# → {"ok":true,"ts":"..."}

# Frontend
curl -I http://localhost:3000/
# → HTTP/1.1 200 OK

# Studio (returns 403 without auth cookie — that's expected)
curl -I http://localhost:3001/studio
# → HTTP/1.1 403 Forbidden  ← correct, middleware blocks unauthenticated access
```

## 7. Create the first admin

After the backend is up (port 4000), create the first admin account using the
`FIRST_RUN_TOKEN` from `mini-services/backend/.env`:

```bash
FIRST_RUN_TOKEN=$(grep FIRST_RUN_TOKEN mini-services/backend/.env | cut -d= -f2)

curl -X POST http://localhost:4000/api/auth/first-run \
  -H "Content-Type: application/json" \
  -H "X-Setup-Admin-Token: $FIRST_RUN_TOKEN" \
  -d '{
    "username": "admin",
    "email": "admin@your-domain.com",
    "password": "YOUR_STRONG_ADMIN_PASSWORD"
  }'
```

Then open the admin panel at `http://your-server-ip:3001/studio` and log in
with the credentials you just set.

**After creating the first admin**, rotate `FIRST_RUN_TOKEN` in
`mini-services/backend/.env` and restart the backend — this prevents anyone
else from using the first-run endpoint.

## 8. Production setup (recommended)

For a real production deployment, you'll want:

### a) Reverse proxy (Nginx) for TLS + domain routing

The Node.js processes listen on `localhost:3000`, `localhost:3001`,
`localhost:4000`. Put Nginx in front to:

- Terminate TLS (Let's Encrypt)
- Route `your-domain.com` → `localhost:3000`
- Route `your-domain.com/api/*` and `/uploads/*` and `/socket.io/*` → `localhost:4000`
- Route `your-domain.com/studio*` → `localhost:3001`
- Route `studio.your-domain.com` → `localhost:3001`

Sample Nginx config (save to `/etc/nginx/sites-available/999pro`):

```nginx
server {
    listen 80;
    server_name your-domain.com studio.your-domain.com;

    # ACME challenge for Let's Encrypt
    location /.well-known/acme-challenge/ {
        root /var/www/letsencrypt;
    }

    # Redirect everything else to HTTPS
    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    # API + uploads + socket.io → backend
    location ~ ^/(api|uploads|socket.io)(/|$) {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        # WebSocket support (for Socket.IO)
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    # Everything else → frontend
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 443 ssl http2;
    server_name studio.your-domain.com;

    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Activate:

```bash
sudo ln -s /etc/nginx/sites-available/999pro /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx

# Get TLS cert via certbot
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com -d studio.your-domain.com
```

After Nginx is set up, edit `mini-services/backend/.env`:

```ini
CLIENT_ORIGIN="https://your-domain.com,https://studio.your-domain.com"
TRUST_PROXY=true
APP_PUBLIC_URL=https://your-domain.com
```

### b) Process manager (systemd) for auto-restart + boot-time start

`npm run start` is fine for testing, but for production you want each service
to auto-restart on crash and start on boot. Create three systemd unit files:

`/etc/systemd/system/999pro-backend.service`:

```ini
[Unit]
Description=999 PRO Backend (Express + Prisma)
After=network.target

[Service]
Type=simple
User=your-user
WorkingDirectory=/home/your-user/999pro/mini-services/backend
EnvironmentFile=/home/your-user/999pro/mini-services/backend/.env
Environment=NODE_ENV=production
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

`/etc/systemd/system/999pro-frontend.service`:

```ini
[Unit]
Description=999 PRO Frontend (Next.js)
After=network.target 999pro-backend.service

[Service]
Type=simple
User=your-user
WorkingDirectory=/home/your-user/999pro
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=HOSTNAME=0.0.0.0
Environment=BACKEND_URL=http://localhost:4000
ExecStart=/usr/bin/node .next/standalone/server.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

`/etc/systemd/system/999pro-studio.service`:

```ini
[Unit]
Description=999 PRO Studio (Next.js admin)
After=network.target 999pro-backend.service

[Service]
Type=simple
User=your-user
WorkingDirectory=/home/your-user/999pro/mini-services/studio
Environment=NODE_ENV=production
Environment=PORT=3001
Environment=HOSTNAME=0.0.0.0
Environment=BACKEND_URL=http://localhost:4000
ExecStart=/usr/bin/node .next/standalone/server.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Activate:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now 999pro-backend 999pro-frontend 999pro-studio

# Check status
sudo systemctl status 999pro-backend
sudo systemctl status 999pro-frontend
sudo systemctl status 999pro-studio

# Tail logs
sudo journalctl -u 999pro-backend -f
```

## 9. Common operations

```bash
# Stop all services (when using `npm run start`)
# → Press Ctrl+C in the terminal where `npm run start` is running

# Restart services (when using systemd)
sudo systemctl restart 999pro-backend 999pro-frontend 999pro-studio

# Rebuild after code changes
git pull
npm run install:all   # only if package.json changed
npm run build
sudo systemctl restart 999pro-backend 999pro-frontend 999pro-studio

# Rotate secrets (WARNING: invalidates all sessions + push subscriptions)
npm run setup -- --force
sudo systemctl restart 999pro-backend

# Run database migrations manually
npm run db:deploy

# Open Prisma Studio (DB GUI) — for inspection only, not for prod data editing
cd mini-services/backend && npx prisma studio

# Tail logs
sudo journalctl -u 999pro-backend -f
sudo journalctl -u 999pro-frontend -f
sudo journalctl -u 999pro-studio -f
```

## 10. Database backup & restore (SQLite)

```bash
# Backup (while backend is stopped or in low-traffic period)
cp mini-services/backend/dev.db backups/dev-$(date +%Y%m%d).db

# Restore
systemctl stop 999pro-backend
cp backups/dev-YYYYMMDD.db mini-services/backend/dev.db
systemctl start 999pro-backend
```

For PostgreSQL, use `pg_dump` / `psql` instead.

## 11. Troubleshooting

### `npm install` fails with `EALLOWSCRIPTS`

The `.npmrc` in the project root sets `dangerously-allow-all-scripts=true` to
allow native module builds (sharp, argon2, prisma). If this is blocked by your
npm config, either:

1. Use the bundled `.npmrc` (default).
2. Or run `npm approve-scripts` after each install (more secure).

### Build fails with "Couldn't find any `pages` or `app` directory"

You're running `next build` from the wrong directory. Always use
`npm run build` from the project root — it handles directory changes
internally.

### Backend fails with "FATAL: JWT_SECRET environment variable is required"

You haven't run `npm run setup` yet, or the `.env` file is missing. Run:

```bash
npm run setup
npm run build
npm run start
```

### Backend fails with "FATAL: JWT_SECRET is a known leaked demo value"

The JWT_SECRET matches one of the known leaked demo secrets. Regenerate:

```bash
npm run setup -- --force
npm run build
sudo systemctl restart 999pro-backend
```

### Frontend shows "Cannot find module 'next/package.json'"

This happens if `next` isn't installed in the frontend's `node_modules`.
Run `npm run install:all` again — it installs each service's dependencies
separately.

### Studio returns 403 on `/studio`

This is **correct behavior** — the studio middleware blocks unauthenticated
access. To see the login screen, either:

1. Log in via the main app first (sets the `studio-auth-token` cookie), then
   visit `/studio`.
2. Set `ALLOW_IFRAME=true` and visit `http://localhost:3001/studio` directly
   with a valid auth cookie.

### Port already in use

Check what's using the port:

```bash
sudo lsof -i :3000
sudo lsof -i :3001
sudo lsof -i :4000
```

Kill the process or change the port in the relevant `.env` file.

### Native module build fails (argon2, sharp)

Make sure build tools are installed:

```bash
sudo apt-get install -y python3 make g++ build-essential
```

Then rebuild:

```bash
npm run install:all
```

### Prisma migration fails

The committed migrations are SQLite-only. If you're using PostgreSQL, you need
to generate a fresh Postgres baseline. See `mini-services/backend/prisma/` —
the `schema.postgres.prisma` file is the Postgres variant. To use it:

```bash
cd mini-services/backend
cp prisma/schema.postgres.prisma prisma/schema.prisma
rm -rf prisma/migrations
mkdir -p prisma/migrations/0_postgres_baseline
npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/0_postgres_baseline/migration.sql
echo 'provider = "postgresql"' > prisma/migrations/migration_lock.toml
npx prisma generate
npx prisma migrate deploy
```

## 12. Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    Host (Ubuntu Server)                       │
│                                                               │
│  ┌─────────────┐                                              │
│  │   Nginx     │  :443 (TLS)                                  │
│  │ (reverse    │  :80  (redirect to 443)                      │
│  │  proxy)     │                                              │
│  └──────┬──────┘                                              │
│         │                                                     │
│         ├─ your-domain.com/api/*         → localhost:4000     │
│         ├─ your-domain.com/uploads/*     → localhost:4000     │
│         ├─ your-domain.com/socket.io/*   → localhost:4000     │
│         ├─ your-domain.com/studio*       → localhost:3001     │
│         ├─ your-domain.com/*             → localhost:3000     │
│         └─ studio.your-domain.com/*      → localhost:3001     │
│                                                               │
│  ┌─────────────────┐  ┌─────────────────┐  ┌───────────────┐ │
│  │ Frontend (Next) │  │ Studio (Next)   │  │ Backend       │ │
│  │ localhost:3000  │  │ localhost:3001  │  │ (Express)     │ │
│  │                 │  │ basePath:       │  │ localhost:4000│ │
│  │ user-facing app │  │   /studio       │  │               │ │
│  └─────────────────┘  └─────────────────┘  └───────┬───────┘ │
│                                                    │         │
│                                            ┌───────┴───────┐ │
│                                            │  SQLite DB    │ │
│                                            │  (dev.db)     │ │
│                                            │  or Postgres  │ │
│                                            └───────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

- **Frontend** (Next.js 16 standalone) serves the user-facing app on `:3000`.
- **Studio** (Next.js 16 standalone, `basePath: /studio`) serves the admin
  panel on `:3001`.
- **Backend** (Express 4 + Prisma 6 + Socket.IO) serves the API on `:4000`.
- **Database** — SQLite by default (`dev.db` file in backend dir). For
  production with high traffic, switch to PostgreSQL (see `.env`).

## 13. Project structure

```
999pro/
├── package.json                    # Frontend package.json (workspace root)
├── .npmrc                          # npm config (allow-scripts, etc.)
├── next.config.ts                  # Next.js config (standalone output)
├── tsconfig.json
├── tailwind.config.ts
├── postcss.config.mjs
├── next-env.d.ts
├── scripts/
│   ├── setup.js                    # Generate .env files with secrets
│   ├── install-all.js              # npm install in root + backend + studio
│   ├── build.js                    # Build all 3 services
│   ├── start.js                    # Start all 3 services (with log prefixes)
│   ├── db-inspect.ts               # DB inspection utility
│   ├── generate-app-icon.ts        # PWA icon generator
│   ├── generate-mobile-icons.py    # Mobile icon generator
│   ├── generate-pwa-assets.py      # PWA asset generator
│   └── fix-console-error.py        # Dev utility
├── src/                            # Frontend source (Next.js app router)
├── public/                         # Frontend static assets
├── packages/
│   └── shared/                     # @999pro/shared (shared TS types)
├── mini-services/
│   ├── backend/                    # Express API
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── prisma/
│   │   │   ├── schema.prisma             # SQLite (default)
│   │   │   ├── schema.postgres.prisma    # PostgreSQL (alternative)
│   │   │   ├── migrations/               # SQLite migrations
│   │   │   └── seed*.ts                  # Seed scripts
│   │   ├── src/                    # Backend source
│   │   ├── scripts/                # Admin utilities (create-admin, etc.)
│   │   └── .npmrc                  # npm config (allows install-scripts)
│   └── studio/                     # Admin panel (Next.js)
│       ├── package.json
│       ├── next.config.ts          # basePath: /studio, standalone output
│       ├── tsconfig.json
│       ├── eslint.config.mjs
│       ├── postcss.config.mjs
│       ├── src/                    # Studio source
│       ├── public/                 # Studio static assets
│       └── .npmrc                  # npm config
├── .env.example                    # Frontend env template
├── .gitignore
└── README.md                       # This file
```

## 14. Quick reference

| Command | Description |
|---------|-------------|
| `npm install` | Install root deps (use `npm run install:all` for all 3) |
| `npm run install:all` | Install deps in root + backend + studio |
| `npm run setup` | Generate `.env` files with random secrets (one-time) |
| `npm run setup -- --force` | Regenerate all secrets (rotates JWTs, VAPID, etc.) |
| `npm run build` | Build all 3 services |
| `npm run start` | Start all 3 services (Ctrl+C to stop) |
| `npm run dev` | Start frontend in dev mode (hot reload) |
| `npm run db:deploy` | Run Prisma migrations + regenerate client |
| `npm run db:seed` | Seed database with demo data |
| `npm run lint` | Run ESLint on frontend |
| `npm test` | Run unit tests (vitest) |

## 15. What was removed in v25 (no-Docker version)

Compared to v24 (Docker-based):

- ❌ `Dockerfile` (root, backend, studio)
- ❌ `docker-compose.prod.yml`
- ❌ `.dockerignore` files (root, backend, studio)
- ❌ `generate-env.sh` (replaced by `scripts/setup.js`)
- ❌ `Caddyfile`, `Caddyfile.prod` (replaced by Nginx sample in this README)
- ❌ `DEPLOYMENT.md` (merged into this README)
- ❌ `start-all.sh` (replaced by `scripts/start.js`)
- ❌ `bun.lock` files (root, backend, studio)
- ❌ All `bun` / `bunx` references in `package.json` scripts

Added:

- ✅ `scripts/setup.js` — generates `.env` with strong secrets (Node.js crypto)
- ✅ `scripts/install-all.js` — runs `npm install` in all 3 services
- ✅ `scripts/build.js` — orchestrates the 3 builds in correct order
- ✅ `scripts/start.js` — starts all 3 services with prefixed logs
- ✅ `.npmrc` — configures npm to allow install-scripts (sharp, argon2, prisma)
- ✅ `turbopack.root` in both `next.config.ts` files — ensures flat standalone output
- ✅ This README with full deployment guide

## 16. Environment variables reference

### Backend (`mini-services/backend/.env`)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NODE_ENV` | yes | `production` | Runtime environment |
| `PORT` | no | `4000` | Backend listen port |
| `BACKEND_DATABASE_URL` | yes | `file:./dev.db` | SQLite path or Postgres URL |
| `CLIENT_ORIGIN` | yes | `http://localhost:3000,...` | CORS allowed origins (comma-sep) |
| `TRUST_PROXY` | no | `false` | Set `true` behind Nginx/Caddy |
| `JWT_SECRET` | **yes** | — | JWT signing secret (min 32 chars) |
| `JWT_EXPIRES_IN` | no | `7d` | JWT TTL |
| `FIRST_RUN_TOKEN` | **yes** | — | First-admin setup token |
| `RESET_ADMIN_TOKEN` | **yes** | — | Admin reset token |
| `IP_HASH_PEPPER` | **yes** | — | GDPR IP hashing pepper |
| `BCRYPT_ROUNDS` | no | `12` | Bcrypt cost factor |
| `VAPID_SUBJECT` | **yes** | — | Push notification subject (mailto:) |
| `VAPID_PUBLIC_KEY` | **yes** | — | VAPID P-256 public key (base64url) |
| `VAPID_PRIVATE_KEY` | **yes** | — | VAPID P-256 private key (base64url) |
| `EMAIL_VERIFICATION_REQUIRED` | no | `false` | Require email verification |
| `SMTP_HOST` | if email | — | SMTP server hostname |
| `SMTP_PORT` | if email | `587` | SMTP port |
| `SMTP_USER` | if email | — | SMTP username |
| `SMTP_PASS` | if email | — | SMTP password |
| `SMTP_FROM` | if email | — | Sender email |
| `SMTP_SECURE` | no | `false` | `true` for port 465, `false` for 587 |
| `APP_PUBLIC_URL` | yes | `http://localhost:3000` | Frontend public URL |
| `DEEPSEEK_API_KEY` | no | — | AI assistant (optional) |
| `DEEPSEEK_API_BASE` | no | `https://api.deepseek.com` | DeepSeek API base |
| `DEEPSEEK_MODEL` | no | `deepseek-chat` | DeepSeek model |

### Frontend (`.env` at project root)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `BACKEND_URL` | yes | `http://localhost:4000` | Backend URL (server-side) |
| `NEXT_PUBLIC_API_BASE` | no | empty | Public API base (empty = relative) |
| `NEXT_PUBLIC_YANDEX_MAPS_API_KEY` | no | empty | Yandex Maps API key |
| `ALLOW_IFRAME` | no | `false` | Iframe embedding (false in prod) |
| `DEEPSEEK_API_KEY` | no | empty | AI assistant (server-side only) |

### Studio (`mini-services/studio/.env`)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NEXT_PUBLIC_API_BASE` | no | empty | Public API base |
| `NEXT_PUBLIC_APP_URL` | yes | `http://localhost:3000` | Frontend public URL |
| `NEXT_PUBLIC_BACKEND_ORIGIN` | yes | `http://localhost:4000` | Backend URL (SSR proxy) |
| `NEXT_PUBLIC_YANDEX_MAPS_API_KEY` | no | empty | Yandex Maps API key |
| `ALLOW_IFRAME` | no | `true` | Iframe embedding (true so main app can embed) |
