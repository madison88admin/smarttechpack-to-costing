-- NextGen product metadata refresh
-- Tracks when the NextGen product row (status, composition, SMV/labor fields)
-- was last re-fetched for active requests, so the request detail panel can show
-- "Last refreshed" instead of "Captured at request creation" forever. The
-- hourly cron (/api/admin/refresh-nextgen-metadata) updates this timestamp and
-- alerts the costing team when the metadata actually changed.
alter table tp_costing.nextgen_products
  add column if not exists metadata_checked_at timestamptz;
