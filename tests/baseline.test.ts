import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildBaselineNote,
  buildBaselineRef,
  getHistoricalCostingById
} from "../src/lib/costing/history";

// "Copy baseline" on a Like Styles result copies an approved historical
// costing's cost/attributes into a new request. These tests cover the fetch
// helper, the audit-reference note appended to the new request, and the
// baseline_ref snapshot persisted on the request (shown on the detail page
// and as a reference banner in the factory CBD form).

const { mocks } = vi.hoisted(() => ({ mocks: { client: null as unknown } }));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: () => mocks.client
}));

import { createMockSupabase, type Responder } from "./helpers/supabase-mock";

const baselineRow = {
  id: "h1",
  costing_request_id: "11111111-1111-4111-8111-111111111111",
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
  benchmark_excluded: false
};

function responder(): Responder {
  return {
    historical_costings: {
      maybeSingle: () => ({ data: baselineRow, error: null })
    }
  };
}

afterEach(() => {
  mocks.client = null;
});

describe("getHistoricalCostingById", () => {
  it("fetches the historical row by id", async () => {
    const { client, calls } = createMockSupabase(responder());
    mocks.client = client;

    const row = await getHistoricalCostingById("h1");
    expect(row?.style_number).toBe("M88-100");
    expect(row?.total_cost).toBe(3.2);

    const query = calls.find((c) => c.table === "historical_costings" && c.terminal === "maybeSingle");
    expect(query?.chain.eq).toEqual([["id", "h1"]]);
  });

  it("returns null when the id does not exist", async () => {
    const { client } = createMockSupabase({
      historical_costings: { maybeSingle: () => ({ data: null, error: null }) }
    });
    mocks.client = client;

    const row = await getHistoricalCostingById("missing");
    expect(row).toBeNull();
  });
});

describe("buildBaselineRef", () => {
  it("snapshots the approved cost and attributes for the new request", () => {
    const ref = buildBaselineRef(baselineRow as never);
    expect(ref).toEqual({
      source: "historical",
      historicalId: "h1",
      sourceRequestId: "11111111-1111-4111-8111-111111111111",
      styleNumber: "M88-100",
      factoryName: "Cebu Factory",
      totalCost: 3.2,
      currency: "USD",
      approvedAt: "2025-01-10T00:00:00Z",
      yarnType: "100% Acrylic",
      knitType: "Jacquard",
      machineType: "7G",
      construction: "Rib",
      productCategory: "Hats",
      averageConsumption: 0.21,
      knittingTime: 0.45,
      brand: null,
      customer: null,
      season: null
    });
  });

  it("normalizes missing attribute fields to null", () => {
    const ref = buildBaselineRef({ id: "h2", style_number: null, total_cost: null } as never);
    expect(ref).toMatchObject({
      styleNumber: null,
      totalCost: null,
      yarnType: null,
      averageConsumption: null
    });
  });

  it("returns null for no baseline", () => {
    expect(buildBaselineRef(null)).toBeNull();
    expect(buildBaselineRef(undefined)).toBeNull();
  });
});

describe("buildBaselineNote", () => {
  it("formats style, short request id, and cost with currency", () => {
    const note = buildBaselineNote(baselineRow as never);
    expect(note).toBe("[Baseline: M88-100 · request 11111111 · USD 3.20]");
  });

  it("degrades gracefully when fields are missing", () => {
    const note = buildBaselineNote({ id: "h2", style_number: null, costing_request_id: null, total_cost: null } as never);
    expect(note).toBe("[Baseline: historical style]");
  });

  it("returns an empty string for no baseline", () => {
    expect(buildBaselineNote(null)).toBe("");
    expect(buildBaselineNote(undefined)).toBe("");
  });
});
