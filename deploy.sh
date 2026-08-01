#!/usr/bin/env bash
# ============================================================================
# 999 PRO — deploy.sh
# ----------------------------------------------------------------------------
# One-command deployment script for the 999 PRO project (no Docker).
#
# Performs a full production deploy:
#   1. Checks Node.js version (>= 20)
#   2. Checks / generates .env files (via scripts/setup.js)
#   3. Installs dependencies in root + backend + studio
#   4. Runs Prisma migrations (db push for SQLite, migrate deploy for Postgres)
#   5. Generates Prisma client
#   6. Builds backend (tsc) → dist/index.js
#   7. Builds frontend (next build) → .next/standalone/server.js
#   8. Builds studio (next build) → .next/standalone/server.js
#   9. Starts all three services and verifies the API responds
#  10. Prints a summary with the URL of the first-run setup wizard
#
# Usage:
#   ./deploy.sh              # full deploy + start
#   ./deploy.sh --no-start   # build only, don't start services
#   ./deploy.sh --sqlite     # use SQLite instead of PostgreSQL
#
# The script is idempotent — it's safe to re-run. Existing .env files are
# preserved (use `npm run setup -- --force` to regenerate secrets).
#
# EXIT CODES:
#   0 — success
#   1 — generic failure (see error message)
#   2 — Node.js version too old
#   3 — .env files missing and could not be generated
#   4 — dependency installation failed
#   5 — Prisma migration failed
#   6 — build failed
#   7 — service start failed or API didn't respond
# ============================================================================

set -euo pipefail

# ---------- colours ----------
RED=$'\033[31m'
GREEN=$'\033[32m'
YELLOW=$'\033[33m'
CYAN=$'\033[36m'
BOLD=$'\033[1m'
DIM=$'\033[2m'
RESET=$'\033[0m'

log()   { echo "${BOLD}${CYAN}▶ $1${RESET}"; }
ok()    { echo "  ${GREEN}✓${RESET} $1"; }
warn()  { echo "  ${YELLOW}⚠${RESET} $1"; }
err()   { echo "  ${RED}✗${RESET} $1" >&2; }
step()  { echo ""; log "$1"; echo "${DIM}$(printf '─%.0s' {1..78})${RESET}"; }

# ---------- args ----------
NO_START=false
USE_SQLITE=false
INSTALL_SERVICES=false
for arg in "$@"; do
  case "$arg" in
    --no-start) NO_START=true ;;
    --sqlite)   USE_SQLITE=true ;;
    --install-services) INSTALL_SERVICES=true ;;
    --services) INSTALL_SERVICES=true ;;  # alias
    --help|-h)
      echo "Usage: ./deploy.sh [--no-start] [--sqlite] [--install-services]"
      echo ""
      echo "  --no-start           Build only, don't start services"
      echo "  --sqlite             Use SQLite instead of PostgreSQL (local dev)"
      echo "  --install-services   Install systemd units for persistent startup"
      echo "                       (auto-start on boot, auto-restart on crash,"
      echo "                       survives terminal/SSH disconnect)"
      exit 0
      ;;
    *)
      err "Unknown argument: $arg"
      exit 1
      ;;
  esac
done

# ---------- locate project root ----------
# deploy.sh lives at the project root (alongside package.json, scripts/, etc.),
# so ROOT is the same directory as SCRIPT_DIR.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$SCRIPT_DIR"
cd "$ROOT"

echo ""
echo "${BOLD}╔══════════════════════════════════════════════════════════════════════════╗${RESET}"
echo "${BOLD}║  999 PRO — Deployment                                                    ║${RESET}"
echo "${BOLD}║  No Docker · Node.js only · PostgreSQL (default) / SQLite (dev)         ║${RESET}"
if [ "$INSTALL_SERVICES" = true ]; then
  echo "${BOLD}║  + systemd persistent services (auto-start on boot, auto-restart)       ║${RESET}"
fi
echo "${BOLD}╚══════════════════════════════════════════════════════════════════════════╝${RESET}"
echo ""

# ---------- 1. Node.js version check ----------
step "1/9  Checking Node.js"
if ! command -v node >/dev/null 2>&1; then
  err "Node.js is not installed. Install Node.js 20+ from https://nodejs.org/"
  err "On Ubuntu: curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs"
  exit 2
