#!/bin/bash
# Cron job configuration for Smart TP Costing Approval Tool
# Add these to your server's crontab (crontab -e) or systemd timers

# === Escalation Processing ===
# Run escalation check daily at 9 AM (checks SLA breaches, sends reminders/escalations)
0 9 * * * curl -s -X POST https://costing.madison88.com/api/notifications/escalate -H "x-cron-secret: $CRON_SECRET" >> /var/log/tp-costing-cron.log 2>&1

# === NextGen Metadata Refresh ===
# Re-fetch the NextGen product row (status, composition, SMV/labor) for active
# requests hourly; alerts the costing team when the metadata changed.
0 * * * * curl -s -X POST https://costing.madison88.com/api/admin/refresh-nextgen-metadata -H "x-cron-secret: $CRON_SECRET" -H "Content-Type: application/json" -d '{}' >> /var/log/tp-costing-cron.log 2>&1

# === Notification Queue Processing ===
# Process notification queue every 30 minutes (sends pending email/Teams notifications)
*/30 * * * * curl -s -X POST https://costing.madison88.com/api/notifications/process -H "x-cron-secret: $CRON_SECRET" >> /var/log/tp-costing-cron.log 2>&1

# === Scheduled Reporting ===
# Runs daily; the admin setting controls whether it sends and whether it is weekly.
0 7 * * * curl -s -X POST https://costing.madison88.com/api/notifications/daily-digest -H "x-cron-secret: $CRON_SECRET" >> /var/log/tp-costing-cron.log 2>&1

# === NextGen Historical Backfill ===
# Re-fetch Dropped/archived NextGen products daily and push newly-available
# knitting-time / SMV values (and BOM consumption) into existing synced rows.
# Emails admins when new values are actually populated; silent otherwise.
0 4 * * * curl -s -X POST https://costing.madison88.com/api/admin/backfill-nextgen-times -H "x-cron-secret: $CRON_SECRET" -H "Content-Type: application/json" -d '{"enrichBom":true}' >> /var/log/tp-costing-cron.log 2>&1

# === Database Backup ===
# Daily pg_dump of the tp_costing app schema AND the Supabase auth identities,
# with a row-count manifest per run. Restore needs both, and losing an approved
# historical costing row is unrecoverable without a dump from before it went.
# Prefer the installer (idempotent): bash deploy/install-backup-cron.sh
# NB: the live VPS runs this at 18:15 UTC, not 02:00, writing to
# /opt/smart-tp-costing/backup.log. Check `crontab -l | grep backup` before
# trusting either number — the crontab is the only source of truth.
0 2 * * * /opt/smart-tp-costing/app/deploy/backup-tp-costing.sh >> /var/log/tp-costing-backup.log 2>&1

# === Health Check ===
# Check API health every 5 minutes
*/5 * * * * curl -s -o /dev/null -w "%{http_code}" https://costing.madison88.com/api/health >> /var/log/tp-costing-health.log 2>&1

# === Setup Instructions ===
# 1. Set CRON_SECRET in your .env.local or server environment
# 2. Copy this file to /etc/cron.d/tp-costing or add entries via crontab -e
# 3. Ensure curl is installed and the server URL is correct
# 4. Create log directory: sudo mkdir -p /var/log && touch /var/log/tp-costing-cron.log /var/log/tp-costing-health.log
# 5. Set proper permissions: sudo chown $USER /var/log/tp-costing-*.log
