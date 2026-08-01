# 999 PRO — Production Deployment Guide

This document describes how to deploy 999 PRO to a production server with
monitoring, backups, and TURN server for WebRTC.

## Architecture

```
                    ┌──────────────────┐
                    │   Cloudflare     │  ← DDoS protection, CDN
                    │   (DNS + CDN)    │
                    └────────┬─────────┘
                             │
                    ┌────────▼─────────┐
                    │     Caddy        │  ← HTTPS termination, reverse proxy
                    │   :443 → :3000   │
                    │   :443 → :4000   │  (via /api/*, /socket.io/*, /uploads/*)
                    └────────┬─────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
        ┌─────▼─────┐  ┌─────▼─────┐  ┌─────▼─────┐
        │ Frontend  │  │  Backend  │  │  Studio   │
        │ Next.js   │  │ Express + │  │ Next.js   │
        │ :3000     │  │ Prisma +  │  │ :3001     │
        │           │  │ Socket.IO │  │           │
        └───────────┘  │ :4000     │  └───────────┘
                       └─────┬─────┘
                             │
                    ┌────────▼─────────┐
                    │  PostgreSQL 16   │  ← production DB (SQLite for dev only)
                    │   + daily backup │
                    └──────────────────┘

                    ┌──────────────────┐
                    │   Coturn TURN    │  ← WebRTC relay (separate server)
                    │   :3478, :5349   │
                    └──────────────────┘

                    ┌──────────────────┐
                    │   Sentry         │  ← Error tracking (SaaS)
                    │   (optional)     │
                    └──────────────────┘
```

## 1. Server Setup

### 1.1 Install system packages

```bash
# Ubuntu 22.04+ / Debian 12+
sudo apt update
sudo apt install -y curl ca-certificates gnupg sqlite3 cron

# Install Bun (faster than Node for our stack)
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc

# Install Caddy (reverse proxy + auto-HTTPS)
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install caddy

# Install Coturn (WebRTC TURN server) — can be on same host or separate
sudo apt install coturn
```

### 1.2 Clone the repository

```bash
sudo mkdir -p /opt/999pro
sudo chown $USER:$USER /opt/999pro
cd /opt/999pro
git clone <your-repo-url> .

# Install dependencies for all 3 services
bun install
cd mini-services/backend && bun install && cd ../..
cd mini-services/studio && bun install && cd ../..
```

### 1.3 Configure secrets

```bash
# Generate fresh secrets — DO NOT reuse dev values
NODE_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")
RESET_TOKEN=$(openssl rand -hex 24)
VAPID_KEYS=$(bunx web-push generate-vapid-keys)
# (copy the public + private keys from the output)

cat > /opt/999pro/mini-services/backend/.env <<EOF
DATABASE_URL=postgresql://ninepro:your-strong-password@localhost:5432/ninepro?schema=public&connection_limit=10&pool_timeout=10
PORT=4000
NODE_ENV=production
CLIENT_ORIGIN=https://999.pro,https://studio.999.pro

JWT_SECRET=$NODE_SECRET
JWT_EXPIRES_IN=7d
BCRYPT_ROUNDS=12

VAPID_PUBLIC_KEY=<from output above>
VAPID_PRIVATE_KEY=<from output above>
VAPID_SUBJECT=mailto:admin@999.pro

RESET_ADMIN_TOKEN=$RESET_TOKEN

TURN_URL=turn:turn.999.pro:3478
TURN_USERNAME=999pro
# v24.6-audit fix: was TURN_PASSWORD, but the backend reads TURN_CREDENTIAL
# (see mini-services/backend/src/routes/calls.ts). Mismatched env var name
# meant TURN never worked in production.
TURN_CREDENTIAL=<strong-password-from-coturn.conf>

SENTRY_DSN=<from sentry.io>
EOF

chmod 600 /opt/999pro/mini-services/backend/.env
```

### 1.4 Configure the database

```bash
cd /opt/999pro/mini-services/backend
bunx prisma migrate deploy    # apply all migrations (no data loss)
bunx prisma generate
bunx prisma db seed           # optional: seed with demo data
```

### 1.5 Configure Caddy

