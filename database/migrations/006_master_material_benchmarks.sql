-- Master material benchmark curation
-- Allows MD / Costing / Admin to set curated reference prices, operations, and
-- knitting times that OVERRIDE the derived (auto-aggregated) benchmark lines.
-- The MD review panel merges these with the derived benchmark so reviewers see
-- curated references even before enough CBD history accumulates.

create table if not exists tp_costing.master_material_benchmarks (
  id uuid primary key default gen_random_uuid(),
  -- Normalized description (material name / operation / machine type).
  label text not null,
  category text not null check (category in ('material', 'operation', 'knitting')),
  -- Curated reference values.
  curated_average numeric,
  curated_median numeric,
  curated_max numeric,
  -- True when the values are minutes (knitting) rather than USD.
  is_time boolean not null default false,
  -- Free-form note from the curator (e.g. "premium yarn, verified Q3 pricing").
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text,
  unique (label, category)
);

-- RLS is managed at the API layer (service role); keep the table readable by
-- the app role for the detail page and writable only via admin routes.
alter table tp_costing.master_material_benchmarks enable row level security;

create policy "master_material_benchmarks_select" on tp_costing.master_material_benchmarks
  for select using (true);

create policy "master_material_benchmarks_insert" on tp_costing.master_material_benchmarks
  for insert with check (true);

create policy "master_material_benchmarks_update" on tp_costing.master_material_benchmarks
  for update using (true);

create policy "master_material_benchmarks_delete" on tp_costing.master_material_benchmarks
  for delete using (true);

grant all on table tp_costing.master_material_benchmarks to service_role;
