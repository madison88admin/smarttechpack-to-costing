#!/usr/bin/env sh
set -eu

# Applies outstanding database migrations on the VPS Supabase stack.
# Idempotent: each migration is recorded in tp_costing.schema_migrations and
# skipped when its version is already present. Run from the app directory:
#   bash deploy/apply-migrations.sh
# (or set APP_ROOT to the deployed app path when running remotely).

APP_ROOT="${APP_ROOT:-/opt/smart-tp-costing/app}"
DB_CONTAINER="${DB_CONTAINER:-supabase-db}"
MIGRATIONS_DIR="$APP_ROOT/database/migrations"

migration_applied() {
  docker exec "$DB_CONTAINER" psql -U postgres -d postgres -tAc \
    "select coalesce((select version from tp_costing.schema_migrations where version='$1'), '')" 2>/dev/null \
    | grep -qx "$1"
}

apply_migration() {
  migration_applied "$1" && {
    echo "Migration $1 already applied"
    return 0
  }
  test -s "$MIGRATIONS_DIR/$2"
  docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 < "$MIGRATIONS_DIR/$2"
  echo "Migration $1 applied"
}

apply_migration 012 012_production_hardening.sql
apply_migration 013 013_notification_reads.sql
apply_migration 014 014_retire_manager_status.sql
apply_migration 015 015_db_clock_cbd_submitted_at.sql