#!/usr/bin/env sh
set -eu
docker exec -i supabase-db psql -U postgres -d postgres -At <<'SQL'
select coalesce(p.style_number,'') || '|' || count(b.id)
from tp_costing.nextgen_products p
join tp_costing.nextgen_bom_lines b on b.product_id=p.id
where p.style_number not in ('M8836232','M88118568')
group by p.style_number
order by count(b.id) desc, p.style_number
limit 10;
SQL
