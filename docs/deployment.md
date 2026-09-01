# Smart TP Costing Deployment

## Target

Run the app on the VPS as a separate container beside the existing Supabase stack.

Recommended local URL on VPS:

```txt
http://5.223.78.194:3110
```

Recommended production URL after HTTPS is configured:

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

## Commands

From the project root:

```bash
docker compose -f deploy/docker-compose.costing.yml --env-file deploy/.env.costing up -d --build
```

Check logs:

```bash
docker logs -f smart-tp-costing
```

Health check:

```bash
curl http://127.0.0.1:3110
curl http://127.0.0.1:3110/api/nextgen/health
```

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
