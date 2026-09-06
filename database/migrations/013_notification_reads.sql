-- 013_notification_reads.sql
-- Durable read receipts for the derived notification feed (/api/notifications/pending).
--
-- The bell feed is recomputed from live request state on every poll, so without
-- a stored marker every SLA / review item would re-nag on every page load and on
-- every device. This table records which (role, notification key) pairs the user
-- has already viewed or dismissed, letting the feed surface only genuinely new
-- items. Keys are stable per request + situation (e.g. `overdue-<updated>-<id>`,
-- `review-<status>-<updated>-<id>`), so a status transition naturally produces a
-- fresh key and re-notifies.

create table if not exists tp_costing.notification_reads (
  recipient_role text not null,
  notification_key text not null,
  read_at timestamptz not null default now(),
  constraint notification_reads_pkey primary key (recipient_role, notification_key)
);

alter table tp_costing.notification_reads enable row level security;
revoke all on table tp_costing.notification_reads from anon, authenticated;
grant all on table tp_costing.notification_reads to service_role;

insert into tp_costing.schema_migrations(version, description)
values ('013', 'Durable read receipts for the derived notification feed')
on conflict (version) do update
set description = excluded.description, applied_at = now();
