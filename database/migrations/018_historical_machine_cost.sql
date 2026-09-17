-- 018_historical_machine_cost.sql
-- Stores the landed cost and the selling price on each historical costing row,
-- so the Like Styles machine-speed table can average "what this machine costs"
-- per machine type without loading every row's raw payload.
--
-- Why columns and not a payload read: the like-styles pool query selects
-- explicit columns on purpose (raw_payload carries the whole latest CBD), and
-- the machine table must stay one query. `total_cost` already stores the FOB
-- cost; `landed_cost` adds freight, duty, insurance, customs and inland
-- transport, which only the newer costings carry.
--
-- `selling_price` is the real customer-facing price (PBD-entered, else the
-- NextGen-ported price) — the same precedence the margin panel uses. It is
-- deliberately left NULL when unknown: imported Data Bank history has no real
-- selling price, and a markup estimate must never be presented as a margin.

alter table tp_costing.historical_costings
  add column if not exists landed_cost numeric,
  add column if not exists selling_price numeric;

-- Landed cost from the costed payload, where the totals were snapshotted.
update tp_costing.historical_costings h
set landed_cost = (h.raw_payload -> 'totals' ->> 'landedCostPerUnit')::numeric
where h.landed_cost is null
  and jsonb_typeof(h.raw_payload -> 'totals') = 'object'
  and (h.raw_payload -> 'totals' ->> 'landedCostPerUnit') ~ '^[0-9]+(\.[0-9]+)?$'
  and (h.raw_payload -> 'totals' ->> 'landedCostPerUnit')::numeric > 0;

-- Selling price from the request this row was approved from: PBD-entered price
-- first, then the NextGen-ported selling price (same order as the margin panel).
-- Every cast is regex-guarded — the payload keys are free text upstream.
update tp_costing.historical_costings h
set selling_price = v.price
from tp_costing.costing_requests r
left join tp_costing.nextgen_products p on p.id = r.product_id
cross join lateral (
  select coalesce(
    case when (r.pbd_pricing ->> 'wholesalePrice') ~ '^[0-9]+(\.[0-9]+)?$'
      then (r.pbd_pricing ->> 'wholesalePrice')::numeric end,
    case when (p.raw_payload ->> 'DefaultProductCostingCostingSellingPrice') ~ '^[0-9]+(\.[0-9]+)?$'
      then (p.raw_payload ->> 'DefaultProductCostingCostingSellingPrice')::numeric end,
    case when (p.raw_payload ->> 'TargetMaximumSellingPrice') ~ '^[0-9]+(\.[0-9]+)?$'
      then (p.raw_payload ->> 'TargetMaximumSellingPrice')::numeric end
  ) as price
) v
where h.costing_request_id = r.id
  and h.selling_price is null
  and v.price > 0;

insert into tp_costing.schema_migrations(version, description)
values ('018', 'Historical costing landed cost + selling price for machine cost/margin averages')
on conflict (version) do update
set description = excluded.description, applied_at = now();
