# 999 PRO — Production Deployment Guide

> **v25.0-audit-fix** — fully working Docker deployment with Bun-based builds,
> auto-generated secrets, and Postgres-compatible migrations.

This guide covers deploying 999 PRO on a clean Ubuntu Server 22.04+ using
Docker Compose. After following this guide, you will have:

- Frontend (Next.js) on `https://YOUR_DOMAIN`
- Studio (admin panel) on `https://studio.YOUR_DOMAIN` and `https://YOUR_DOMAIN/studio`
- Backend API (Express) on `https://YOUR_DOMAIN/api/*`
- PostgreSQL 16 (internal, port 5432 not exposed)
- Caddy reverse proxy with automatic Let's Encrypt TLS

## 1. Prerequisites

- **Ubuntu Server 22.04+** (or any Linux with Docker support)
- **2 GB RAM minimum** (4 GB recommended for build)
- **20 GB disk** minimum
- **Domain name** with DNS A records pointing to your server's public IP:
  - `YOUR_DOMAIN` → server IP
  - `studio.YOUR_DOMAIN` → server IP (optional, /studio proxy also works)
- **Ports 80 and 443** open in your firewall (for Caddy / Let's Encrypt)

## 2. Install Docker

```bash
# Official Docker install script
curl -fsSL https://get.docker.com | sh

# Add your user to the docker group (optional, lets you run docker without sudo)
sudo usermod -aG docker $USER
newgrp docker

# Verify
docker --version
docker compose version
```

## 3. Get the project on the server

```bash
# Clone or upload the project
git clone <your-repo-url> 999pro
cd 999pro

# OR upload the zip and extract
unzip 999pro-v25.zip
cd 999pro
```

## 4. Generate secrets (ONE command)

```bash
./generate-env.sh --domain YOUR_DOMAIN
```

This will:

1. Generate cryptographically-strong secrets for `JWT_SECRET`,
   `FIRST_RUN_TOKEN`, `RESET_ADMIN_TOKEN`, `IP_HASH_PEPPER`,
   `POSTGRES_PASSWORD`, and a P-256 VAPID keypair.
2. Write `.env.prod` (with all required env vars and the generated secrets).
3. Write `secrets/postgres_password.txt` (Docker file-based secret for Postgres).

**Edit `.env.prod` and fill in the remaining values:**

```bash
nano .env.prod
```

Required if email verification is on (default):

- `SMTP_HOST` — your SMTP server (e.g. `smtp.yandex.ru`)
- `SMTP_PORT` — usually `587` (STARTTLS) or `465` (implicit TLS)
- `SMTP_USER` — SMTP username
- `SMTP_PASS` — SMTP password
- `SMTP_FROM` — sender email (e.g. `no-reply@YOUR_DOMAIN`)

Optional:

- `NEXT_PUBLIC_YANDEX_MAPS_API_KEY` — required for delivery map on non-localhost
- `APPLE_TEAM_ID`, `ANDROID_SHA256_FINGERPRINT` — for native app deep links
- `DEEPSEEK_API_KEY` — for AI assistant (also configurable via Studio)

## 5. Build & start

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

This builds three images (frontend, backend, studio) and starts five containers
(postgres, backend, frontend, studio, caddy). First build takes ~5–10 minutes
(depending on server resources); subsequent builds use cache and are faster.

## 6. Verify deployment

```bash
# Check container status (all should be "healthy" or "Up")
docker compose -f docker-compose.prod.yml ps

# Tail backend logs
docker compose -f docker-compose.prod.yml logs -f backend

# Tail all logs
docker compose -f docker-compose.prod.yml logs -f
```

If all services are healthy, open `https://YOUR_DOMAIN` in your browser — you
should see the 999 PRO frontend.

## 7. Create the first admin

After the backend is healthy, create the first admin account using the
`FIRST_RUN_TOKEN` from your `.env.prod`:

```bash
FIRST_RUN_TOKEN=$(grep FIRST_RUN_TOKEN .env.prod | cut -d= -f2)

curl -X POST https://YOUR_DOMAIN/api/auth/first-run \
  -H "Content-Type: application/json" \
  -H "X-Setup-Admin-Token: $FIRST_RUN_TOKEN" \
  -d '{
    "username": "admin",
    "email": "admin@YOUR_DOMAIN",
    "password": "YOUR_STRONG_ADMIN_PASSWORD"
  }'
```

Then log in to the admin panel at `https://YOUR_DOMAIN/studio` (or
`https://studio.YOUR_DOMAIN`) with the credentials you just set.

**After creating the first admin, rotate `FIRST_RUN_TOKEN`** in `.env.prod`
and restart the backend (`docker compose ... restart backend`) — this
prevents anyone else from using the first-run endpoint.

## 8. Common operations

```bash
# Stop all services
docker compose -f docker-compose.prod.yml --env-file .env.prod down

# Stop and delete volumes (⚠️ destroys all data)
docker compose -f docker-compose.prod.yml --env-file .env.prod down -v

# Rebuild after code changes
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build

# Pull logs for one service
docker compose -f docker-compose.prod.yml logs -f backend
docker compose -f docker-compose.prod.yml logs -f frontend
docker compose -f docker-compose.prod.yml logs -f studio

# Restart a single service
docker compose -f docker-compose.prod.yml --env-file .env.prod restart backend

# Run a shell inside a running container
docker compose -f docker-compose.prod.yml exec backend sh
docker compose -f docker-compose.prod.yml exec postgres psql -U postgres pro999
```

## 9. Backup & restore

### Backup Postgres

```bash
docker compose -f docker-compose.prod.yml exec postgres \
  pg_dump -U postgres pro999 > backup-$(date +%Y%m%d).sql
```

### Restore Postgres

```bash
cat backup-YYYYMMDD.sql | docker compose -f docker-compose.prod.yml exec -T postgres \
  psql -U postgres pro999
```

### Backup user uploads

```bash
docker compose -f docker-compose.prod.yml cp backend:/app/uploads ./uploads-backup
```

## 10. Troubleshooting

### Build fails on `bun install --frozen-lockfile`

The `bun.lock` file is out of sync with `package.json`. Fix:

```bash
# Run locally (NOT on the server) to regenerate the lockfile
cd <service-with-drift>
bun install
git add bun.lock
git commit -m "chore: refresh bun.lock"
git push

# On the server, pull and rebuild
git pull
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

### Backend fails to start with "FATAL: JWT_SECRET is a known leaked demo value"

The JWT_SECRET in `.env.prod` matches one of the known leaked demo secrets.
Regenerate it:

```bash
JWT_SECRET=$(openssl rand -hex 48)
sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$JWT_SECRET|" .env.prod
docker compose -f docker-compose.prod.yml --env-file .env.prod restart backend
```

### Backend fails to start with "FATAL: JWT_SECRET environment variable is required"

You forgot to pass `--env-file .env.prod` to `docker compose`. Always include it:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod <command>
```

### Caddy can't get a TLS certificate

1. Make sure DNS A records for `YOUR_DOMAIN` AND `studio.YOUR_DOMAIN` point to
   your server's public IP.
2. Make sure ports 80 and 443 are open in your firewall.
3. Check Caddy logs: `docker compose -f docker-compose.prod.yml logs caddy`

### Prisma migration fails

The backend's CMD runs `prisma migrate deploy` before starting the server. If
it fails, check the backend logs:

```bash
docker compose -f docker-compose.prod.yml logs backend | tail -50
```

Common causes:
- Postgres not ready yet (wait 30s, backend will retry)
- Wrong `BACKEND_DATABASE_URL` (should be auto-assembled from the secret —
  check that `secrets/postgres_password.txt` exists and is non-empty)
- Postgres version mismatch (we use `postgres:16-alpine` — make sure your
  volume wasn't created with an older version; if so, delete the volume with
  `docker compose ... down -v` and start fresh)

### Frontend shows blank page

1. Check browser console for errors
2. Check frontend logs: `docker compose ... logs frontend`
3. Make sure `BACKEND_URL=http://backend:4000` is set (compose does this)
4. If using a CDN/Cloudflare in front of Caddy, make sure it doesn't block
   WebSockets (needed for chat)

## 11. Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                       Host (Ubuntu Server)                    │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │                Docker network: 999pro-net               │ │
│  │                                                         │ │
│  │  ┌─────────┐    ┌─────────┐    ┌─────────┐             │ │
│  │  │ Caddy   │───▶│ Frontend│    │ Studio  │             │ │
│  │  │ :80/:443│    │ :3000   │    │ :3001   │             │ │
│  │  └─────────┘    └─────────┘    └─────────┘             │ │
│  │       │              │              │                   │ │
│  │       │              ▼              ▼                   │ │
│  │       │         ┌─────────────────────┐                │ │
│  │       └────────▶│   Backend :4000     │                │ │
│  │                 │  (Express+Prisma)   │                │ │
│  │                 └─────────┬───────────┘                │ │
│  │                           │                            │ │
│  │                           ▼                            │ │
│  │                 ┌─────────────────────┐                │ │
│  │                 │  PostgreSQL :5432   │                │ │
│  │                 │   (postgres:16)     │                │ │
│  │                 └─────────────────────┘                │ │
│  └─────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

- **Caddy** terminates TLS (auto Let's Encrypt) and reverse-proxies to
  frontend / studio / backend based on the path.
- **Frontend** (Next.js 16 standalone) serves the user-facing app on `:3000`.
- **Studio** (Next.js 16 standalone, `basePath: /studio`) serves the admin
  panel on `:3001`. Mounted at `/studio` on the main domain via Caddy.
- **Backend** (Express 4 + Prisma 6 + Socket.IO) serves the API on `:4000`.
  Reads the Postgres password from `/run/secrets/postgres_password` (Docker
  file-based secret — not visible in `docker inspect`).
- **PostgreSQL** stores all data in a named volume `postgres-data`.

## 12. Project structure

```
999pro/
├── Dockerfile                      # Frontend (Next.js) Dockerfile
├── docker-compose.prod.yml         # Production compose (5 services)
├── Caddyfile.prod                  # Caddy reverse proxy config
├── generate-env.sh                 # One-command secrets + .env.prod generator
├── .env.example                    # Frontend env template (for local dev)
├── bun.lock                        # Bun lockfile (root workspace)
├── package.json                    # Frontend package.json (workspace root)
├── next.config.ts                  # Next.js config (standalone output)
├── tsconfig.json
├── tailwind.config.ts
├── postcss.config.mjs
├── src/                            # Frontend source (Next.js app router)
├── public/                         # Frontend static assets (PWA icons, sw.js)
├── packages/
│   └── shared/                     # @999pro/shared (shared TS types)
├── mini-services/
│   ├── backend/                    # Express API
│   │   ├── Dockerfile              # Backend Dockerfile (Bun + tsc)
│   │   ├── package.json
│   │   ├── bun.lock
│   │   ├── tsconfig.json
│   │   ├── prisma/
│   │   │   ├── schema.prisma             # SQLite (dev)
│   │   │   ├── schema.postgres.prisma    # PostgreSQL (prod)
│   │   │   └── migrations/               # SQLite migrations (dev only;
│   │   │                                  # Dockerfile replaces with a
│   │   │                                  # Postgres baseline at build time)
│   │   └── src/                    # Backend source (Express routes, lib)
│   └── studio/                     # Admin panel (Next.js)
│       ├── Dockerfile              # Studio Dockerfile (root context for
│       │                           #   @999pro/shared access)
│       ├── package.json
│       ├── bun.lock
│       ├── next.config.ts          # basePath: /studio, standalone output
│       ├── tsconfig.json
│       └── src/                    # Studio source
└── secrets/                        # Docker file-based secrets (gitignored)
    └── postgres_password.txt       # Generated by ./generate-env.sh
```