fi
NODE_VERSION=$(node -p "process.versions.node.split('.')[0]")
if [ "$NODE_VERSION" -lt 20 ]; then
  err "Node.js $NODE_VERSION is too old. Install Node.js 20+ (LTS recommended)."
  exit 2
fi
ok "Node.js $(node -v) (PID $$)"

if ! command -v npm >/dev/null 2>&1; then
  err "npm is not installed (should ship with Node.js)."
  exit 2
fi
ok "npm $(npm -v)"

# ---------- 2. .env files ----------
step "2/9  Checking .env files"
SETUP_ARGS=""
if [ "$USE_SQLITE" = true ]; then
  SETUP_ARGS="--sqlite"
  warn "SQLite mode requested — NOT recommended for production."
fi
if [ ! -f "$ROOT/.env" ] || [ ! -f "$ROOT/mini-services/backend/.env" ] || [ ! -f "$ROOT/mini-services/studio/.env" ]; then
  warn "Some .env files missing — running setup.js…"
  if ! node "$ROOT/scripts/setup.js" $SETUP_ARGS; then
    err "setup.js failed."
    exit 3
  fi
else
  ok "All .env files present."
fi

# Re-swap the schema provider if --sqlite was passed but .env already exists.
if [ "$USE_SQLITE" = true ]; then
  if [ ! -f "$ROOT/mini-services/backend/prisma/schema.sqlite.prisma" ]; then
    warn "SQLite template not found — running setup.js to bootstrap."
    node "$ROOT/scripts/setup.js" --sqlite || true
  else
    node "$ROOT/scripts/use-sqlite.js"
  fi
fi

# Check whether BACKEND_DATABASE_URL is still the placeholder (PostgreSQL).
DB_URL=$(grep '^BACKEND_DATABASE_URL=' "$ROOT/mini-services/backend/.env" | cut -d= -f2- | tr -d '"' || true)
if echo "$DB_URL" | grep -q 'USER:PASSWORD'; then
  err "BACKEND_DATABASE_URL in mini-services/backend/.env is still the placeholder."
  err "Edit it to point to your real PostgreSQL database, then re-run ./deploy.sh."
  err ""
  err "Example:"
  err "  BACKEND_DATABASE_URL=\"postgresql://ninepro:password@localhost:5432/ninepro?schema=public&connection_limit=10&pool_timeout=10\""
  err ""
  err "Or use SQLite for local dev: ./deploy.sh --sqlite"
  exit 3
fi
ok "BACKEND_DATABASE_URL is set (provider: $(echo "$DB_URL" | cut -d: -f1))"

# ---------- 3. Install dependencies ----------
step "3/9  Installing dependencies"
install_deps() {
  local dir="$1"
  local label="$2"
  if [ ! -d "$dir/node_modules" ]; then
    echo "  ${DIM}npm install in $label…${RESET}"
    if ! (cd "$dir" && npm install --no-audit --no-fund --include=dev); then
      err "npm install failed in $label"
      exit 4
    fi
  else
    echo "  ${DIM}$label: node_modules present — skipping (use --reinstall to force)${RESET}"
  fi
}
install_deps "$ROOT" "frontend (root)"
install_deps "$ROOT/mini-services/backend" "backend"
install_deps "$ROOT/mini-services/studio" "studio"
install_deps "$ROOT/packages/shared" "shared"
ok "All dependencies installed."

# ---------- 4. Prisma migrations ----------
step "4/9  Running Prisma migrations"
SCHEMA_FILE="$ROOT/mini-services/backend/prisma/schema.prisma"
if grep -q 'provider = "sqlite"' "$SCHEMA_FILE"; then
  echo "  ${DIM}SQLite detected — running prisma db push…${RESET}"
  if ! (cd "$ROOT/mini-services/backend" && npx prisma db push); then
    err "prisma db push failed."
    exit 5
  fi
else
  echo "  ${DIM}PostgreSQL detected — running prisma migrate deploy…${RESET}"
  if ! (cd "$ROOT/mini-services/backend" && npx prisma migrate deploy); then
    err "prisma migrate deploy failed."
    err "Check that BACKEND_DATABASE_URL points to a reachable PostgreSQL instance"
    err "and that the database exists (CREATE DATABASE ninepro OWNER ninepro;)."
    exit 5
  fi
