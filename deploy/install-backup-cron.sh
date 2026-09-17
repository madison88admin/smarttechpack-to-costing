#!/usr/bin/env sh
set -eu

# Installs the daily database backup into root's crontab, idempotently.
#
# Run on the VPS:
#   bash /opt/smart-tp-costing/app/deploy/install-backup-cron.sh
#
# Re-running replaces the existing backup entry instead of adding a second one,
# and leaves every other cron line untouched. Verify with:
#   crontab -l | grep backup-tp-costing
#   bash /opt/smart-tp-costing/app/deploy/backup-tp-costing.sh --check

APP_ROOT="${APP_ROOT:-/opt/smart-tp-costing/app}"
SCHEDULE="${TP_COSTING_BACKUP_SCHEDULE:-0 2 * * *}"
LOG_FILE="${TP_COSTING_BACKUP_LOG:-/var/log/tp-costing-backup.log}"

if [ ! -x "$APP_ROOT/deploy/backup-tp-costing.sh" ]; then
  echo "backup script not executable at $APP_ROOT/deploy/backup-tp-costing.sh" >&2
  echo "fix with: chmod +x $APP_ROOT/deploy/backup-tp-costing.sh" >&2
  exit 1
fi

CRON_LINE="$SCHEDULE $APP_ROOT/deploy/backup-tp-costing.sh >> $LOG_FILE 2>&1"

existing="$(crontab -l 2>/dev/null || true)"
printf '%s\n' "$existing" | grep -v 'deploy/backup-tp-costing.sh' | grep -v '^$' > /tmp/tp-costing-crontab.$$
printf '%s\n' "$CRON_LINE" >> /tmp/tp-costing-crontab.$$
crontab /tmp/tp-costing-crontab.$$
rm -f /tmp/tp-costing-crontab.$$

echo "installed: $CRON_LINE"
echo "active entries:"
crontab -l | grep 'backup-tp-costing.sh' || true