```bash
sudo tee /etc/caddy/Caddyfile <<'EOF'
999.pro, www.999.pro {
    encode gzip zstd

    # Socket.IO — must NOT be cached, must support websockets
    @socketio path /socket.io/*
    reverse_proxy @socketio localhost:4000 {
        header_up Host {host}
    }

    # API — no cache
    @api path /api/*
    reverse_proxy @api localhost:4000 {
        header_up Host {host}
    }

    # Uploaded files — long cache
    @uploads path /uploads/*
    reverse_proxy @uploads localhost:4000 {
        header_up Host {host}
    }

    # Studio — separate Next.js app
    @studio path /studio /studio/*
    reverse_proxy @studio localhost:3001 {
        header_up Host {host}
    }

    # Everything else — frontend Next.js
    reverse_proxy localhost:3000 {
        header_up Host {host}
    }

    log {
        output file /var/log/caddy/999pro.log
        format json
    }
}

# Optional: separate domain for Studio
studio.999.pro {
    encode gzip zstd
    reverse_proxy localhost:3001
}
EOF

sudo systemctl reload caddy
```

### 1.6 Configure Coturn (TURN server for WebRTC)

```bash
sudo cp /opt/999pro/deploy/coturn.conf /etc/turnserver.conf
# Edit /etc/turnserver.conf: set user=999pro:<strong-password>,
# set realm=999.pro, uncomment cert/pkey paths (use Let's Encrypt certs)

# Open firewall ports
sudo ufw allow 3478/tcp
sudo ufw allow 3478/udp
sudo ufw allow 5349/tcp
sudo ufw allow 5349/udp
sudo ufw allow 49152:65535/udp

sudo systemctl enable coturn
sudo systemctl start coturn
```

### 1.7 Configure daily backups

```bash
cd /opt/999pro
bash scripts/setup-cron.sh
# This installs a cron entry that runs scripts/backup-db.sh daily at 03:00
```

For offsite backups, uncomment the S3 section in `scripts/backup-db.sh`
and configure AWS credentials.

### 1.8 Run as systemd services

Create three systemd units:

```bash
# /etc/systemd/system/999pro-backend.service
sudo tee /etc/systemd/system/999pro-backend.service <<'EOF'
[Unit]
Description=999 PRO Backend (Express + Prisma + Socket.IO)
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/999pro/mini-services/backend
ExecStart=/home/www-data/.bun/bin/bunx tsx src/index.ts
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

# /etc/systemd/system/999pro-frontend.service
sudo tee /etc/systemd/system/999pro-frontend.service <<'EOF'
[Unit]
Description=999 PRO Frontend (Next.js)
After=network.target 999pro-backend.service

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/999pro
ExecStart=/home/www-data/.bun/bin/bun .next/standalone/server.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=HOSTNAME=127.0.0.1

[Install]
WantedBy=multi-user.target
EOF

# /etc/systemd/system/999pro-studio.service
sudo tee /etc/systemd/system/999pro-studio.service <<'EOF'
[Unit]
Description=999 PRO Studio (Next.js)
After=network.target 999pro-backend.service

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/999pro/mini-services/studio
ExecStart=/home/www-data/.bun/bin/bun .next/standalone/server.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=3001
Environment=HOSTNAME=127.0.0.1

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now 999pro-backend 999pro-frontend 999pro-studio
```

### 1.9 Build for production

```bash
cd /opt/999pro
bun run build

cd mini-services/studio
bun run build
```

## 2. Monitoring

### 2.1 Health endpoints

- `GET /api/health` — liveness (process up)
- `GET /api/ready` — readiness (DB reachable)
- `GET /api/health/detailed` — full status (uptime, memory, DB latency, socket count)

Use these with your uptime monitor (UptimeRobot, Pingdom, BetterUptime):

```
https://999.pro/api/health        → expect 200 + {"ok": true}
https://999.pro/api/ready         → expect 200 + {"ok": true}
https://999.pro/api/health/detailed → expect 200, db.ok === true, latencyMs < 100
```

### 2.2 Sentry (error tracking)

