#!/bin/bash
# Start all 3 services (backend, frontend, studio) as detached daemon processes.
# Each service runs in its own session via setsid and writes logs to ${PROJECT_DIR:-/home/z/my-project/999pro}/logs/.

set -uo pipefail

PROJECT_DIR=${PROJECT_DIR:-/home/z/my-project/999pro}
LOG_DIR="$PROJECT_DIR/logs"
PID_DIR="$PROJECT_DIR/.zscripts"
mkdir -p "$LOG_DIR" "$PID_DIR"

# Kill any previously started services
for pidfile in "$PID_DIR"/backend.pid "$PID_DIR"/frontend.pid "$PID_DIR"/studio.pid; do
  if [ -f "$pidfile" ]; then
    OLD_PID=$(cat "$pidfile" 2>/dev/null || echo "")
    if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
      kill -TERM "$OLD_PID" 2>/dev/null || true
      sleep 1
      kill -KILL "$OLD_PID" 2>/dev/null || true
    fi
    rm -f "$pidfile"
  fi
done

# Also kill anything still listening on 3000/3001/4000
for port in 3000 3001 4000; do
  fuser -k -TERM "$port"/tcp 2>/dev/null || true
done
sleep 1

# Start BACKEND (port 4000) — Express + Socket.IO + Prisma
echo "Starting backend on port 4000..."
setsid -f bash -c 'cd ${PROJECT_DIR:-/home/z/my-project/999pro}/mini-services/backend && exec bunx tsx watch src/index.ts' \
  > "$LOG_DIR/backend.log" 2>&1 < /dev/null
sleep 6
# Find the actual backend process PID
BACKEND_PID=$(pgrep -f "tsx watch src/index.ts" | head -1)
if [ -n "$BACKEND_PID" ]; then
  echo "  Backend started (PID: $BACKEND_PID)"
  echo "$BACKEND_PID" > "$PID_DIR/backend.pid"
else
  echo "  ERROR: backend did not start"
  tail -20 "$LOG_DIR/backend.log"
fi

# Start FRONTEND (port 3000) — Next.js dev server
echo "Starting frontend on port 3000..."
setsid -f bash -c 'cd /home/z/my-project && exec bun run dev' \
  > "$LOG_DIR/frontend.log" 2>&1 < /dev/null
sleep 5
FRONTEND_PID=$(pgrep -f "next dev" | head -1)
if [ -n "$FRONTEND_PID" ]; then
  echo "  Frontend started (PID: $FRONTEND_PID)"
  echo "$FRONTEND_PID" > "$PID_DIR/frontend.pid"
else
  echo "  ERROR: frontend did not start"
  tail -20 "$LOG_DIR/frontend.log"
fi

# Start STUDIO (port 3001) — Next.js dev server for admin studio
echo "Starting studio on port 3001..."
setsid -f bash -c 'cd ${PROJECT_DIR:-/home/z/my-project/999pro}/mini-services/studio && exec bun run dev' \
  > "$LOG_DIR/studio.log" 2>&1 < /dev/null
sleep 5
STUDIO_PID=$(pgrep -f "next dev -H 0.0.0.0 -p 3001" | head -1)
if [ -n "$STUDIO_PID" ]; then
  echo "  Studio started (PID: $STUDIO_PID)"
  echo "$STUDIO_PID" > "$PID_DIR/studio.pid"
else
  echo "  Studio may still be starting. Check log:"
  tail -20 "$LOG_DIR/studio.log"
fi

echo ""
echo "=========================================="
echo "All services started. Logs in: $LOG_DIR/"
echo "=========================================="
echo ""
echo "Service status:"
for port in 4000 3000 3001; do
  if curl -s --max-time 2 "http://localhost:$port" >/dev/null 2>&1; then
    echo "  Port $port: ✓ responding"
  else
    echo "  Port $port: ✗ not responding yet (may still be starting)"
  fi
done
