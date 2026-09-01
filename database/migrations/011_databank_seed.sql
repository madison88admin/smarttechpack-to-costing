-- 011 databank seed: public.databank (2829 rows from Downloads/databank_rows.sql 7.25.25 + historical_costings bridge)
-- Run: node batch-insert-databank.mjs then sync-to-historical.mjs (see tmp/opencode)

create schema if not exists public;

create table if not exists public.databank (
  season text,
  customer text,
  style_number text,
  style_name text,
  main_material text,
  material_consumption text,
  material_price text,
  trim_cost text,
  total_material_cost text,
  knitting_machine text,
  knitting_time text,
  knitting_cpm text,
  knitting_cost text,
  ops_cost text,
  knitting_ops_cost text,
  packaging text,
  oh text,
  profit text,
  fty_adjustment text,
  ttl_fty_cost text,
  main_material_cost text,
  label text,
  trims text,
  packaging2 text,
  total_material text,
  material_code text,
  material_consumption3 text,
  material_price4 text,
  finance_percent text,
  finance_usd text,
  smv text,
  average_efficiency text,
  oh2 text,
  oh_ratio text,
  bom_cost_tot_mat_finance text,
  direct_labor_costs text,
  labor_oh_usd text,
  bom_lo text,
  others text,
  profit_percent text,
  profit_usd text,
  fob_adj_usd text,
  total_lop text,
  product_testing_cost text,
  freight_to_port text,
  total_fob text,
  sample_wt_with_tag_qc_sample_check_form_grams text,
  remarks text,
  id uuid primary key
);
create index if not exists databank_style_idx on public.databank(style_number);
create index if not exists databank_machine_idx on public.databank(knitting_machine);
create index if not exists databank_customer_idx on public.databank(customer);
create index if not exists databank_season_idx on public.databank(season);

-- Bridge: public.databank -> tp_costing.historical_costings
-- Executed via sync-to-historical.mjs (2828 rows, avg knitting 13.0min, avg cost $3.88)
-- Columns mapped: season/customer/style_number/style_name/main_material->yarn_type/knitting_machine->machine_type/knitting_time|smv->knitting_time/ttl_fty_cost->total_cost/knitting_ops_cost|knitting+ops->labor/oh->overhead/searchable_text = style+customer+season+material+machine+remarks/raw_payload = to_jsonb(d)
-- Dedup: initially distinct style_number, then remaining variants inserted (total public 2829 -> historical 2828)

-- Verification:
-- SELECT count(*) FROM public.databank; -- 2829
-- SELECT count(*) FROM tp_costing.historical_costings; -- 2828
-- SELECT machine_type, count(*) FROM tp_costing.historical_costings GROUP BY machine_type ORDER BY count DESC;
