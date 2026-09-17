#!/usr/bin/env bash
# Boots a disposable Postgres + PostgREST + the app, then replays the fuzz
# harness in anon + pbd + admin modes so hostile query patterns hit a real
# PostgREST on every CI run (see .github/workflows/ci.yml, job `fuzz-live`).
#
# The app talks to supabase-js, which always calls "<url>/rest/v1/...". Bare
# PostgREST serves at the root, so scripts/ci-rest-proxy.mjs strips the
# /rest/v1 prefix and forwards to it. The app's service client authenticates
# with a JWT minted for the `service_role` Postgres role and signed with the
# PostgREST jwt-secret (mirrors the Supabase service-role contract).
#
# Requirements (the CI job installs these): psql, node + npm deps installed,
# a Postgres reachable at $DB_URL, and the postgrest binary at $POSTGREST_BIN.
set -euo pipefail

DB_URL="${DB_URL:-postgres://postgres:postgres@127.0.0.1:5432/postgres}"
PGREST_PORT="${PGREST_PORT:-3000}"
PROXY_PORT="${PROXY_PORT:-3100}"
APP_PORT="${APP_PORT:-3122}"
APP_URL="http://127.0.0.1:${APP_PORT}"
POSTGREST_BIN="${POSTGREST_BIN:-postgrest}"
SESSION_SECRET="${TP_COSTING_SESSION_SECRET:-ci-fuzz-session-secret-at-least-32-characters}"
JWT_SECRET="$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

PIDS=()
cleanup() {
  for pid in "${PIDS[@]:-}"; do kill "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
}
trap cleanup EXIT

log() { echo "[boot] $*"; }

log "== 1/6 database roles and extensions =="
psql "$DB_URL" -v ON_ERROR_STOP=1 -q <<SQL
create role anon nologin;  -- Supabase's role trio; the schema's RLS statements revoke from anon/authenticated
create role authenticated nologin;
create role service_role nologin bypassrls;
create extension if not exists vector;  -- schema declares vector(1536); production Supabase ships pgvector
SQL

log "== 2/6 schema + migrations =="
psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$ROOT/database/tp_costing_schema.sql"
for f in "$ROOT"/database/migrations/*.sql; do
  log "  applying $(basename "$f")"
  psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$f"
done
psql "$DB_URL" -v ON_ERROR_STOP=1 -q -c "grant usage on schema tp_costing to service_role;"

log "== 3/6 PostgREST =="
cat > /tmp/tp-fuzz-postgrest.conf <<EOF
db-uri = "${DB_URL}"
db-schemas = "tp_costing"
db-anon-role = "anon"
jwt-secret = "${JWT_SECRET}"
server-host = "127.0.0.1"
server-port = ${PGREST_PORT}
EOF
"$POSTGREST_BIN" /tmp/tp-fuzz-postgrest.conf > /tmp/tp-fuzz-postgrest.log 2>&1 &
PIDS+=($!)
for _ in $(seq 1 30); do
  if curl -sf -o /dev/null "http://127.0.0.1:${PGREST_PORT}/" 2>/dev/null; then break; fi
  sleep 1
done
curl -sf -o /dev/null "http://127.0.0.1:${PGREST_PORT}/" || {
  echo "[boot] PostgREST failed to start — log:"; cat /tmp/tp-fuzz-postgrest.log; exit 1;
}
log "  PostgREST up on :${PGREST_PORT}"

log "== 4/6 /rest/v1 proxy + service-role JWT =="
SERVICE_JWT="$(cd "$ROOT" && node --input-type=module -e \
  "import {mintToken} from './scripts/fuzz-http.mjs'; console.log(mintToken('${JWT_SECRET}', 'service_role'))")"
POSTGREST_UPSTREAM="http://127.0.0.1:${PGREST_PORT}" PORT="${PROXY_PORT}" node "$ROOT/scripts/ci-rest-proxy.mjs" > /tmp/tp-fuzz-proxy.log 2>&1 &
PIDS+=($!)
sleep 1
curl -sf -o /dev/null "http://127.0.0.1:${PROXY_PORT}/rest/v1/" || {
  echo "[boot] proxy failed — log:"; cat /tmp/tp-fuzz-proxy.log; exit 1;
}
log "  proxy up on :${PROXY_PORT}"

log "== 5/6 app dev server =="
(
  cd "$ROOT"
  NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:${PROXY_PORT}" \
  SUPABASE_SERVICE_ROLE_KEY="${SERVICE_JWT}" \
  NEXT_PUBLIC_SUPABASE_ANON_KEY="ci-anon-placeholder" \
  TP_COSTING_SESSION_SECRET="${SESSION_SECRET}" \
  NEXTGEN_BASE_URL="https://nextgen.invalid" \
  NEXTGEN_USERNAME="ci" \
  NEXTGEN_PASSWORD="ci" \
  PORT="${APP_PORT}" HOSTNAME="127.0.0.1" \
  npm run dev -- -p "${APP_PORT}" > /tmp/tp-fuzz-app.log 2>&1 &
)
PIDS+=($!)
for _ in $(seq 1 90); do
  if curl -sf -o /dev/null "${APP_URL}/api/health" 2>/dev/null; then break; fi
  sleep 1
done
curl -sf -o /dev/null "${APP_URL}/api/health" || {
  echo "[boot] app failed to start — log tail:"; tail -50 /tmp/tp-fuzz-app.log; exit 1;
}
log "  app up on ${APP_URL}"

log "== 6/6 fuzz harness (unauthenticated + pbd + admin) =="
cd "$ROOT"
# --skip-upstream: NextGen is not reachable in CI and the NextGen client throws
# on a failed upstream login, which would 500 the proxy routes regardless of
# the param. The DB-backed surface (the regression class this replay guards) is
# fully probed; upstream proxies are fuzzed where NextGen is reachable instead.
node scripts/fuzz-http.mjs --roles pbd,admin --secret "${SESSION_SECRET}" --base "${APP_URL}" --concurrency 4 --skip-upstream
