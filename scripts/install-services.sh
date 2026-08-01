#!/usr/bin/env bash
# ============================================================================
# 999 PRO — install-services.sh
# ----------------------------------------------------------------------------
# Installs systemd unit files for backend, frontend, and studio so the
# services run as persistent system processes.
#
# After install:
#   - Services auto-start on VPS boot (systemctl enable)
#   - Services auto-restart on crash (Restart=on-failure, RestartSec=5)
#   - Services survive terminal/SSH disconnect (nohup-like, but via systemd)
#   - Logs go to journald (viewable via `journalctl -u 999pro-backend -f`)
#
# Prerequisites:
#   - npm run build has been run (dist/ and .next/standalone/ exist)
#   - .env files exist (npm run setup)
#   - This script is run with sudo (root) — needed to write to /etc/systemd
#
# Usage:
#   sudo ./scripts/install-services.sh              # install + start
#   sudo ./scripts/install-services.sh --no-start   # install only, don't start
#   sudo ./scripts/install-services.sh --user www-data  # run as specific user
#
# Exit codes:
#   0 — success
#   1 — not root
#   2 — build artifacts missing
#   3 — .env files missing
#   4 — systemd not available
#   5 — service start failed
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

# ---------- locate project root ----------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKEND="$ROOT/mini-services/backend"
STUDIO="$ROOT/mini-services/studio"
SYSTEMD_TEMPLATES="$SCRIPT_DIR/systemd"
UNIT_DIR="/etc/systemd/system"

# ---------- args ----------
NO_START=false
SERVICE_USER=""
for arg in "$@"; do
  case "$arg" in
    --no-start) NO_START=true ;;
    --user) shift; SERVICE_USER="${1:-}" ;;
    --user=*) SERVICE_USER="${arg#--user=}" ;;
    --help|-h)
      echo "Usage: sudo $0 [--no-start] [--user USERNAME]"
      echo ""
      echo "  --no-start       Install unit files but don't start services"
      echo "  --user USERNAME  Run services as this user (default: current SUDO_USER or root)"
      exit 0
      ;;
  esac
done

echo ""
echo "${BOLD}╔══════════════════════════════════════════════════════════════════════════╗${RESET}"
echo "${BOLD}║  999 PRO — systemd services installer                                    ║${RESET}"
echo "${BOLD}║  Persistent processes · auto-restart · boot-time start                  ║${RESET}"
echo "${BOLD}╚══════════════════════════════════════════════════════════════════════════╝${RESET}"
echo ""

# ---------- 1. Root check ----------
step "1/6  Checking privileges"
if [ "$(id -u)" -ne 0 ]; then
  err "This script must be run as root (use sudo)."
  err "  sudo $0"
  exit 1
fi
ok "Running as root (UID 0)"

# Determine the user the services will run as. Default: SUDO_USER (the user
# who invoked sudo), or root if invoked directly.
if [ -z "$SERVICE_USER" ]; then
  SERVICE_USER="${SUDO_USER:-root}"
fi
if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  err "User '$SERVICE_USER' does not exist."
  exit 1
fi
SERVICE_GROUP="$(id -gn "$SERVICE_USER")"
SERVICE_UID="$(id -u "$SERVICE_USER")"
ok "Services will run as: $SERVICE_USER (uid=$SERVICE_UID, group=$SERVICE_GROUP)"

