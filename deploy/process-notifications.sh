#!/usr/bin/env sh
set -eu

ENV_FILE="${TP_COSTING_ENV_FILE:-/opt/smart-tp-costing/app/deploy/.env.costing}"
APP_URL="${TP_COSTING_INTERNAL_URL:-http://127.0.0.1:3110}"
secret="$(sed -n 's/^CRON_SECRET=//p' "$ENV_FILE" | tail -1)"
if [ -z "$secret" ]; then
  echo "CRON_SECRET is not configured" >&2
  exit 1
fi

curl --fail --silent --show-error --max-time 45 \
  -X POST -H "x-cron-secret: $secret" "$APP_URL/api/notifications/escalate" >/dev/null
curl --fail --silent --show-error --max-time 45 \
  -X POST -H "x-cron-secret: $secret" "$APP_URL/api/notifications/process" >/dev/null
echo "notification processor completed at $(date -u +%FT%TZ)"
