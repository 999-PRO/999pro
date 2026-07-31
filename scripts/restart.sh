#!/bin/bash
# Restart all 999 PRO services
/home/z/my-project/app/999pro/scripts/stop.sh
sleep 2
/home/z/my-project/app/999pro/scripts/start-service.sh backend \
  /home/z/my-project/app/999pro/mini-services/backend \
  "bunx tsx src/index.ts"
/home/z/my-project/app/999pro/scripts/start-service.sh frontend \
  /home/z/my-project/app/999pro \
  "bun run dev"
/home/z/my-project/app/999pro/scripts/start-service.sh studio \
  /home/z/my-project/app/999pro/mini-services/studio \
  "bun run dev"
echo ""
echo "=== Status ==="
/home/z/my-project/app/999pro/scripts/status.sh