1. Create a project at https://sentry.io (free tier: 5000 errors/month)
2. Get the DSN from Settings → Projects → 999 PRO → Client Keys
3. Add `SENTRY_DSN=<your-dsn>` to `mini-services/backend/.env`
4. Restart backend: `sudo systemctl restart 999pro-backend`

The structured logger (`mini-services/backend/src/lib/logger.ts`) automatically
forwards error-level logs to Sentry when SENTRY_DSN is set.

For frontend error tracking, install `@sentry/nextjs` and configure in
`next.config.ts` + `sentry.client.config.ts`.

### 2.3 Log aggregation

The structured logger outputs JSON lines to stdout/stderr. To ship them to
a log aggregator:

**Datadog / Logtail / Loggly**:
```bash
# Install the agent, configure it to tail /var/log/999pro/*.log
# (configure systemd to redirect stdout to log files)
```

**Loki + Promtail**:
```yaml
# /etc/promtail/config.yml
positions:
  filename: /tmp/positions.yaml
clients:
  - url: http://loki:3100/loki/api/v1/push
scrape_configs:
  - job_name: 999pro-backend
    static_configs:
      - targets: [localhost]
        labels:
          job: 999pro-backend
          __path__: /var/log/999pro/backend.log
```

### 2.4 Uptime monitoring checklist

| Check | URL | Expected | Alert if |
|-------|-----|----------|----------|
| Liveness | /api/health | 200, ok:true | 3 consecutive failures |
| Readiness | /api/ready | 200, ok:true | 1 failure (DB down = critical) |
| Frontend | https://999.pro/ | 200 | 3 consecutive failures |
| Studio | https://999.pro/studio/ | 200 | 3 consecutive failures |
| DB latency | /api/health/detailed | db.latencyMs < 100 | > 500ms |
| Memory | /api/health/detailed | rssMb < 1024 | > 2048 |
| SSL cert | https://999.pro | valid > 14 days | < 7 days |
| Disk usage | df -h | < 80% | > 90% |

## 3. Backups

### 3.1 Database (SQLite)

Daily backup runs at 03:00 via cron (`scripts/setup-cron.sh`):
- SQLite online backup (non-blocking)
- gzip compressed
- Stored in `mini-services/backend/db/backups/`
- Retention: 30 days

**Restore**:
```bash
bash scripts/restore-db.sh latest   # restore most recent backup
bash scripts/restore-db.sh <file>   # restore specific file
```

### 3.2 Uploaded files

The `mini-services/backend/uploads/` directory contains user-uploaded media.
Back it up daily:

```bash
# Add to crontab:
0 4 * * * rsync -a /opt/999pro/mini-services/backend/uploads/ /backup/uploads/
```

For S3 sync:
```bash
0 4 * * * aws s3 sync /opt/999pro/mini-services/backend/uploads/ s3://999pro-uploads/ --delete
```

### 3.3 Offsite DB backups (recommended)

Uncomment the S3 section in `scripts/backup-db.sh` and configure:

```bash
export AWS_ACCESS_KEY_ID=...
export AWS_SECRET_ACCESS_KEY=...
export S3_BACKUP_BUCKET=999pro-db-backups
```

## 4. Scaling considerations

### 4.1 When single PostgreSQL instance is no longer enough

> **v25.2**: PostgreSQL is the ONLY production database provider. The
> "migrate from SQLite to PostgreSQL" path documented in earlier versions
> no longer applies — the project ships PostgreSQL-only since v25.2.

Symptoms that you've outgrown a single Postgres instance:
- DB latency > 200ms on /api/health/detailed
- > 50 concurrent users actively chatting
- Connection pool saturation (Prisma P2024 "Timed out fetching a connection")

Scaling path:
1. Add PgBouncer in front of PostgreSQL (connection pooling at the DB level)
2. Increase `connection_limit` in DATABASE_URL (e.g. from 10 to 20-30)
3. Provision a larger PostgreSQL instance (RDS, DigitalOcean Managed DB)
4. Add read replicas for analytics queries (routes/analytics.ts)
5. Consider partitioning the audit log table (it grows fastest)

### 4.2 When local uploads are no longer enough

Symptoms:
- Disk usage > 80%
- Need for CDN
- Multiple backend instances

