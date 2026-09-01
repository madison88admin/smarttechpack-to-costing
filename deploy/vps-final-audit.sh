#!/usr/bin/env sh
set -eu
echo HEALTH
curl -sS --fail http://127.0.0.1:3110/api/health
echo
echo CONTAINER
docker ps --filter name=smart-tp-costing --format '{{.Names}}|{{.Status}}'
echo MIGRATION_OBJECTS
docker exec -i supabase-db psql -U postgres -d postgres -At <<'SQL'
select 'revision_table=' || to_regclass('tp_costing.customer_revision_history');
select 'notification_templates=' || to_regclass('tp_costing.notification_templates');
select 'currency_history=' || to_regclass('tp_costing.currency_rate_history');
select 'approval_actor_user_id=' || count(*) from information_schema.columns where table_schema='tp_costing' and table_name='approval_actions' and column_name='actor_user_id';
select 'linked_active_auth_profiles=' || count(*) from tp_costing.user_profiles where is_active and auth_user_id is not null;
select 'pilot_approved=' || count(*) from tp_costing.costing_requests where season='PILOT-2026' and status='approved';
select 'pilot_history=' || count(*) from tp_costing.historical_costings h join tp_costing.costing_requests r on r.id=h.costing_request_id where r.season='PILOT-2026';
select 'active_notification_recipients=' || count(*) from tp_costing.notification_recipients where is_active;
SQL
echo NOTIFICATION_TRANSPORT_KEYS
sed -n '/^MS_GRAPH_/s/=.*/=configured/p;/^SMTP_/s/=.*/=configured/p;/^TEAMS_WEBHOOK_URL=/s/=.*/=configured/p' /opt/smart-tp-costing/app/deploy/.env.costing
echo CRON_INSTALLED
crontab -l | grep process-notifications.sh >/dev/null && echo yes || echo no
echo PILOT_EVIDENCE
find /opt/smart-tp-costing/pilot-results -maxdepth 1 -type f -name 'three-style-pilot-*.json' -printf '%f\n' | sort | tail -1
