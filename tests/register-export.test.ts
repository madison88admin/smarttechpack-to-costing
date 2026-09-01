import { describe, expect, it } from "vitest";
import { buildRegisterExportRows, registerCsv, REGISTER_EXPORT_HEADERS } from "../src/lib/export/register";
import type { ReportRequestRow } from "../src/lib/reporting";

function row(overrides: Partial<ReportRequestRow> = {}): ReportRequestRow {
  return {
    id: "req-1",
    request_number: "CR-100001",
    style_number: "M88-1",
    product_name: "Beanie",
    factory_name: "Hangzhou U-Jump",
    status: "approved",
    brand: "Mens",
    customer: "Prana",
    season: "FH:2018",
    product_category: "Hats",
    created_at: "2026-01-15T10:00:00Z",
    updated_at: "2026-01-20T10:00:00Z",
    ...overrides
  };
}

describe("register export helper", () => {
  it("maps rows to flat records with readable status labels", () => {
    const records = buildRegisterExportRows([row()], "costing");
    expect(records).toHaveLength(1);
    expect(records[0]).toEqual({
      request_number: "CR-100001",
      style_number: "M88-1",
      product_name: "Beanie",
      factory_name: "Hangzhou U-Jump",
      brand: "Mens",
      customer: "Prana",
      season: "FH:2018",
      product_category: "Hats",
      status: "Internally Approved",
      created_at: "2026-01-15T10:00:00Z",
      updated_at: "2026-01-20T10:00:00Z",
      request_id: "req-1"
    });
  });

  it("masks internal review statuses for factory role", () => {
    const records = buildRegisterExportRows(
      [row({ status: "for_md_review", id: "req-2", request_number: "CR-2" })],
      "factory"
    );
    expect(records[0].status).toBe("Under Review");
  });

  it("falls back to empty strings for missing fields", () => {
    const records = buildRegisterExportRows([row({ brand: null, season: null, factory_name: null })], "admin");
    expect(records[0].brand).toBe("");
    expect(records[0].season).toBe("");
    expect(records[0].factory_name).toBe("");
  });

  it("builds CSV with a header row and one line per row", () => {
    const csv = registerCsv([row(), row({ id: "req-2", request_number: "CR-2", status: "draft" })], "admin");
    const lines = csv.trim().split("\n");
    expect(lines).toHaveLength(3); // header + 2 rows
    expect(lines[0]).toBe(REGISTER_EXPORT_HEADERS.join(","));
    expect(lines[1]).toContain("CR-100001");
    expect(lines[1]).toContain("Internally Approved");
    expect(lines[2]).toContain("Draft");
  });
});
