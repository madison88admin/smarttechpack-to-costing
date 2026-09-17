import { getReportData, type ReportFilters, type ReportGranularity } from "@/lib/reporting";
import { csvResponse, toCsv } from "@/lib/export/csv";
import { canDownloadCostingReports, getCurrentRole } from "@/lib/auth/roles";

export async function GET(request: Request) {
  const role = getCurrentRole();
  const allowed = canDownloadCostingReports(role);
  if (!allowed) {
    return new Response("Unauthorized", { status: 401 });
  }

  const filters = readFilters(new URL(request.url));
  const data = await getReportData(filters);

  const headers = [
    "request_number",
    "style_number",
    "product_name",
    "factory_name",
    "brand",
    "customer",
    "season",
    "product_category",
    "status",
    "created_at",
    "updated_at",
    "request_id"
  ];

  const csv = toCsv(
    data.rows.map((row) => ({
      request_number: row.request_number,
      style_number: row.style_number,
      product_name: row.product_name,
      factory_name: row.factory_name,
      brand: row.brand,
      customer: row.customer,
      season: row.season,
      product_category: row.product_category,
      status: row.status,
      created_at: row.created_at,
      updated_at: row.updated_at,
      request_id: row.id
    })),
    headers
  );

  return csvResponse(`tp-costing-report-${new Date().toISOString().slice(0, 10)}.csv`, csv);
}

function readFilters(url: URL): ReportFilters {
  const pick = (key: string) => {
    const value = url.searchParams.get(key)?.trim();
    return value ? value : null;
  };
  return {
    factory: pick("factory"),
    brand: pick("brand"),
    customer: pick("customer"),
    season: pick("season"),
    status: pick("status"),
    granularity: pick("granularity") as ReportGranularity | null,
    from: pick("from"),
    to: pick("to")
  };
}
