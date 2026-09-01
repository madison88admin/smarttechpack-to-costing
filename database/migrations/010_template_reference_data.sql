-- Generic, auditable storage for MML and Costing Metric workbook rows.
create table if not exists tp_costing.template_reference_data (
  id uuid primary key default gen_random_uuid(),
  reference_type text not null check (reference_type in ('mml','costing_metric')),
  source_workbook text not null,
  source_sheet text not null,
  row_number integer not null,
  category text,
  material_type text,
  material_name text,
  brand text,
  factory text,
  season text,
  unit text,
  supplier text,
  effective_date date,
  numeric_value numeric,
  raw_data jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  imported_at timestamptz not null default now(),
  unique(reference_type, source_workbook, source_sheet, row_number)
);
create index if not exists template_reference_data_lookup_idx
  on tp_costing.template_reference_data(reference_type, category, material_type, material_name);
create index if not exists template_reference_data_season_idx
  on tp_costing.template_reference_data(reference_type, season, brand, factory);
