-- 007: named, shareable Like Styles comparison sets.
--
-- Costing or PBD can save the current comparison set (the exact scored
-- results plus the filters that produced them) under a name and share the
-- link, so both roles review the SAME set — even after historical data moves.
-- The results are snapshotted (not recomputed) so a shared link is stable.
-- request_id anchors a set to a request so the detail page can list them.
create table if not exists tp_costing.saved_comparison_sets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  request_id uuid references tp_costing.costing_requests(id) on delete cascade,
  filters jsonb not null default '{}'::jsonb,
  results jsonb not null default '[]'::jsonb,
  benchmark jsonb,
  share_token text not null unique,
  created_by text,
  created_by_role text,
  created_at timestamptz not null default now()
);

create index if not exists saved_comparison_sets_request_idx
  on tp_costing.saved_comparison_sets(request_id, created_at);

create index if not exists saved_comparison_sets_token_idx
  on tp_costing.saved_comparison_sets(share_token);

-- Security: match the rest of tp_costing (RLS + service_role only).
alter table tp_costing.saved_comparison_sets enable row level security;
revoke all on table tp_costing.saved_comparison_sets from anon, authenticated;
grant all on table tp_costing.saved_comparison_sets to service_role;
