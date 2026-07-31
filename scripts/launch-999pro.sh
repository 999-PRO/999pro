#!/bin/bash
# 999 PRO launcher — fully detaches all services so they survive tool-call exits.
set -u

PROJECT_DIR="${PROJECT_DIR:-/home/z/my-project/999pro}"
LOG_DIR="${PROJECT_DIR:-/home/z/my-project/999pro}/logs"
PID_DIR="${PROJECT_DIR:-/home/z/my-project/999pro}/.run"
mkdir -p "$LOG_DIR" "$PID_DIR"

# Kill stale processes
pkill -f "tsx src/index.ts" 2>/dev/null || true
pkill -f "next dev" 2>/dev/null || true
sleep 1

# Helper: launch a command via setsid + disown, with cwd set, all stdio redirected.
launch() {
  local name="$1"
  local cwd="$2"
  shift 2
  local pidfile="$PID_DIR/$name.pid"
  local logfile="$LOG_DIR/$name.log"

  (
    cd "$cwd"
    setsid nohup "$@" >"$logfile" 2>&1 < /dev/null &
    echo $! > "$pidfile"
    disown
  ) 2>/dev/null
  sleep 0.5
  local pid
  pid=$(cat "$pidfile" 2>/dev/null || echo "?")
  echo "[$name] pid=$pid cwd=$cwd cmd=$*"
}

launch backend  "$PROJECT_DIR/mini-services/backend" bun src/index.ts
launch frontend "$PROJECT_DIR"                       bunx next dev -p 3000 -H 0.0.0.0
launch studio    "$PROJECT_DIR/mini-services/studio"  bunx next dev -p 3001 -H 0.0.0.0

sleep 1
echo ""
echo "Launched. PIDs:"
for n in backend frontend studio; do
  echo "  $n: $(cat $PID_DIR/$n.pid 2>/dev/null)"
done
