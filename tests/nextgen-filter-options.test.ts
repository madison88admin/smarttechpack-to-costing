import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockSupabase, type Call } from "./helpers/supabase-mock";
import type { NextGenFilterOptions } from "../src/lib/nextgen/filter-options";

// ─────────────────────────────────────────────────────────────────────────────
// The NextGen filter directory: the module behind the /requests and /reports
// stall, and the one whose live ERP call made role-affordance-wiring pass by
// luck of upstream timing. Two tests referenced it and both mocked it, so none
// of its behaviour was covered.
//
// Pinned here:
//   - a cold process answers from the snapshot instead of paying for the scan
//   - an expired value is served while the rebuild runs behind the caller
//   - concurrent stale callers coalesce into one rebuild
//   - which scans may be persisted (all-empty is never remembered; partial is)
//   - the bounded scan: the 15s deadline, and the partial flag it sets
//   - the upstream-failure path, and a stale value surviving a failed rebuild
//
// Only the HTTP boundary (safeNextGenPostOnce) and the snapshot table are
// stubbed. The cache, the scan loop, the normalizer, the PO-line mapper and
// both persistence rules are the real modules.

const SNAPSHOT_TABLE = "nextgen_filter_option_cache";
const TTL_MS = 5 * 60 * 1000;

const stub = vi.hoisted(() => ({
  calls: [] as string[],
  productPages: [] as Array<{ ok: boolean; status: number; body: unknown }>,
  poOk: true,
  onProduct: null as null | (() => void)
}));

vi.mock("@/lib/nextgen/client", () => ({
  safeNextGenPostOnce: async (endpoint: string) => {
    stub.calls.push(endpoint);
    if (endpoint === "poRead") {
      return stub.poOk
        ? { ok: true, status: 200, upstreamContentType: "application/json", body: { Data: [] } }
        : { ok: false, status: 502, upstreamContentType: "text/plain", body: { error: "po stub down" } };
    }
    // Lets a test move the clock between the scan's pages.
    stub.onProduct?.();
    const page = stub.productPages.shift() ?? { ok: true, status: 200, body: { Data: [] } };
    return page.ok
      ? { ok: true, status: page.status, upstreamContentType: "application/json", body: page.body }
      : { ok: false, status: page.status, upstreamContentType: "text/plain", body: { error: "product stub down" } };
  }
}));

const db = vi.hoisted(() => ({
  row: null as null | { payload: unknown; refreshed_at: string },
  error: null as unknown,
  client: null as unknown
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: () => db.client
}));

let clock = 0;
let recorded: Call[] = [];

