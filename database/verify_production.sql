\pset format unaligned
\pset fieldsep '|'
\pset tuples_only on

select 'migration_012', count(*)
from tp_costing.schema_migrations
where version = '012';

select 'notification_templates', count(*)
from tp_costing.notification_templates
where is_active = true;

select 'legacy_manager_statuses', count(*)
from tp_costing.costing_requests
where status = 'pending_manager_approval';

select 'legacy_manager_users', count(*)
from tp_costing.user_profiles
where role = 'manager';

select 'unassigned_factory_actions', count(*)
from tp_costing.costing_requests
where assigned_factory_user_id is null
  and status in ('sent_to_factory', 'needs_clarification');

with latest_cbd as (
  select distinct on (c.costing_request_id)
    c.costing_request_id,
    case
      when coalesce(c.raw_payload->>'factoryCostTotal', '') ~ '^-?[0-9]+(\.[0-9]+)?$'
        then (c.raw_payload->>'factoryCostTotal')::numeric
      when coalesce(c.raw_payload->>'grandTotal', '') ~ '^-?[0-9]+(\.[0-9]+)?$'
        then (c.raw_payload->>'grandTotal')::numeric
      else null
    end as authoritative_total
  from tp_costing.factory_cbds c
  order by c.costing_request_id, c.submitted_at desc nulls last, c.id desc
)
select 'historical_total_mismatches', count(*)
from tp_costing.historical_costings h
join latest_cbd c on c.costing_request_id = h.costing_request_id
where c.authoritative_total is not null
  and c.authoritative_total > 0
  and h.total_cost is distinct from c.authoritative_total;

select 'remaining_targeted_warnings', count(*)
from tp_costing.validation_results
where resolved_at is null
  and rule_code in ('missing_labor_cost', 'missing_packagingCost', 'no_material_lines');

select 'bom_rows', count(*)
from tp_costing.nextgen_bom_lines;

select 'bom_rows_missing_enrichment', count(*)
from tp_costing.nextgen_bom_lines
where nullif(trim(coalesce(supplier_name, '')), '') is null
   or quote_price is null
   or nullif(trim(coalesce(compliance_status, '')), '') is null
   or nullif(trim(coalesce(colorway, '')), '') is null;
