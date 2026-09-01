#!/usr/bin/env sh
set -eu
docker exec -i supabase-db psql -U postgres -d postgres -At <<'SQL'
select role || '|' || email from tp_costing.user_profiles where is_active order by role, email;
SQL
