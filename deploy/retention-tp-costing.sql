-- Run daily with the service database account. Adjust periods to the approved company retention policy.
delete from tp_costing.notification_queue
where status in ('sent', 'failed') and created_at < now() - interval '90 days';

delete from tp_costing.system_error_logs
where created_at < now() - interval '180 days';

-- Audit/workflow and approved costing records are intentionally retained.
-- Their deletion requires an approved finance/legal retention decision.
