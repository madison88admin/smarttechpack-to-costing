-- 006: carry the copied "baseline" (a comparable approved historical costing)
-- onto the new request so the cost and attributes survive request creation.
-- The Like Styles "Copy baseline" action prefills the create-request form and
-- records the source row here; the detail page shows it and the factory CBD
-- form surfaces it as a read-only reference while filling the actual costing.
alter table if exists tp_costing.costing_requests
  add column if not exists baseline_ref jsonb;

grant all on table tp_costing.costing_requests to service_role;
