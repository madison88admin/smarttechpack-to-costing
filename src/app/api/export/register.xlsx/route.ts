import * as XLSX from "xlsx";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { canRunCostingAction, canRunPbdAction, getCurrentRole } from "@/lib/auth/roles";
import { listHistoricalCostings } from "@/lib/costing/history";
import { buildComparableSheets, extractLikeStyleAttributes } from "@/lib/export/comparable";
import { buildRegisterExportRows, REGISTER_EXPORT_HEADERS } from "@/lib/export/register";
import { getReportData, normalizeRegisterSort, sortReportRows, type ReportFilters, type ReportGranularity } from "@/lib/reporting";

/**
 * Exports the full filtered Request Register as an XLSX workbook — every
 * matching row, not just the visible page — plus one "<request> styles" sheet
 * per request that has comparable approved styles (the same attribute matching
 * as the Like Styles search). Honors the same filters as /reports plus the
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
  const records = buildRegisterExportRows(rows, role);

  const wb = XLSX.utils.book_new();
  const aoa = [
    [...REGISTER_EXPORT_HEADERS],
    ...records.map((record) => REGISTER_EXPORT_HEADERS.map((header) => record[header] ?? ""))
  ];
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  sheet["!cols"] = REGISTER_EXPORT_HEADERS.map((header) => ({
    wch: Math.min(Math.max(header.length + 4, 12), 42)
  }));
  XLSX.utils.book_append_sheet(wb, sheet, "Request Register");

  await appendComparableStyleSheets(wb, records);

  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="tp-costing-register-${stamp}.xlsx"`
    }
  });
}

/**
 * Appends one "<request> styles" sheet per register row that has a CBD with
 * at least one comparable approved style. Best-effort: a failure computing the
 * comparison sets must never fail the register export itself.
 */
async function appendComparableStyleSheets(
  wb: XLSX.WorkBook,
  records: ReturnType<typeof buildRegisterExportRows>
) {
  try {
    if (records.length === 0) return;
    const supabase = createSupabaseServiceClient();
    const requestIds = records.map((record) => record.request_id);

    // Latest CBD per request for the attribute matching (raw_payload has the
    // yarn/knit/machine/construction/category the search page uses).
    const { data: cbds } = await supabase
      .from("factory_cbds")
      .select("costing_request_id, raw_payload")
      .in("costing_request_id", requestIds)
      .order("submitted_at", { ascending: false });

    const latestByRequest = new Map<string, unknown>();
    for (const cbd of (cbds ?? []) as Array<{ costing_request_id: string; raw_payload: unknown }>) {
      if (!latestByRequest.has(cbd.costing_request_id)) {
        latestByRequest.set(cbd.costing_request_id, cbd.raw_payload);
      }
    }

    const historical = await listHistoricalCostings();
    const sheets = buildComparableSheets(
      records.map((record) => ({
        id: record.request_id,
        requestNumber: record.request_number || null,
        attributes: extractLikeStyleAttributes(latestByRequest.get(record.request_id))
      })),
      historical
    );

    for (const { sheetName, aoa } of sheets) {
      const comparable = XLSX.utils.aoa_to_sheet(aoa);
      comparable["!cols"] = [
        { wch: 18 },
        { wch: 12 },
        { wch: 30 },
        { wch: 10 },
        { wch: 12 },
        { wch: 22 },
        { wch: 18 },
        { wch: 14 },
        { wch: 14 },
        { wch: 14 },
        { wch: 16 },
        { wch: 18 },
        { wch: 14 },
        { wch: 20 },
        { wch: 40 }
      ];
      XLSX.utils.book_append_sheet(wb, comparable, sheetName);
    }
  } catch (error) {
    console.error("[register.xlsx] comparable styles sheets skipped:", error instanceof Error ? error.message : error);
  }
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
