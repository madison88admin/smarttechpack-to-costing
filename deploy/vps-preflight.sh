#!/usr/bin/env sh
set -eu

echo COMPOSE_LABELS
docker inspect smart-tp-costing --format '{{json .Config.Labels}}'
echo MOUNTS
docker inspect smart-tp-costing --format '{{range .Mounts}}{{.Source}} -> {{.Destination}}{{println}}{{end}}'
echo ENV_FILES
find /opt/smart-tp-costing -maxdepth 4 -type f -name '.env.costing' -print
echo COMPOSE_FILES
find /opt/smart-tp-costing -maxdepth 4 -type f \( -name 'docker-compose*.yml' -o -name 'compose*.yml' \) -print
echo DB_IDENTITY
docker exec supabase-db psql -U postgres -d postgres -Atc 'select current_database(), current_user, version();'
echo SCHEMA_TABLES
docker exec supabase-db psql -U postgres -d postgres -Atc "select count(*) from information_schema.tables where table_schema='tp_costing';"