fi
ok "Database schema applied."

# ---------- 5. Prisma generate ----------
step "5/9  Generating Prisma client"
if ! (cd "$ROOT/mini-services/backend" && npx prisma generate); then
  err "prisma generate failed."
  exit 5
fi
ok "Prisma client generated."

# ---------- 6. Build backend ----------
step "6/9  Building backend (tsc → dist/)"
if ! (cd "$ROOT/mini-services/backend" && npx tsc); then
  err "Backend build (tsc) failed."
  exit 6
fi
if [ ! -f "$ROOT/mini-services/backend/dist/index.js" ]; then
  err "Backend build finished but dist/index.js not found."
  exit 6
fi
ok "dist/index.js created."

# ---------- 7. Build frontend ----------
step "7/9  Building frontend (next build → standalone)"
if ! (cd "$ROOT" && npx next build); then
  err "Frontend build failed."
  exit 6
fi
if [ ! -f "$ROOT/.next/standalone/server.js" ]; then
  err "Frontend build finished but .next/standalone/server.js not found."
  exit 6
fi
# Copy static + public assets (not included in standalone by default)
if [ -d "$ROOT/.next/static" ]; then
  mkdir -p "$ROOT/.next/standalone/.next"
  cp -r "$ROOT/.next/static" "$ROOT/.next/standalone/.next/"
fi
if [ -d "$ROOT/public" ]; then
  cp -r "$ROOT/public" "$ROOT/.next/standalone/"
fi
ok ".next/standalone/server.js created."

# ---------- 8. Build studio ----------
step "8/9  Building studio (next build → standalone)"
if ! (cd "$ROOT/mini-services/studio" && npx next build); then
  err "Studio build failed."
  exit 6
fi
if [ ! -f "$ROOT/mini-services/studio/.next/standalone/server.js" ]; then
  err "Studio build finished but .next/standalone/server.js not found."
  exit 6
fi
if [ -d "$ROOT/mini-services/studio/.next/static" ]; then
  mkdir -p "$ROOT/mini-services/studio/.next/standalone/.next"
  cp -r "$ROOT/mini-services/studio/.next/static" "$ROOT/mini-services/studio/.next/standalone/.next/"
fi
if [ -d "$ROOT/mini-services/studio/public" ]; then
  cp -r "$ROOT/mini-services/studio/public" "$ROOT/mini-services/studio/.next/standalone/"
fi
ok "studio/.next/standalone/server.js created."

# ---------- 9. (optional) Start services ----------
if [ "$NO_START" = true ]; then
  echo ""
  echo "${BOLD}${GREEN}════════════════════════════════════════════════════════════════════════${RESET}"
  echo "${BOLD}${GREEN}  ✅ BUILD COMPLETE (--no-start)${RESET}"
  echo "${BOLD}${GREEN}════════════════════════════════════════════════════════════════════════${RESET}"
  echo ""
  echo "  Start services with:  ${CYAN}npm run start${RESET}"
  if [ "$INSTALL_SERVICES" = true ]; then
    echo "  Or install persistent services:  ${CYAN}sudo ./scripts/install-services.sh${RESET}"
  fi
  exit 0
fi

# Branch: --install-services uses systemd (persistent); otherwise foreground.
if [ "$INSTALL_SERVICES" = true ]; then
  step "9/10  Installing systemd services (persistent startup)"

  # Stop any existing foreground processes on our ports first.
  for port in 3000 3001 4000; do
    if command -v fuser >/dev/null 2>&1; then
      fuser -k -9 "${port}/tcp" 2>/dev/null || true
    fi
  done
  sleep 1

  # install-services.sh requires root (writes to /etc/systemd/system/).
  # If we're not root, re-exec via sudo. The script itself detects SUDO_USER
  # so the services still run as the original user, not root.
  if [ "$(id -u)" -ne 0 ]; then
    echo "  ${DIM}re-launching install-services.sh via sudo (root needed for systemd)…${RESET}"
    if ! sudo bash "$ROOT/scripts/install-services.sh"; then
      err "install-services.sh failed (exit $?)."
      err "Services were NOT installed. You can still run them in the"
      err "foreground with: npm run start"
      exit 7
    fi
  else
    if ! bash "$ROOT/scripts/install-services.sh"; then
      err "install-services.sh failed (exit $?)."
      err "Services were NOT installed. You can still run them in the"
      err "foreground with: npm run start"
      exit 7
    fi
  fi

  # install-services.sh already started the services and ran health checks.
  # We're done — exit with success.
  exit 0
