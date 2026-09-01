-- 005: track the last-known NextGen BOM version per product so the system can
-- detect when the BOM for a style changes upstream and alert the costing team.
alter table if exists tp_costing.nextgen_products
  add column if not exists bom_version text,
  add column if not exists bom_version_comment text,
  add column if not exists bom_checked_at timestamptz;

grant all on table tp_costing.nextgen_products to service_role;
