-- Reconcile two objects the app has always queried but that were only ever
-- created by hand in production, so a database rebuilt from the schema plus
-- migrations could not serve the request list or the CBD photo endpoints.
--
-- Found by the CI `fuzz-live` job on its first successful boot: every probe of
-- GET /api/costing/requests answered 500, because `listCostingRequests` selects
-- cost_sheet_ready / cost_sheet_ready_at / cost_sheet_ready_by and PostgREST
-- rejects the whole select when a column is missing. The photo endpoints were
-- failing for the same reason against `cbd_photos`.
--
-- Both statements are `if not exists`, so this is a no-op on any database where
-- the columns and table already exist (production did).
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

insert into tp_costing.schema_migrations(version, description)
values ('021', 'Reconcile cost_sheet_ready columns and cbd_photos table (production-only drift)')
on conflict (version) do update
set description = excluded.description, applied_at = now();
