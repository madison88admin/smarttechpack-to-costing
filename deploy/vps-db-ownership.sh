#!/usr/bin/env sh
set -eu
docker exec -i supabase-db psql -U postgres -d postgres -At <<'SQL'
select tablename || '|' || tableowner from pg_tables where schemaname='tp_costing' order by tableowner, tablename;
select rolname || '|super=' || rolsuper || '|create=' || rolcreaterole from pg_roles where rolname in ('postgres','supabase_admin','service_role');
SQL
