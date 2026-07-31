#!/bin/bash
# Local launcher for 999 PRO in sandbox preview environment.
# Starts backend (4000), frontend (3000), studio (3001) as detached daemons.

PROJECT_DIR="/home/z/my-project/app/999pro"
LOG_DIR="$PROJECT_DIR/logs"
mkdir -p "$LOG_DIR"

# Stop any existing instances
echo "Stopping existing services..."
pkill -f "tsx src/index.ts" 2>/dev/null || true
pkill -f "next-server" 2>/dev/null || true
pkill -f "next dev" 2>/dev/null || true
sleep 2

# Start backend (Express on port 4000)
echo "Starting backend (Express on port 4000)..."
cd "$PROJECT_DIR/mini-services/backend"
nohup bunx tsx src/index.ts > "$LOG_DIR/backend.log" 2>&1 < /dev/null &
BACKEND_PID=$!
echo "$BACKEND_PID" > "$LOG_DIR/backend.pid"
disown $BACKEND_PID 2>/dev/null || true
sleep 6
echo "  backend PID=$BACKEND_PID, alive=$(kill -0 $BACKEND_PID 2>/dev/null && echo yes || echo no)"

# Start frontend (Next.js on port 3000)
echo "Starting frontend (Next.js on port 3000)..."
cd "$PROJECT_DIR"
nohup bun run dev > "$LOG_DIR/frontend.log" 2>&1 < /dev/null &
FRONTEND_PID=$!
echo "$FRONTEND_PID" > "$LOG_DIR/frontend.pid"
disown $FRONTEND_PID 2>/dev/null || true
sleep 4
echo "  frontend PID=$FRONTEND_PID, alive=$(kill -0 $FRONTEND_PID 2>/dev/null && echo yes || echo no)"

# Start studio (Next.js admin on port 3001)
echo "Starting studio (Next.js admin on port 3001)..."
cd "$PROJECT_DIR/mini-services/studio"
nohup bun run dev > "$LOG_DIR/studio.log" 2>&1 < /dev/null &
STUDIO_PID=$!
echo "$STUDIO_PID" > "$LOG_DIR/studio.pid"
disown $STUDIO_PID 2>/dev/null || true
sleep 4
echo "  studio PID=$STUDIO_PID, alive=$(kill -0 $STUDIO_PID 2>/dev/null && echo yes || echo no)"

echo ""
echo "=== All services started ==="
echo "Backend:  http://localhost:4000/api/health"
echo "Frontend: http://localhost:3000"
echo "Studio:   http://localhost:3001/studio"
echo ""
echo "Logs in: $LOG_DIR/"
