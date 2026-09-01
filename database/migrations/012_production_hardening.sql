-- Production hardening roll-up.
-- Idempotent: safe to apply after any combination of migrations 001-011.

create table if not exists tp_costing.schema_migrations (
  version text primary key,
  description text not null,
  applied_at timestamptz not null default now()
);

alter table tp_costing.costing_requests
  add column if not exists metadata_checked_at timestamptz;

insert into tp_costing.notification_templates(event_type, channel, subject_template, body_template, is_active)
values
  ('send_to_factory', 'email', '[{{requestNumber}}] Factory CBD requested', 'Request {{requestNumber}} has been sent to {{factoryName}} for CBD completion.', true),
  ('submit', 'email', '[{{requestNumber}}] Factory CBD submitted', 'Factory CBD for {{requestNumber}} was submitted and is ready for MD review.', true),
  ('costing_complete', 'email', '[{{requestNumber}}] Ready for PBD review', 'Costing validation for {{requestNumber}} is complete and ready for the PBD decision.', true),
  ('clarify', 'email', '[{{requestNumber}}] CBD correction requested', 'Please open {{requestNumber}}, review the clarification note, update the CBD, and resubmit.', true),
  ('approve', 'email', '[{{requestNumber}}] Internal costing approved', 'PBD approved the internal costing for {{requestNumber}}.', true),
  ('send_to_factory', 'teams', '[{{requestNumber}}] Factory CBD requested', 'Request {{requestNumber}} has been sent to {{factoryName}} for CBD completion.', true),
  ('submit', 'teams', '[{{requestNumber}}] Factory CBD submitted', 'Factory CBD for {{requestNumber}} is ready for MD review.', true),
  ('costing_complete', 'teams', '[{{requestNumber}}] Ready for PBD review', 'Costing validation for {{requestNumber}} is complete.', true),
  ('clarify', 'teams', '[{{requestNumber}}] CBD correction requested', 'Factory correction is required for {{requestNumber}}.', true),
  ('approve', 'teams', '[{{requestNumber}}] Internal costing approved', 'PBD approved {{requestNumber}}.', true)
on conflict (event_type, channel) do nothing;

-- Manager is not a separate approval stage. PBD owns the combined decision.
update tp_costing.costing_requests
set status = 'for_pbd_review', updated_at = now()
where status = 'pending_manager_approval';

update tp_costing.user_profiles
set role = 'pbd', updated_at = now()
where role = 'manager';

-- Preserve Factory tenant isolation while making legacy clarification loops
-- actionable without an administrator. Prefer the latest CBD submitter.
with latest_submitter as (
  select distinct on (c.costing_request_id)
    c.costing_request_id,
    c.submitted_by
  from tp_costing.factory_cbds c
  where c.submitted_by is not null
  order by c.costing_request_id, c.submitted_at desc nulls last, c.id desc
), resolved as (
  select ls.costing_request_id, up.id as profile_id
  from latest_submitter ls
  join tp_costing.user_profiles up
    on (up.id::text = ls.submitted_by::text or up.auth_user_id::text = ls.submitted_by::text)
   and up.role = 'factory'
   and up.is_active = true
)
update tp_costing.costing_requests r
set assigned_factory_user_id = resolved.profile_id, updated_at = now()
from resolved
where r.id = resolved.costing_request_id
  and r.assigned_factory_user_id is null
  and r.status in ('sent_to_factory', 'needs_clarification');

-- Legacy requests without a recorded submitter are assigned to an active
-- Factory profile rather than being globally visible to every Factory user.
with fallback as (
  select id from tp_costing.user_profiles
  where role = 'factory' and is_active = true
  order by created_at asc nulls last, id asc
  limit 1
)
update tp_costing.costing_requests r
set assigned_factory_user_id = fallback.id, updated_at = now()
from fallback
where r.assigned_factory_user_id is null
  and r.status in ('sent_to_factory', 'needs_clarification');

