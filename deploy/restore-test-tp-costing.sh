#!/usr/bin/env sh
set -eu

BACKUP_FILE="${1:-}"
TEST_CONTAINER="${TP_COSTING_RESTORE_TEST_CONTAINER:-tp-costing-restore-test}"
TEST_IMAGE="${TP_COSTING_RESTORE_TEST_IMAGE:-pgvector/pgvector:pg15}"

if [ -z "$BACKUP_FILE" ] || [ ! -f "$BACKUP_FILE" ]; then
  echo "Usage: $0 /path/to/tp_costing_YYYYMMDD.sql.gz" >&2
  exit 2
fi

docker rm -f "$TEST_CONTAINER" >/dev/null 2>&1 || true
docker run -d --name "$TEST_CONTAINER" -e POSTGRES_PASSWORD=restoretest "$TEST_IMAGE" >/dev/null

cleanup() {
  docker rm -f "$TEST_CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT

sleep 8
docker exec "$TEST_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c "create extension if not exists vector; do \$\$ begin create role service_role; exception when duplicate_object then null; end \$\$;" >/tmp/tp_costing_restore_test.out
gzip -dc "$BACKUP_FILE" | docker exec -i "$TEST_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 >>/tmp/tp_costing_restore_test.out
docker exec "$TEST_CONTAINER" psql -U postgres -d postgres -tAc "select count(*) from information_schema.tables where table_schema='tp_costing';"
