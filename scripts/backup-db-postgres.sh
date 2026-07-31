#!/usr/bin/env bash
# ============================================================
# 999 PRO — PostgreSQL database backup script (Wave 4)
# ============================================================
# Creates a timestamped backup of the PostgreSQL database using
# pg_dump with custom format (compressed, parallel-restore capable).
#
# Usage:
#   bash scripts/backup-db-postgres.sh                  # default: keep last 30
#   KEEP_DAYS=90 bash scripts/backup-db-postgres.sh     # keep last 90 days
#
# Prerequisites:
#   - PostgreSQL client tools (pg_dump) installed
#   - BACKEND_DATABASE_URL env var set to postgresql://...
#   - Or PGPASSWORD env var + explicit -h/-U/-d flags
#
# Recommended cron (daily at 03:00):
#   0 3 * * *  cd /home/z/my-project/999pro && bash scripts/backup-db-postgres.sh >> logs/backup.log 2>&1
# ============================================================
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/home/z/my-project/999pro}"
BACKUP_DIR="$PROJECT_DIR/db/backups"
KEEP_DAYS="${KEEP_DAYS:-30}"
MIN_BACKUP_SIZE_BYTES=10240  # 10KB — fail if backup is suspiciously small

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

# Parse BACKEND_DATABASE_URL if set
DATABASE_URL="${BACKEND_DATABASE_URL:-}"
if [ -z "$DATABASE_URL" ]; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: BACKEND_DATABASE_URL not set" >&2
  echo "  Expected: postgresql://user:pass@host:port/dbname?schema=public" >&2
  exit 1
fi

if [[ "$DATABASE_URL" != postgresql://* ]]; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: BACKEND_DATABASE_URL is not a PostgreSQL URL" >&2
  echo "  Got: $DATABASE_URL" >&2
  echo "  For SQLite backup, use: bash scripts/backup-db.sh" >&2
  exit 1
fi

TIMESTAMP=$(date '+%Y%m%d_%H%M%S')
BACKUP_FILE="$BACKUP_DIR/postgres_${TIMESTAMP}.dump"

# pg_dump with custom format (compressed, parallel-restore capable)
# --no-owner: don't include ownership commands (portable across users)
# --no-privileges: don't include GRANT/REVOKE (portable)
# --format=custom: compressed binary format, ~70% smaller than SQL
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting pg_dump..."
if ! pg_dump "$DATABASE_URL" \
  --no-owner \
  --no-privileges \
  --format=custom \
  --compress=9 \
  --file="$BACKUP_FILE" 2>&1; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: pg_dump failed" >&2
  rm -f "$BACKUP_FILE"
  exit 1
fi

chmod 600 "$BACKUP_FILE"

SIZE=$(stat -c%s "$BACKUP_FILE" 2>/dev/null || stat -f%z "$BACKUP_FILE")
SIZE_HR=$(numfmt --to=iec "$SIZE" 2>/dev/null || echo "${SIZE} bytes")

# Wave 2 (C-DB-002): fail loudly if backup is suspiciously small
if [ "$SIZE" -lt "$MIN_BACKUP_SIZE_BYTES" ]; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: Backup too small ($SIZE_HR < $MIN_BACKUP_SIZE_BYTES bytes) — likely corrupted or empty DB!" >&2
  rm -f "$BACKUP_FILE"
  exit 1
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] ✓ Backup created: $BACKUP_FILE ($SIZE_HR)"

# Verify backup integrity (pg_restore --list reads the archive header)
if ! pg_restore --list "$BACKUP_FILE" >/dev/null 2>&1; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: Backup integrity check failed!" >&2
  rm -f "$BACKUP_FILE"
  exit 1
fi

# Prune old backups (keep last KEEP_DAYS days)
find "$BACKUP_DIR" -name "postgres_*.dump" -mtime +${KEEP_DAYS} -delete 2>/dev/null || true

# Count remaining backups
COUNT=$(find "$BACKUP_DIR" -name "postgres_*.dump" | wc -l)
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Backup directory: $COUNT file(s) remaining (keep last ${KEEP_DAYS} days)"

# Optional: upload to S3 / remote. Uncomment and configure:
# if [ -n "${S3_BACKUP_BUCKET:-}" ]; then
#   aws s3 cp "$BACKUP_FILE" "s3://${S3_BACKUP_BUCKET}/db-backups/$(basename "$BACKUP_FILE")" \
#     --sse AES256 && echo "✓ Uploaded to S3" || echo "⚠ S3 upload failed"
# fi
