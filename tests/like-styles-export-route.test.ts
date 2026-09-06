import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as csvGet } from "../src/app/api/export/like-styles.csv/route";
import { GET as xlsxGet } from "../src/app/api/export/like-styles.xlsx/route";
import type { LikeStyleMatch } from "../src/lib/costing/history";

// Route-level tests for the Like Styles export endpoints: role gate and that
// the current filters flow into the scored comparison set.

const { mocks } = vi.hoisted(() => ({
  mocks: {
    role: "viewer",
    findLikeStyles: null as unknown
  }
}));

vi.mock("@/lib/auth/roles", () => ({
  getCurrentRole: () => mocks.role
}));

vi.mock("@/lib/costing/history", () => ({
  findLikeStyles: (input: unknown) => (mocks.findLikeStyles as (input: unknown) => Promise<LikeStyleMatch[]>)(input)
}));

function match(): LikeStyleMatch {
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
    scorePercent: 100,
    sampleSize: 10,
    confidence: "high",
    matchReasons: ["Yarn +3"],
    matchingNotes: []
  };
}

beforeEach(() => {
  mocks.role = "costing";
  mocks.findLikeStyles = vi.fn().mockResolvedValue([match()]);
});

afterEach(() => {
  mocks.role = "viewer";
});

function csvUrl() {
  return new Request("http://localhost/api/export/like-styles.csv?yarnType=Acrylic&notes=smv&minScore=4");
}

describe("like-styles export routes", () => {
  it("rejects roles outside MD/Costing/PBD/Manager/Admin", async () => {
    mocks.role = "factory";
    const res = await csvGet(csvUrl());
    expect(res.status).toBe(401);

    mocks.role = "viewer";
    const res2 = await csvGet(csvUrl());
    expect(res2.status).toBe(401);
  });

  it("exports CSV with the current filters and scored rows", async () => {
    const res = await csvGet(csvUrl());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toContain("like-styles");

    const body = await res.text();
    const lines = body.trim().split("\n");
    expect(lines[0]).toContain("match_score");
    expect(lines[1]).toContain("M88-100");
    expect(lines[1]).toContain("Yarn +3");

    // The search inputs were forwarded to the engine.
    const called = (mocks.findLikeStyles as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(called).toMatchObject({
      yarnType: "Acrylic",
      notesQuery: "smv",
      minScore: 4,
      limit: 200
    });
  });

  it("exports a valid XLSX workbook with one 'Like Styles' sheet", async () => {
    const res = await xlsxGet(csvUrl());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("spreadsheetml");

    const buffer = Buffer.from(await res.arrayBuffer());
    const XLSX = await import("xlsx");
    const wb = XLSX.read(buffer, { type: "buffer" });
    expect(wb.SheetNames).toEqual(["Like Styles"]);
    const aoa = XLSX.utils.sheet_to_json(wb.Sheets["Like Styles"], { header: 1 });
    expect((aoa[0] as string[]).join(",")).toContain("match_score");
    expect(JSON.stringify(aoa[1])).toContain("M88-100");
  });

  it("exports an empty comparison set cleanly when nothing matches", async () => {
    mocks.findLikeStyles = vi.fn().mockResolvedValue([]);
    const res = await csvGet(csvUrl());
    expect(res.status).toBe(200);
    const lines = (await res.text()).trim().split("\n");
    expect(lines).toHaveLength(1); // header only
  });
});
