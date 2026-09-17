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

# Which role applies the migrations. Not postgres by default: part of tp_costing
# is owned by the stack's superuser (supabase_admin) and this image's `postgres`
# role is NOT a superuser, so CREATE INDEX / ALTER TABLE on those tables fails
# with "must be owner of table". That is how a rollout once stopped half-way —
# after the code swap, before the container rebuild, because the failure happened
# between the two. Run as the owner when it can connect; DB_USER overrides.
DB_USER="${DB_USER:-}"
if [ -z "$DB_USER" ]; then
  if docker exec "$DB_CONTAINER" psql -U supabase_admin -d postgres -tAc "select 1" >/dev/null 2>&1; then
    DB_USER=supabase_admin
  else
    DB_USER=postgres
  fi
fi
echo "Applying migrations as role: $DB_USER"

migration_applied() {
  docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d postgres -tAc \
    "select coalesce((select version from tp_costing.schema_migrations where version='$1'), '')" 2>/dev/null \
    | grep -qx "$1"
}

apply_migration() {
  migration_applied "$1" && {
    echo "Migration $1 already applied"
    return 0
  }
  test -s "$MIGRATIONS_DIR/$2"
  docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 < "$MIGRATIONS_DIR/$2"
  echo "Migration $1 applied"
}

apply_migration 012 012_production_hardening.sql
apply_migration 013 013_notification_reads.sql
apply_migration 014 014_retire_manager_status.sql
apply_migration 015 015_db_clock_cbd_submitted_at.sql
apply_migration 016 016_cbd_change_requests.sql
apply_migration 017 017_retire_manager_recipients.sql
apply_migration 018 018_historical_machine_cost.sql
apply_migration 019 019_active_request_unique_index.sql
apply_migration 020 020_nextgen_filter_option_snapshot.sql
apply_migration 021 021_reconcile_cost_sheet_ready_and_photos.sql