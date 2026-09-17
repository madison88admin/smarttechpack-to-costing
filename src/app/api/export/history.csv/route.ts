import { csvResponse, toCsv } from "@/lib/export/csv";
import { listHistoricalCostings, smvSourceStatus } from "@/lib/costing/history";
import { canAccessHistoricalCostData, getCurrentRole } from "@/lib/auth/roles";

export async function GET(request: Request) {
  const role = getCurrentRole();
  if (!canAccessHistoricalCostData(role)) {
    return new Response("Forbidden", { status: 403 });
  }
  const url = new URL(request.url);
  const query = url.searchParams.get("q") ?? "";
  const rows = await listHistoricalCostings({
    query,
    factory: url.searchParams.get("factory") ?? "",
    brand: url.searchParams.get("brand") ?? "",
    customer: url.searchParams.get("customer") ?? "",
    season: url.searchParams.get("season") ?? ""
  });
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
