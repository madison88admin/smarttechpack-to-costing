#!/usr/bin/env sh
set -eu
echo CONTAINER
docker ps --filter name=smart-tp-costing --format '{{.Names}}|{{.Status}}|{{.Image}}'
echo HEALTH
curl -sS -o /tmp/tp-health.json -w '%{http_code}\n' http://127.0.0.1:3110/api/health
cat /tmp/tp-health.json
echo ENV_FLAGS
sed -n '/^TP_COSTING_ENABLE_/p;/^TP_COSTING_SESSION_SECRET=/s/=.*/=configured/p;/^CRON_SECRET=/s/=.*/=configured/p' /opt/smart-tp-costing/app/deploy/.env.costing
echo PREVIOUS
find /opt/smart-tp-costing -maxdepth 1 -type d -name 'app_prev_20260810*' -print
echo CRON
crontab -l | grep process-notifications || true
