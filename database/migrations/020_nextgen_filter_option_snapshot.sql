-- Last complete NextGen directory scan, remembered across server restarts.
--
-- Building the list-page filter options means up to 20 sequential ERP page
-- requests behind a 15s deadline, then the PO-line directory: ~17-20s. Caching
-- them in-process removed the recurring stall (an expired entry is now served
-- while the rebuild runs behind it) but a process that has never built them —
-- every restart and every deploy — had nothing to serve, so the first user to
-- open a list page paid the entire scan.
--
-- This one-row snapshot is written after each scan that returned values and
-- read at process start, so a cold start is instant, and an ERP outage degrades
-- to the last known directory instead of empty dropdowns. The payload keeps the
-- scan's own `partial` flag, so the UI can still tell a truncated directory from
-- a complete one.
create table if not exists tp_costing.nextgen_filter_option_cache (
  id integer primary key default 1 check (id = 1),
  payload jsonb not null,
  refreshed_at timestamptz not null default now()
);

alter table tp_costing.nextgen_filter_option_cache enable row level security;

insert into tp_costing.schema_migrations(version, description)
values ('020', 'Last-known-good NextGen filter options snapshot (cold-start cache)')
on conflict (version) do update
set description = excluded.description, applied_at = now();
