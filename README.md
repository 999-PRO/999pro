# 999 PRO — Production Deployment (No Docker)

> **v25.2** — Pure Node.js deployment. No Docker, no docker-compose, no Bun.
> Just `npm install && npm run setup && npm run build && npm run start`
> — or one command: `./deploy.sh --install-services` for persistent startup.
> **PostgreSQL is the default database** (SQLite still available for local dev).
> **First admin is created via a web-based setup wizard — no curl, no
> tokens, no terminal commands required.**
> **v25.2: systemd integration — services survive terminal/SSH disconnect,
> auto-start on VPS boot, auto-restart on crash.**

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

### Install PostgreSQL (recommended — production default)

v25.1 uses **PostgreSQL** as the default database. On a clean Ubuntu VPS:

```bash
# Install PostgreSQL 16
sudo apt-get install -y postgresql postgresql-contrib

# Start + enable on boot
sudo systemctl enable --now postgresql

# Create a database + user for 999 PRO
sudo -u postgres psql <<'SQL'
CREATE USER ninepro WITH PASSWORD 'your-strong-password-here';
CREATE DATABASE ninepro OWNER ninepro;
GRANT ALL PRIVILEGES ON DATABASE ninepro TO ninepro;
\q
SQL

# Verify
psql -U ninepro -d ninepro -h localhost -c 'SELECT version();'
# → PostgreSQL 16.x ...
```

> **Beget VPS note**: Beget's PostgreSQL add-on can be enabled from the
> hosting control panel. After enabling, you'll get a `postgresql://`
> connection string — paste it into `mini-services/backend/.env` as
> `DATABASE_URL`.

> **v25.2**: PostgreSQL is the only production database provider. SQLite
> is no longer a setup.js flag — see `scripts/use-sqlite.js` for a
> LOCAL-DEV-ONLY convenience that is NOT supported in production.

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

**v25.2**: `setup` writes a placeholder `DATABASE_URL` (PostgreSQL) that
you MUST edit before building. SQLite is no longer a setup flag — see
`scripts/use-sqlite.js` for a LOCAL-DEV-ONLY convenience.

**Review and edit the generated `.env` files** — especially
`mini-services/backend/.env`:

```bash
nano mini-services/backend/.env
```

Settings you likely need to change for production:

```ini
# Database — PostgreSQL is the only production provider (v25.2).
# Replace USER:PASSWORD@localhost:5432/999pro with your real
# PostgreSQL credentials.
#
# Connection pool params:
#   connection_limit=10   — max simultaneous connections (Prisma's pool)
#   pool_timeout=10       — seconds to wait for a free connection
DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/999pro?schema=public&connection_limit=10&pool_timeout=10"

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

> **v25.1 one-command deploy**: Instead of running setup + install + build
> + start manually, you can use `./deploy.sh` (or `npm run deploy`):
>
> ```bash
> ./deploy.sh              # full deploy + start
> ./deploy.sh --no-start   # build only, don't start services
> ./deploy.sh --sqlite     # use SQLite (local dev only)
> ```
>
> The script checks Node.js, generates `.env`, installs deps, runs Prisma
> migrations, builds all 3 services, starts them, and health-checks the
> API. See section 6.5 below for details.

## 6. Start all services

There are **two ways** to run the services:

### Option A — Foreground (development / quick test)

```bash
npm run start
```

This starts three long-running Node.js processes:

- **Backend** on port `4000` (Express + Prisma + Socket.IO)
- **Frontend** on port `3000` (Next.js standalone)
- **Studio** on port `3001` (Next.js standalone, served at `/studio`)

Logs from all services are prefixed with `[backend]`, `[frontend]`, `[studio]`
and interleaved on stdout. Press `Ctrl+C` to stop all services gracefully.

> ⚠ **Foreground mode stops when you close the terminal.** For production,
> use Option B (systemd) below — services survive SSH disconnect, VPS
> reboot, and auto-restart on crash.

### Option B — Persistent services (production) ⭐ recommended

v25.2 introduces **systemd integration** for persistent, production-grade
process management. After install:

- ✅ Services survive terminal/SSH disconnect (systemd-managed)
- ✅ Services auto-start on VPS boot (`systemctl enable`)
- ✅ Services auto-restart on crash (`Restart=on-failure`, 5s pause)
- ✅ Logs go to journald (viewable via `journalctl`)
- ✅ Resource limits (memory cap, file descriptor limit)
- ✅ Graceful shutdown (SIGTERM → 15s → SIGKILL)

#### Install persistent services (one-time, after `npm run build`)

```bash
sudo ./scripts/install-services.sh
```

Or via npm:

```bash
sudo npm run services:install
```

Or via the deploy script (build + install in one command):

```bash
./deploy.sh --install-services
# or
npm run deploy:services
```

The installer:
1. Checks build artifacts + `.env` files exist
2. Generates 3 systemd unit files from templates (with your actual paths)
3. Copies them to `/etc/systemd/system/999pro-*.service`
4. Enables them (auto-start on boot)
5. Starts them + runs HTTP health checks on all 3 ports

#### Verify services are running

```bash
npm run services:status
```

Output:
```
999 PRO — services status
═══════════════════════════════════════════════════════════════════════

  SERVICE  PORT       STATE        AUTO-START  HEALTH
  ────────────────────────────────────────────────────────────────────────
  backend  4000       active       enabled     ✓ ok
  frontend 3000       active       enabled     ✓ ok
  studio   3001       active       enabled     ✓ ok

