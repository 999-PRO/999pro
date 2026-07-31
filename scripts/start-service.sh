#!/bin/bash
# Daemon launcher that survives parent shell exit.
# Uses setsid + double-fork-style isolation.

SVC_NAME="$1"
SVC_DIR="$2"
SVC_CMD="$3"

LOG_DIR="/home/z/my-project/app/999pro/logs"
PID_DIR="$LOG_DIR"
mkdir -p "$LOG_DIR"

cd "$SVC_DIR" || exit 1

# Kill existing instance if any
if [ -f "$PID_DIR/$SVC_NAME.pid" ]; then
  OLD_PID=$(cat "$PID_DIR/$SVC_NAME.pid" 2>/dev/null || true)
  if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
    kill -TERM "$OLD_PID" 2>/dev/null || true
    sleep 2
    kill -9 "$OLD_PID" 2>/dev/null || true
  fi
  rm -f "$PID_DIR/$SVC_NAME.pid"
fi

# Start with setsid in a fully detached subshell
setsid bash -c "
  cd '$SVC_DIR'
  exec $SVC_CMD
" > "$LOG_DIR/$SVC_NAME.log" 2>&1 < /dev/null &
PID=$!
echo "$PID" > "$PID_DIR/$SVC_NAME.pid"

# Give it a moment to actually start
sleep 2

if kill -0 "$PID" 2>/dev/null; then
  echo "OK: $SVC_NAME started PID=$PID, alive=yes"
else
  echo "FAIL: $SVC_NAME (PID=$PID) died; log tail:"
  tail -20 "$LOG_DIR/$SVC_NAME.log"
fi