fi

step "9/9  Starting services + health check (foreground)"

# Kill anything on our ports first (defensive).
for port in 3000 3001 4000; do
  if command -v fuser >/dev/null 2>&1; then
    fuser -k -9 "${port}/tcp" 2>/dev/null || true
  fi
done
sleep 1

# Start all services in background via scripts/start.js (it handles log
# prefixes, graceful shutdown, etc.).
LOG_FILE="/tmp/999pro-deploy-$$.log"
node "$ROOT/scripts/start.js" > "$LOG_FILE" 2>&1 &
START_PID=$!

# Give services time to boot.
echo "  ${DIM}Waiting for services to boot (15s)…${RESET}"
sleep 15

# Health check: backend /api/health
echo "  ${DIM}Checking http://localhost:4000/api/health…${RESET}"
for i in 1 2 3 4 5; do
  if curl -sf http://localhost:4000/api/health >/dev/null 2>&1; then
    ok "Backend healthy."
    break
  fi
  if [ "$i" -eq 5 ]; then
    err "Backend did not respond after 5 attempts. Recent logs:"
    tail -20 "$LOG_FILE" >&2
    kill -9 $START_PID 2>/dev/null || true
    exit 7
  fi
  sleep 2
done

# Health check: frontend
if curl -sf -o /dev/null http://localhost:3000/; then
  ok "Frontend responding."
else
  err "Frontend did not respond."
  tail -20 "$LOG_FILE" >&2
  kill -9 $START_PID 2>/dev/null || true
  exit 7
fi

# Health check: studio (HTML request — should be 200)
if curl -sf -o /dev/null -H "Accept: text/html" http://localhost:3001/studio; then
  ok "Studio responding."
else
  err "Studio did not respond."
  tail -20 "$LOG_FILE" >&2
  kill -9 $START_PID 2>/dev/null || true
  exit 7
fi

# ---------- summary ----------
# Check whether first admin exists
ADMIN_EXISTS=$(curl -s http://localhost:4000/api/auth/admin-exists 2>/dev/null || echo '{"hasAdmin":true}')

echo ""
echo "${BOLD}${GREEN}╔══════════════════════════════════════════════════════════════════════════╗${RESET}"
echo "${BOLD}${GREEN}║  ✅  DEPLOYMENT COMPLETE                                                  ║${RESET}"
echo "${BOLD}${GREEN}╚══════════════════════════════════════════════════════════════════════════╝${RESET}"
echo ""
echo "  ${BOLD}Endpoints:${RESET}"
echo "    Frontend:  ${CYAN}http://localhost:3000${RESET}"
echo "    Studio:    ${CYAN}http://localhost:3001/studio${RESET}"
echo "    Backend:   ${CYAN}http://localhost:4000/api/health${RESET}"
echo ""
if echo "$ADMIN_EXISTS" | grep -q '"hasAdmin":false'; then
  echo "  ${BOLD}${YELLOW}First-run setup required${RESET}"
  echo "  Open ${CYAN}http://localhost:3001/studio${RESET} in your browser."
  echo "  The setup wizard opens automatically — fill in the form to create"
  echo "  the first admin. No curl, no tokens, no terminal commands."
  echo ""
else
  echo "  ${BOLD}Admin already exists${RESET} — login at ${CYAN}http://localhost:3001/studio${RESET}"
  echo ""
fi
echo "  ${DIM}Deploy log: $LOG_FILE${RESET}"
echo "  ${DIM}Stop services: kill $START_PID  (or Ctrl+C if running in foreground)${RESET}"
echo ""
echo "  ${YELLOW}⚠ Foreground mode: services stop when you close the terminal.${RESET}"
echo "  ${YELLOW}  For persistent startup (survives reboot + SSH disconnect), run:${RESET}"
echo "  ${CYAN}    sudo ./scripts/install-services.sh${RESET}"
echo "  ${YELLOW}  Or re-deploy with:${RESET}"
echo "  ${CYAN}    ./deploy.sh --install-services${RESET}"
echo ""

exit 0
