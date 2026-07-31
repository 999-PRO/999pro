#!/usr/bin/env bash
# ============================================================
# 999 PRO — Install daily DB backup cron job
# ============================================================
# Installs a cron entry that runs scripts/backup-db.sh daily at 03:00.
# Idempotent — running it again updates the existing entry instead of
# duplicating it.
# ============================================================
set -euo pipefail

PROJECT_DIR="/home/z/my-project"
BACKUP_SCRIPT="$PROJECT_DIR/scripts/backup-db.sh"
LOG_FILE="$PROJECT_DIR/logs/backup.log"
CRON_ENTRY="0 3 * * * cd $PROJECT_DIR && bash $BACKUP_SCRIPT >> $LOG_FILE 2>&1"

mkdir -p "$PROJECT_DIR/logs"

# Remove any existing 999pro-backup entries (idempotent)
if crontab -l 2>/dev/null | grep -q "999pro-backup"; then
  echo "Existing 999pro-backup cron entry found — replacing..."
  crontab -l 2>/dev/null | grep -v "999pro-backup" | { cat; echo "# 999pro-backup (auto-managed — do not edit)"; echo "$CRON_ENTRY"; } | crontab -
else
  echo "Installing 999pro-backup cron entry..."
  { crontab -l 2>/dev/null; echo "# 999pro-backup (auto-managed — do not edit)"; echo "$CRON_ENTRY"; } | crontab -
fi

echo "✓ Cron installed. Daily backup at 03:00 → $LOG_FILE"
echo ""
echo "Current crontab:"
crontab -l 2>/dev/null | grep -A1 "999pro-backup" || echo "(no entry)"
echo ""
echo "To test manually:  bash $BACKUP_SCRIPT"
echo "To restore:        bash $PROJECT_DIR/scripts/restore-db.sh latest"
