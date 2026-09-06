-- 014_retire_manager_status.sql
-- Retires the legacy `pending_manager_approval` status.
--
-- The Manager approval stage was folded into PBD earlier: PBD now makes the
-- final internal decision directly from `for_pbd_review`, and the Manager
-- role/actions/threshold are gone. This migration moves any rows still sitting
-- in the old status into `for_pbd_review` so they flow through the single PBD
-- decision gate and keep rendering with the correct label, then normalizes the
-- recorded decision chain so audit and flow queries never see the retired
-- status in from_status/to_status.

update tp_costing.costing_requests
set status = 'for_pbd_review',
    updated_at = now()
where status = 'pending_manager_approval';

update tp_costing.approval_actions
set from_status = 'for_pbd_review'
where from_status = 'pending_manager_approval';

update tp_costing.approval_actions
set to_status = 'for_pbd_review'
where to_status = 'pending_manager_approval';

insert into tp_costing.schema_migrations(version, description)
values ('014', 'Retire pending_manager_approval status (rows -> for_pbd_review)')
on conflict (version) do update
set description = excluded.description, applied_at = now();