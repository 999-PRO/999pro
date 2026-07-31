#!/usr/bin/env bash
# ============================================================
# 999 PRO — Setup daily cleanup cron job
# ============================================================
# Phase 16: Installs a cron entry that runs the DB cleanup script
# daily at 04:00. This prunes old ProductView (30d), SearchHistory
# (90d), AuditLog (365d) rows and runs VACUUM + ANALYZE.
#
# Usage:
#   bash scripts/setup-cleanup-cron.sh
# ============================================================
set -euo pipefail

PROJECT_DIR="/home/z/my-project/999pro-app/app/mini-services/backend"
LOG_DIR="/home/z/my-project/logs"
CRON_ENTRY="0 4 * * * cd $PROJECT_DIR && bunx tsx scripts/cleanup.ts >> $LOG_DIR/cleanup.log 2>&1"

mkdir -p "$LOG_DIR"

# Check if cron is already installed
if crontab -l 2>/dev/null | grep -q "scripts/cleanup.ts"; then
  echo "✓ Cleanup cron already installed (skipping)"
  exit 0
fi

# Add to crontab
(crontab -l 2>/dev/null || true; echo "$CRON_ENTRY") | crontab -
echo "✓ Cleanup cron installed:"
echo "  $CRON_ENTRY"
echo ""
echo "Logs will be written to: $LOG_DIR/cleanup.log"
echo ""
echo "To run manually: cd $PROJECT_DIR && bunx tsx scripts/cleanup.ts"
