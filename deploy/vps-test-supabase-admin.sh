#!/usr/bin/env sh
set -eu
docker exec supabase-db psql -U supabase_admin -d postgres -Atc 'select current_user;'
