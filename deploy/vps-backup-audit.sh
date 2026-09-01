#!/usr/bin/env sh
set -eu

mkdir -p /opt/smart-tp-costing/backups
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup="/opt/smart-tp-costing/backups/tp_costing_pre_security_${stamp}.sql.gz"
docker exec supabase-db pg_dump -U postgres -d postgres --schema=tp_costing --no-owner --no-privileges | gzip -9 > "$backup"
test -s "$backup"
echo BACKUP_OK
ls -lh "$backup"

echo LIVE_ENV_KEYS
sed -n 's/^\([A-Z0-9_]*\)=.*/\1/p' /opt/smart-tp-costing/app/deploy/.env.costing | sort

echo AUTH_COUNTS
docker exec -i supabase-db psql -U postgres -d postgres -At <<'SQL'
select 'auth_users=' || count(*) from auth.users;
select 'active_profiles=' || count(*) from tp_costing.user_profiles where is_active;
select role || '=' || count(*) from tp_costing.user_profiles where is_active group by role order by role;
SQL
