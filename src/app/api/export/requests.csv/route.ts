import { listCostingRequests } from "@/lib/costing/requests";
import { csvResponse, toCsv } from "@/lib/export/csv";
import { getCurrentRole } from "@/lib/auth/roles";

type RequestExportRow = Awaited<ReturnType<typeof listCostingRequests>>["data"][number];

export async function GET(request: Request) {
  const role = getCurrentRole();
  if (role === "viewer") {
    return new Response("Unauthorized", { status: 401 });
  }
  const url = new URL(request.url);
  const query = url.searchParams.get("q") ?? "";
  const status = url.searchParams.get("status") ?? "all";
  // Role visibility: the export must never leak requests the caller cannot see
  // in the UI. The dashboard list passes roles — this route must do the same,
  // otherwise factory could export internal review statuses via the CSV.
  const result = await listCostingRequests({
    query,
    status: status === "overdue" ? "all" : status,
    limit: 1000,
    offset: 0,
    roles: [role]
  });
  const headers = [
    "request_number",
    "style_number",
    "product_name",
    "factory_name",
    "status",
    "priority",
    "created_at",
    "updated_at",
    "request_id"
  ];
  const csv = toCsv(
    result.data.map((row) => {
      const product = getProduct(row);

      return {
        request_number: row.request_number,
        style_number: product?.style_number,
        product_name: product?.name,
        factory_name: row.factory_name,
        status: row.status,
        priority: row.priority,
        created_at: row.created_at,
        updated_at: row.updated_at,
        request_id: row.id
      };
    }),
    headers
  );

  return csvResponse(`tp-costing-requests-${dateStamp()}.csv`, csv);
}

function getProduct(row: RequestExportRow) {
  return Array.isArray(row.nextgen_products) ? row.nextgen_products[0] : row.nextgen_products;
}

function dateStamp() {
  return new Date().toISOString().slice(0, 10);
}