# ---------- 2. Build artifacts ----------
step "2/6  Checking build artifacts"
ARTIFACTS=(
  "Backend dist"      "$BACKEND/dist/index.js"
  "Frontend standalone" "$ROOT/.next/standalone/server.js"
  "Studio standalone" "$STUDIO/.next/standalone/server.js"
)
MISSING=()
for i in $(seq 0 2 $((${#ARTIFACTS[@]} - 1))); do
  label="${ARTIFACTS[$i]}"
  path="${ARTIFACTS[$((i + 1))]}"
  if [ ! -f "$path" ]; then
    err "$label missing: $path"
    MISSING+=("$label")
  else
    ok "$label present"
  fi
done
if [ ${#MISSING[@]} -gt 0 ]; then
  err ""
  err "Build artifacts missing. Run \`npm run build\` first."
  exit 2
fi

# ---------- 3. .env files ----------
step "3/6  Checking .env files"
ENV_FILES=(
  "Backend"  "$BACKEND/.env"
  "Frontend" "$ROOT/.env"
  "Studio"   "$STUDIO/.env"
)
MISSING_ENV=()
for i in $(seq 0 2 $((${#ENV_FILES[@]} - 1))); do
  label="${ENV_FILES[$i]}"
  path="${ENV_FILES[$((i + 1))]}"
  if [ ! -f "$path" ]; then
    err "$label .env missing: $path"
    MISSING_ENV+=("$label")
  else
    ok "$label .env present"
  fi
done
if [ ${#MISSING_ENV[@]} -gt 0 ]; then
  err ""
  err ".env files missing. Run \`npm run setup\` first."
  exit 3
fi

# ---------- 4. systemd availability ----------
step "4/6  Checking systemd"
if ! command -v systemctl >/dev/null 2>&1; then
  err "systemctl not found. This script requires systemd (standard on Ubuntu 16.04+)."
  err "If you're on a different init system (SysV, OpenRC), see the README for"
  err "manual setup instructions using pm2 or supervisord."
  exit 4
fi
if ! systemctl is-system-running >/dev/null 2>&1; then
  warn "systemctl reports system is not fully running — continuing anyway."
fi
ok "systemd available ($(systemctl --version | head -1))"

# Detect Node.js path (must be absolute for systemd ExecStart).
NODE_BIN="$(command -v node || true)"
if [ -z "$NODE_BIN" ]; then
  # Common install locations
  for candidate in /usr/bin/node /usr/local/bin/node /opt/node/bin/node "$HOME/.nvm/versions/node/$(node -v 2>/dev/null)/bin/node"; do
    if [ -x "$candidate" ]; then
      NODE_BIN="$candidate"
      break
    fi
  done
fi
if [ -z "$NODE_BIN" ]; then
  err "Node.js not found in PATH. Install Node.js 20+ first."
  exit 1
fi
# Resolve symlinks (nvm installs often symlink node → a version-specific path).
NODE_BIN="$(readlink -f "$NODE_BIN")"
ok "Node.js: $NODE_BIN ($(node -v))"

# ---------- 5. Generate + install unit files ----------
step "5/6  Generating + installing unit files"

SERVICES=(backend frontend studio)
TEMPLATE_MAP=(
  "999pro-backend.service"
  "999pro-frontend.service"
  "999pro-studio.service"
)

# Stop existing services if they're running (so we can replace the unit files).
for svc in "${SERVICES[@]}"; do
  if systemctl is-active --quiet "999pro-$svc" 2>/dev/null; then
    echo "  ${DIM}stopping 999pro-$svc (will restart after install)…${RESET}"
    systemctl stop "999pro-$svc" || true
  fi
done

for i in "${!SERVICES[@]}"; do
  svc="${SERVICES[$i]}"
  template="${TEMPLATE_MAP[$i]}"
  template_path="$SYSTEMD_TEMPLATES/$template"
  unit_path="$UNIT_DIR/$template"

  if [ ! -f "$template_path" ]; then
    err "Template not found: $template_path"
    exit 1
  fi

  # Substitute placeholders. Using sed with | as delimiter because paths
  # contain / (but not |).
  sed \
    -e "s|__ROOT__|$ROOT|g" \
    -e "s|__BACKEND__|$BACKEND|g" \
    -e "s|__STUDIO__|$STUDIO|g" \
    -e "s|__NODE__|$NODE_BIN|g" \
    -e "s|__USER__|$SERVICE_USER|g" \
    -e "s|__GROUP__|$SERVICE_GROUP|g" \
    "$template_path" > "$unit_path"

  chmod 644 "$unit_path"
  ok "$template → $unit_path"
done

# Reload systemd so it picks up the new units.
systemctl daemon-reload
ok "systemd daemon reloaded"

# Enable services (auto-start on boot).
for svc in "${SERVICES[@]}"; do
  systemctl enable "999pro-$svc" 2>&1 | sed 's/^/  /'
done
ok "All 3 services enabled (auto-start on boot)"

# ---------- 6. Start services ----------
if [ "$NO_START" = true ]; then
  echo ""
  warn "Skipping service start (--no-start)."
  echo "  Start with:  ${CYAN}sudo systemctl start 999pro-backend 999pro-frontend 999pro-studio${RESET}"
  echo ""
  exit 0
fi

step "6/6  Starting services"

# Start backend first (frontend + studio depend on it for API).
echo "  ${DIM}starting 999pro-backend…${RESET}"
systemctl start 999pro-backend
sleep 3

# Health check backend
for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -sf http://localhost:4000/api/health >/dev/null 2>&1; then
    ok "Backend healthy (took ${i} attempts)"
    break
  fi
  if [ "$i" -eq 10 ]; then
    err "Backend failed to start within 30s. Recent logs:"
    journalctl -u 999pro-backend --no-pager -n 20 >&2
    exit 5
  fi
  sleep 3
done

echo "  ${DIM}starting 999pro-frontend…${RESET}"
systemctl start 999pro-frontend
sleep 2

echo "  ${DIM}starting 999pro-studio…${RESET}"
systemctl start 999pro-studio
sleep 2

# Final health checks
echo ""
echo "  ${DIM}Health checks:${RESET}"
HEALTH_OK=true
for check in \
  "Backend:4000/api/health" \
  "Frontend:3000/" \
  "Studio:3001/studio"; do
  label="${check%%:*}"
  url="http://localhost:${check#*:}"
  # For studio, send Accept: text/html so the proxy doesn't 403
  if [ "$label" = "Studio" ]; then
    if curl -sf -H "Accept: text/html" "$url" >/dev/null 2>&1; then
      ok "$label responding"
    else
      err "$label not responding"
      HEALTH_OK=false
    fi
  else
    if curl -sf "$url" >/dev/null 2>&1; then
      ok "$label responding"
    else
      err "$label not responding"
      HEALTH_OK=false
    fi
  fi
done

# ---------- summary ----------
echo ""
echo "${BOLD}${GREEN}╔══════════════════════════════════════════════════════════════════════════╗${RESET}"
echo "${BOLD}${GREEN}║  ✅  SYSTEMD SERVICES INSTALLED                                           ║${RESET}"
echo "${BOLD}${GREEN}╚══════════════════════════════════════════════════════════════════════════╝${RESET}"
echo ""
echo "  ${BOLD}Services are now persistent:${RESET}"
echo "    ✓ Survive terminal/SSH disconnect (systemd-managed)"
echo "    ✓ Auto-start on VPS boot (enabled)"
echo "    ✓ Auto-restart on crash (Restart=on-failure, 5s pause)"
echo ""
echo "  ${BOLD}Status:${RESET}    ${CYAN}sudo systemctl status 999pro-backend 999pro-frontend 999pro-studio${RESET}"
echo "  ${BOLD}Logs:${RESET}       ${CYAN}sudo journalctl -u 999pro-backend -f${RESET}  (or -u 999pro-frontend / -u 999pro-studio)"
echo "  ${BOLD}Restart:${RESET}    ${CYAN}sudo systemctl restart 999pro-backend 999pro-frontend 999pro-studio${RESET}"
echo "  ${BOLD}Stop:${RESET}       ${CYAN}sudo systemctl stop 999pro-backend 999pro-frontend 999pro-studio${RESET}"
echo "  ${BOLD}Uninstall:${RESET}  ${CYAN}sudo $SCRIPT_DIR/uninstall-services.sh${RESET}"
echo ""

if [ "$HEALTH_OK" = false ]; then
  warn "Some services didn't pass health check. Check logs with:"
  echo "  ${CYAN}sudo journalctl -u 999pro-backend --no-pager -n 50${RESET}"
  exit 5
fi

# Check if first admin exists
ADMIN_EXISTS=$(curl -s http://localhost:4000/api/auth/admin-exists 2>/dev/null || echo '{"hasAdmin":true}')
if echo "$ADMIN_EXISTS" | grep -q '"hasAdmin":false'; then
  echo "  ${BOLD}${YELLOW}First-run setup required${RESET}"
  echo "  Open ${CYAN}http://localhost:3001/studio${RESET} in your browser."
  echo "  The setup wizard opens automatically — fill in the form to create"
  echo "  the first admin. No curl, no tokens, no terminal commands."
else
  echo "  ${BOLD}Admin already exists${RESET} — login at ${CYAN}http://localhost:3001/studio${RESET}"
fi
echo ""

exit 0