✓ All services healthy.
```

#### View logs

```bash
# All services (interleaved, live follow)
npm run services:logs

# One service only
npm run services:logs:backend
npm run services:logs:frontend
npm run services:logs:studio

# Last 50 lines, no follow
./scripts/services-logs.sh backend --no-follow

# Logs from the last hour
./scripts/services-logs.sh --since 1h
```

#### Restart / stop / start

```bash
npm run services:restart   # restart all 3
npm run services:stop      # stop all 3
npm run services:start     # start all 3

# Or per-service via systemctl directly:
sudo systemctl restart 999pro-backend
sudo systemctl stop 999pro-frontend
sudo systemctl start 999pro-studio
```

#### Uninstall (remove systemd integration, keep build artifacts)

```bash
sudo npm run services:uninstall
# or
sudo ./scripts/uninstall-services.sh
# or with log purge:
sudo ./scripts/uninstall-services.sh --purge
```

This stops + disables + removes the unit files, but **does NOT delete**:
- Build artifacts (`dist/`, `.next/standalone/`)
- `.env` files (secrets)
- Database (PostgreSQL data or `dev.db`)

You can re-install anytime with `sudo ./scripts/install-services.sh`.

### Verify it's running

```bash
# Backend health
curl http://localhost:4000/api/health
# → {"ok":true,"ts":"..."}

# Frontend
curl -I http://localhost:3000/
# → HTTP/1.1 200 OK

# Studio (HTML — returns 200 so the first-run wizard can render)
curl -I http://localhost:3001/studio
# → HTTP/1.1 200 OK  ← the page loads; the wizard or login shows client-side

