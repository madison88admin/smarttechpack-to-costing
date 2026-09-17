#!/usr/bin/env sh
set -eu

ROOT=/opt/smart-tp-costing
ARCHIVE=/tmp/smart-tp-costing-security.tar.gz
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
CURRENT="$ROOT/app"
NEW="$ROOT/app_new_$STAMP"
PREVIOUS="$ROOT/app_prev_$STAMP"

test -s "$ARCHIVE"
mkdir -p "$NEW"
tar -xzf "$ARCHIVE" -C "$NEW"
cp "$CURRENT/deploy/.env.costing" "$NEW/deploy/.env.costing"
chmod 600 "$NEW/deploy/.env.costing"

set_env() {
  key="$1"
  value="$2"
  file="$NEW/deploy/.env.costing"
  if grep -q "^${key}=" "$file"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$file"
  else
    printf '%s=%s\n' "$key" "$value" >> "$file"
  fi
}

set_env TP_COSTING_ENABLE_SUPABASE_AUTH true
set_env TP_COSTING_ENABLE_LEGACY_PASSWORD_LOGIN false
set_env NEXT_PUBLIC_APP_URL https://smart-tp-costing.5-223-78-194.sslip.io
if ! grep -q '^TP_COSTING_SESSION_SECRET=' "$NEW/deploy/.env.costing"; then
  set_env TP_COSTING_SESSION_SECRET "$(openssl rand -hex 48)"
fi
if ! grep -q '^CRON_SECRET=' "$NEW/deploy/.env.costing"; then
  set_env CRON_SECRET "$(openssl rand -hex 32)"
fi

# Migrate the new tree BEFORE the swap. If a migration fails, the running app is
# left untouched and still consistent; migrating after the swap leaves the code
# on the new version and the container on the old image — half deployed, which is
# exactly what a failed migration did once.
chmod 700 "$NEW/deploy/apply-migrations.sh"
APP_ROOT="$NEW" "$NEW/deploy/apply-migrations.sh"

mv "$CURRENT" "$PREVIOUS"
mv "$NEW" "$CURRENT"

rollback() {
  echo "Deployment failed; restoring previous application" >&2
  rm -rf "$CURRENT"
  mv "$PREVIOUS" "$CURRENT"
  cd "$CURRENT/deploy"
  docker compose -f docker-compose.costing.yml up -d --build
}
trap rollback INT TERM HUP

cd "$CURRENT/deploy"
if ! docker compose -f docker-compose.costing.yml up -d --build; then
  rollback
  exit 1
fi

chmod 700 "$CURRENT/deploy/process-notifications.sh"
cron_line="*/5 * * * * $CURRENT/deploy/process-notifications.sh >> $ROOT/notification-cron.log 2>&1"
(crontab -l 2>/dev/null | grep -v 'process-notifications.sh'; echo "$cron_line") | crontab -

sleep 3
curl --fail --silent --show-error --max-time 30 http://127.0.0.1:3110/api/health >/dev/null
trap - INT TERM HUP
echo "DEPLOY_OK previous=$PREVIOUS"
