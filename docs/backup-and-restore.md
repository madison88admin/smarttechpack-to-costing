# Backup and restore

The costing database lives in the `supabase-db` container on the VPS
(`5.223.78.194`). Only `tp_costing` and `auth` matter for recovery: the first is
every request, CBD, historical costing and audit row; the second is the
Supabase identities the app signs in with. A dump of one without the other
cannot bring the system back.

## What runs

| Item | Value |
|---|---|
| Script | `deploy/backup-tp-costing.sh` |
| Output | `/opt/smart-tp-costing/backups/tp_costing_<stamp>.sql.gz`, `auth_<stamp>.sql.gz`, `tp_costing_<stamp>.manifest` |
| Schedule | daily **18:15 UTC** on the VPS (`15 18 * * *`); `install-backup-cron.sh` defaults to 02:00 for a fresh host |
| Log | `/opt/smart-tp-costing/backup.log` |
| Retention | prunable after **30 days** (`TP_COSTING_BACKUP_RETENTION_DAYS`), but the newest **7** dumps are never pruned (`TP_COSTING_BACKUP_KEEP_MINIMUM`); manually named archives are never pruned at all |

Confirm what is actually scheduled before trusting any of this — the crontab is
the only source of truth about whether backups run:

```bash
crontab -l | grep backup-tp-costing
bash /opt/smart-tp-costing/app/deploy/backup-tp-costing.sh --check
```

Install if the line is missing (on the VPS, idempotent):

```bash
cd /opt/smart-tp-costing/app
bash deploy/install-backup-cron.sh
```

## The backup died silently once — what prevented it from mattering

Between 2026-09-06 and 2026-09-16 the VPS took **no backups at all**, and nothing
signalled it: cron invoked `deploy/backup-tp-costing.sh` directly, the file had
no execute bit (a Windows checkout, CRLF endings, mode `644`), so every run wrote
`/bin/sh: Permission denied` into the log and exited. The same defect killed the
healthcheck (**10,072** failed runs) and the notification processor (**2,865**),
i.e. ten days with no escalation, digest or SLA notification while every job
looked scheduled.

Three things now hold that shut:

- `deploy-vps.sh` normalises the whole deploy directory on every deploy — strips
  `\r` and sets the execute bit on `deploy/*.sh` — which is the step that was
  missing (only `apply-migrations.sh` used to be chmod'd).
- `.gitattributes` forces `*.sh` to LF, so a Windows checkout cannot ship CRLF.
- `tests/deploy-config.test.ts` fails CI on any of it recurring, and also on a
  proxy port that disagrees with the port the app container publishes.

## Manually named dumps are the recovery set

Anything named outside the scheduled `tp_costing_<stamp>.sql.gz` pattern is never
pruned. The two pre-wipe dumps were renamed for exactly that reason:

```
/opt/smart-tp-costing/backups/tp_costing_pre_wipe_20260904T181501Z.sql.gz
/opt/smart-tp-costing/backups/tp_costing_pre_wipe_20260905T181501Z.sql.gz
```

They are the only copies that predate the 2026-09-16 request wipe, and they are
still the recovery path for `CR-621716` — confirm with:

```bash
zcat /opt/smart-tp-costing/backups/tp_costing_pre_wipe_*.sql.gz | grep -c CR-621716
```

Check the state at any time — this writes nothing:

```bash
bash deploy/backup-tp-costing.sh --check
```

It prints how many dumps exist, their timestamps and sizes, and the newest
manifest. **The manifest is how you find the right dump**: it records the row
counts and the newest `historical_costings.approved_at` at the moment the dump
was taken, so a dump that still contains a row deleted later is identifiable by
its higher count.

## Why a dump is verified, never assumed

A dump is kept only when it is non-empty *and* contains `tp_costing.historical_costings`
(the app schema) or `auth.users`. `pg_dump` writes to a plain file first and is
checked before compression, because in a shell pipeline the exit status belongs
to the last command — a failed `pg_dump` piped into `gzip` would otherwise look
like a success. Any failure removes the partial file and exits non-zero, so
cron reports it and no half-written file can masquerade as a backup.

`tests/backup-script.test.ts` exercises all of this against a stub `docker`:
dump errors, empty dumps, a missing core table, the manifest, `--check`, and the
retention floor.

## Restoring

### One row (the usual case)

Row-level loss comes from a cascading delete: `historical_costings.costing_request_id`
is `references costing_requests(id) on delete cascade`, so deleting a request
removes its historical costing. Since the parent is gone, restore the row with
`costing_request_id` left **NULL** — that is normal here (2,818 of 2,828 rows
have no request link) and keeps the row in Like Styles, benchmarks and machine
averages. The unique index only applies to non-null values.

```bash
# 1. Find the dump that still has it (manifest shows the higher count)
bash /opt/smart-tp-costing/app/deploy/backup-tp-costing.sh --check

# 2. Locate the request id and the historical row inside that dump
DUMP=/opt/smart-tp-costing/backups/tp_costing_<stamp>.sql.gz
REQ=$(gzip -dc "$DUMP" | grep -F 'CR-621716' | head -1 | cut -f1)
gzip -dc "$DUMP" | awk -v id="$REQ" -F'\t' '$2 == id' | head -5
```

Then insert the recovered row through the app's service key with
`costing_request_id: null`, and re-check the count (`historical_costings` should
go from 2,828 to 2,829).

### A whole table or schema

```bash
# Extract one table from a dump and load it into a scratch database first.
# Restore into production only after the row counts match the manifest.
gzip -dc "$DUMP" | sed -n '/^COPY tp_costing.historical_costings /,/^\\\.$/p' > historical_costings.copy
```

Restoring a full schema into a live database will collide with existing rows
(the dump has no `--clean`/`--if-exists`); restore into a scratch database,
compare, then copy across the specific rows you need.

### After any restore

- Reload PostgREST's schema cache so the API sees the change:
  `docker exec supabase-db psql -U postgres -d postgres -c "notify pgrst, 'reload schema';"`
- Verify in the app: Like Styles search returns the style, and the machine table
  counts the row in its cost sample.

## Point-in-time recovery (not enabled)

This is a self-hosted Supabase stack, so there is **no PITR**: no WAL
archiving, no `archive_mode`, and no managed snapshot to roll back to. Anything
deleted between two daily dumps is unrecoverable. Options, cheapest first:

1. **Frequent dumps** — run the backup script every 6 hours instead of daily
   (`TP_COSTING_BACKUP_SCHEDULE="0 */6 * * *"`). Bounds loss to 6 hours.
2. **WAL archiving** — set `archive_mode = on`, `archive_command` to a
   `wal-g`/`pgBackRest` target, then `pg_basebackup` for the base. Requires a
   restart of the db container and a storage target for the WAL.
3. **Managed Postgres with PITR** — move the database to a managed instance
   that offers point-in-time restore.

Until one of these is in place, treat every `delete` as permanent.

## Known loss — CR-621716

`CR-621716` was an older-session test request removed by a broad cleanup sweep.
Its `historical_costings` row cascaded with it, taking the table from **2,829 to
2,828** rows. Verified on 2026-09-16:

- Nothing in any of the 36 `tp_costing` tables mentions the number any more
  (`scripts/find-request-references.mjs CR-621716`).
- The VPS backups are the only possible source, and no dump from before the
  deletion has been found or read yet.
- Test-named requests are still visible to Like Styles and the machine averages;
  this row is simply absent from them.

If a pre-deletion dump turns up, use the row-level restore above. Nothing else
needs to change: the other 2,828 rows and the cost library are intact.
