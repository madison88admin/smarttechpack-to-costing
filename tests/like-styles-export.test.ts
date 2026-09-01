import { describe, expect, it, vi } from "vitest";
import { buildLikeStylesExportRows, likeStylesCsv, LIKE_STYLES_EXPORT_HEADERS, parseLikeStylesExportParams } from "../src/lib/export/like-styles";
import type { LikeStyleMatch } from "../src/lib/costing/history";

// Export of the Like Styles comparison set: the full scored result list as CSV
// / XLSX so Costing/MD/PBD can save the matched styles with benchmark data.

function match(overrides: Partial<LikeStyleMatch> = {}): LikeStyleMatch {
  return {
    id: "h1",
    costing_request_id: "req-1",
    style_number: "M88-100",
    factory_name: "Cebu Factory",
    total_cost: 3.2,
    currency: "USD",
    approved_at: "2025-01-10T00:00:00Z",
    yarn_type: "100% Acrylic",
    knit_type: "Jacquard",
    machine_type: "7G",
    construction: "Rib",
    product_category: "Hats",
    average_consumption: 0.21,
    knitting_time: 0.45,
    matchScore: 8,
    matchReasons: ["Yarn +3", "Knit +3", "Machine +2"],
    matchingNotes: [{ note_type: "smv_note", note: "SMV re-checked", tags: ["smv"] }],
    ...overrides
  };
}

describe("like-styles export helper", () => {
  it("maps matches to flat records with readable reasons and notes", () => {
    const records = buildLikeStylesExportRows([match()]);
    expect(records).toHaveLength(1);
    expect(records[0]).toEqual({
      style_number: "M88-100",
      factory_name: "Cebu Factory",
      approved_cost: 3.2,
      currency: "USD",
      yarn_type: "100% Acrylic",
      knit_type: "Jacquard",
      machine_type: "7G",
      construction: "Rib",
      product_category: "Hats",
      average_consumption: 0.21,
      knitting_time: 0.45,
      approved_at: "2025-01-10T00:00:00Z",
      match_score: 8,
      match_reasons: "Yarn +3, Knit +3, Machine +2",
      matching_notes: "smv_note: SMV re-checked",
      costing_request_id: "req-1"
    });
  });

  it("falls back to empty strings for missing fields", () => {
    const records = buildLikeStylesExportRows([
      match({ style_number: null, factory_name: null, total_cost: null, yarn_type: null, matchingNotes: [] })
    ]);
    expect(records[0].style_number).toBe("");
    expect(records[0].factory_name).toBe("");
    expect(records[0].approved_cost).toBe("");
    expect(records[0].yarn_type).toBe("");
    expect(records[0].matching_notes).toBe("");
  });

  it("builds CSV with a header row and one line per match", () => {
    const csv = likeStylesCsv([match(), match({ id: "h2", style_number: "M88-200", matchScore: 5 })]);
    const lines = csv.trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe(LIKE_STYLES_EXPORT_HEADERS.join(","));
    expect(lines[1]).toContain("M88-100");
    expect(lines[1]).toContain("Yarn +3, Knit +3, Machine +2");
  });

  it("parses the same query params as the search API, defaulting the export limit higher", () => {
    const params = parseLikeStylesExportParams(
      new URL("http://localhost/api/export/like-styles.csv?yarnType=Acrylic&notes=smv&minScore=4")
    );
    expect(params.yarnType).toBe("Acrylic");
    expect(params.notes).toBe("smv");
    expect(params.minScore).toBe(4);
    expect(params.limit).toBe(200);

    const capped = parseLikeStylesExportParams(new URL("http://localhost/x?limit=9999"));
    expect(capped.limit).toBe(500);
  });
});
