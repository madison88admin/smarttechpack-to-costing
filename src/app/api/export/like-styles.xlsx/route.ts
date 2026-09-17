import * as XLSX from "xlsx";
import { canAccessHistoricalCostData, getCurrentRole } from "@/lib/auth/roles";
import { buildLikeStylesExportRows, LIKE_STYLES_EXPORT_HEADERS, parseLikeStylesExportParams } from "@/lib/export/like-styles";
import { findLikeStyles } from "@/lib/costing/history";

export const dynamic = "force-dynamic";

// GET /api/export/like-styles.xlsx
// Exports the current Like Styles comparison set as a single-sheet workbook.
export async function GET(request: Request) {
  const role = getCurrentRole();
  if (!canAccessHistoricalCostData(role)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const url = new URL(request.url);
  const params = parseLikeStylesExportParams(url);
  const results = await findLikeStyles({
    yarnType: params.yarnType || null,
    knitType: params.knitType || null,
    machineType: params.machineType || null,
    construction: params.construction || null,
    productCategory: params.category || null,
    factoryName: params.factory || null,
    brand: params.brand || null,
    customer: params.customer || null,
    season: params.season || null,
    notesQuery: params.notes || null,
    minScore: params.minScore,
    limit: params.limit
  });

  const records = buildLikeStylesExportRows(results);

  const wb = XLSX.utils.book_new();
  const aoa = [
    [...LIKE_STYLES_EXPORT_HEADERS],
    ...records.map((record) => LIKE_STYLES_EXPORT_HEADERS.map((header) => record[header] ?? ""))
  ];
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  sheet["!cols"] = LIKE_STYLES_EXPORT_HEADERS.map((header) => ({
    wch: Math.min(Math.max(header.length + 4, 12), 42)
  }));
  XLSX.utils.book_append_sheet(wb, sheet, "Like Styles");

  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="tp-costing-like-styles-${stamp}.xlsx"`
    }
  });
}
