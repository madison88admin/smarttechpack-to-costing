import { csvResponse, toCsv } from "@/lib/export/csv";
import {
  countHistoricalCostings,
  HISTORICAL_READ_MAX_ROWS,
  listHistoricalCostings,
  smvSourceStatus
} from "@/lib/costing/history";
import { canAccessHistoricalCostData, getCurrentRole } from "@/lib/auth/roles";

export async function GET(request: Request) {
  const role = getCurrentRole();
  if (!canAccessHistoricalCostData(role)) {
    return new Response("Forbidden", { status: 403 });
  }
  const url = new URL(request.url);
  const filters = {
    query: url.searchParams.get("q") ?? "",
    factory: url.searchParams.get("factory") ?? "",
    brand: url.searchParams.get("brand") ?? "",
    customer: url.searchParams.get("customer") ?? "",
    season: url.searchParams.get("season") ?? ""
  };
  // The whole filtered register, sized by its own count rather than a fixed
  // ceiling — an "Export CSV" that quietly stopped at 5,000 rows of a larger
  // register would repeat the truncation this endpoint was fixed for. Above the
  // safety ceiling the export refuses and says so, instead of shipping a prefix.
  const total = await countHistoricalCostings(filters);
  if (total > HISTORICAL_READ_MAX_ROWS) {
    return new Response(
      `This export covers ${total.toLocaleString()} rows, above the ${HISTORICAL_READ_MAX_ROWS.toLocaleString()}-row export limit. Narrow the filters and retry.`,
      { status: 413 }
    );
  }
  const rows = await listHistoricalCostings({ ...filters, maxRows: Math.max(total, 1) });
  const headers = [
    "style_number",
    "factory_name",
    "brand",
    "customer",
    "season",
    "yarn_type",
    "knit_type",
    "machine_type",
    "construction",
    "product_category",
    "approved_cost",
    "currency",
    "approved_at",
    "knitting_time",
    "smv_source",
    "costing_request_id"
  ];
  const csv = toCsv(
    rows.map((row) => ({
      style_number: row.style_number,
      factory_name: row.factory_name,
      brand: row.brand,
      customer: row.customer,
      season: row.season,
      yarn_type: row.yarn_type,
      knit_type: row.knit_type,
      machine_type: row.machine_type,
      construction: row.construction,
      product_category: row.product_category,
      approved_cost: row.total_cost,
      currency: row.currency,
      approved_at: row.approved_at,
      knitting_time: row.knitting_time,
      smv_source: smvSourceStatus(row).label,
      costing_request_id: row.costing_request_id
    })),
    headers
  );

  return csvResponse(`tp-costing-history-${dateStamp()}.csv`, csv);
}

function dateStamp() {
  return new Date().toISOString().slice(0, 10);
}