Migration path:
1. Provision S3 bucket (or MinIO for self-hosted)
2. Install `@aws-sdk/client-s3` in backend
3. Replace `saveFile()` in `routes/upload.ts` to upload to S3 instead of local disk
4. Update `assetUrl()` in `src/lib/api.ts` to return S3 URLs
5. Migrate existing uploads: `aws s3 sync uploads/ s3://999pro-uploads/`

### 4.3 When single backend is no longer enough

Symptoms:
- CPU > 80% sustained
- Socket.IO connections > 10,000

Migration path:
1. Run 2+ backend instances behind a load balancer
2. Use Redis adapter for Socket.IO (so messages broadcast across instances)
3. Use sticky sessions for WebRTC signaling (call:signal events must reach
   the same instance that has the recipient's socket)

## 5. Security checklist

- [ ] `.env` files are NOT in git (`git status` should show no .env changes)
- [ ] `JWT_SECRET` is a fresh random 48+ char string (not the dev default)
- [ ] `VAPID_PRIVATE_KEY` is fresh (not the dev default)
- [ ] `RESET_ADMIN_TOKEN` is fresh
- [ ] HTTPS is enforced (Caddy redirects HTTP → HTTPS)
- [ ] CORS allowlist is explicit (`CLIENT_ORIGIN=https://999.pro,https://studio.999.pro`)
- [ ] `NODE_ENV=production` (enables strict CSP, disables dev logs)
- [ ] Coturn password is strong (32+ random chars)
- [ ] Firewall allows only 80, 443, 3478, 5349, 49152-65535/udp
- [ ] SSH login requires key (no password)
- [ ] Daily DB backups running (verify with `crontab -l`)
- [ ] Sentry DSN configured (verify by triggering a test error)
- [ ] Uptime monitor configured for /api/health and /api/ready

## 6. Post-deploy verification

After deploy, run through this checklist:

```bash
# 1. All services running
sudo systemctl status 999pro-backend 999pro-frontend 999pro-studio

# 2. Health checks
curl https://999.pro/api/health
curl https://999.pro/api/ready
curl https://999.pro/api/health/detailed | jq

# 3. Frontend loads
curl -sI https://999.pro/ | head -3

# 4. Studio loads
curl -sI https://999.pro/studio/ | head -3

# 5. WebSocket upgrade works (should return 101 Switching Protocols)
curl -sI -H "Connection: Upgrade" -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: test" \
  https://999.pro/socket.io/?EIO=4&transport=websocket

# 6. PWA manifest is reachable
curl -sI https://999.pro/manifest.webmanifest

# 7. Service worker is reachable
curl -sI https://999.pro/sw.js

# 8. ICE config endpoint works
curl https://999.pro/api/calls/ice-servers | jq

# 9. Push VAPID public key
curl https://999.pro/api/push/vapid-public | jq

# 10. Create first admin
# Open https://999.pro/studio/ — first-run wizard appears
# Create admin account with strong password
```

## 7. Rollback

If a deploy breaks production:

```bash
# 1. Stop services
sudo systemctl stop 999pro-frontend 999pro-studio 999pro-backend

# 2. Roll back the code
cd /opt/999pro
git log --oneline -5           # find the last good commit
git checkout <last-good-commit>

# 3. Roll back the DB if a migration broke things
cd mini-services/backend
bunx prisma migrate resolve --rolled-back <bad-migration-name>
bash /opt/999pro/scripts/restore-db.sh latest

# 4. Rebuild
cd /opt/999pro && bun run build
cd mini-services/studio && bun run build

# 5. Restart
sudo systemctl start 999pro-backend 999pro-frontend 999pro-studio
```

## 8. Updating

To deploy a new version:

```bash
cd /opt/999pro
git pull origin main

# Apply migrations (no data loss with prisma migrate deploy)
cd mini-services/backend
bunx prisma migrate deploy
bunx prisma generate

# Rebuild frontend + studio
cd /opt/999pro && bun run build
cd mini-services/studio && bun run build

# Restart services (zero downtime if behind load balancer)
sudo systemctl restart 999pro-backend 999pro-frontend 999pro-studio
```
