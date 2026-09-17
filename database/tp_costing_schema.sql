create schema if not exists tp_costing;

create table if not exists tp_costing.nextgen_products (
  id uuid primary key default gen_random_uuid(),
  nextgen_entity_id text unique not null,
  style_number text,
  name text,
  raw_payload jsonb not null,
  synced_at timestamptz not null default now()
);

create table if not exists tp_costing.nextgen_bom_lines (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references tp_costing.nextgen_products(id) on delete cascade,
  nextgen_line_id text,
  material_code text,
  material_name text,
  material_description text,
  material_type text,
  category text,
  consumption numeric,
  uom text,
  supplier_name text,
  placement text,
  quote_price numeric,
  quote_currency text,
  compliance_status text,
  colorway text,
  raw_payload jsonb not null,
  synced_at timestamptz not null default now()
);

create table if not exists tp_costing.costing_requests (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references tp_costing.nextgen_products(id),
  request_number text unique,
  factory_name text,
  status text not null default 'draft',
  priority text not null default 'normal',
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists tp_costing.costing_requests
  add column if not exists customer_status text not null default 'not_submitted',
  add column if not exists customer_status_updated_at timestamptz,
  add column if not exists customer_submitted_at timestamptz,
  add column if not exists customer_decision_at timestamptz,
  add column if not exists customer_revision_due_at timestamptz,
  add column if not exists customer_revision_number integer not null default 0,
  add column if not exists pbd_pricing jsonb not null default '{}'::jsonb,
  add column if not exists pbd_pricing_status text not null default 'pending',
  add column if not exists pbd_pricing_updated_at timestamptz,
  add column if not exists pbd_pricing_updated_by uuid,
  add column if not exists customer_notes text,
  add column if not exists season text,
  add column if not exists brand text,
  add column if not exists customer text,
  add column if not exists po_number text,
  add column if not exists mpo_number text,
  add column if not exists product_category text,
  add column if not exists buyer_style_number text,
  add column if not exists notes text,
  -- Cost Sheet Ready flag — set by Costing/Admin after approval (per-request
  -- endpoint and bulk action), read by the production view and request page.
  add column if not exists cost_sheet_ready boolean not null default false,
  add column if not exists cost_sheet_ready_at timestamptz,
  add column if not exists cost_sheet_ready_by text;

create table if not exists tp_costing.user_profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique,
  display_name text not null,
  email text unique,
  role text not null default 'viewer',
  password_hash text,
  last_login_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists tp_costing.user_profiles
  add column if not exists password_hash text,
  add column if not exists last_login_at timestamptz;

create table if not exists tp_costing.workflow_events (
  id uuid primary key default gen_random_uuid(),
  costing_request_id uuid references tp_costing.costing_requests(id) on delete cascade,
  event_type text not null,
  actor_role text,
  payload jsonb not null default '{}'::jsonb,
  notification_status text not null default 'pending',
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create table if not exists tp_costing.validation_checklist_items (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  label text not null,
  is_required boolean not null default true,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists tp_costing.validation_checklist_items
  add column if not exists updated_at timestamptz not null default now();

-- Seed default checklist items (4 required, 3 optional per business decision)
insert into tp_costing.validation_checklist_items (code, label, is_required, sort_order, is_active) values
  ('moq_checked', 'MOQ checked', true, 0, true),
  ('lead_time_checked', 'Lead time checked', true, 1, true),
  ('packaging_checked', 'Packaging checked', true, 2, true),
  ('comparable_style_reviewed', 'Comparable style reviewed', true, 3, true),
  ('nominated_supplier_checked', 'Brand-nominated supplier/items checked', false, 4, true),
  ('material_buffer_checked', 'Material buffer checked', false, 5, true),
  ('testing_cost_checked', 'Testing cost checked', false, 6, true)
on conflict (code) do update set
  is_required = excluded.is_required,
  sort_order = excluded.sort_order,
  updated_at = now();

create table if not exists tp_costing.request_checklist_results (
  id uuid primary key default gen_random_uuid(),
  costing_request_id uuid not null references tp_costing.costing_requests(id) on delete cascade,
  checklist_code text not null,
  is_checked boolean not null default false,
  comment text,
  checked_by_role text,
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  unique(costing_request_id, checklist_code)
);

create table if not exists tp_costing.costing_notes (
  id uuid primary key default gen_random_uuid(),
  costing_request_id uuid references tp_costing.costing_requests(id) on delete cascade,
  historical_costing_id uuid,
  note_type text not null default 'learning',
  note text not null,
  tags text[] not null default '{}',
  created_by_role text,
  created_at timestamptz not null default now()
);

create table if not exists tp_costing.workflow_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists tp_costing.notification_recipients (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  role text not null,
  email text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists tp_costing.system_error_logs (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'app',
  severity text not null default 'error',
  message text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists tp_costing.factory_cbds (
  id uuid primary key default gen_random_uuid(),
  costing_request_id uuid not null references tp_costing.costing_requests(id) on delete cascade,
  submitted_by uuid,
  -- Stamped by DEFAULT now() on submit (the app omits the column); drafts
  -- insert explicit null. Single DB clock source for the outlier-ack check.
  submitted_at timestamptz default now(),
  status text not null default 'draft',
  raw_payload jsonb not null default '{}'::jsonb
);

create table if not exists tp_costing.cbd_material_lines (
  id uuid primary key default gen_random_uuid(),
  factory_cbd_id uuid not null references tp_costing.factory_cbds(id) on delete cascade,
  bom_line_id uuid references tp_costing.nextgen_bom_lines(id),
  section text not null default 'yarn', -- yarn, fabric, trim, knitting, operations, packaging, overhead_profit
  material_name text,
  consumption numeric,
  uom text,
  unit_cost numeric,
  total_cost numeric,
  currency text,
  sort_order integer not null default 0,
  raw_payload jsonb not null default '{}'::jsonb
);

alter table if exists tp_costing.cbd_material_lines
  add column if not exists section text not null default 'yarn',
  add column if not exists sort_order integer not null default 0;

create table if not exists tp_costing.validation_results (
  id uuid primary key default gen_random_uuid(),
  costing_request_id uuid not null references tp_costing.costing_requests(id) on delete cascade,
  severity text not null,
  rule_code text not null,
  message text not null,
  field_path text,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists tp_costing.approval_actions (
  id uuid primary key default gen_random_uuid(),
  costing_request_id uuid not null references tp_costing.costing_requests(id) on delete cascade,
  actor_id uuid,
  actor_role text,
  action text not null,
  from_status text,
  to_status text,
  comment text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table if exists tp_costing.approval_actions
  add column if not exists actor_role text,
  add column if not exists actor_name text,
  add column if not exists from_status text,
  add column if not exists to_status text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create table if not exists tp_costing.historical_costings (
  id uuid primary key default gen_random_uuid(),
  costing_request_id uuid references tp_costing.costing_requests(id),
  style_number text,
  factory_name text,
  total_cost numeric,
  currency text,
  approved_at timestamptz,
  searchable_text text,
  embedding vector(1536),
  raw_payload jsonb not null default '{}'::jsonb
);

alter table if exists tp_costing.historical_costings
  add column if not exists yarn_type text,
  add column if not exists knit_type text,
  add column if not exists machine_type text,
  add column if not exists construction text,
  add column if not exists product_category text,
  add column if not exists average_consumption numeric,
  add column if not exists knitting_time numeric,
  add column if not exists brand text,
  add column if not exists customer text,
  add column if not exists season text,
  -- Migration 018: landed cost + real selling price, so the Like Styles machine
  -- table can average what a machine costs and earns per matched style.
  add column if not exists landed_cost numeric,
  add column if not exists selling_price numeric;

create unique index if not exists historical_costings_request_unique
  on tp_costing.historical_costings(costing_request_id)
  where costing_request_id is not null;

create unique index if not exists costing_requests_active_style_factory_season_unique
  on tp_costing.costing_requests(product_id, lower(coalesce(factory_name, '')), lower(coalesce(season, '')))
  where status not in ('approved', 'rejected');

-- Comparative style review tracking (BR-005)
create table if not exists tp_costing.style_comparisons (
  id uuid primary key default gen_random_uuid(),
  costing_request_id uuid not null references tp_costing.costing_requests(id) on delete cascade,
  compared_costing_request_id uuid references tp_costing.costing_requests(id),
  compared_historical_id uuid references tp_costing.historical_costings(id),
  compared_style_number text,
  decision text not null default 'reviewed',
  notes text,
  recorded_by_role text,
  created_at timestamptz not null default now()
);

-- Notification queue (BR-011, FR-009)
create table if not exists tp_costing.notification_queue (
  id uuid primary key default gen_random_uuid(),
  workflow_event_id uuid references tp_costing.workflow_events(id) on delete cascade,
  costing_request_id uuid references tp_costing.costing_requests(id) on delete cascade,
  channel text not null default 'email',
  recipient text not null,
  subject text,
  body text,
  status text not null default 'pending',
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index if not exists notification_queue_status_idx
  on tp_costing.notification_queue(status, created_at);

-- Phase 1-4 feature tables

-- Multi-vendor RFQ comparison
create table if not exists tp_costing.vendor_quotes (
  id uuid primary key default gen_random_uuid(),
  costing_request_id uuid not null references tp_costing.costing_requests(id) on delete cascade,
  factory_name text not null,
  status text not null default 'pending',
  quote_total numeric,
  currency text default 'USD',
  moq integer,
  lead_time_days integer,
  submitted_at timestamptz,
  notes text,
  raw_payload jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Currency exchange rate management
create table if not exists tp_costing.currency_rates (
  id uuid primary key default gen_random_uuid(),
  base_currency text not null,
  quote_currency text not null,
  rate numeric not null,
  source text default 'manual',
  updated_at timestamptz not null default now(),
  unique(base_currency, quote_currency)
);

-- Material library (reusable material + supplier database)
create table if not exists tp_costing.material_library (
  id uuid primary key default gen_random_uuid(),
  material_name text not null,
  category text,
  uom text default 'kg',
  specification text,
  composition text,
  supplier_name text,
  supplier_contact text,
  standard_unit_cost numeric,
  currency text default 'USD',
  moq integer,
  lead_time_days integer,
  is_active boolean default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Compliance checks (RSL, DPP, REACH, OEKO-TEX)
create table if not exists tp_costing.compliance_checks (
  id uuid primary key default gen_random_uuid(),
  costing_request_id uuid not null references tp_costing.costing_requests(id) on delete cascade,
  check_type text not null,
  status text not null default 'pending',
  details jsonb default '{}'::jsonb,
  checked_at timestamptz,
  checked_by text,
  notes text,
  created_at timestamptz not null default now()
);

-- Sample tracking
create table if not exists tp_costing.sample_tracking (
  id uuid primary key default gen_random_uuid(),
  costing_request_id uuid not null references tp_costing.costing_requests(id) on delete cascade,
  sample_type text not null default 'proto',
  status text not null default 'requested',
  size text,
  color text,
  quantity integer default 1,
  sent_date date,
  received_date date,
  factory_notes text,
  pbd_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ===== PERFORMANCE INDEXES =====

-- costing_requests: most common query patterns
create index if not exists costing_requests_status_idx
  on tp_costing.costing_requests(status);
create index if not exists costing_requests_created_at_idx
  on tp_costing.costing_requests(created_at desc);
create index if not exists costing_requests_factory_name_idx
  on tp_costing.costing_requests(factory_name);
create index if not exists costing_requests_product_id_idx
  on tp_costing.costing_requests(product_id);
create index if not exists costing_requests_season_idx
  on tp_costing.costing_requests(season);
create index if not exists costing_requests_customer_status_idx
  on tp_costing.costing_requests(customer_status);
create index if not exists costing_requests_status_created_idx
  on tp_costing.costing_requests(status, created_at desc);

-- nextgen_products
create index if not exists nextgen_products_style_number_idx
  on tp_costing.nextgen_products(style_number);

-- nextgen_bom_lines
create index if not exists nextgen_bom_lines_product_id_idx
  on tp_costing.nextgen_bom_lines(product_id);

-- factory_cbds
create index if not exists factory_cbds_request_id_idx
  on tp_costing.factory_cbds(costing_request_id);
create index if not exists factory_cbds_status_idx
  on tp_costing.factory_cbds(status);

-- cbd_material_lines
create index if not exists cbd_material_lines_cbd_id_idx
  on tp_costing.cbd_material_lines(factory_cbd_id);

-- approval_actions
create index if not exists approval_actions_request_id_idx
  on tp_costing.approval_actions(costing_request_id);
create index if not exists approval_actions_created_at_idx
  on tp_costing.approval_actions(created_at desc);

-- workflow_events
create index if not exists workflow_events_request_id_idx
  on tp_costing.workflow_events(costing_request_id);
create index if not exists workflow_events_type_created_idx
  on tp_costing.workflow_events(event_type, created_at desc);

-- validation_results
create index if not exists validation_results_request_id_idx
  on tp_costing.validation_results(costing_request_id);

-- historical_costings
create index if not exists historical_costings_style_idx
  on tp_costing.historical_costings(style_number);
create index if not exists historical_costings_factory_idx
  on tp_costing.historical_costings(factory_name);
create index if not exists historical_costings_approved_at_idx
  on tp_costing.historical_costings(approved_at desc);

-- costing_notes
create index if not exists costing_notes_request_id_idx
  on tp_costing.costing_notes(costing_request_id);

-- system_error_logs
create index if not exists system_error_logs_created_at_idx
  on tp_costing.system_error_logs(created_at desc);
create index if not exists system_error_logs_severity_idx
  on tp_costing.system_error_logs(severity);

-- vendor_quotes
create index if not exists vendor_quotes_request_id_idx
  on tp_costing.vendor_quotes(costing_request_id);
create index if not exists vendor_quotes_status_idx
  on tp_costing.vendor_quotes(status);

-- style_comparisons
create index if not exists style_comparisons_request_id_idx
  on tp_costing.style_comparisons(costing_request_id);

-- In-app change alerts (migration 003)
create table if not exists tp_costing.in_app_alerts (
  id uuid primary key default gen_random_uuid(),
  costing_request_id uuid not null references tp_costing.costing_requests(id) on delete cascade,
  alert_type text not null,
  recipient_role text not null,
  title text not null,
  body text,
  payload jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists in_app_alerts_role_unread_idx
  on tp_costing.in_app_alerts(recipient_role, read_at, created_at);

create index if not exists in_app_alerts_request_idx
  on tp_costing.in_app_alerts(costing_request_id, recipient_role);

alter table tp_costing.in_app_alerts enable row level security;
revoke all on table tp_costing.in_app_alerts from anon, authenticated;
grant all on table tp_costing.in_app_alerts to service_role;

-- Notification read receipts (migration 013)
create table if not exists tp_costing.notification_reads (
  recipient_role text not null,
  notification_key text not null,
  read_at timestamptz not null default now(),
  constraint notification_reads_pkey primary key (recipient_role, notification_key)
);

alter table tp_costing.notification_reads enable row level security;
revoke all on table tp_costing.notification_reads from anon, authenticated;
grant all on table tp_costing.notification_reads to service_role;

-- Structured per-field change requests (migration 016)
create table if not exists tp_costing.cbd_change_requests (
  id uuid primary key default gen_random_uuid(),
  costing_request_id uuid not null references tp_costing.costing_requests(id) on delete cascade,
  cbd_section text not null default '',
  field_key text not null default '',
  field_label text not null default '',
  current_value text not null default '',
  requested_value text not null default '',
  reason text not null default '',
  priority text not null default 'normal',
  due_date date,
  status text not null default 'open',
  requested_by_role text,
  requested_by_name text,
  resolved_cbd_id uuid references tp_costing.factory_cbds(id) on delete set null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists cbd_change_requests_request_idx
  on tp_costing.cbd_change_requests(costing_request_id, status, created_at desc);

alter table tp_costing.cbd_change_requests enable row level security;
revoke all on table tp_costing.cbd_change_requests from anon, authenticated;
grant all on table tp_costing.cbd_change_requests to service_role;

-- Factory CBD photos. The storage object is the file, this row is the record;
-- uploaded_by holds the display name of the uploader.
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

-- NextGen-synced historical records are flagged with source = 'nextgen' so
-- re-syncs can dedup and benchmarks can exclude dropped/archived products.
alter table if exists tp_costing.historical_costings
  add column if not exists source text not null default 'import',
  add column if not exists nextgen_entity_id text;

-- Last-known NextGen BOM version per product, used to detect upstream BOM
-- changes and alert the costing team through the change-alert flow.
alter table if exists tp_costing.nextgen_products
  add column if not exists bom_version text,
  add column if not exists bom_version_comment text,
  add column if not exists bom_checked_at timestamptz;