-- Repair approved-history totals from the latest authoritative CBD snapshot.
with latest_cbd as (
  select distinct on (c.costing_request_id)
    c.costing_request_id,
    c.raw_payload
  from tp_costing.factory_cbds c
  order by c.costing_request_id, c.submitted_at desc nulls last, c.id desc
), authoritative as (
  select
    costing_request_id,
    case
      when coalesce(raw_payload->>'factoryCostTotal', '') ~ '^-?[0-9]+(\.[0-9]+)?$'
        then (raw_payload->>'factoryCostTotal')::numeric
      when coalesce(raw_payload->>'grandTotal', '') ~ '^-?[0-9]+(\.[0-9]+)?$'
        then (raw_payload->>'grandTotal')::numeric
      else null
    end as total_cost
  from latest_cbd
)
update tp_costing.historical_costings h
set total_cost = a.total_cost
from authoritative a
where h.costing_request_id = a.costing_request_id
  and a.total_cost is not null
  and a.total_cost > 0
  and h.total_cost is distinct from a.total_cost;

-- Remove only provably stale legacy warnings. Current validation runs will
-- recreate a warning when the corresponding structured value is truly absent.
with latest_cbd as (
  select distinct on (c.costing_request_id)
    c.costing_request_id,
    c.raw_payload
  from tp_costing.factory_cbds c
  order by c.costing_request_id, c.submitted_at desc nulls last, c.id desc
), cbd_facts as (
  select
    costing_request_id,
    case when coalesce(raw_payload->>'laborCost', '') ~ '^-?[0-9]+(\.[0-9]+)?$'
      then (raw_payload->>'laborCost')::numeric else 0 end as labor_cost,
    case when coalesce(raw_payload->>'packagingCost', '') ~ '^-?[0-9]+(\.[0-9]+)?$'
      then (raw_payload->>'packagingCost')::numeric else 0 end as packaging_cost,
    case when coalesce(raw_payload->>'packagingTotal', '') ~ '^-?[0-9]+(\.[0-9]+)?$'
      then (raw_payload->>'packagingTotal')::numeric else 0 end as packaging_total,
    case when coalesce(raw_payload->>'standardPackagingCost', '') ~ '^-?[0-9]+(\.[0-9]+)?$'
      then (raw_payload->>'standardPackagingCost')::numeric else 0 end as standard_packaging_cost,
    case when coalesce(raw_payload->>'specialPackagingCost', '') ~ '^-?[0-9]+(\.[0-9]+)?$'
      then (raw_payload->>'specialPackagingCost')::numeric else 0 end as special_packaging_cost,
    case when coalesce(raw_payload->>'materialTotal', '') ~ '^-?[0-9]+(\.[0-9]+)?$'
      then (raw_payload->>'materialTotal')::numeric else 0 end as material_total,
    case when jsonb_typeof(raw_payload->'knittingLines') = 'array'
      then jsonb_array_length(raw_payload->'knittingLines') else 0 end as knitting_count,
    case when jsonb_typeof(raw_payload->'operationsLines') = 'array'
      then jsonb_array_length(raw_payload->'operationsLines') else 0 end as operations_count,
    case when jsonb_typeof(raw_payload->'yarnLines') = 'array'
      then jsonb_array_length(raw_payload->'yarnLines') else 0 end as yarn_count,
    case when jsonb_typeof(raw_payload->'fabricLines') = 'array'
      then jsonb_array_length(raw_payload->'fabricLines') else 0 end as fabric_count,
    case when jsonb_typeof(raw_payload->'trimLines') = 'array'
      then jsonb_array_length(raw_payload->'trimLines') else 0 end as trim_count
  from latest_cbd
)
delete from tp_costing.validation_results v
using cbd_facts c
where v.costing_request_id = c.costing_request_id
  and v.resolved_at is null
  and (
    (v.rule_code = 'missing_labor_cost' and (
      c.labor_cost > 0 or c.knitting_count > 0 or c.operations_count > 0
    ))
    or (v.rule_code = 'missing_packagingCost' and (
      c.packaging_cost > 0 or c.packaging_total > 0
      or c.standard_packaging_cost > 0 or c.special_packaging_cost > 0
    ))
    or (v.rule_code = 'no_material_lines' and (
      c.yarn_count > 0 or c.fabric_count > 0 or c.trim_count > 0 or c.material_total > 0
    ))
  );

insert into tp_costing.schema_migrations(version, description)
values ('012', 'Production access, workflow, assignment, metadata and data-integrity hardening')
on conflict (version) do update
set description = excluded.description, applied_at = now();
