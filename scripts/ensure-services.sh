#!/bin/bash
# 999PRO Marketplace — idempotent service starter for the current sandbox session.
# Starts whatever is down: backend :4000, frontend :3000, studio :3001.
PORT_UP() { ss -ltn 2>/dev/null | grep -q ":$1 "; }

ROOT=/home/z/my-project
LOGS=$ROOT/logs
BACK=$ROOT/mini-services/backend
STUDIO=$ROOT/mini-services/studio
mkdir -p "$LOGS"

if ! PORT_UP 4000; then
  (cd "$BACK" && setsid nohup npx tsx src/index.ts > "$LOGS/backend.log" 2>&1 < /dev/null &)
  echo "[ensure] backend starting..."
fi
if ! PORT_UP 3001; then
  (cd "$STUDIO" && setsid nohup npx next dev -H 0.0.0.0 -p 3001 > "$LOGS/studio.log" 2>&1 < /dev/null &)
  echo "[ensure] studio starting..."
fi
if ! PORT_UP 3000; then
  (cd "$ROOT" && setsid nohup npx next dev -p 3000 > "$LOGS/frontend.log" 2>&1 < /dev/null &)
  echo "[ensure] frontend starting..."
fi

for i in $(seq 1 120); do
  if PORT_UP 4000 && PORT_UP 3000 && PORT_UP 3001; then break; fi
  sleep 1
done

echo "backend:4000=$(PORT_UP 4000 && echo up || echo down) frontend:3000=$(PORT_UP 3000 && echo up || echo down) studio:3001=$(PORT_UP 3001 && echo up || echo down)"
