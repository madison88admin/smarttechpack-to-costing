-- 016: structured per-field change requests.
--
-- Reviewers (MD/Costing/PBD) request a change on an exact CBD field instead
-- of free-text only. The request stores section + field key + current value +
-- requested value + reason, flips the request to needs_clarification through
-- the normal transition (so routing/audit/notifications keep working), and is
-- auto-resolved when a later factory CBD carries the requested value.

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

insert into tp_costing.schema_migrations(version, description)
values ('016', 'Structured per-field CBD change requests with auto-resolution')
on conflict (version) do update
set description = excluded.description, applied_at = now();
