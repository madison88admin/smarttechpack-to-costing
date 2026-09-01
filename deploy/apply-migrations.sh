#!/usr/bin/env sh
set -eu

APP_ROOT="${APP_ROOT:-/opt/smart-tp-costing/app}"
DB_CONTAINER="${DB_CONTAINER:-supabase-db}"
MIGRATION="$APP_ROOT/database/migrations/012_production_hardening.sql"

test -s "$MIGRATION"
docker exec "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -tAc "select coalesce((select version from tp_costing.schema_migrations where version='012'), '')" 2>/dev/null \
  | grep -qx 012 && {
    echo "Migration 012 already applied"
    exit 0
  }

docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 < "$MIGRATION"
echo "Migration 012 applied"
