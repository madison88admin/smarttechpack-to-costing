#!/usr/bin/env sh
set -eu

BACKUP_DIR="${TP_COSTING_BACKUP_DIR:-/opt/smart-tp-costing/backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DB_CONTAINER="${SUPABASE_DB_CONTAINER:-supabase-db}"
OUT_FILE="$BACKUP_DIR/tp_costing_${STAMP}.sql"

mkdir -p "$BACKUP_DIR"
docker exec "$DB_CONTAINER" pg_dump -U postgres --schema=tp_costing postgres > "$OUT_FILE"
gzip "$OUT_FILE"
find "$BACKUP_DIR" -name 'tp_costing_*.sql.gz' -mtime +14 -type f -delete
echo "$OUT_FILE.gz"
