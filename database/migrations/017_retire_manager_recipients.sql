-- 017_retire_manager_recipients.sql
-- Removes the retired Manager notification recipients.
--
-- Migration 012 folded the Manager approval stage into PBD, and 014 moved any
-- rows still parked in `pending_manager_approval` into `for_pbd_review`. The
-- `manager_approve` / `manager_reject` rows in notification_recipients were left
-- behind: their event types no longer exist, so they can never match an event,
-- and they only make the recipient admin screen look like a Manager stage is
-- still configured.
--
-- PBD already receives both decisions through the live `approve` and `reject`
-- recipients (same address), so this is a pure removal with no re-routing.

delete from tp_costing.notification_recipients
where event_type in ('manager_approve', 'manager_reject');

-- Templates for the retired events, if any were ever created.
delete from tp_costing.notification_templates
where event_type in ('manager_approve', 'manager_reject');

insert into tp_costing.schema_migrations(version, description)
values ('017', 'Retire manager_approve/manager_reject notification recipients and templates')
on conflict (version) do update
set description = excluded.description, applied_at = now();