# Studio (non-HTML probe without auth cookie — still 403 to scanners)
curl -H "Accept: application/json" http://localhost:3001/studio
# → HTTP/1.1 403 Forbidden  ← correct, blocks automated probes
```

## 6.5 One-command deploy (`./deploy.sh`)

v25.1 introduces a single deploy script that runs all the steps from
sections 3–6 automatically:

```bash
./deploy.sh              # full deploy + start services
./deploy.sh --no-start   # build only, don't start services
./deploy.sh --sqlite     # use SQLite instead of PostgreSQL (local dev only)
```

Or via npm:

```bash
npm run deploy              # full deploy + start
npm run deploy:build-only   # build only, don't start
npm run deploy:sqlite       # SQLite (local dev)
```

### What the script does

1. **Checks Node.js** — verifies Node.js 20+ and npm are installed.
2. **Generates .env** — runs `scripts/setup.js` if any `.env` file is missing.
   Existing files are preserved (use `npm run setup -- --force` to rotate
   secrets).
3. **Installs dependencies** — runs `npm install` in root, backend, studio,
   and shared package (only if `node_modules` is missing).
4. **Runs Prisma migrations** — `prisma migrate deploy` for PostgreSQL, or
   `prisma db push` for SQLite (auto-detected from the active schema).
5. **Generates Prisma client** — `prisma generate`.
6. **Builds backend** — `tsc` → `mini-services/backend/dist/index.js`.
7. **Builds frontend** — `next build` → `.next/standalone/server.js` +
   copies static + public assets.
8. **Builds studio** — `next build` → `mini-services/studio/.next/standalone/server.js`.
9. **Starts services + health check** — runs `scripts/start.js`, waits 15s,
   then verifies backend/frontend/studio all respond. Prints the wizard URL
   if no admin exists yet.

### Exit codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Generic failure (see error message) |
| 2 | Node.js version too old or missing |
| 3 | `.env` files missing and could not be generated |
| 4 | Dependency installation failed |
| 5 | Prisma migration failed |
| 6 | Build failed (backend / frontend / studio) |
| 7 | Service start failed or API didn't respond |

### Deploy log

The script writes all service logs to `/tmp/999pro-deploy-<pid>.log`. If
something fails, the script prints the last 20 lines of the log to stderr.

## 7. Create the first admin (web-based setup wizard)

After all three services are running (Backend on 4000, Frontend on 3000,
Studio on 3001), the first admin is created **entirely through the web
interface — no curl, no terminal commands, no tokens**.

### Steps

1. Open the Studio in your browser:

   ```
   http://your-server-ip:3001/studio
   ```

   (or `https://studio.your-domain.com` if you've set up Nginx + TLS)

2. The Studio automatically calls `GET /api/auth/admin-exists` on load.

   - If **no admin exists yet**, the **"First-run setup wizard"** opens
     automatically — a full-screen page with a glassmorphism design,
     smooth Framer Motion animations, and dark/light theme support.
   - If an admin already exists, the regular login form is shown instead.
     The wizard never appears again once the first admin has been created.

3. Fill in the wizard form:

   - **Administrator name** (display name)
   - **Username** (latin letters, digits, underscore; 3–24 chars)
   - **Email**
   - **Password** (min 8 chars; the wizard shows a live strength meter)
   - **Confirm password**

4. Click **"Создать администратора"** (Create administrator).

5. The backend creates the admin account via `POST /api/auth/setup-admin`
   and returns a JWT. The Studio automatically:
   - Saves the token to the auth store (and the `studio-auth-token`
     cookie, so future page loads work without re-login).
   - Marks the session as authenticated + admin.
   - Opens the Studio dashboard.

   **No second login is required** — the user goes straight from the
   wizard to the dashboard in one click.

### Security model

The `POST /api/auth/setup-admin` endpoint is **publicly accessible** but
protected by these layers:

1. **Precondition**: the endpoint only works when `adminCount === 0`.
   Once any admin exists, it hard-returns `403 Forbidden` (or `409
   Conflict` on a race) forever. No second admin can ever be created
   through this endpoint.
2. **Rate limiting**: the standard auth rate limiter (20 requests / 15
   min / IP) applies.
3. **Transactional create**: the count + create run inside a single
   Prisma transaction, so two concurrent first-time requests cannot both
   create admins (race-condition fix B-HIGH-009).
4. **Uniqueness checks**: email and username must not collide with any
   existing user (admin or non-admin).
5. **Password validation**: the password is validated against the
   `SecuritySettings` table (defaults to min 8 chars on a fresh install;
   configurable from the Studio → Security panel after setup).

### What was removed (vs. v24)

The old flow required the operator to:

- Read `FIRST_RUN_TOKEN` from `mini-services/backend/.env`.
- Run a `curl -X POST` command with the token in the
  `X-Setup-Admin-Token` header.
- Rotate the token after setup.

**All of this is gone.** The `FIRST_RUN_TOKEN` env var is still generated
by `npm run setup` for backward compatibility with any external
automation, but the backend no longer reads it — the setup-admin
endpoint is token-less. You can safely ignore `FIRST_RUN_TOKEN`.

