#!/usr/bin/env sh
set -eu
docker exec -i supabase-db psql -U postgres -d postgres -At <<'SQL'
select 'profiles_with_auth_user_id=' || count(*) from tp_costing.user_profiles where is_active and auth_user_id is not null;
select 'profiles_matching_auth_email=' || count(*) from tp_costing.user_profiles p where p.is_active and exists (select 1 from auth.users u where lower(u.email)=lower(p.email));
select 'profiles_without_auth_match=' || count(*) from tp_costing.user_profiles p where p.is_active and not exists (select 1 from auth.users u where lower(u.email)=lower(p.email));
SQL
