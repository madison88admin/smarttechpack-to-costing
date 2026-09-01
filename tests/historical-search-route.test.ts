import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "../src/app/api/historical/search/route";
import { createMockSupabase } from "./helpers/supabase-mock";
import { issueSessionToken } from "./helpers/session";

// Baseline picker search: free-text lookup over the approved-cost library so
// a baseline can be picked from inside the Create Request form.

const { session, mocks } = vi.hoisted(() => ({
  session: { token: null as string | null },
  mocks: { client: null as unknown }
}));

vi.mock("next/headers", () => ({
  cookies: () => ({ get: () => (session.token ? { value: session.token } : undefined) })
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: () => mocks.client
}));

const historicalRow = {
  id: "h1",
  costing_request_id: "req-1",
  style_number: "M8833541",
  factory_name: "Hangzhou U-Jump",
  total_cost: 6.09,
  currency: "USD",
  approved_at: "2026-08-06T00:00:00Z",
  yarn_type: "Acrylic/Wool",
  knit_type: "Flat",
  machine_type: "Manual",
  construction: "Knitted",
  product_category: "Yarn",
  average_consumption: 0.8,
  knitting_time: 12.5
};

beforeEach(async () => {
  session.token = await issueSessionToken("costing");
});

afterEach(() => {
  session.token = null;
  mocks.client = null;
});

describe("GET /api/historical/search", () => {
  it("rejects factory", async () => {
    session.token = await issueSessionToken("factory");
    const { client } = createMockSupabase({});
    mocks.client = client;
    const res = await GET(new Request("http://localhost/api/historical/search?q=Acrylic"));
    expect(res.status).toBe(401);
  });

  it("searches by free-text query against the library", async () => {
    const { client, calls } = createMockSupabase({
      historical_costings: { select: () => ({ data: [historicalRow], error: null }) }
    });
    mocks.client = client;

    const res = await GET(new Request("http://localhost/api/historical/search?q=M8833541&limit=5"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].style_number).toBe("M8833541");

    const query = calls.find((c) => c.table === "historical_costings" && c.terminal === "select");
    expect(query?.chain.ilike).toEqual([["searchable_text", "%M8833541%"]]);
  });

  it("caps and clamps the limit", async () => {
    const { client } = createMockSupabase({
      historical_costings: { select: () => ({ data: Array.from({ length: 30 }, (_, i) => ({ ...historicalRow, id: `h${i}` })), error: null }) }
    });
    mocks.client = client;

    const res = await GET(new Request("http://localhost/api/historical/search?q=x&limit=5"));
    const body = await res.json();
    expect(body.data).toHaveLength(5);
  });

  it("returns 500 when the lookup fails", async () => {
    const { client } = createMockSupabase({
      historical_costings: {
        select: () => {
          throw new Error("db down");
        }
      }
    });
    mocks.client = client;

    const res = await GET(new Request("http://localhost/api/historical/search?q=x"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain("db down");
  });
});
