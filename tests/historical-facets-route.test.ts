import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createMockSupabase, type Responder } from "./helpers/supabase-mock";
import { issueSessionToken } from "./helpers/session";
import type { UserRole } from "../src/lib/auth/roles";

// GET /api/historical/distinct — the facet dropdowns behind the history list and
// the Like Styles search. The pool read belongs to lib/costing/history (the
// owner of historical_costings), so this pins four things: the payload the
// screens consume, the canonical role rule, that the shared cache scans the
// pool once, and that the route does not query the table itself.

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

const ROWS = [
  { yarn_type: "Acrylic", knit_type: "Flat", machine_type: "7G", construction: "Rib", product_category: "Hats", factory_name: "Cebu", brand: "Madison88", customer: "Sorel", season: "Fall 26" },
  { yarn_type: "Acrylic", knit_type: "Jacquard", machine_type: "7G", construction: "Ribbed", product_category: "Scarves", factory_name: "Cebu", brand: "Madison88", customer: "Sorel", season: "Spring 26" },
  { yarn_type: "", knit_type: "#N/A", machine_type: null, construction: "Rib", product_category: "Hats", factory_name: "Hangzhou", brand: "null", customer: "Alo", season: "Fall 26" }
];

const responder = (): Responder => ({ historical_costings: { select: () => ({ data: ROWS, error: null }) } });

/** Fresh module instance, so each test gets its own cache. */
async function loadRoute() {
  vi.resetModules();
  return (await import("../src/app/api/historical/distinct/route")).GET;
}

beforeEach(async () => {
  session.token = await issueSessionToken("costing");
});

afterEach(() => {
  session.token = null;
  mocks.client = null;
});

describe("GET /api/historical/distinct", () => {
  it("allows every internal role, including Super Admin", async () => {
    for (const role of ["superadmin", "admin", "pbd", "costing", "md"] as UserRole[]) {
      session.token = await issueSessionToken(role);
      mocks.client = createMockSupabase(responder()).client;
      const GET = await loadRoute();
      const response = await GET();
      expect(response.status, role).toBe(200);
    }
  });

  it("denies Factory and Viewer", async () => {
    for (const role of ["factory", "viewer"] as UserRole[]) {
      session.token = await issueSessionToken(role);
      mocks.client = createMockSupabase(responder()).client;
      const GET = await loadRoute();
      expect((await GET()).status, role).toBe(401);
    }
  });

  it("returns nine sorted, deduped facet lists without spreadsheet artifacts", async () => {
    mocks.client = createMockSupabase(responder()).client;
    const GET = await loadRoute();
    const body = await (await GET()).json();

    expect(body.ok).toBe(true);
    expect(Object.keys(body.data)).toHaveLength(9);
    expect(body.data.yarnTypes).toEqual(["Acrylic"]);
    expect(body.data.knitTypes).toEqual(["Flat", "Jacquard"]); // "#N/A" artifact dropped
    expect(body.data.machineTypes).toEqual(["7G"]);
    expect(body.data.constructions).toEqual(["Rib", "Ribbed"]);
    expect(body.data.categories).toEqual(["Hats", "Scarves"]);
    expect(body.data.factories).toEqual(["Cebu", "Hangzhou"]);
    expect(body.data.brands).toEqual(["Madison88"]); // "null" artifact dropped
    expect(body.data.customers).toEqual(["Alo", "Sorel"]);
    expect(body.data.seasons).toEqual(["Fall 26", "Spring 26"]);
  });

  it("scans the pool once for repeated requests", async () => {
    const { client, calls } = createMockSupabase(responder());
    mocks.client = client;
    const GET = await loadRoute();

    await GET();
    await GET();

    expect(calls.filter((call) => call.table === "historical_costings")).toHaveLength(1);
  });

  it("reads the pool through its owner instead of querying the table here", () => {
    const source = readFileSync("src/app/api/historical/distinct/route.ts", "utf8");
    expect(source).toContain("listHistoricalFacetValues");
    expect(source).not.toContain('from("historical_costings")');
    expect(source).not.toContain("createSupabaseServiceClient");
  });
});
