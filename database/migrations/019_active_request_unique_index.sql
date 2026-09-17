-- The unique index that stops two active requests for the same style/factory.
--
-- `database/tp_costing_schema.sql` has declared this since the beginning, but it
-- was never applied to the live database. A byte-identical duplicate insert was
-- accepted (HTTP 201), so the only thing between a double-submit — or the same
-- style open in two tabs — and two drafts was the application-level duplicate
-- check, and two requests in flight at once both pass it. That is exactly how a
-- playtest ended up with CR-969172 and CR-969232: same product, same factory,
-- same season, 83ms apart.
--
-- Idempotent and additive. It fails loudly if rows already violate it: duplicates
-- present at apply time have to be merged or removed deliberately, not accepted
-- silently just to get the migration through.
create unique index if not exists costing_requests_active_style_factory_season_unique
  on tp_costing.costing_requests (product_id, lower(coalesce(factory_name, '')), lower(coalesce(season, '')))
  where status not in ('approved', 'rejected');

insert into tp_costing.schema_migrations(version, description)
values ('019', 'Unique index on active requests per style/factory/season (was declared but never applied)')
on conflict (version) do update
set description = excluded.description, applied_at = now();
