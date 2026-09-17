# Smart TP Costing Deployment

## Target

Run the app on the VPS as a separate container beside the existing Supabase stack.

Live URL (nginx 443 → 127.0.0.1:3110):

```txt
https://smart-tp-costing.5-223-78-194.sslip.io/
```

When verifying from a workstation, use that hostname — **not** the bare IP. The
VPS hosts several apps, and port 80's `default_server` block belongs to the AP
Invoice app (`/opt/ap-invoice`, Express on 3001), so `http://5.223.78.194/…`
answers from the wrong application (`/login` returns its SPA, `/api/…` returns
Express `Cannot GET …`). Port 3110 is not open to the outside either, so the
reliable path is an SSH tunnel:

```sh
ssh -f -N -L 3121:127.0.0.1:3110 root@5.223.78.194
curl -s http://127.0.0.1:3121/api/health      # {"ok":true,"checks":{...}}
```

Note that https to the sslip.io host can be intercepted by a corporate
web-filter (Fortinet), which serves its own certificate and page; the tunnel
avoids that entirely.

Recommended production URL after DNS is configured:

```txt
https://costing.madison88.com
```

## Environment

Create `deploy/.env.costing` on the VPS using `deploy/.env.costing.example` as reference.

Required:

```txt
NEXTGEN_BASE_URL=https://nextgen.madison88.com
NEXTGEN_USERNAME=...
NEXTGEN_PASSWORD=...
```

The compose file also loads `/opt/supabase/docker/.env`, so the app can reuse the existing Supabase `SERVICE_ROLE_KEY` without copying it into another file.

Never commit `.env.costing`.

## Deploying from a workstation

```bash
export TP_VPS_PASSWORD=...        # or let ssh prompt
bash deploy/sync-to-vps.sh             # package, typecheck, ship, roll out, verify
bash deploy/sync-to-vps.sh --no-wait   # ship and start the rollout, exit
```

The script packages the working tree (never a `.env` file — the VPS keeps its own
`deploy/.env.costing`), uploads it, and runs `deploy/rollout-security.sh` on the
VPS, which extracts into `app_new_<stamp>`, migrates, swaps, rebuilds, restores
the notification cron, health-checks, and rolls back on failure. It runs the
rollout detached and polls the log, so a dropped connection cannot interrupt a
docker build or fire the rollback trap.

## Migrations

`deploy/apply-migrations.sh` applies an explicit ordered manifest; migrations are
not auto-discovered (the pre-ledger ones must not be re-run). Two things matter:

- It runs as **supabase_admin**, not `postgres`. Part of `tp_costing` is owned by
  `supabase_admin` and this image's `postgres` role is not a superuser, so
  `CREATE INDEX` / `ALTER TABLE` on those tables fails with "must be owner of
  table". Override with `DB_USER=`. A failure of that kind once stopped a rollout
  half-way, after the code swap and before the rebuild.
- `rollout-security.sh` migrates the **new** tree before swapping directories, so
a failed migration leaves the running app untouched.

## Commands

On the VPS, from the app directory:

```bash
docker compose -f deploy/docker-compose.costing.yml --env-file deploy/.env.costing up -d --build
```

Check logs:

```bash
docker logs -f smart-tp-costing
```

Health check:

```bash
curl http://127.0.0.1:3110/api/health
```

## Verifying a deployment

```bash
# through the tunnel above, as any role (cookies minted from the VPS secret)
node scripts/fuzz-http.mjs --base http://127.0.0.1:3121 --secret "$SECRET" --roles pbd,admin
```

Measured on the live deployment (2026-09-17): `/api/historical/distinct` 299 ms
cold / 114 ms warm (was ~70 s cold), `/api/nextgen/filter-options` 128 ms from the
persisted snapshot, Like Styles search 275 ms, and 2,223 hostile-param probes
across anon/pbd/admin with no hangs and no 5xx.

## Security Before Public Use

Put the app behind HTTPS and access control before sharing outside the internal team.

Minimum:

```txt
HTTPS/domain
restricted Supabase Studio
rotated shared credentials
service role key only in backend env
database backups
```
