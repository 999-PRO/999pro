#!/usr/bin/env bash
# ============================================================================
# 999 PRO — services-logs.sh
# ----------------------------------------------------------------------------
# Tails the journald logs for one or all 999 PRO services.
#
# Usage:
#   ./scripts/services-logs.sh                  # all services (interleaved)
#   ./scripts/services-logs.sh backend          # backend only
#   ./scripts/services-logs.sh frontend         # frontend only
#   ./scripts/services-logs.sh studio           # studio only
#   ./scripts/services-logs.sh --no-follow      # print last 50 lines, exit
#   ./scripts/services-logs.sh --since 1h       # last 1 hour
# ============================================================================

set -uo pipefail

SERVICE=""
FOLLOW=true
SINCE=""
LINES="50"

while [ $# -gt 0 ]; do
  case "$1" in
    --no-follow|-n) FOLLOW=false; shift ;;
    --since) shift; SINCE="--since=$1"; shift ;;
    --lines) shift; LINES="$1"; shift ;;
    --help|-h)
      echo "Usage: $0 [service] [--no-follow] [--since 1h] [--lines 50]"
      echo ""
      echo "  service     backend | frontend | studio (default: all)"
      echo "  --no-follow  Print last N lines and exit (don't follow)"
      echo "  --since T    Show logs since time (e.g. '1h', 'today', '2024-01-01')"
      echo "  --lines N    Number of lines for --no-follow (default: 50)"
      exit 0
      ;;
    backend|frontend|studio) SERVICE="$1"; shift ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

if ! command -v journalctl >/dev/null 2>&1; then
  echo "journalctl not available. Are you on a systemd system?" >&2
  exit 1
fi

FOLLOW_FLAG=""
if [ "$FOLLOW" = true ]; then
  FOLLOW_FLAG="-f"
fi

LINES_FLAG="-n ${LINES}"
if [ "$FOLLOW" = true ]; then
  LINES_FLAG="-n 50"  # show last 50 lines before following
fi

if [ -n "$SERVICE" ]; then
  exec journalctl $FOLLOW_FLAG $LINES_FLAG $SINCE -u "999pro-$SERVICE"
else
  # All services — use -u for each, journalctl interleaves them.
  # Add SYSLOG_IDENTIFIER prefix coloring via -o cat doesn't work well with
  # multiple units; default format includes the unit name.
  exec journalctl $FOLLOW_FLAG $LINES_FLAG $SINCE \
    -u 999pro-backend \
    -u 999pro-frontend \
    -u 999pro-studio
fi
