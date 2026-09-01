import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "../src/app/api/admin/sync-nextgen-historical/route";
import { createMockSupabase, inserts, type Responder } from "./helpers/supabase-mock";
import { issueSessionToken } from "./helpers/session";

// Route tests for the NextGen historical sync: preview counts, mapped insert
// payloads (source='nextgen' + benchmark exclusion), and the style+factory
// dedup against existing rows.

const { session, mocks } = vi.hoisted(() => ({
  session: { token: null as string | null },
  mocks: { client: null as unknown, nextGenPost: null as unknown }
}));

vi.mock("next/headers", () => ({
  cookies: () => ({ get: () => (session.token ? { value: session.token } : undefined) })
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: () => mocks.client
}));

vi.mock("@/lib/nextgen/client", () => ({
  nextGenPost: (...args: unknown[]) => (mocks.nextGenPost as (...a: unknown[]) => Promise<unknown>)(...args)
}));

const productRows = [
  {
    Id: 14451,
    Name: "M88100481 - 3",
    StatusName: "Dropped",
    RangeName: "FH:2018",
    CustomerName: "Calvin Klein",
    DivisionName: "PVH",
    CommodityTypeName: "Hats",
    DefaultProductCostingCostingPurchasePrice: 2.85,
    DefaultProductCostingCostingPurchaseCurrencyName: "USD",
    DefaultProductCostingCostingProductSupplierName: "Hangzhou U-Jump Arts and Crafts Co. Ltd",
    LastEditedDateTime: "2018-04-26T17:00:01.636",
    CompositionConcatenated: "100% Acrylic"
  },
  {
    Id: 14267,
    Name: "M88100481 - 2",
    StatusName: "Dropped",
    DefaultProductCostingCostingPurchasePrice: 3.1,
    DefaultProductCostingCostingPurchaseCurrencyName: "USD",
    DefaultProductCostingCostingProductSupplierName: "Hangzhou U-Jump Arts and Crafts Co. Ltd",
    LastEditedDateTime: "2018-02-01T00:00:00"
  }
];

async function adminSession() {
  session.token = await issueSessionToken("admin");
}

function responder(overrides: Partial<Responder> = {}): Responder {
  return {
    historical_costings: {
      select: () => ({ data: [], error: null }),
      insert: () => ({ data: [], error: null })
    },
    ...overrides
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.nextGenPost = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
  session.token = null;
});

describe("GET /api/admin/sync-nextgen-historical", () => {
  it("requires admin", async () => {
    session.token = await issueSessionToken("factory");
    const response = await GET(new Request("http://localhost/api/admin/sync-nextgen-historical"));
    expect(response.status).toBe(403);
  });

  it("reports per-status NextGen counts and already-synced rows", async () => {
    await adminSession();
    (mocks.nextGenPost as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      upstreamContentType: "application/json",
      body: { Data: [], Total: 5590 }
    });
    const { client } = createMockSupabase({
      historical_costings: {
        select: () => ({ data: [], error: null, count: 42 })
      }
    });
    mocks.client = client;

    const response = await GET(new Request("http://localhost/api/admin/sync-nextgen-historical?statuses=Dropped"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.totalInNextGen).toBe(5590);
    expect(body.alreadySynced).toBe(42);
    expect(body.statuses).toEqual([{ status: "Dropped", total: 5590 }]);
  });
});

describe("POST /api/admin/sync-nextgen-historical", () => {
  it("requires admin", async () => {
    session.token = await issueSessionToken("costing");
    const response = await POST(
      new Request("http://localhost/api/admin/sync-nextgen-historical", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ statuses: "Dropped", limit: "50" })
      })
    );
    expect(response.status).toBe(403);
  });

  it("maps rows into historical_costings with source + benchmark exclusion and skips existing", async () => {
    await adminSession();
    (mocks.nextGenPost as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      upstreamContentType: "application/json",
      body: { Data: productRows, Total: 2 }
    });

    // One row already exists for the same style+factory → skipped.
    const { client, calls } = createMockSupabase({
      historical_costings: {
        select: () => ({ data: [{ style_number: "M88100481 - 3", factory_name: "Hangzhou U-Jump Arts and Crafts Co. Ltd" }], error: null }),
        insert: () => ({ data: [], error: null })
      }
    });
    mocks.client = client;

    const response = await POST(
      new Request("http://localhost/api/admin/sync-nextgen-historical", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ statuses: "Dropped", limit: "50" })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.scanned).toBe(2);
    expect(body.alreadySynced).toBe(1);
    expect(body.inserted).toBe(1);
    expect(body.benchmarkExcluded).toBe(true);

    const payload = inserts(calls, "historical_costings");
    expect(payload).toHaveLength(1);
    // .insert(batch) records the whole batch array as the payload.
    const [row] = payload[0] as Array<Record<string, unknown>>;
    expect(row.style_number).toBe("M88100481 - 2");
    expect(row.factory_name).toBe("Hangzhou U-Jump Arts and Crafts Co. Ltd");
    expect(row.total_cost).toBe(3.1);
    expect(row.currency).toBe("USD");
    expect(row.source).toBe("nextgen");
    expect(row.benchmark_excluded).toBe(true);
    expect(row.benchmark_exclusion_reason).toBe("nextgen_synced_dropped_product");
    expect(row.raw_payload).toEqual(productRows[1]);
  });

  it("inserts in batches of 50 and aggregates failures", async () => {
    await adminSession();
    const rows = Array.from({ length: 110 }, (_, i) => ({
      Id: 1000 + i,
      Name: `STYLE-${i}`,
      StatusName: "Dropped",
      DefaultProductCostingCostingPurchaseCurrencyName: "USD"
    }));
    (mocks.nextGenPost as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      upstreamContentType: "application/json",
      body: { Data: rows, Total: rows.length }
    });

    let insertCalls = 0;
    const { client, calls } = createMockSupabase({
      historical_costings: {
        select: () => ({ data: [], error: null }),
        insert: () => {
          insertCalls++;
          return insertCalls === 3 ? { data: [], error: { message: "batch failed" } } : { data: [], error: null };
        }
      }
    });
    mocks.client = client;

    const response = await POST(
      new Request("http://localhost/api/admin/sync-nextgen-historical", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ statuses: "Dropped", limit: "110" })
      })
    );
    const body = await response.json();

    expect(insertCalls).toBe(3); // 50 + 50 + 10
    expect(body.inserted).toBe(100);
    expect(body.failed).toBe(10);
    expect(body.errors).toEqual(["batch failed"]);
    expect(inserts(calls, "historical_costings")).toHaveLength(3);
  });

  it("reports empty gracefully when NextGen has no rows", async () => {
    await adminSession();
    (mocks.nextGenPost as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      upstreamContentType: "application/json",
      body: { Data: [], Total: 0 }
    });
    const { client } = createMockSupabase(responder());
    mocks.client = client;

    const response = await POST(
      new Request("http://localhost/api/admin/sync-nextgen-historical", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ statuses: "Dropped" })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.inserted).toBe(0);
    expect(body.message).toMatch(/No historical products/);
  });
});
