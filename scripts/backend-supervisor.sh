#!/bin/bash
# 999 PRO backend supervisor — auto-restarts the backend if it crashes or
# gets killed when a bash session exits (which happens routinely in the
# sandboxed tool environment).
#
# Usage:
#   nohup setsid bash ${PROJECT_DIR:-/home/z/my-project/999pro}/scripts/backend-supervisor.sh \
#     > ${PROJECT_DIR:-/home/z/my-project/999pro}/logs/supervisor.log 2>&1 < /dev/null &

set -u

BACKEND_DIR="${PROJECT_DIR:-/home/z/my-project/999pro}/mini-services/backend"
LOG_FILE="${PROJECT_DIR:-/home/z/my-project/999pro}/logs/backend.log"
PID_FILE="${PROJECT_DIR:-/home/z/my-project/999pro}/.run/backend.pid"
HEALTH_URL="http://localhost:4000/api/health"
HEALTH_CHECK_INTERVAL=10
HEALTH_FAIL_THRESHOLD=3
MIN_RESTART_INTERVAL=10

mkdir -p "$(dirname "$LOG_FILE")" "$(dirname "$PID_FILE")"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] [supervisor] $*"
}

start_backend() {
  cd "$BACKEND_DIR"
  # nohup + setsid: fully detach from this supervisor's process group so
  # the backend survives even if the supervisor itself is killed.
  setsid nohup bunx tsx src/index.ts > "$LOG_FILE" 2>&1 < /dev/null &
  local pid=$!
  disown "$pid" 2>/dev/null || true
  echo "$pid" > "$PID_FILE"
  log "backend started (pid=$pid)"
}

backend_pid_alive() {
  local pid
  pid=$(cat "$PID_FILE" 2>/dev/null || echo "")
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

health_ok() {
  curl -s -m 3 "$HEALTH_URL" 2>/dev/null | grep -q '"ok":true'
}

# Kill any stale instances first
pkill -f "tsx src/index.ts" 2>/dev/null || true
sleep 1

# Start immediately so we don't wait HEALTH_CHECK_INTERVAL for first boot.
start_backend
sleep 5

last_restart=$(date +%s)
fail_count=0

log "supervisor running — polling $HEALTH_URL every ${HEALTH_CHECK_INTERVAL}s"

while true; do
  sleep "$HEALTH_CHECK_INTERVAL"

  if ! backend_pid_alive; then
    log "backend process not alive — restarting"
    now=$(date +%s)
    if [ $((now - last_restart)) -lt "$MIN_RESTART_INTERVAL" ]; then
      log "throttled: waiting ${MIN_RESTART_INTERVAL}s before restart"
      sleep "$MIN_RESTART_INTERVAL"
    fi
    start_backend
    last_restart=$(date +%s)
    fail_count=0
    sleep 5
    continue
  fi

  if ! health_ok; then
    fail_count=$((fail_count + 1))
    log "health check failed ($fail_count/$HEALTH_FAIL_THRESHOLD)"
    if [ "$fail_count" -ge "$HEALTH_FAIL_THRESHOLD" ]; then
      log "threshold exceeded — killing and restarting backend"
      pid=$(cat "$PID_FILE" 2>/dev/null || echo "")
      if [ -n "$pid" ]; then
        kill -TERM "$pid" 2>/dev/null || true
        sleep 2
        kill -KILL "$pid" 2>/dev/null || true
      fi
      pkill -f "tsx src/index.ts" 2>/dev/null || true
      sleep 1
      start_backend
      last_restart=$(date +%s)
      fail_count=0
      sleep 5
    fi
  else
    if [ "$fail_count" -gt 0 ]; then
      log "health recovered after $fail_count failures"
    fi
    fail_count=0
  fi
done
