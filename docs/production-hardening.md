# Phase 8 Production Hardening Checklist

## Public Access

- Use `smart-tp-costing.5-223-78-194.sslip.io` through Nginx reverse proxy.
- Add HTTPS certificate with Certbot.
- Redirect HTTP to HTTPS after certificate is verified.

## Security

- Replace pilot env-based role selection with Supabase Auth-backed login.
- Map authenticated users to `tp_costing.user_profiles`.
- Keep service role key backend-only.
- Add RLS policies before any direct frontend Supabase access.

## Backups

- Daily PostgreSQL dump of `tp_costing` schema.
- Keep 7 daily backups and 4 weekly backups.
- Test restore quarterly.
- Script added: `deploy/backup-tp-costing.sh`.
- Restore-test script added: `deploy/restore-test-tp-costing.sh /path/to/backup.sql.gz`.

## Monitoring

- Health endpoint: `/api/health`.
- Monitor app container restart count.
- Monitor Supabase REST availability.
- Add uptime monitor against the public URL.
- Script added: `deploy/healthcheck-tp-costing.sh`.
- Suggested cron:
  - `15 18 * * * /opt/smart-tp-costing/app/deploy/backup-tp-costing.sh >> /opt/smart-tp-costing/backup.log 2>&1`
  - `*/5 * * * * /opt/smart-tp-costing/app/deploy/healthcheck-tp-costing.sh >> /opt/smart-tp-costing/health-cron.log 2>&1`

## Rollback

- Each deployment keeps prior app folder under `/opt/smart-tp-costing/app_prev_*`.
- Rollback procedure:
  1. Stop current app container.
  2. Move latest app folder aside.
  3. Restore most recent `app_prev_*` to `app`.
  4. Rebuild/restart compose.

## Error Logs

- Review `docker logs smart-tp-costing`.
- Add future admin log viewer for recent app errors.

## Final Go-Live Criteria

- HTTPS enabled.
- User login enabled.
- Pilot QA passes for at least 3 real styles.
- Backup and rollback tested.
- Notification recipients configured.
