import { toCsv } from "@/lib/export/csv";
import type { LikeStyleMatch } from "@/lib/costing/history";

// Export helpers for the Like Styles Search page. The comparison set is the
// full scored result list (not a paginated slice), so Costing/MD/PBD can save
// the matched styles with their benchmark consumption/knitting time for review.

export const LIKE_STYLES_EXPORT_HEADERS = [
  "style_number",
  "factory_name",
  "approved_cost",
  "currency",
  "yarn_type",
  "knit_type",
  "machine_type",
  "construction",
  "product_category",
  "average_consumption",
  "knitting_time",
  "approved_at",
  "match_score",
  "match_reasons",
  "matching_notes",
  "costing_request_id"
] as const;

export type LikeStylesExportRow = {
  style_number: string;
  factory_name: string;
  approved_cost: number | string;
  currency: string;
  yarn_type: string;
  knit_type: string;
  machine_type: string;
  construction: string;
  product_category: string;
  average_consumption: number | string;
  knitting_time: number | string;
  approved_at: string;
  match_score: number;
  match_reasons: string;
  matching_notes: string;
  costing_request_id: string;
};

export function buildLikeStylesExportRows(results: LikeStyleMatch[]): LikeStylesExportRow[] {
  return results.map((row) => ({
    style_number: row.style_number ?? "",
    factory_name: row.factory_name ?? "",
    approved_cost: row.total_cost ?? "",
    currency: row.currency ?? "",
    yarn_type: row.yarn_type ?? "",
    knit_type: row.knit_type ?? "",
    machine_type: row.machine_type ?? "",
    construction: row.construction ?? "",
    product_category: row.product_category ?? "",
    average_consumption: row.average_consumption ?? "",
    knitting_time: row.knitting_time ?? "",
    approved_at: row.approved_at ?? "",
    match_score: row.matchScore,
    match_reasons: row.matchReasons.join(", "),
    matching_notes: row.matchingNotes.map((note) => `${note.note_type}: ${note.note}`).join(" | "),
    costing_request_id: row.costing_request_id ?? ""
  }));
}

export function likeStylesCsv(results: LikeStyleMatch[]): string {
  return toCsv(
    buildLikeStylesExportRows(results) as unknown as Array<Record<string, unknown>>,
    [...LIKE_STYLES_EXPORT_HEADERS]
  );
}

export type LikeStylesExportParams = {
  yarnType: string;
  knitType: string;
  machineType: string;
  construction: string;
  category: string;
  factory: string;
  brand: string;
  customer: string;
  season: string;
  notes: string;
  minScore: number;
  limit: number;
};

/** Shared by the CSV/XLSX export routes: same params as the search API. */
export function parseLikeStylesExportParams(url: URL): LikeStylesExportParams {
  const pick = (key: string) => url.searchParams.get(key)?.trim() ?? "";
  return {
    yarnType: pick("yarnType"),
    knitType: pick("knitType"),
    machineType: pick("machineType"),
    construction: pick("construction"),
    category: pick("category"),
    factory: pick("factory"),
    brand: pick("brand"),
    customer: pick("customer"),
    season: pick("season"),
    notes: pick("notes"),
    minScore: Number(url.searchParams.get("minScore")) || 0,
    // Exports carry the whole comparison set, not the 10-row screen cap.
    limit: Math.min(Number(url.searchParams.get("limit")) || 200, 500)
  };
}
