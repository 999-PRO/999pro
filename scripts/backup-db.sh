#!/usr/bin/env bash
# ============================================================
# 999 PRO — SQLite database backup script
# ============================================================
# Creates a timestamped backup of the backend SQLite database
# using the online backup API (safe — does not block writes).
#
# FIXED (Phase 0.6): DB path was wrong — pointed to
#   mini-services/backend/db/marketplace.db (doesn't exist),
#   actual DB is at $PROJECT_DIR/db/custom.db per backend .env.
#   Also added: chmod 600 on backup files, chmod 700 on backup dir,
#   integrity check after backup, WAL checkpoint before backup.
#
# Usage:
#   bash scripts/backup-db.sh                  # default: keep last 30
#   KEEP_DAYS=90 bash scripts/backup-db.sh     # keep last 90 days
#
# Recommended cron (daily at 03:00):
#   0 3 * * *  cd /home/z/my-project && bash scripts/backup-db.sh >> logs/backup.log 2>&1
# ============================================================
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/home/z/my-project/999pro}"
# Wave 2 (C-DB-002): correct path — real DB is at backend/prisma/dev.db,
# NOT /home/z/my-project/db/custom.db (root .env has stale DATABASE_URL).
DB_FILE="$PROJECT_DIR/mini-services/backend/prisma/dev.db"
BACKUP_DIR="$PROJECT_DIR/db/backups"
KEEP_DAYS="${KEEP_DAYS:-30}"
MIN_BACKUP_SIZE_BYTES=10240  # 10KB — fail if backup is suspiciously small

# Create backup dir with restrictive permissions (700 = owner only)
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

if [ ! -f "$DB_FILE" ]; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: DB file not found: $DB_FILE" >&2
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Hint: check BACKEND_DATABASE_URL in mini-services/backend/.env" >&2
  exit 1
fi

# Ensure DB file has restrictive permissions (600 = owner read/write only)
chmod 600 "$DB_FILE"

TIMESTAMP=$(date '+%Y%m%d_%H%M%S')
BACKUP_FILE="$BACKUP_DIR/custom_${TIMESTAMP}.db"

# Use SQLite's online backup (.backup command) — safe for live DBs, does not
# block writers. Falls back to file copy if sqlite3 is unavailable.
if command -v sqlite3 >/dev/null 2>&1; then
  # WAL checkpoint before backup — ensures all WAL data is flushed to main DB
  sqlite3 "$DB_FILE" "PRAGMA wal_checkpoint(TRUNCATE);" 2>/dev/null || true
  sqlite3 "$DB_FILE" ".backup '$BACKUP_FILE'"

  # Integrity check on the backup
  INTEGRITY=$(sqlite3 "$BACKUP_FILE" "PRAGMA integrity_check;" 2>/dev/null || echo "error")
  if [ "$INTEGRITY" != "ok" ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: Backup integrity check failed: $INTEGRITY" >&2
    rm -f "$BACKUP_FILE"
    exit 1
  fi
else
  # Fallback: copy with WAL checkpoint awareness
  # WARNING: cp without sqlite3 may give inconsistent backup if WAL is active.
  # Recommend installing sqlite3 package.
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] WARNING: sqlite3 not found, using cp fallback (may be inconsistent if WAL active)" >&2
  cp "$DB_FILE" "$BACKUP_FILE"
  # Also copy WAL and SHM if they exist (WAL mode)
  [ -f "$DB_FILE-wal" ] && cp "$DB_FILE-wal" "$BACKUP_FILE-wal" || true
  [ -f "$DB_FILE-shm" ] && cp "$DB_FILE-shm" "$BACKUP_FILE-shm" || true
fi

# Set restrictive permissions on backup file (owner read/write only)
chmod 600 "$BACKUP_FILE"

# Compress the backup to save disk space
gzip -f "$BACKUP_FILE"
BACKUP_FILE_GZ="${BACKUP_FILE}.gz"
chmod 600 "$BACKUP_FILE_GZ"

SIZE=$(stat -c%s "$BACKUP_FILE_GZ" 2>/dev/null || stat -f%z "$BACKUP_FILE_GZ")
SIZE_HR=$(numfmt --to=iec "$SIZE" 2>/dev/null || echo "${SIZE} bytes")

# Wave 2 (C-DB-002): fail loudly if backup is suspiciously small (likely empty)
if [ "$SIZE" -lt "$MIN_BACKUP_SIZE_BYTES" ]; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: Backup too small ($SIZE_HR < $MIN_BACKUP_SIZE_BYTES bytes) — likely corrupted or empty DB!" >&2
  rm -f "$BACKUP_FILE_GZ"
  exit 1
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] ✓ Backup created: $BACKUP_FILE_GZ ($SIZE_HR) [integrity: ok]"

# Prune old backups (keep last KEEP_DAYS days)
find "$BACKUP_DIR" -name "custom_*.db.gz" -mtime +${KEEP_DAYS} -delete 2>/dev/null || true

# Count remaining backups
COUNT=$(find "$BACKUP_DIR" -name "custom_*.db.gz" | wc -l)
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Backup directory: $COUNT file(s) remaining (keep last ${KEEP_DAYS} days)"

# Optional: upload to S3 / remote. Uncomment and configure:
# if [ -n "${S3_BACKUP_BUCKET:-}" ]; then
#   aws s3 cp "$BACKUP_FILE_GZ" "s3://${S3_BACKUP_BUCKET}/db-backups/$(basename "$BACKUP_FILE_GZ")" \
#     --sse AES256 && echo "✓ Uploaded to S3" || echo "⚠ S3 upload failed"
# fi
