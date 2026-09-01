import { scoreLikeStyles, type HistoricalCostingRow, type LikeStyleMatch, type LikeStyleMatchInput } from "@/lib/costing/history";

// Per-request "comparable styles" sheets for the Request Register XLSX export.
//
// For every register row that has a CBD, we take the same attribute matching
// the Like Styles search uses (yarn/knit/machine/construction/category) and
// score the approved historical library against it, then append one sheet per
// request that has at least one comparable style. The sheets always agree with
// what the /like-styles page would return for those attributes.

export const COMPARABLE_STYLES_HEADERS = [
  "style_number",
  "factory_name",
  "total_cost",
  "currency",
  "match_score",
  "match_reasons",
  "yarn_type",
  "knit_type",
  "machine_type",
  "construction",
  "product_category",
  "average_consumption",
  "knitting_time",
  "approved_at",
  "source_request_id"
] as const;

export type ComparableSheet = {
  /** Excel sheet name, e.g. "CR-348090 styles" (<= 31 chars, safe chars). */
  sheetName: string;
  aoa: unknown[][];
};

/** Reads the like-styles attributes out of a CBD raw_payload. */
export function extractLikeStyleAttributes(rawPayload: unknown): LikeStyleMatchInput {
  if (!rawPayload || typeof rawPayload !== "object") return {};
  const payload = rawPayload as Record<string, unknown>;
  const pick = (key: string): string | null => {
    const value = payload[key];
    return typeof value === "string" && value.trim() ? value.trim() : null;
  };
  return {
    yarnType: pick("yarnType"),
    knitType: pick("knitType"),
    machineType: pick("machineType"),
    construction: pick("construction"),
    productCategory: pick("productCategory")
  };
}

/**
 * Builds one sheet per register request that has at least one comparable
 * historical style, sorted by match score descending. Requests without a CBD
 * or without matches produce no sheet. The same attribute scoring as the
 * Like Styles search page, capped at `limit` comparables per request.
 */
export function buildComparableSheets(
  requests: Array<{ id: string; requestNumber: string | null; attributes: LikeStyleMatchInput }>,
  historical: HistoricalCostingRow[],
  limit = 5
): ComparableSheet[] {
  const sheets: ComparableSheet[] = [];
  const usedNames = new Set<string>();

  for (const request of requests) {
    const matches = scoreLikeStyles(historical, {
      ...request.attributes,
      excludeRequestId: request.id,
      minScore: 1,
      limit
    });
    if (matches.length === 0) continue;

    const label = (request.requestNumber ?? request.id.slice(0, 8)).trim() || "request";
    let sheetName = `${label} styles`.replace(/[\/?*[\]:]/g, "-").slice(0, 31);
    let suffix = 2;
    while (usedNames.has(sheetName)) {
      sheetName = `${`${label} styles`.replace(/[\/?*[\]:]/g, "-").slice(0, 28)} (${suffix++})`;
    }
    usedNames.add(sheetName);

    sheets.push({
      sheetName,
      aoa: [["Request", request.requestNumber ?? request.id], [], [...COMPARABLE_STYLES_HEADERS], ...matches.map(toRow)]
    });
  }

  return sheets;
}

function toRow(match: LikeStyleMatch): unknown[] {
  return COMPARABLE_STYLES_HEADERS.map((header) => {
    switch (header) {
      case "style_number":
        return match.style_number ?? "";
      case "factory_name":
        return match.factory_name ?? "";
      case "total_cost":
        return match.total_cost ?? "";
      case "currency":
        return match.currency ?? "";
      case "match_score":
        return match.matchScore;
      case "match_reasons":
        return match.matchReasons.join(", ");
      case "yarn_type":
        return match.yarn_type ?? "";
      case "knit_type":
        return match.knit_type ?? "";
      case "machine_type":
        return match.machine_type ?? "";
      case "construction":
        return match.construction ?? "";
      case "product_category":
        return match.product_category ?? "";
      case "average_consumption":
        return match.average_consumption ?? "";
      case "knitting_time":
        return match.knitting_time ?? "";
      case "approved_at":
        return match.approved_at ?? "";
      case "source_request_id":
        return match.costing_request_id ?? "";
    }
  });
}