### Operator safety recommendation

Between server boot and the moment you complete the wizard, anyone who
can reach `/api/auth/setup-admin` can become the first admin. This is
the same trust model as every CMS that ships a `/install` endpoint
(WordPress, Drupal, Nextcloud, …). For production deployments:

- Bring the server up behind a private network or reverse proxy.
- Complete the setup wizard immediately.
- Only then expose the server publicly.

If you're deploying on a public IP without a firewall, complete the
wizard within seconds of starting the services — the rate limiter
(20/15min/IP) makes automated races impractical, but a determined
attacker who beats you to it becomes the admin. Use a firewall or
reverse proxy for real production deployments.

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

v25.2 ships a built-in systemd installer that creates all 3 unit files
automatically with your actual paths, Node.js binary, and user. **You no
longer need to write unit files by hand.**

After `npm run build`:

```bash
# Option 1: install services only (assumes build already done)
sudo ./scripts/install-services.sh

# Option 2: build + install in one command
./deploy.sh --install-services
# or
npm run deploy:services
```

The installer:
1. Detects your Node.js path (`which node`, resolved via `readlink -f`)
2. Detects the user to run as (`$SUDO_USER` by default, or `--user USERNAME`)
3. Generates 3 unit files from `scripts/systemd/999pro-*.service` templates
   (with `__ROOT__`, `__BACKEND__`, `__STUDIO__`, `__NODE__`, `__USER__`
   placeholders substituted)
4. Copies them to `/etc/systemd/system/`
5. Runs `systemctl daemon-reload && systemctl enable --now 999pro-*`
6. Health-checks all 3 services (HTTP requests to ports 4000/3000/3001)

The generated unit files include production hardening that the v25.0 manual
instructions didn't have:

- `Restart=on-failure` + `RestartSec=5` (auto-restart on crash, 5s pause)
- `TimeoutStartSec=30` (30s grace period for boot)
- `KillSignal=SIGTERM` + `TimeoutStopSec=15` (graceful shutdown)
- `MemoryMax=1G` / `MemoryHigh=768M` (per-service RAM cap)
- `LimitNOFILE=65536` (high file descriptor limit for many connections)
- `NoNewPrivileges`, `ProtectSystem=full`, `PrivateTmp` (security hardening)
- `StandardOutput=journal` (logs to journald, viewable via `journalctl`)

#### Manual unit file (fallback — only if the installer doesn't work)

If `install-services.sh` fails for some reason, you can write the unit files
by hand. Save this as `/etc/systemd/system/999pro-backend.service`
(replace `your-user` and paths as needed):

```ini
[Unit]
Description=999 PRO Backend (Express + Prisma)
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=your-user
Group=your-user
WorkingDirectory=/home/your-user/999pro/mini-services/backend
EnvironmentFile=/home/your-user/999pro/mini-services/backend/.env
Environment=NODE_ENV=production
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
RestartSec=5
TimeoutStartSec=30
KillSignal=SIGTERM
TimeoutStopSec=15
StandardOutput=journal
StandardError=journal
SyslogIdentifier=999pro-backend

[Install]
WantedBy=multi-user.target
```

Then activate:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now 999pro-backend

# Check status
sudo systemctl status 999pro-backend

# Tail logs
sudo journalctl -u 999pro-backend -f
```

Repeat for frontend (`WorkingDirectory=/home/your-user/999pro`,
`ExecStart=/usr/bin/node .next/standalone/server.js`, `PORT=3000`) and
studio (`WorkingDirectory=/home/your-user/999pro/mini-services/studio`,
`ExecStart=/usr/bin/node .next/standalone/server.js`, `PORT=3001`).
Or just run `sudo ./scripts/install-services.sh` and let it do all 3
automatically.

## 9. Common operations

```bash
# Stop all services (when using `npm run start` foreground)
# → Press Ctrl+C in the terminal where `npm run start` is running

# Stop all services (when using systemd)
npm run services:stop
# or
sudo systemctl stop 999pro-backend 999pro-frontend 999pro-studio

