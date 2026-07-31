#!/bin/bash
# Launch all 999 PRO services as detached daemons (setsid + nohup).
# Survives parent shell exit.

PROJECT_DIR="/home/z/my-project/999pro"
LOG_DIR="$PROJECT_DIR/logs"
mkdir -p "$LOG_DIR"

# Stop any existing instances
echo "Stopping existing services..."
pkill -f "tsx src/index.ts" 2>/dev/null || true
pkill -f "next dev" 2>/dev/null || true
pkill -f "next-server" 2>/dev/null || true
sleep 2
# Second pass — kill any leftover next-server processes that survived the first pass
pkill -9 -f "next-server" 2>/dev/null || true
sleep 1

# Start backend
echo "Starting backend (Express on port 4000)..."
cd "$PROJECT_DIR/mini-services/backend"
setsid nohup bunx tsx src/index.ts > "$LOG_DIR/backend.log" 2>&1 < /dev/null &
BACKEND_PID=$!
echo "$BACKEND_PID" > "$LOG_DIR/backend.pid"
disown $BACKEND_PID 2>/dev/null || true
sleep 6
if kill -0 $BACKEND_PID 2>/dev/null; then
  echo "  backend PID=$BACKEND_PID alive=YES"
else
  echo "  backend PID=$BACKEND_PID alive=NO"
fi

# Start frontend
echo "Starting frontend (Next.js on port 3000)..."
cd "$PROJECT_DIR"
setsid nohup bun run dev > "$LOG_DIR/frontend.log" 2>&1 < /dev/null &
FRONTEND_PID=$!
echo "$FRONTEND_PID" > "$LOG_DIR/frontend.pid"
disown $FRONTEND_PID 2>/dev/null || true
sleep 6
if kill -0 $FRONTEND_PID 2>/dev/null; then
  echo "  frontend PID=$FRONTEND_PID alive=YES"
else
  echo "  frontend PID=$FRONTEND_PID alive=NO"
fi

# Start studio
echo "Starting studio (Next.js admin on port 3001)..."
cd "$PROJECT_DIR/mini-services/studio"
setsid nohup bun run dev > "$LOG_DIR/studio.log" 2>&1 < /dev/null &
STUDIO_PID=$!
echo "$STUDIO_PID" > "$LOG_DIR/studio.pid"
disown $STUDIO_PID 2>/dev/null || true
sleep 6
if kill -0 $STUDIO_PID 2>/dev/null; then
  echo "  studio PID=$STUDIO_PID alive=YES"
else
  echo "  studio PID=$STUDIO_PID alive=NO"
fi

echo ""
echo "=== All services started ==="
echo "Backend:  http://localhost:4000/api/health"
echo "Frontend: http://localhost:3000"
echo "Studio:   http://localhost:3001"
echo ""
echo "Logs: $LOG_DIR/"
