import { describe, expect, it } from "vitest";
import type { HistoricalCostingRow } from "../src/lib/costing/history";
import {
  buildComparableSheets,
  COMPARABLE_STYLES_HEADERS,
  extractLikeStyleAttributes
} from "../src/lib/export/comparable";

// The Request Register XLSX export appends one "comparable styles" sheet per
// request, scored with the exact same attribute matching as the Like Styles
// search page.

function hist(overrides: Partial<HistoricalCostingRow> = {}): HistoricalCostingRow {
  return {
    id: "h1",
    costing_request_id: "src-req-1",
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
    benchmark_excluded: false,
    ...overrides
  };
}

const matching = hist();
const different = hist({
  id: "h2",
  costing_request_id: "src-req-2",
  style_number: "M88-999",
  yarn_type: "Wool",
  knit_type: "Flat",
  machine_type: "5G",
  construction: "Paneled",
  product_category: "Scarves"
});

describe("extractLikeStyleAttributes", () => {
  it("reads the CBD attribute keys used by the search page", () => {
    expect(
      extractLikeStyleAttributes({
        yarnType: "100% Acrylic",
        knitType: "Jacquard",
        machineType: "7G",
        construction: "Rib",
        productCategory: "Hats"
      })
    ).toEqual({
      yarnType: "100% Acrylic",
      knitType: "Jacquard",
      machineType: "7G",
      construction: "Rib",
      productCategory: "Hats"
    });
  });

  it("trims values and ignores non-string / missing fields", () => {
    expect(extractLikeStyleAttributes({ yarnType: "  Acrylic  ", knitType: 42, productCategory: null })).toEqual({
      yarnType: "Acrylic",
      knitType: null,
      machineType: null,
      construction: null,
      productCategory: null
    });
    expect(extractLikeStyleAttributes(null)).toEqual({});
    expect(extractLikeStyleAttributes("nope")).toEqual({});
  });
});

describe("buildComparableSheets", () => {
  const requests = [
    { id: "req-1", requestNumber: "CR-100001", attributes: { yarnType: "100% Acrylic", knitType: "Jacquard" } },
    { id: "req-2", requestNumber: "CR-100002", attributes: { yarnType: "Silk" } }
  ];

  it("emits a sheet per request that has matches, with header + scored rows", () => {
    const sheets = buildComparableSheets(requests, [matching, different]);

    expect(sheets).toHaveLength(1);
    expect(sheets[0].sheetName).toBe("CR-100001 styles");
    // [Request, CR-100001], [], headers, row
    expect(sheets[0].aoa[0]).toEqual(["Request", "CR-100001"]);
    expect(sheets[0].aoa[2]).toEqual([...COMPARABLE_STYLES_HEADERS]);
    const row = sheets[0].aoa[3] as unknown[];
    expect(row[0]).toBe("M88-100");
    expect(row[4]).toBe(6); // Yarn +3 + Knit +3
    expect(String(row[5])).toBe("Yarn +3, Knit +3");
  });

  it("skips requests with no matches and without attributes", () => {
    expect(buildComparableSheets(requests, [different])).toEqual([]);
    expect(
      buildComparableSheets(
        [{ id: "req-3", requestNumber: "CR-100003", attributes: {} }],
        [matching]
      )
    ).toEqual([]);
  });

  it("excludes the request's own historical costing from its comparables", () => {
    const sheets = buildComparableSheets(
      [{ id: "src-req-1", requestNumber: "CR-1", attributes: { yarnType: "100% Acrylic", knitType: "Jacquard" } }],
      [matching]
    );
    expect(sheets).toEqual([]); // the only match is the request itself
  });

  it("lists a style once per sheet even when the register holds several of its costing records", () => {
    // The register keeps every ERP costing record of a style; a comparable sheet
    // must not spend its rows on the same style at three prices.
    const revisions = [
      hist({ id: "rev-1", style_number: "M88-100", costing_request_id: "x1", approved_at: "2025-03-10T00:00:00Z", total_cost: 3.4 }),
      hist({ id: "rev-2", style_number: "M88-100", costing_request_id: "x2", approved_at: "2025-02-10T00:00:00Z", total_cost: 3.1 }),
      hist({ id: "rev-3", style_number: "M88-100", costing_request_id: "x3", approved_at: "2025-01-10T00:00:00Z", total_cost: 2.9 }),
      hist({ id: "other", style_number: "M88-200", costing_request_id: "x4" })
    ];

    const sheets = buildComparableSheets([requests[0]], revisions, 5);
    const styles = sheets[0].aoa.slice(3).map((row) => (row as unknown[])[0]);

    expect(styles).toEqual(["M88-100", "M88-200"]);
  });

  it("caps the comparables per request", () => {
    const rows = [hist({ id: "a", costing_request_id: "x1" }), hist({ id: "b", costing_request_id: "x2" })];
    const sheets = buildComparableSheets(requests, rows, 1);
    expect(sheets[0].aoa.length - 3).toBe(1); // header block is 3 rows
  });

  it("dedupes and sanitizes sheet names", () => {
    const rows = [hist({ id: "a", costing_request_id: "x1" }), hist({ id: "b", costing_request_id: "x2" })];
    const sheets = buildComparableSheets(
      [
        { id: "r1", requestNumber: "CR/1", attributes: { yarnType: "100% Acrylic" } },
        { id: "r2", requestNumber: "CR-1 styles", attributes: { yarnType: "100% Acrylic" } }
      ],
      rows
    );
    const names = new Set(sheets.map((sheet) => sheet.sheetName));
    expect(names.size).toBe(sheets.length);
    expect(sheets[0].sheetName).toMatch(/^CR-1 styles/);
  });
});
