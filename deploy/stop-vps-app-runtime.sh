#!/usr/bin/env sh
set -eu

docker stop smart-tp-costing >/dev/null
current_cron="$(mktemp)"
crontab -l 2>/dev/null | grep -v process-notifications.sh > "$current_cron" || true
crontab "$current_cron"
rm -f "$current_cron"

echo APP_CONTAINER
docker ps -a --filter name=smart-tp-costing --format '{{.Names}}|{{.Status}}'
echo BACKEND_CONTAINERS
docker ps --format '{{.Names}}|{{.Status}}' | grep -E 'supabase-(db|auth|rest|kong)'