beforeEach(() => {
  vi.resetModules(); // a fresh cache per test: the module holds one for the process
  clock = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  db.row = null;
  db.error = null;
  stub.calls = [];
  stub.productPages = [];
  stub.poOk = true;
  stub.onProduct = null;

  const mock = createMockSupabase({
    [SNAPSHOT_TABLE]: {
      maybeSingle: () => ({ data: db.row, error: db.error }),
      upsert: () => ({ data: null, error: null })
    }
  });
  db.client = mock.client;
  recorded = mock.calls;
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function loadModule() {
  return await import("../src/lib/nextgen/filter-options");
}

/**
 * The directories written to the snapshot table. save() upserts a row
 * ({ id, payload, refreshed_at }), so the directory is the row's `payload`;
 * the read path selects without a payload and is excluded by that check.
 */
function persisted(): NextGenFilterOptions[] {
  return recorded
    .filter((call) => call.table === SNAPSHOT_TABLE && call.chain.payload)
    .map((call) => (call.chain.payload as { payload: NextGenFilterOptions }).payload);
}

/** How many times the scan hit the product directory. */
const scans = () => stub.calls.filter((call) => call === "productSearch").length;

function productRow(overrides: Record<string, unknown> = {}) {
  return {
    Id: "p1",
    Name: "M88-0001",
    CompositionConcatenated: "100% Acrylic",
    KnitTypeName: "Flat Knit",
    MachineTypeName: "7GG",
    ConstructionName: "Rib",
    CommodityTypeName: "Beanie",
    DivisionName: "Madison88",
    CustomerName: "ACME",
    RangeName: "SS26",
    ...overrides
  };
}

const productPage = (rows: unknown[]) => ({ ok: true, status: 200, body: { Data: rows } });

function emptyDirectory(): NextGenFilterOptions {
  return {
    yarnTypes: [],
    knitTypes: [],
    machineTypes: [],
    constructions: [],
    categories: [],
    factories: [],
    brands: [],
    customers: [],
    seasons: []
  };
}

function snapshotRow(payload: Partial<NextGenFilterOptions>, savedAt: number) {
  return { payload: { ...emptyDirectory(), ...payload }, refreshed_at: new Date(savedAt).toISOString() };
}

describe("cold start — the snapshot is what keeps a restart from paying for the scan", () => {
  it("answers from a fresh snapshot without touching the ERP", async () => {
    db.row = snapshotRow({ yarnTypes: ["Snapshot Yarn"], factories: ["Snapshot Factory"] }, clock);
    const mod = await loadModule();

    const options = await mod.getNextGenFilterOptions();

    expect(options.yarnTypes).toEqual(["Snapshot Yarn"]);
    expect(options.factories).toEqual(["Snapshot Factory"]);
    expect(stub.calls, "a fresh snapshot means no ERP call at all").toEqual([]);
    expect(persisted(), "nothing was rebuilt, so nothing is written back").toHaveLength(0);
  });

  it("serves an expired snapshot immediately and rebuilds behind the caller", async () => {
    db.row = snapshotRow({ yarnTypes: ["Stale Yarn"] }, clock - 10 * 60 * 1000);
    stub.productPages = [productPage([productRow({ CompositionConcatenated: "Fresh Yarn" })])];
    const mod = await loadModule();

    const first = await mod.getNextGenFilterOptions();
    expect(first.yarnTypes, "the caller must not wait for a rebuild").toEqual(["Stale Yarn"]);
    expect(scans(), "the rebuild started behind the caller").toBe(1);

    await vi.waitFor(() => expect(persisted(), "the rebuilt directory is persisted").toHaveLength(1));
    expect((await mod.getNextGenFilterOptions()).yarnTypes).toEqual(["Fresh Yarn"]);
  });

  it("falls back to the scan when the snapshot cannot be read", async () => {
    db.error = { message: 'relation "nextgen_filter_option_cache" does not exist' };
    stub.productPages = [productPage([productRow()])];
    const mod = await loadModule();

    const options = await mod.getNextGenFilterOptions();

    expect(options.yarnTypes).toEqual(["100% Acrylic"]);
    expect(scans()).toBe(1);
  });

  it("ignores a snapshot whose timestamp is unreadable", async () => {
    db.row = { payload: emptyDirectory(), refreshed_at: "not-a-date" };
    stub.productPages = [productPage([productRow()])];
    const mod = await loadModule();

    const options = await mod.getNextGenFilterOptions();

    expect(options.yarnTypes, "an unusable timestamp must not be trusted as fresh").toEqual(["100% Acrylic"]);
  });
});

describe("in-process staleness", () => {
  it("serves the stale directory while one rebuild runs, and coalesces concurrent callers", async () => {
    stub.productPages = [productPage([productRow({ CompositionConcatenated: "First Yarn" })])];
    const mod = await loadModule();
    expect((await mod.getNextGenFilterOptions()).yarnTypes).toEqual(["First Yarn"]);
    expect(scans()).toBe(1);

    clock += TTL_MS + 1000;
    stub.productPages = [productPage([productRow({ CompositionConcatenated: "Second Yarn" })])];

    const stale = await Promise.all([
      mod.getNextGenFilterOptions(),
      mod.getNextGenFilterOptions(),
      mod.getNextGenFilterOptions()
    ]);

    for (const options of stale) expect(options.yarnTypes).toEqual(["First Yarn"]);
    expect(scans(), "three stale callers must share one rebuild").toBe(2);
    await vi.waitFor(() => expect(persisted()).toHaveLength(2));
    expect((await mod.getNextGenFilterOptions()).yarnTypes).toEqual(["Second Yarn"]);
  });
});

describe("which scans may be persisted", () => {
  it("never remembers a scan that found nothing", async () => {
    stub.productPages = [productPage([])];
    const mod = await loadModule();

    const options = await mod.getNextGenFilterOptions();

    expect(options.yarnTypes).toEqual([]);
    expect(options.factories).toEqual([]);
    expect(options.customers).toEqual([]);
    expect(
      persisted(),
      "an all-empty scan would become the directory every later boot serves"
    ).toHaveLength(0);
  });

  it("persists a partial scan and carries the flag with it", async () => {
    stub.productPages = [productPage([productRow()])];
    stub.poOk = false; // the PO directory is what makes this scan partial
    const mod = await loadModule();

    const options = await mod.getNextGenFilterOptions();

    expect(options.partial).toBe(true);
    expect(persisted()).toHaveLength(1);
    expect(persisted()[0].partial, "a partial scan is persisted as partial, not as complete").toBe(true);
  });
});

describe("the bounded scan", () => {
  it("finishes and reports complete when a page comes back short", async () => {
    stub.productPages = [productPage([productRow()])];
    const mod = await loadModule();

    const options = await mod.getNextGenFilterOptions();

    expect(scans()).toBe(1);
    expect(options.partial).toBe(false);
  });

  it("stops at the 15s deadline and marks what it collected partial", async () => {
    const fullPage = Array.from({ length: 500 }, (_, index) => productRow({ Id: `p${index}`, Name: `M88-${index}` }));
    stub.productPages = [productPage(fullPage)];
    stub.onProduct = () => {
      clock += 20_000; // the scan has spent its budget by the time the page lands
    };
    const mod = await loadModule();

    const options = await mod.getNextGenFilterOptions();

    expect(scans(), "a full page is not the end of the directory, but the deadline stops page 2").toBe(1);
    expect(options.partial, "a scan cut short must not claim to be complete").toBe(true);
    expect(options.yarnTypes.length).toBeGreaterThan(0);
  });
});

describe("upstream failure", () => {
  it("surfaces as an empty directory through the safe reader", async () => {
    stub.productPages = [{ ok: false, status: 502, body: { error: "down" } }];
    const mod = await loadModule();

    await expect(mod.getNextGenFilterOptions()).rejects.toThrow(/NextGen 502/);
    const safe = await mod.tryGetNextGenFilterOptions();
    expect(safe.yarnTypes).toEqual([]);
    expect(safe.factories).toEqual([]);
  });

  it("keeps serving the stale directory when the rebuild fails, and retries next time", async () => {
    stub.productPages = [productPage([productRow({ CompositionConcatenated: "Good Yarn" })])];
    const mod = await loadModule();
    expect((await mod.getNextGenFilterOptions()).yarnTypes).toEqual(["Good Yarn"]);

    clock += TTL_MS + 1000;
    stub.productPages = [{ ok: false, status: 502, body: { error: "down" } }];

    const stale = await mod.getNextGenFilterOptions();
    expect(stale.yarnTypes, "a failing rebuild must not evict what still renders").toEqual(["Good Yarn"]);
    await vi.waitFor(() => expect(scans()).toBe(2));

    const again = await mod.getNextGenFilterOptions();
    expect(again.yarnTypes).toEqual(["Good Yarn"]);
    await vi.waitFor(() => expect(scans(), "the next caller tries the rebuild again").toBe(3));
  });
});
