#!/bin/bash
# 999 PRO backend supervisor — wrapped in a script (not inline command) so the
# FC/k8s sandbox lets the child process survive bash-session exits.
#
# The supervisor polls /api/health every 10s. If the backend is dead or
# unresponsive for 3 consecutive polls (30s), it kills any stale instance
# and starts a fresh one.
#
# Usage (from a bash tool call):
#   bash ${PROJECT_DIR:-/home/z/my-project/999pro}/scripts/start-supervisor.sh
#
# The supervisor itself uses the same (subshell + setsid + nohup + disown)
# pattern that keeps the Next.js dev servers alive across tool calls.

set -u

PROJECT_DIR="${PROJECT_DIR:-/home/z/my-project/999pro}/mini-services/backend"
LOG_DIR="${PROJECT_DIR:-/home/z/my-project/999pro}/logs"
PID_DIR="${PROJECT_DIR:-/home/z/my-project/999pro}/.run"
mkdir -p "$LOG_DIR" "$PID_DIR"

SUP_PID_FILE="$PID_DIR/supervisor.pid"
SUP_LOG_FILE="$LOG_DIR/supervisor.log"
BACKEND_PID_FILE="$PID_DIR/backend.pid"
BACKEND_LOG_FILE="$LOG_DIR/backend.log"

HEALTH_URL="http://localhost:4000/api/health"
HEALTH_CHECK_INTERVAL=10
HEALTH_FAIL_THRESHOLD=3
MIN_RESTART_INTERVAL=10

# Kill any stale supervisor + backend first
pkill -f "bun.*src/index.ts" 2>/dev/null || true
pkill -f "tsx src/index.ts" 2>/dev/null || true
# Kill old supervisor by PID file
OLD_SUP=$(cat "$SUP_PID_FILE" 2>/dev/null || echo "")
[ -n "$OLD_SUP" ] && kill -TERM "$OLD_SUP" 2>/dev/null || true
sleep 1

# Launch the supervisor loop itself using the surviving pattern (subshell +
# setsid + nohup). Inside the loop, the backend is launched the same way.
(
  setsid nohup bash -c '
    set -u
    PROJECT_DIR="'"$PROJECT_DIR"'"
    BACKEND_PID_FILE="'"$BACKEND_PID_FILE"'"
    BACKEND_LOG_FILE="'"$BACKEND_LOG_FILE"'"
    HEALTH_URL="'"$HEALTH_URL"'"
    HEALTH_CHECK_INTERVAL='"$HEALTH_CHECK_INTERVAL"'
    HEALTH_FAIL_THRESHOLD='"$HEALTH_FAIL_THRESHOLD"'
    MIN_RESTART_INTERVAL='"$MIN_RESTART_INTERVAL"'

    log() { echo "[$(date +%H:%M:%S)] [supervisor] $*"; }

    start_backend() {
      ( cd "$PROJECT_DIR" \
        && setsid nohup bun run src/index.ts > "$BACKEND_LOG_FILE" 2>&1 < /dev/null \
        & echo $! > "$BACKEND_PID_FILE"; disown ) 2>/dev/null
      log "backend started (pid=$(cat $BACKEND_PID_FILE 2>/dev/null))"
    }

    backend_alive() {
      local pid
      pid=$(cat "$BACKEND_PID_FILE" 2>/dev/null || echo "")
      [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
    }

    health_ok() {
      curl -s -m 3 "$HEALTH_URL" 2>/dev/null | grep -q "\"ok\":true"
    }

    start_backend
    sleep 5

    last_restart=$(date +%s)
    fail=0
    log "supervisor running — polling every ${HEALTH_CHECK_INTERVAL}s"

    while true; do
      sleep "$HEALTH_CHECK_INTERVAL"
      if ! backend_alive; then
        log "backend process dead — restarting"
        now=$(date +%s)
        [ $((now - last_restart)) -lt "$MIN_RESTART_INTERVAL" ] && sleep "$MIN_RESTART_INTERVAL"
        start_backend
        last_restart=$(date +%s)
        fail=0
        sleep 5
        continue
      fi
      if ! health_ok; then
        fail=$((fail + 1))
        log "health check failed ($fail/$HEALTH_FAIL_THRESHOLD)"
        if [ "$fail" -ge "$HEALTH_FAIL_THRESHOLD" ]; then
          log "threshold exceeded — killing and restarting"
          pid=$(cat "$BACKEND_PID_FILE" 2>/dev/null || echo "")
          [ -n "$pid" ] && kill -KILL "$pid" 2>/dev/null
          pkill -f "bun.*src/index.ts" 2>/dev/null
          sleep 1
          start_backend
          last_restart=$(date +%s)
          fail=0
          sleep 5
        fi
      else
        [ "$fail" -gt 0 ] && log "health recovered after $fail failures"
        fail=0
      fi
    done
  ' > '"$SUP_LOG_FILE"' 2>&1 < /dev/null &
  echo $! > '"$SUP_PID_FILE"'
  disown
) 2>/dev/null

sleep 1
SUP_PID=$(cat "$SUP_PID_FILE" 2>/dev/null)
echo "supervisor started, pid=$SUP_PID"
echo "  polling $HEALTH_URL every ${HEALTH_CHECK_INTERVAL}s"
echo "  logs: $SUP_LOG_FILE (supervisor), $BACKEND_LOG_FILE (backend)"

# Wait for backend to boot and report health
sleep 6
echo ""
echo "=== Backend status ==="
BPID=$(cat "$BACKEND_PID_FILE" 2>/dev/null)
ps -p "$BPID" -o pid,cmd 2>&1 | tail -2
echo ""
echo "=== Health ==="
curl -s -m 5 "$HEALTH_URL" || echo "FAILED"
echo
