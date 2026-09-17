import { canRunCostingAction, canRunPbdAction, getCurrentRole } from "@/lib/auth/roles";
import { csvResponse } from "@/lib/export/csv";
import { registerCsv } from "@/lib/export/register";
import { getReportData, normalizeRegisterSort, sortReportRows, type ReportFilters, type ReportGranularity } from "@/lib/reporting";

/**
 * Exports the full filtered Request Register as CSV — every matching row,
 * not just the visible page. Honors the same filters as /reports plus the
 * current register sort (sort + dir params).
 */
export async function GET(request: Request) {
  const role = getCurrentRole();
  const allowed = canRunPbdAction(role) || canRunCostingAction(role);
  if (!allowed) {
    return new Response("Unauthorized", { status: 401 });
  }

  const url = new URL(request.url);
  const filters = readFilters(url);
  const data = await getReportData(filters);

  const sort = normalizeRegisterSort(url.searchParams.get("sort"));
  const dir = url.searchParams.get("dir") === "asc" ? "asc" : "desc";
  const rows = sortReportRows(data.rows, sort, dir);

  const stamp = new Date().toISOString().slice(0, 10);
  return csvResponse(`tp-costing-register-${stamp}.csv`, registerCsv(rows, role));
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
