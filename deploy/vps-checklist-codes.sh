#!/usr/bin/env sh
set -eu
docker exec -i supabase-db psql -U postgres -d postgres -At <<'SQL'
select code from tp_costing.validation_checklist_items where is_active and is_required order by sort_order, code;
SQL