# Restart services (when using systemd)
npm run services:restart
# or
sudo systemctl restart 999pro-backend 999pro-frontend 999pro-studio

# Check status
npm run services:status

# View logs (live follow)
npm run services:logs
# or per-service:
sudo journalctl -u 999pro-backend -f
sudo journalctl -u 999pro-frontend -f
sudo journalctl -u 999pro-studio -f

# Rebuild after code changes
git pull
npm run install:all   # only if package.json changed
npm run build
# If using systemd:
sudo systemctl restart 999pro-backend 999pro-frontend 999pro-studio

# Rotate secrets (WARNING: invalidates all sessions + push subscriptions)
npm run setup -- --force
# If using systemd:
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

### Studio returns 403 on `/studio` for non-HTML requests

The Studio proxy (Next.js 16 edge "proxy" in `mini-services/studio/src/proxy.ts`)
returns 403 for **non-HTML unauthenticated requests** (curl with
`Accept: application/json`, API probes, etc.). This is intentional — it
prevents automated scanners from enumerating the Studio.

**Browser navigation always returns 200** (HTML), so:
- The first-run setup wizard renders when no admin exists.
- The login dialog renders when an admin exists but the visitor isn't
  authenticated.
- The dashboard renders when authenticated.

If `curl -I http://localhost:3001/studio` returns 403, that's because
`curl -I` sends `Accept: */*` (or `HEAD`), which the proxy treats as a
non-HTML probe. Use a browser or add `-H "Accept: text/html"`:

```bash
curl -H "Accept: text/html" http://localhost:3001/studio
# → 200 OK (HTML page renders)
```

### Port already in use

Check what's using the port:

```bash
sudo lsof -i :3000
sudo lsof -i :3001
sudo lsof -i :4000
```

Kill the process or change the port in the relevant `.env` file.

If the port is held by a 999 PRO service you previously started via
`npm run start` (foreground), kill it:

```bash
# Kill any node process listening on our ports
sudo fuser -k -9 3000/tcp 3001/tcp 4000/tcp

# Or kill all node processes (use with caution)
pkill -9 -f "node"
```

If you have systemd services installed, they'll automatically restart after
being killed (that's the point of `Restart=on-failure`). To actually stop
them, use `npm run services:stop` or `sudo systemctl stop 999pro-*`.

### Services stop when I close the terminal (Beget SSH)

This means you're running `npm run start` in **foreground mode**. To make
services persistent (survive SSH disconnect, VPS reboot, auto-restart on
crash), install the systemd services:

```bash
sudo ./scripts/install-services.sh
# or
./deploy.sh --install-services
```

After install, verify they're running as systemd services (not foreground):

```bash
npm run services:status
# Should show: STATE=active, AUTO-START=enabled
```

Now you can safely close the terminal — services keep running.

### Service won't start after install (systemctl status shows "failed")

Check the logs:

```bash
sudo journalctl -u 999pro-backend --no-pager -n 50
sudo journalctl -u 999pro-frontend --no-pager -n 50
sudo journalctl -u 999pro-studio --no-pager -n 50
```

Common causes:

1. **`DATABASE_URL` is the placeholder** — edit
   `mini-services/backend/.env` to point to a real PostgreSQL database,
   then `sudo systemctl restart 999pro-backend`.
2. **Node.js not in the unit file's PATH** — the installer detects Node
   via `which node` and resolves symlinks, but if you installed Node via
   `nvm` and ran the installer as a different user, the path may be wrong.
   Check `ExecStart=` in `/etc/systemd/system/999pro-backend.service` —
   it should be an absolute path like `/usr/bin/node` or
   `/home/user/.nvm/versions/node/v22.x/bin/node`. Re-run the installer
   as the correct user: `sudo -u your-user ./scripts/install-services.sh`.
3. **PostgreSQL not running** — `systemctl status postgresql` should show
   `active`. If not, `sudo systemctl start postgresql`.
4. **Permission denied on `.env`** — the service user must be able to read
   the `.env` files. Check: `sudo -u your-user cat mini-services/backend/.env`.
   If it fails, fix permissions: `chmod 644 mini-services/backend/.env`
   (the file contains secrets — `640` with group set to the service user
   is more secure).

### Services don't auto-start after VPS reboot

Check if the services are enabled:

```bash
systemctl is-enabled 999pro-backend 999pro-frontend 999pro-studio
# Should print: enabled
```

If they show `disabled`, enable them:

```bash
sudo systemctl enable 999pro-backend 999pro-frontend 999pro-studio
```

If they're enabled but didn't start, check the boot-time logs:

```bash
sudo journalctl --boot -u 999pro-backend --no-pager -n 50
```

Common boot-time failures:
- PostgreSQL wasn't up yet (the unit files have `After=postgresql.service`
  + `Wants=postgresql.service`, but if Postgres is slow to start, the
  backend may time out). Fix: increase `TimeoutStartSec` in the unit file.
