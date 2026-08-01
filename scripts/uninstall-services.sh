#!/usr/bin/env bash
# ============================================================================
# 999 PRO — uninstall-services.sh
# ----------------------------------------------------------------------------
# Stops and removes the systemd unit files installed by install-services.sh.
#
# After uninstall:
#   - Services are stopped (if running)
#   - Services are disabled (won't auto-start on boot)
#   - Unit files are removed from /etc/systemd/system/
#   - The build artifacts (.next/, dist/) and .env files are NOT touched
#     — only the systemd integration is removed.
#
# Usage:
#   sudo ./scripts/uninstall-services.sh           # stop + disable + remove
#   sudo ./scripts/uninstall-services.sh --purge   # also delete logs
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
PURGE=false
for arg in "$@"; do
  case "$arg" in
    --purge) PURGE=true ;;
    --help|-h)
      echo "Usage: sudo $0 [--purge]"
      echo ""
      echo "  --purge  Also delete journald logs for 999pro-* services"
      exit 0
      ;;
  esac
done

echo ""
echo "${BOLD}╔══════════════════════════════════════════════════════════════════════════╗${RESET}"
echo "${BOLD}║  999 PRO — systemd services uninstaller                                  ║${RESET}"
echo "${BOLD}╚══════════════════════════════════════════════════════════════════════════╝${RESET}"
echo ""

# ---------- root check ----------
step "1/4  Checking privileges"
if [ "$(id -u)" -ne 0 ]; then
  err "This script must be run as root (use sudo)."
  exit 1
fi
ok "Running as root"

# ---------- stop + disable ----------
step "2/4  Stopping + disabling services"
SERVICES=(backend frontend studio)
for svc in "${SERVICES[@]}"; do
  unit="999pro-$svc"
  if systemctl is-active --quiet "$unit" 2>/dev/null; then
    echo "  ${DIM}stopping $unit…${RESET}"
    systemctl stop "$unit" 2>/dev/null || true
    ok "$unit stopped"
  else
    echo "  ${DIM}$unit not running — skipping stop${RESET}"
  fi
  if systemctl is-enabled --quiet "$unit" 2>/dev/null; then
    systemctl disable "$unit" 2>/dev/null || true
    ok "$unit disabled (won't auto-start on boot)"
  else
    echo "  ${DIM}$unit not enabled — skipping disable${RESET}"
  fi
done

# ---------- remove unit files ----------
step "3/4  Removing unit files"
UNIT_DIR="/etc/systemd/system"
for svc in "${SERVICES[@]}"; do
  unit_file="$UNIT_DIR/999pro-$svc.service"
  if [ -f "$unit_file" ]; then
    rm -f "$unit_file"
    ok "removed $unit_file"
  else
    echo "  ${DIM}$unit_file not present — skipping${RESET}"
  fi
done

systemctl daemon-reload
ok "systemd daemon reloaded"

# ---------- optional: purge logs ----------
if [ "$PURGE" = true ]; then
  step "4/4  Purging journald logs (--purge)"
  for svc in "${SERVICES[@]}"; do
    unit="999pro-$svc"
    echo "  ${DIM}vacuuming logs for $unit…${RESET}"
    journalctl --vacuum-time=1s --unit="$unit" 2>/dev/null || true
  done
  ok "Logs purged"
else
  step "4/4  Preserving logs (use --purge to delete)"
  echo "  ${DIM}Logs remain in journald. View with:${RESET}"
  echo "  ${DIM}  journalctl -u 999pro-backend --no-pager -n 50${RESET}"
fi

# ---------- summary ----------
echo ""
echo "${BOLD}${GREEN}╔══════════════════════════════════════════════════════════════════════════╗${RESET}"
echo "${BOLD}${GREEN}║  ✅  SYSTEMD SERVICES UNINSTALLED                                         ║${RESET}"
echo "${BOLD}${GREEN}╚══════════════════════════════════════════════════════════════════════════╝${RESET}"
echo ""
echo "  ${BOLD}What was removed:${RESET}"
echo "    ✓ Stopped 999pro-backend, 999pro-frontend, 999pro-studio"
echo "    ✓ Disabled auto-start on boot"
echo "    ✓ Removed unit files from /etc/systemd/system/"
echo ""
echo "  ${BOLD}What was preserved:${RESET}"
echo "    ✓ Build artifacts (dist/, .next/standalone/)"
echo "    ✓ .env files (secrets)"
echo "    ✓ Database (PostgreSQL / SQLite dev.db)"
echo ""
echo "  To re-install:  ${CYAN}sudo ./scripts/install-services.sh${RESET}"
echo "  To run manually (no persistence):  ${CYAN}npm run start${RESET}"
echo ""

exit 0
