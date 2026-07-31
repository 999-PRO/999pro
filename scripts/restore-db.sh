#!/usr/bin/env bash
# ============================================================
# 999 PRO — SQLite database restore script
# ============================================================
# Restores the backend SQLite database from a backup file.
# WARNING: stops the backend first, replaces the live DB, then restarts.
#
# FIXED (Phase 0.6):
#   - DB path was wrong (mini-services/backend/db/marketplace.db → db/custom.db)
#   - Typo: $SAETY → $SAFETY
#   - Path: .zscripts/launch.sh → scripts/launch-999pro.sh
#   - Added: integrity check after restore, WAL checkpoint after restore
#
# Usage:
#   bash scripts/restore-db.sh <backup-file.gz>
#   bash scripts/restore-db.sh latest    # restore most recent backup
# ============================================================
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/home/z/my-project/999pro}"
# Wave 2 (C-DB-002): correct DB path — was /home/z/my-project/db/custom.db (nonexistent)
DB_FILE="$PROJECT_DIR/mini-services/backend/prisma/dev.db"
BACKUP_DIR="$PROJECT_DIR/db/backups"

if [ "${1:-}" = "latest" ]; then
  BACKUP=$(ls -t "$BACKUP_DIR"/custom_*.db.gz 2>/dev/null | head -1)
  if [ -z "$BACKUP" ]; then
    echo "ERROR: No backups found in $BACKUP_DIR" >&2
    exit 1
  fi
  echo "Latest backup: $BACKUP"
elif [ -n "${1:-}" ]; then
  BACKUP="$1"
else
  echo "Usage: bash scripts/restore-db.sh <backup-file.gz|latest>" >&2
  exit 1
fi

if [ ! -f "$BACKUP" ]; then
  echo "ERROR: Backup file not found: $BACKUP" >&2
  exit 1
fi

# Stop backend (so no writes during restore)
echo "Stopping backend..."
pkill -f "tsx src/index.ts" 2>/dev/null || true
sleep 2

# Make a safety copy of the current DB before overwriting
if [ -f "$DB_FILE" ]; then
  SAFETY="$DB_FILE.pre-restore.$(date '+%Y%m%d_%H%M%S')"
  cp "$DB_FILE" "$SAFETY"
  chmod 600 "$SAFETY"
  # FIXED: was $SAETY (typo) → $SAFETY
  echo "✓ Safety copy: $SAFETY"
fi

# Decompress and replace
echo "Restoring from $BACKUP..."
gunzip -c "$BACKUP" > "$DB_FILE"
chmod 600 "$DB_FILE"
echo "✓ DB restored: $DB_FILE"

# Integrity check on restored DB
if command -v sqlite3 >/dev/null 2>&1; then
  INTEGRITY=$(sqlite3 "$DB_FILE" "PRAGMA integrity_check;" 2>/dev/null || echo "error")
  if [ "$INTEGRITY" != "ok" ]; then
    echo "ERROR: Restored DB integrity check failed: $INTEGRITY" >&2
    echo "Safety copy is at: $SAFETY"
    exit 1
  fi
  echo "✓ Integrity check: ok"
  # WAL checkpoint after restore — ensures consistent state
  sqlite3 "$DB_FILE" "PRAGMA wal_checkpoint(TRUNCATE);" 2>/dev/null || true
fi

# Restart backend
# FIXED: was .zscripts/launch.sh (doesn't exist) → scripts/launch-999pro.sh
echo "Restarting backend..."
if [ -f "$PROJECT_DIR/scripts/launch-999pro.sh" ]; then
  bash "$PROJECT_DIR/scripts/launch-999pro.sh" 2>&1 | tail -5
elif [ -f "$PROJECT_DIR/999pro-app/scripts/launch-999pro.sh" ]; then
  bash "$PROJECT_DIR/999pro-app/scripts/launch-999pro.sh" 2>&1 | tail -5
else
  echo "WARNING: launch script not found, backend not restarted automatically"
  echo "Restart manually: bash /home/z/my-project/scripts/launch-999pro.sh"
fi
sleep 5
curl -s http://localhost:4000/api/health && echo " ← backend OK"
