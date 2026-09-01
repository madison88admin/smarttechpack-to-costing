-- Master benchmark price history
-- Every curated benchmark create/update is recorded so MD / Costing / Admin can
-- see how reference prices have moved over time, who changed them, and what
-- the previous values were. The dashboard re-flags active requests whose
-- submitted CBD lines become over-benchmark as a result of a change.
create table if not exists tp_costing.master_benchmark_history (
  id uuid primary key default gen_random_uuid(),
  -- Normalized description (material name / operation / machine type).
  label text not null,
  category text not null check (category in ('material', 'operation', 'knitting')),
  -- Previous curated values (null when the reference was first created).
  prev_average numeric,
  prev_median numeric,
  prev_max numeric,
  -- New curated values.
  new_average numeric,
  new_median numeric,
  new_max numeric,
  -- True when the values are minutes (knitting) rather than USD.
  is_time boolean not null default false,
  changed_by text,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists master_benchmark_history_label_idx
  on tp_costing.master_benchmark_history (label, category, created_at desc);

-- RLS is managed at the API layer (service role); keep the table readable by
-- the app role for the admin page and writable only via admin routes.
alter table tp_costing.master_benchmark_history enable row level security;

create policy "master_benchmark_history_select" on tp_costing.master_benchmark_history
  for select using (true);

create policy "master_benchmark_history_insert" on tp_costing.master_benchmark_history
  for insert with check (true);

grant all on table tp_costing.master_benchmark_history to service_role;
