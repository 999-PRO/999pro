#!/usr/bin/env bash
# ============================================================
# 999 PRO — PostgreSQL database restore script (Wave 4)
# ============================================================
# Restores the PostgreSQL database from a pg_dump backup file.
# WARNING: stops the backend first, replaces the live DB, then restarts.
#
# Usage:
#   bash scripts/restore-db-postgres.sh <backup-file.dump>
#   bash scripts/restore-db-postgres.sh latest    # restore most recent backup
# ============================================================
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/home/z/my-project/999pro}"
BACKUP_DIR="$PROJECT_DIR/db/backups"

if [ "${1:-}" = "latest" ]; then
  BACKUP=$(ls -t "$BACKUP_DIR"/postgres_*.dump 2>/dev/null | head -1)
  if [ -z "$BACKUP" ]; then
    echo "ERROR: No PostgreSQL backups found in $BACKUP_DIR" >&2
    exit 1
  fi
  echo "Latest backup: $BACKUP"
elif [ -n "${1:-}" ]; then
  BACKUP="$1"
else
  echo "Usage: bash scripts/restore-db-postgres.sh <backup-file.dump|latest>" >&2
  exit 1
fi

if [ ! -f "$BACKUP" ]; then
  echo "ERROR: Backup file not found: $BACKUP" >&2
  exit 1
fi

DATABASE_URL="${BACKEND_DATABASE_URL:-}"
if [ -z "$DATABASE_URL" ]; then
  echo "ERROR: BACKEND_DATABASE_URL not set" >&2
  exit 1
fi

if [[ "$DATABASE_URL" != postgresql://* ]]; then
  echo "ERROR: BACKEND_DATABASE_URL is not a PostgreSQL URL" >&2
  echo "  For SQLite restore, use: bash scripts/restore-db.sh" >&2
  exit 1
fi

# Safety confirmation (skip with --force)
if [ "${2:-}" != "--force" ]; then
  echo ""
  echo "⚠️  WARNING: This will DROP and recreate the database:"
  echo "   Target: $DATABASE_URL"
  echo "   Backup: $BACKUP"
  echo ""
  read -p "Type 'RESTORE' to continue: " CONFIRM
  if [ "$CONFIRM" != "RESTORE" ]; then
    echo "Aborted."
    exit 1
  fi
fi

# Stop backend (it holds DB connections)
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Stopping backend..."
pkill -f "tsx src/index.ts" 2>/dev/null || true
sleep 3

# Restore with pg_restore
# --clean: drop objects before recreating
# --if-exists: don't error if object doesn't exist
# --no-owner: don't set ownership
# --no-privileges: don't set GRANT/REVOKE
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting pg_restore..."
if ! pg_restore \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  --dbname="$DATABASE_URL" \
  --jobs=4 \
  "$BACKUP" 2>&1; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] WARNING: pg_restore reported errors (may be normal for --clean on empty DB)" >&2
  echo "  Verify the restore by checking data counts."
fi

# Restart backend
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Restarting backend..."
cd "$PROJECT_DIR"
setsid bash -c 'cd mini-services/backend && exec bunx tsx src/index.ts' > logs/backend.log 2>&1 < /dev/null &
sleep 5

# Verify
if curl -s http://localhost:4000/api/ready | grep -q '"ok":true'; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ✓ Restore complete, backend healthy"
else
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ⚠ Backend not healthy after restore — check logs/backend.log" >&2
fi
