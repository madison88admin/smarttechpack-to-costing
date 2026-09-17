-- Reconcile three objects the app has always used but that only ever existed in
-- production, created by hand, so a database rebuilt from this repo could not
-- serve the request list, the CBD photo endpoints, or the notes search.
--
-- Found by the CI `fuzz-live` job on its first successful boot, which replays
-- the hostile-param harness against a database built from schema + migrations:
--   * GET /api/costing/requests 500'd on every probe — `listCostingRequests`
--     selects cost_sheet_ready / cost_sheet_ready_at / cost_sheet_ready_by, and
--     PostgREST rejects the whole select when a column is missing.
--   * the CBD photo endpoints failed the same way against `cbd_photos`.
--   * /api/historical/like-styles?notes= 500'd because the notes query embeds
--     the historical style through costing_notes.historical_costing_id, which
--     had no foreign key for PostgREST to resolve.
--
-- Every statement is guarded, so this is a no-op where the objects already
-- exist (production did).
alter table if exists tp_costing.costing_requests
  add column if not exists cost_sheet_ready boolean not null default false,
  add column if not exists cost_sheet_ready_at timestamptz,
  add column if not exists cost_sheet_ready_by text;

-- Factory CBD photos. The storage object is the file, this row is the record:
-- uploaded_by holds the display name of whoever uploaded it.
create table if not exists tp_costing.cbd_photos (
  id uuid primary key default gen_random_uuid(),
  costing_request_id uuid not null references tp_costing.costing_requests(id) on delete cascade,
  file_name text not null,
  file_path text not null,
  file_size bigint,
  content_type text,
  uploaded_by text,
  uploaded_at timestamptz not null default now()
);

create index if not exists cbd_photos_request_idx
  on tp_costing.cbd_photos(costing_request_id, uploaded_at);

alter table tp_costing.cbd_photos enable row level security;
revoke all on table tp_costing.cbd_photos from anon, authenticated;
grant all on table tp_costing.cbd_photos to service_role;

-- NOT VALID: existing rows are not re-checked, so a database that already
-- carries orphan ids is not blocked.
do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'tp_costing'
      and t.relname = 'costing_notes'
      and c.contype = 'f'
      and c.conkey = array[
        (select a.attnum from pg_attribute a where a.attrelid = t.oid and a.attname = 'historical_costing_id')
      ]
  ) then
    alter table tp_costing.costing_notes
      add constraint costing_notes_historical_costing_id_fkey
      foreign key (historical_costing_id) references tp_costing.historical_costings(id) on delete set null not valid;
  end if;
end $$;

insert into tp_costing.schema_migrations(version, description)
values ('021', 'Reconcile production-only drift: cost_sheet_ready flag, cbd_photos, costing_notes FK')
on conflict (version) do update
set description = excluded.description, applied_at = now();
