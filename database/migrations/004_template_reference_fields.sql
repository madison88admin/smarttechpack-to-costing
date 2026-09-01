-- Template-driven NextGen BOM fields from BTP/PP request packages.
alter table if exists tp_costing.nextgen_bom_lines add column if not exists material_description text;
alter table if exists tp_costing.nextgen_bom_lines add column if not exists material_type text;
alter table if exists tp_costing.nextgen_bom_lines add column if not exists supplier_name text;
alter table if exists tp_costing.nextgen_bom_lines add column if not exists placement text;
alter table if exists tp_costing.nextgen_bom_lines add column if not exists quote_price numeric;
alter table if exists tp_costing.nextgen_bom_lines add column if not exists quote_currency text;
alter table if exists tp_costing.nextgen_bom_lines add column if not exists compliance_status text;
alter table if exists tp_costing.nextgen_bom_lines add column if not exists colorway text;
