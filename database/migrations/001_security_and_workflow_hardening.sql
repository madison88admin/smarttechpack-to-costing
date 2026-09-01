begin;

alter table tp_costing.approval_actions add column if not exists actor_user_id uuid;
alter table tp_costing.workflow_events add column if not exists actor_user_id uuid;
alter table tp_costing.costing_requests add column if not exists assigned_factory_user_id uuid;
alter table tp_costing.costing_requests add column if not exists archived_at timestamptz;
alter table tp_costing.costing_requests add column if not exists archived_by uuid;
alter table tp_costing.costing_requests add column if not exists cancellation_reason text;
alter table tp_costing.costing_requests add column if not exists customer_revision_number integer not null default 0;
alter table tp_costing.historical_costings add column if not exists benchmark_excluded boolean not null default false;
alter table tp_costing.historical_costings add column if not exists benchmark_exclusion_reason text;

create table if not exists tp_costing.customer_revision_history (
  id uuid primary key default gen_random_uuid(),
  costing_request_id uuid not null references tp_costing.costing_requests(id) on delete cascade,
  revision_number integer not null,
  from_status text,
  to_status text not null,
  notes text,
  reference_url text,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique(costing_request_id, revision_number)
);

create table if not exists tp_costing.notification_templates (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  channel text not null check (channel in ('email', 'teams')),
  subject_template text not null,
  body_template text not null,
  is_active boolean not null default true,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  unique(event_type, channel)
);

create table if not exists tp_costing.currency_rate_history (
  id uuid primary key default gen_random_uuid(),
  base_currency text not null,
  quote_currency text not null,
  rate numeric not null check (rate > 0),
  source text not null default 'manual',
  effective_at timestamptz not null default now(),
  created_by uuid
);

create table if not exists tp_costing.customer_approval_attachments (
  id uuid primary key default gen_random_uuid(),
  costing_request_id uuid not null references tp_costing.costing_requests(id) on delete cascade,
  file_name text not null,
  storage_path text not null,
  mime_type text,
  uploaded_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists approval_actions_actor_user_idx on tp_costing.approval_actions(actor_user_id);
create index if not exists workflow_events_actor_user_idx on tp_costing.workflow_events(actor_user_id);
create index if not exists costing_requests_factory_user_idx on tp_costing.costing_requests(assigned_factory_user_id);
create index if not exists customer_revision_request_idx on tp_costing.customer_revision_history(costing_request_id, revision_number desc);
create index if not exists currency_rate_history_pair_date_idx on tp_costing.currency_rate_history(base_currency, quote_currency, effective_at desc);

-- The application accesses these tables only through server routes using the service role.
-- Anonymous and ordinary authenticated PostgREST users receive no direct table privileges.
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'nextgen_products','nextgen_bom_lines','costing_requests','user_profiles','workflow_events',
    'validation_checklist_items','request_checklist_results','costing_notes','workflow_settings',
    'notification_recipients','system_error_logs','factory_cbds','cbd_material_lines',
    'validation_results','approval_actions','historical_costings','style_comparisons',
    'notification_queue','vendor_quotes','currency_rates','material_library','compliance_checks',
    'sample_tracking','customer_revision_history','notification_templates','currency_rate_history',
    'customer_approval_attachments'
  ]
  loop
    execute format('alter table tp_costing.%I enable row level security', table_name);
    execute format('revoke all on table tp_costing.%I from anon, authenticated', table_name);
    execute format('grant all on table tp_costing.%I to service_role', table_name);
  end loop;
end $$;

commit;
