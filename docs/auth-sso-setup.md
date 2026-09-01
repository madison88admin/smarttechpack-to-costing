# Smart TP Costing Auth / SSO Setup

## Current state

The app supports:

- Pilot shortcut users for internal testing.
- `tp_costing.user_profiles` users with hashed passwords.
- Supabase Auth email/password login when enabled.

## Enable Supabase Auth email/password

1. Create users in Supabase Auth.
2. Add matching rows in `tp_costing.user_profiles` using the same email and desired role.
3. Set:

```env
TP_COSTING_ENABLE_SUPABASE_AUTH=true
NEXT_PUBLIC_SUPABASE_URL=https://your-supabase-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

Pilot fallback remains active so admins are not locked out during migration.

## SSO readiness

For Microsoft Entra ID / Google / Okta SSO, provide:

- Provider type
- Client ID
- Client secret
- Allowed callback URL
- Allowed Madison88 email domains

After provider setup in Supabase Auth, set:

```env
TP_COSTING_ENABLE_SUPABASE_AUTH=true
TP_COSTING_SSO_PROVIDER=azure
```

The app already exposes `/api/auth/sso-status` for checking whether SSO flags are active.
