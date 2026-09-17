import { afterEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import { GET } from "../src/app/api/export/register.xlsx/route";
import { createMockSupabase, type Responder } from "./helpers/supabase-mock";

// The Request Register XLSX export appends a per-request "comparable styles"
// sheet using the same attribute matching as the Like Styles search.

const { mocks } = vi.hoisted(() => ({
  mocks: {
    role: "viewer",
    client: null as unknown,
    reportRows: [] as Array<Record<string, unknown>>
  }
}));

// Only the session is injected; every predicate comes from the real module, so
// this mock cannot drift from the rule the route reads (it used to hand-roll
// canRunCostingAction/canRunPbdAction and broke the day the route switched to
// canDownloadCostingReports).
vi.mock("@/lib/auth/roles", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/auth/roles")>()),
  getCurrentRole: () => mocks.role
}));

vi.mock("@/lib/reporting", () => ({
  getReportData: () => Promise.resolve({ rows: mocks.reportRows }),
  normalizeRegisterSort: (sort: string | null) => sort ?? "created_at",
  sortReportRows: (rows: Array<Record<string, unknown>>) => rows,
  buildReportBenchmark: () => null,
  buildReportForecast: () => null,
  compareLatestTrendPeriods: () => null,
  percentChange: () => 0
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: () => mocks.client
}));

function responder(): Responder {
  return {
    factory_cbds: {
      select: () => ({
        data: [
          {
            costing_request_id: "req-1",
            raw_payload: { yarnType: "100% Acrylic", knitType: "Jacquard", machineType: "7G", construction: "Rib", productCategory: "Hats" }
          },
          { costing_request_id: "req-2", raw_payload: { yarnType: "Silk" } }
        ],
        error: null
      })
    },
    historical_costings: {
      select: () => ({
        data: [
          {
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
            knitting_time: 0.45
          },
          {
            id: "h2",
            costing_request_id: "src-req-2",
            style_number: "M88-999",
            factory_name: "Other Factory",
            total_cost: 5,
            currency: "USD",
            approved_at: "2025-02-10T00:00:00Z",
            yarn_type: "Wool",
            knit_type: "Flat",
            machine_type: "5G",
            construction: "Paneled",
            product_category: "Scarves"
          }
        ],
        error: null
      })
    }
  };
}

afterEach(() => {
  mocks.role = "viewer";
  mocks.client = null;
  mocks.reportRows = [];
});

function url() {
  return new Request("http://localhost/api/export/register.xlsx");
}

function reportRow(id: string, requestNumber: string, style: string) {
  return {
    id,
    request_number: requestNumber,
    style_number: style,
    product_name: "Beanie",
    factory_name: "Cebu Factory",
    status: "approved",
    brand: "Mens",
    customer: "Prana",
    season: "FH:2018",
    product_category: "Hats",
    created_at: "2026-01-15T10:00:00Z",
    updated_at: "2026-01-20T10:00:00Z"
  };
}

describe("GET /api/export/register.xlsx — comparable styles sheets", () => {
  it("rejects roles that cannot view costing exports", async () => {
    mocks.role = "factory";
    const res = await GET(url());
    expect(res.status).toBe(401);
  });

  it("appends one 'comparable styles' sheet per request with matches", async () => {
    mocks.role = "costing";
    mocks.reportRows = [reportRow("req-1", "CR-100001", "M88-1"), reportRow("req-2", "CR-100002", "M88-2")];
    const { client } = createMockSupabase(responder());
    mocks.client = client;

    const res = await GET(url());
    expect(res.status).toBe(200);

    const workbook = XLSX.read(Buffer.from(await res.arrayBuffer()), { type: "buffer" });
    expect(workbook.SheetNames).toContain("Request Register");
    expect(workbook.SheetNames).toContain("CR-100001 styles");
    // req-2 (Silk) has no comparable → no sheet
    expect(workbook.SheetNames).not.toContain("CR-100002 styles");

    const sheet = workbook.Sheets["CR-100001 styles"];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    expect(rows[0]).toEqual(["Request", "CR-100001"]);
    expect((rows[2] as string[])[0]).toBe("style_number");
    const matchRow = rows[3] as Array<number | string>;
    expect(matchRow[0]).toBe("M88-100");
    expect(matchRow[4]).toBe(11); // Yarn +3, Knit +3, Machine +2, Construction +2, Category +1
  });

  it("still returns the register when comparison lookup fails (best-effort)", async () => {
    mocks.role = "admin";
    mocks.reportRows = [reportRow("req-1", "CR-100001", "M88-1")];
    const { client } = createMockSupabase({
      factory_cbds: {
        select: () => {
          throw new Error("cbds down");
        }
      }
    });
    mocks.client = client;

    const res = await GET(url());
    expect(res.status).toBe(200);
    const workbook = XLSX.read(Buffer.from(await res.arrayBuffer()), { type: "buffer" });
    expect(workbook.SheetNames).toEqual(["Request Register"]);
  });
});
