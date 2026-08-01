#!/usr/bin/env bash
# ============================================================================
# 999 PRO — services-status.sh
# ----------------------------------------------------------------------------
# Shows the status of all 3 systemd services (backend, frontend, studio) in
# a compact table format. Also runs a quick HTTP health check.
#
# Usage:
#   ./scripts/services-status.sh              # compact status
#   ./scripts/services-status.sh --verbose    # full systemctl status output
# ============================================================================

set -uo pipefail

# ---------- colours ----------
RED=$'\033[31m'
GREEN=$'\033[32m'
YELLOW=$'\033[33m'
CYAN=$'\033[36m'
BOLD=$'\033[1m'
DIM=$'\033[2m'
RESET=$'\033[0m'

VERBOSE=false
for arg in "$@"; do
  case "$arg" in
    --verbose|-v) VERBOSE=true ;;
    --help|-h)
      echo "Usage: $0 [--verbose]"
      exit 0
      ;;
  esac
done

echo ""
echo "${BOLD}999 PRO — services status${RESET}"
echo "${DIM}$(printf '═%.0s' {1..70})${RESET}"
echo ""

SERVICES=(backend frontend studio)
PORTS=(4000 3000 3001)
PATHS=("/api/health" "/" "/studio")

# Check if systemctl is available (i.e. services are installed)
if ! command -v systemctl >/dev/null 2>&1; then
  echo "${YELLOW}⚠ systemd not available on this system.${RESET}"
  echo "  Services may be running via 'npm run start' (foreground, no persistence)."
  echo ""
  # Fallback: just check if ports respond
  for i in "${!SERVICES[@]}"; do
    svc="${SERVICES[$i]}"
    port="${PORTS[$i]}"
    path="${PATHS[$i]}"
    url="http://localhost:$port$path"
    if [ "$svc" = "studio" ]; then
      if curl -sf -H "Accept: text/html" "$url" >/dev/null 2>&1; then
        echo "  ${GREEN}●${RESET} $svc (port $port) — responding"
      else
        echo "  ${RED}●${RESET} $svc (port $port) — not responding"
      fi
    else
      if curl -sf "$url" >/dev/null 2>&1; then
        echo "  ${GREEN}●${RESET} $svc (port $port) — responding"
      else
        echo "  ${RED}●${RESET} $svc (port $port) — not responding"
      fi
    fi
  done
  echo ""
  exit 0
fi

# Compact status table
printf "  ${BOLD}%-8s %-10s %-12s %-10s %s${RESET}\n" "SERVICE" "PORT" "STATE" "AUTO-START" "HEALTH"
echo "  ${DIM}$(printf '─%.0s' {1..68})${RESET}"

ALL_OK=true
for i in "${!SERVICES[@]}"; do
  svc="${SERVICES[$i]}"
  port="${PORTS[$i]}"
  path="${PATHS[$i]}"
  unit="999pro-$svc"
  url="http://localhost:$port$path"

  # systemd state
  if systemctl is-active --quiet "$unit" 2>/dev/null; then
    state="${GREEN}active${RESET}"
  elif systemctl is-failed --quiet "$unit" 2>/dev/null; then
    state="${RED}failed${RESET}"
    ALL_OK=false
  else
    state="${YELLOW}inactive${RESET}"
    ALL_OK=false
  fi

  # auto-start on boot
  if systemctl is-enabled --quiet "$unit" 2>/dev/null; then
    enabled="${GREEN}enabled${RESET}"
  else
    enabled="${YELLOW}disabled${RESET}"
  fi

  # HTTP health check
  if [ "$svc" = "studio" ]; then
    if curl -sf -H "Accept: text/html" "$url" >/dev/null 2>&1; then
      health="${GREEN}✓ ok${RESET}"
    else
      health="${RED}✗ down${RESET}"
      ALL_OK=false
    fi
  else
    if curl -sf "$url" >/dev/null 2>&1; then
      health="${GREEN}✓ ok${RESET}"
    else
      health="${RED}✗ down${RESET}"
      ALL_OK=false
    fi
  fi

  printf "  %-8s %-10s %-21s %-21s %s\n" "$svc" "$port" "$state" "$enabled" "$health"
done

echo ""

if [ "$VERBOSE" = true ]; then
  echo ""
  echo "${BOLD}Detailed systemctl status:${RESET}"
  echo "${DIM}$(printf '═%.0s' {1..70})${RESET}"
  for svc in "${SERVICES[@]}"; do
    echo ""
    echo "${BOLD}━━ 999pro-$svc ━━${RESET}"
    systemctl status "999pro-$svc" --no-pager -l 2>&1 || true
  done
fi

if [ "$ALL_OK" = true ]; then
  echo "${GREEN}✓ All services healthy.${RESET}"
else
  echo "${YELLOW}⚠ Some services are not healthy. Check logs:${RESET}"
  echo "  ${CYAN}sudo journalctl -u 999pro-backend --no-pager -n 50${RESET}"
  exit 1
fi

echo ""
