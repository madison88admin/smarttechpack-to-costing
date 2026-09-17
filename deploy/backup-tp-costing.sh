#!/usr/bin/env sh
set -eu

# Backs up the costing database from the VPS Supabase stack.
#
# Two schemas, because a restore needs both:
#   tp_costing — every costing request, CBD, historical costing, audit row.
#   auth       — the Supabase identities the app signs in with.
#
# A dump is only kept when it is verifiably usable: non-empty and containing the
# tables we would have to restore. A truncated dump that looks like a backup is
# worse than no backup at all, so any failure removes the partial file and exits
# non-zero (cron then mails the failure).
#
# Each run writes a .manifest next to the .sql.gz listing the row counts at that
# moment — that is what tells you, months later, which dump still holds a row
# that has since been deleted.
#
# Usage:
#   bash deploy/backup-tp-costing.sh            # take a backup, then prune
#   bash deploy/backup-tp-costing.sh --check    # report what exists, touch nothing
#
# Environment:
#   TP_COSTING_BACKUP_DIR             where dumps land (default /opt/smart-tp-costing/backups)
#   TP_COSTING_BACKUP_RETENTION_DAYS  age at which a dump becomes prunable (default 30)
#   TP_COSTING_BACKUP_KEEP_MINIMUM    newest dumps never pruned (default 7)
#   TP_COSTING_BACKUP_SCHEMAS         schemas to dump (default "tp_costing auth")
#   SUPABASE_DB_CONTAINER             db container name (default supabase-db)

BACKUP_DIR="${TP_COSTING_BACKUP_DIR:-/opt/smart-tp-costing/backups}"
DB_CONTAINER="${SUPABASE_DB_CONTAINER:-supabase-db}"
RETENTION_DAYS="${TP_COSTING_BACKUP_RETENTION_DAYS:-30}"
KEEP_MINIMUM="${TP_COSTING_BACKUP_KEEP_MINIMUM:-7}"
SCHEMAS="${TP_COSTING_BACKUP_SCHEMAS:-tp_costing auth}"

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
fail() { log "BACKUP FAILED: $*"; exit 1; }

manifest_path_for() { printf '%s/%s.manifest' "$BACKUP_DIR" "$(basename "$1" .sql.gz)"; }

# ── --check: report the current state without writing anything ────────────────
if [ "${1:-}" = "--check" ]; then
  echo "backup dir: $BACKUP_DIR"
  if [ ! -d "$BACKUP_DIR" ]; then
    echo "no backup directory yet — nothing has been backed up"
    exit 0
  fi
  count=$(find "$BACKUP_DIR" -name 'tp_costing_*.sql.gz' -type f | wc -l | tr -d ' ')
  echo "dumps on disk: $count"
  find "$BACKUP_DIR" -name 'tp_costing_*.sql.gz' -type f -printf '%TY-%Tm-%Td %TH:%TM  %10s  %p\n' 2>/dev/null \
    | sort -r | head -10
  newest=$(find "$BACKUP_DIR" -name 'tp_costing_*.sql.gz' -type f -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -1 | cut -d' ' -f2-)
  if [ -n "${newest:-}" ]; then
    echo "newest manifest:"
    cat "$(manifest_path_for "$newest")" 2>/dev/null || echo "  (none recorded)"
  fi
  exit 0
fi

mkdir -p "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

dump_schema() {
  schema="$1"
  out="$2"
  required_table="$3"
  raw="$out.raw"

  # pg_dump to a plain file first: in a pipeline the exit status is the LAST
  # command's, so `docker exec ... | gzip` would report gzip's success and hide
  # a failed dump. Checked step by step, a broken dump can never look green.
  if ! docker exec "$DB_CONTAINER" pg_dump -U postgres -d postgres \
      --schema="$schema" --no-owner --no-privileges > "$raw"; then
    rm -f "$raw" "$out"
    fail "pg_dump of schema $schema returned an error"
  fi

  bytes=$(wc -c < "$raw" | tr -d ' ')
  if [ "$bytes" -eq 0 ]; then
    rm -f "$raw" "$out"
    fail "schema $schema dumped nothing (empty dump)"
  fi

  # A dump that cannot describe its own core table is not a usable backup.
  if ! grep -q "CREATE TABLE $required_table" "$raw"; then
    rm -f "$raw" "$out"
    fail "$schema dump does not contain $required_table"
  fi

  if ! gzip -9 < "$raw" > "$out"; then
    rm -f "$raw" "$out"
    fail "could not compress the $schema dump"
  fi
  rm -f "$raw"
  log "wrote $(basename "$out") ($(wc -c < "$out" | tr -d ' ') bytes)"
}

dump_schema tp_costing "$BACKUP_DIR/tp_costing_${STAMP}.sql.gz" "tp_costing.historical_costings"
case " $SCHEMAS " in
  *" auth "*) dump_schema auth "$BACKUP_DIR/auth_${STAMP}.sql.gz" "auth.users" ;;
esac

# ── Manifest: what this backup actually contains ──────────────────────────────
MANIFEST="$(manifest_path_for "$BACKUP_DIR/tp_costing_${STAMP}.sql.gz")"
{
  echo "stamp=$STAMP"
  echo "container=$DB_CONTAINER"
  echo "schemas=$SCHEMAS"
  echo "utc_taken=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  docker exec "$DB_CONTAINER" psql -U postgres -d postgres -Atc "
    select 'count_costing_requests=' || count(*) from tp_costing.costing_requests;
    select 'count_historical_costings=' || count(*) from tp_costing.historical_costings;
    select 'count_factory_cbds=' || count(*) from tp_costing.factory_cbds;
    select 'count_user_profiles=' || count(*) from tp_costing.user_profiles;
    select 'latest_historical_approved=' || coalesce(max(approved_at)::text, 'none')
      from tp_costing.historical_costings;
  " 2>/dev/null || echo "counts_unavailable=true"
} > "$MANIFEST"
log "manifest: $(basename "$MANIFEST")"

# ── Retention: prune by age, but never below the newest KEEP_MINIMUM ─────────
kept=0
for file in $(ls -1t "$BACKUP_DIR"/tp_costing_*.sql.gz 2>/dev/null || true); do
  # Only this script's own dumps (tp_costing_<stamp>.sql.gz) are prunable.
  # Manually named archives (e.g. tp_costing_pre_security_<stamp>.sql.gz) are the
  # only copies that may predate an incident, so they are never deleted here.
  case "$(basename "$file")" in
    tp_costing_[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z.sql.gz) ;;
    *) log "keeping $(basename "$file") (not a scheduled dump)"; continue ;;
  esac
  kept=$((kept + 1))
  [ "$kept" -le "$KEEP_MINIMUM" ] && continue
  if [ -n "$(find "$file" -mtime +"$RETENTION_DAYS" 2>/dev/null)" ]; then
    rm -f "$file" "$(manifest_path_for "$file")"
    log "pruned $(basename "$file") (older than ${RETENTION_DAYS}d)"
  fi
done

log "BACKUP OK — $(basename "$BACKUP_DIR/tp_costing_${STAMP}.sql.gz")"
