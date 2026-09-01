-- 004: mark NextGen-synced historical rows distinctly so re-runs skip cleanly
-- and benchmarks stay limited to approved (Excel-imported) costings.
alter table if exists tp_costing.historical_costings
  add column if not exists source text not null default 'import',
  add column if not exists nextgen_entity_id text;

grant all on table tp_costing.historical_costings to service_role;
