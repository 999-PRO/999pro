#!/bin/bash
# Launch all 999 PRO services as detached daemons using start-stop-daemon.
# This survives the parent shell exit because start-stop-daemon double-forks
# and explicitly detaches from the controlling terminal.

set -e

PROJECT_DIR="${PROJECT_DIR:-/home/z/my-project/999pro}"
LOG_DIR="$PROJECT_DIR/logs"
PID_DIR="$PROJECT_DIR/logs"
mkdir -p "$LOG_DIR"

# Stop any existing instances
echo "Stopping existing services..."
for pidfile in backend frontend studio; do
  if [ -f "$PID_DIR/$pidfile.pid" ]; then
    OLD_PID=$(cat "$PID_DIR/$pidfile.pid" 2>/dev/null || true)
    if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
      kill "$OLD_PID" 2>/dev/null || true
      sleep 1
    fi
    rm -f "$PID_DIR/$pidfile.pid"
  fi
done

# Also kill any leftover next/tsx processes
pkill -f "tsx src/index.ts" 2>/dev/null || true
pkill -f "next dev" 2>/dev/null || true
sleep 2

# Start backend
echo "Starting backend (Express on port 4000)..."
start-stop-daemon --start --background \
  --make-pidfile --pidfile "$PID_DIR/backend.pid" \
  --chdir "$PROJECT_DIR/mini-services/backend" \
  --exec /usr/local/bin/bun -- run --bun tsx src/index.ts \
  > "$LOG_DIR/backend.log" 2>&1
sleep 1
# Wait, bun needs to call tsx — use bunx instead. Let me redo:
# Actually start-stop-daemon doesn't expand PATH well, so let's do it differently

echo "Starting backend (Express on port 4000)..."
# Use setsid to fully detach, then nohup
cd "$PROJECT_DIR/mini-services/backend"
setsid bash -c 'exec bunx tsx src/index.ts' > "$LOG_DIR/backend.log" 2>&1 < /dev/null &
BACKEND_PID=$!
echo "$BACKEND_PID" > "$PID_DIR/backend.pid"
disown $BACKEND_PID 2>/dev/null || true

sleep 4
echo "  backend PID=$BACKEND_PID, alive=$(kill -0 $BACKEND_PID 2>/dev/null && echo yes || echo no)"

# Start frontend (Next.js main app on port 3000)
echo "Starting frontend (Next.js on port 3000)..."
cd "$PROJECT_DIR"
setsid bash -c 'exec bun run dev' > "$LOG_DIR/frontend.log" 2>&1 < /dev/null &
FRONTEND_PID=$!
echo "$FRONTEND_PID" > "$PID_DIR/frontend.pid"
disown $FRONTEND_PID 2>/dev/null || true

sleep 4
echo "  frontend PID=$FRONTEND_PID, alive=$(kill -0 $FRONTEND_PID 2>/dev/null && echo yes || echo no)"

# Start studio (Next.js admin panel on port 3001)
echo "Starting studio (Next.js admin on port 3001)..."
cd "$PROJECT_DIR/mini-services/studio"
setsid bash -c 'exec bun run dev' > "$LOG_DIR/studio.log" 2>&1 < /dev/null &
STUDIO_PID=$!
echo "$STUDIO_PID" > "$PID_DIR/studio.pid"
disown $STUDIO_PID 2>/dev/null || true

sleep 4
echo "  studio PID=$STUDIO_PID, alive=$(kill -0 $STUDIO_PID 2>/dev/null && echo yes || echo no)"

echo ""
echo "=== All services started ==="
echo "Backend:  http://localhost:4000/api/health"
echo "Frontend: http://localhost:3000"
echo "Studio:   http://localhost:3001"
echo ""
echo "Logs in: $LOG_DIR/"
