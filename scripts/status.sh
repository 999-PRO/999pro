#!/bin/bash
# Status of all 999 PRO services

LOG_DIR="/home/z/my-project/app/999pro/logs"
SERVICES=(backend frontend studio)

printf "%-10s %-8s %-8s %s\n" "SERVICE" "PID" "STATUS" "URL"
printf "%-10s %-8s %-8s %s\n" "-------" "---" "------" "---"

PORTS=(4000 3000 3001)
URLS=("http://localhost:4000/api/health" "http://localhost:3000/" "http://localhost:3001/studio/")

for i in "${!SERVICES[@]}"; do
  svc="${SERVICES[$i]}"
  pidfile="$LOG_DIR/$svc.pid"
  pid=$(cat "$pidfile" 2>/dev/null || echo "-")
  status="DEAD"
  if [ "$pid" != "-" ] && kill -0 "$pid" 2>/dev/null; then
    status="ALIVE"
  fi
  printf "%-10s %-8s %-8s %s\n" "$svc" "$pid" "$status" "${URLS[$i]}"
done

echo ""
echo "=== Health checks ==="
curl -s -m 3 http://localhost:4000/api/health && echo " (backend)"
curl -s -o /dev/null -w "frontend: HTTP %{http_code}\n" -m 5 http://localhost:3000/
curl -s -o /dev/null -w "studio:   HTTP %{http_code}\n" -m 5 http://localhost:3001/studio/
