#!/usr/bin/env sh
set -eu

URL="${TP_COSTING_HEALTH_URL:-https://smart-tp-costing.5-223-78-194.sslip.io/api/health}"
LOG_FILE="${TP_COSTING_HEALTH_LOG:-/opt/smart-tp-costing/healthcheck.log}"
STAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
STATUS="$(curl -sS -o /tmp/tp_costing_health.out -w '%{http_code}' "$URL" || true)"
BYTES="$(wc -c < /tmp/tp_costing_health.out 2>/dev/null || echo 0)"

echo "$STAMP status=$STATUS bytes=$BYTES url=$URL" >> "$LOG_FILE"
test "$STATUS" = "200"
