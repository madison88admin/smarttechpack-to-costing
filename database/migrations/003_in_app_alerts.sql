-- 003_in_app_alerts.sql
-- In-app change alerts surfaced on the dashboard.
--
-- Every BOM / CBD change and PBD pricing update (and role "your turn" alerts)
-- is recorded here with the role that should act on it. The dashboard shows
-- unread alerts per role and per request, and marks them read when the user
-- opens the request or clicks "Mark all read".

create table if not exists tp_costing.in_app_alerts (
  id uuid primary key default gen_random_uuid(),
  costing_request_id uuid not null references tp_costing.costing_requests(id) on delete cascade,
  alert_type text not null,            -- 'bom_changed' | 'pbd_pricing_updated' | 'role_change'
  recipient_role text not null,        -- 'costing' | 'md' | 'pbd' | 'admin' ...
  title text not null,
  body text,
  payload jsonb,
  read_at timestamptz,                 -- null = unread
  created_at timestamptz not null default now()
);

create index if not exists in_app_alerts_role_unread_idx
  on tp_costing.in_app_alerts(recipient_role, read_at, created_at);

create index if not exists in_app_alerts_request_idx
  on tp_costing.in_app_alerts(costing_request_id, recipient_role);

-- Security: match the rest of tp_costing (RLS + service_role only).
alter table tp_costing.in_app_alerts enable row level security;
revoke all on table tp_costing.in_app_alerts from anon, authenticated;
grant all on table tp_costing.in_app_alerts to service_role;
