# Security Hardening

## Authentication

- Production login uses Supabase Auth and requires an active row in `tp_costing.user_profiles`.
- `TP_COSTING_ENABLE_SUPABASE_AUTH=true` is required.
- `TP_COSTING_ENABLE_LEGACY_PASSWORD_LOGIN=false` is required after migration.
- `TP_COSTING_SESSION_SECRET` must be a random secret of at least 32 characters.
- The application stores one signed, HttpOnly, SameSite session cookie. Role and user identity are read from its signed payload.

## Request protection

- Middleware redirects unauthenticated page requests to `/login`.
- Protected API requests return HTTP 401 without a valid signed session.
- State-changing API requests reject cross-site browser origins.
- Role checks remain enforced inside each sensitive API route.

## Database

- Apply migrations in `database/migrations` in filename order.
- Migration `001_security_and_workflow_hardening.sql` enables RLS and revokes direct `anon` and `authenticated` access.
- The service-role key stays server-side only.

## Rotation

Rotate any credential shared in chat or screenshots before go-live:

1. Create replacement secrets.
2. Update Supabase/NextGen/VPS configuration and the app environment in one maintenance window.
3. Restart affected services and verify `/api/health`.
4. Revoke the old credentials only after successful verification.
5. Record the rotation time and owner without storing secret values in the audit note.
