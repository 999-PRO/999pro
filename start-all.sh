#!/bin/bash
# Launch all 999 PRO services as detached daemons (nohup + setsid)
# Survives parent shell exit.

# v24.6-audit fix: was hardcoded to a non-existent path
# "/home/z/my-project/app/999pro-v16.8-production". Now derives the project
# directory from this script's location so it works from any checkout.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${PROJECT_DIR:-$SCRIPT_DIR}"
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

pkill -f "tsx src/index.ts" 2>/dev/null || true
pkill -f "next dev" 2>/dev/null || true
sleep 2

# Start backend
echo "Starting backend (Express on port 4000)..."
cd "$PROJECT_DIR/mini-services/backend"
nohup setsid bash -c 'exec bunx tsx src/index.ts' > "$LOG_DIR/backend.log" 2>&1 < /dev/null &
BACKEND_PID=$!
echo "$BACKEND_PID" > "$PID_DIR/backend.pid"
disown $BACKEND_PID 2>/dev/null || true
sleep 5
echo "  backend PID=$BACKEND_PID, alive=$(kill -0 $BACKEND_PID 2>/dev/null && echo yes || echo no)"

# Start frontend (Next.js main app on port 3000)
echo "Starting frontend (Next.js on port 3000)..."
cd "$PROJECT_DIR"
nohup setsid bash -c 'exec bun run dev' > "$LOG_DIR/frontend.log" 2>&1 < /dev/null &
FRONTEND_PID=$!
echo "$FRONTEND_PID" > "$PID_DIR/frontend.pid"
disown $FRONTEND_PID 2>/dev/null || true
sleep 5
echo "  frontend PID=$FRONTEND_PID, alive=$(kill -0 $FRONTEND_PID 2>/dev/null && echo yes || echo no)"

# Start studio (Next.js admin panel on port 3001)
echo "Starting studio (Next.js admin on port 3001)..."
cd "$PROJECT_DIR/mini-services/studio"
nohup setsid bash -c 'exec bun run dev' > "$LOG_DIR/studio.log" 2>&1 < /dev/null &
STUDIO_PID=$!
echo "$STUDIO_PID" > "$PID_DIR/studio.pid"
disown $STUDIO_PID 2>/dev/null || true
sleep 5
echo "  studio PID=$STUDIO_PID, alive=$(kill -0 $STUDIO_PID 2>/dev/null && echo yes || echo no)"

echo ""
echo "=== All services started ==="
echo "Backend:  http://localhost:4000/api/health"
echo "Frontend: http://localhost:3000"
echo "Studio:   http://localhost:3001"
echo ""
echo "Logs in: $LOG_DIR/"