- The project directory is on a network mount that wasn't mounted at boot
  time. Fix: add `RequiresMountsFor=/home/your-user/999pro` to the
  `[Unit]` section.

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
│   ├── start.js                    # Start all 3 services (foreground, with log prefixes)
│   ├── use-sqlite.js               # Switch Prisma schema to SQLite
│   ├── use-postgres.js             # Switch Prisma schema to PostgreSQL
│   ├── install-services.sh         # v25.2: Install systemd services (persistent startup)
│   ├── uninstall-services.sh       # v25.2: Stop + remove systemd services
│   ├── services-status.sh          # v25.2: Show status of all 3 services
│   ├── services-logs.sh            # v25.2: Tail journald logs
│   ├── systemd/                    # v25.2: systemd unit file templates
│   │   ├── 999pro-backend.service
│   │   ├── 999pro-frontend.service
│   │   └── 999pro-studio.service
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
| `npm run setup` | Generate `.env` files with random secrets (PostgreSQL default) |
| `npm run setup -- --sqlite` | Generate `.env` files with SQLite (local dev) |
| `npm run setup -- --force` | Regenerate all secrets (rotates JWTs, VAPID, etc.) |
| `npm run build` | Build all 3 services |
| `npm run start` | Start all 3 services **in foreground** (stops on terminal close) |
| `./deploy.sh` | One-command deploy: setup + install + build + start (foreground) |
| `./deploy.sh --no-start` | Build only, don't start services |
| `./deploy.sh --sqlite` | Deploy with SQLite (local dev) |
| `./deploy.sh --install-services` | Deploy + install **persistent systemd services** ⭐ |
| `npm run deploy` | Alias for `./deploy.sh` |
| `npm run deploy:services` | Alias for `./deploy.sh --install-services` |
| `sudo npm run services:install` | Install persistent systemd services (auto-start on boot) |
| `sudo npm run services:uninstall` | Stop + remove systemd services (keeps build artifacts) |
| `npm run services:status` | Show status of all 3 services + HTTP health check |
| `npm run services:status:verbose` | Full `systemctl status` output for each service |
| `npm run services:logs` | Tail logs from all 3 services (live) |
| `npm run services:logs:backend` | Tail backend logs only |
| `npm run services:logs:frontend` | Tail frontend logs only |
| `npm run services:logs:studio` | Tail studio logs only |
| `npm run services:restart` | Restart all 3 services |
| `npm run services:stop` | Stop all 3 services |
| `npm run services:start` | Start all 3 services |
| `npm run use-sqlite` | Switch Prisma schema to SQLite (after setup) |
| `npm run use-postgres` | Switch Prisma schema to PostgreSQL (after setup) |
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
- ❌ `FIRST_RUN_TOKEN` requirement for `setup-admin` (v25: token-less, web wizard)
- ❌ All `curl` / `X-Setup-Admin-Token` instructions for first admin creation

Added:

- ✅ `scripts/setup.js` — generates `.env` with strong secrets (Node.js crypto)
- ✅ `scripts/install-all.js` — runs `npm install` in all 3 services
- ✅ `scripts/build.js` — orchestrates the 3 builds in correct order
- ✅ `scripts/start.js` — starts all 3 services with prefixed logs
- ✅ `scripts/use-sqlite.js` / `scripts/use-postgres.js` — swap Prisma schema provider
- ✅ `deploy.sh` — one-command deploy (setup + install + build + start + health check)
- ✅ `.npmrc` — configures npm to allow install-scripts (sharp, argon2, prisma)
- ✅ `turbopack.root` in both `next.config.ts` files — ensures flat standalone output
- ✅ This README with full deployment guide

### v25.1 additions

- ✅ PostgreSQL as the default database provider (was SQLite)
- ✅ Prisma connection pool config (`connection_limit=10&pool_timeout=10`)
- ✅ Production composite indexes on User, Message tables
- ✅ PostgreSQL baseline migration (`prisma/migrations/0_postgres_baseline/`)
- ✅ `lib/prisma.ts` auto-detects provider (Postgres vs SQLite) and applies
  SQLite pragmas only when needed
- ✅ `deploy.sh` with 9-step automated deploy + health check
- ✅ `npm run deploy` / `npm run deploy:sqlite` / `npm run deploy:build-only`
- ✅ `npm run use-sqlite` / `npm run use-postgres` schema swap commands
- ✅ Web-based first-run setup wizard (no curl, no tokens, no terminal)

### v25.2 additions

- ✅ **systemd integration** — services now run as persistent system processes
- ✅ `scripts/install-services.sh` — one-command systemd service installer
  (generates unit files from templates, enables + starts, health-checks)
- ✅ `scripts/uninstall-services.sh` — stops + removes services (keeps build)
- ✅ `scripts/services-status.sh` — compact status table + HTTP health checks
- ✅ `scripts/services-logs.sh` — tail journald logs (all or per-service)
- ✅ `scripts/systemd/999pro-{backend,frontend,studio}.service` — unit file
  templates with production hardening (Restart=on-failure, MemoryMax,
  LimitNOFILE, NoNewPrivileges, ProtectSystem, etc.)
- ✅ `deploy.sh --install-services` — build + install persistent services
- ✅ `npm run deploy:services` — alias for the above
- ✅ `npm run services:install` / `services:uninstall` / `services:status`
  / `services:logs` / `services:restart` / `services:stop` / `services:start`
- ✅ Services survive terminal/SSH disconnect (systemd-managed)
- ✅ Services auto-start on VPS boot (`systemctl enable`)
- ✅ Services auto-restart on crash (5s pause, no rapid loops)
- ✅ Graceful shutdown (SIGTERM → 15s → SIGKILL)
- ✅ Resource limits (1GB RAM per service, 65k file descriptors)
- ✅ Security hardening (NoNewPrivileges, ProtectSystem, PrivateTmp)

## 16. Environment variables reference

### Backend (`mini-services/backend/.env`)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NODE_ENV` | yes | `production` | Runtime environment |
| `PORT` | no | `4000` | Backend listen port |
| `DATABASE_URL` | yes | `postgresql://USER:PASSWORD@localhost:5432/999pro?...` | **v25.2: PostgreSQL is the ONLY production provider.** Format: `postgresql://user:pass@host:5432/db?schema=public&connection_limit=10&pool_timeout=10`. SQLite is NOT supported in production (see `scripts/use-sqlite.js` for local-dev-only). |
| `CLIENT_ORIGIN` | yes | `http://localhost:3000,...` | CORS allowed origins (comma-sep) |
| `TRUST_PROXY` | no | `false` | Set `true` behind Nginx/Caddy |
| `JWT_SECRET` | **yes** | — | JWT signing secret (min 32 chars) |
| `JWT_EXPIRES_IN` | no | `7d` | JWT TTL |
| `FIRST_RUN_TOKEN` | no | — | **Deprecated in v25.** No longer read by the backend. The setup-admin endpoint is now token-less and gated only by "no admin exists yet". The var is still generated by `npm run setup` for backward compatibility; you can leave it empty. |
| `RESET_ADMIN_TOKEN` | **yes** | — | Admin reset token (used by /reset-admin endpoint) |
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
