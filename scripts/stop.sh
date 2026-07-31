#!/bin/bash
# Stop all 999 PRO services
LOG_DIR="/home/z/my-project/app/999pro/logs"
for svc in backend frontend studio; do
  pidfile="$LOG_DIR/$svc.pid"
  if [ -f "$pidfile" ]; then
    pid=$(cat "$pidfile" 2>/dev/null || true)
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      kill -TERM "$pid" 2>/dev/null || true
      sleep 2
      kill -9 "$pid" 2>/dev/null || true
      echo "stopped $svc (PID=$pid)"
    fi
    rm -f "$pidfile"
  fi
done
echo "done"
