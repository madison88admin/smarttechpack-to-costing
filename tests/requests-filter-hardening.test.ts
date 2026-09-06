import { afterEach, describe, expect, it, vi } from "vitest";
import { listCostingRequests } from "../src/lib/costing/requests";
import { createMockSupabase, type Call } from "./helpers/supabase-mock";

const { mocks } = vi.hoisted(() => ({ mocks: { client: null as unknown } }));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: () => mocks.client
}));

afterEach(() => {
  mocks.client = null;
});

function lastCall(calls: Call[]) {
  return calls.find((c) => c.table === "costing_requests" && c.terminal === "select")!;
}

describe("listCostingRequests — hostile user input hardening", () => {
  it("treats a status value with spaces/operators as no filter instead of hanging or erroring", async () => {
    const { client, calls } = createMockSupabase();
    mocks.client = client;

    const result = await listCostingRequests({ status: "x OR 1=1 --", roles: ["pbd"] });

    expect(result).toEqual({ data: [], total: 0 });
    const call = lastCall(calls);
    // The hostile value must never reach PostgREST as an eq filter — that is
    // what previously hung the request (PostgREST parses spaces as grammar).
    const statusEq = call.chain.eq?.find(([col]) => col === "status");
    expect(statusEq).toBeUndefined();
    // The role visibility filter still applies.
    expect(call.chain.in).toBeDefined();
  });

  it("still applies the status filter for a known workflow status", async () => {
    const { client, calls } = createMockSupabase();
    mocks.client = client;

    await listCostingRequests({ status: "for_pbd_review", roles: ["pbd"] });

    const call = lastCall(calls);
    expect(call.chain.eq).toContainEqual(["status", "for_pbd_review"]);
  });

  it("quotes or() search terms so commas stay literal (verified live: unquoted comma inside .or() is PGRST100 → 500; quoted values match correctly)", async () => {
    const { client, calls } = createMockSupabase();
    mocks.client = client;

    await listCostingRequests({ query: "CR-7001,x", roles: ["pbd"] });

    const call = lastCall(calls);
    expect(call.chain.or).toHaveLength(1);
    expect(call.chain.or![0]).toBe(
      'request_number.ilike."%CR-7001,x%",factory_name.ilike."%CR-7001,x%"'
    );
  });

  it("strips embedded double quotes from or() terms so the quoted-string grammar stays valid (a quote inside a quoted value would break parsing)", async () => {
    const { client, calls } = createMockSupabase();
    mocks.client = client;

    await listCostingRequests({ query: 'CR-"7001"', roles: ["pbd"] });

    const call = lastCall(calls);
    expect(call.chain.or![0]).toBe(
      'request_number.ilike."%CR-7001%",factory_name.ilike."%CR-7001%"'
    );
  });

  it("defuses tautologies in the brand/customer/season ilike values without quoting (the `=` strip kills the hang)", async () => {
    const { client, calls } = createMockSupabase();
    mocks.client = client;

    await listCostingRequests({ brand: "x OR 1=1 --", customer: "a,b", season: "' s'", roles: ["pbd"] });

    const call = lastCall(calls);
    expect(call.chain.ilike).toContainEqual(["brand", "%x OR 11 --%"]);
    expect(call.chain.ilike).toContainEqual(["customer", "%a,b%"]);
    expect(call.chain.ilike).toContainEqual(["season", "%' s'%"]);
  });

  it("leaves the from-date gte value unquoted (quoted values silently never match)", async () => {
    const { client, calls } = createMockSupabase();
    mocks.client = client;

    await listCostingRequests({ from: "2024-01-01 x", roles: ["pbd"] });

    const call = lastCall(calls);
    expect(call.chain.gte).toContainEqual(["created_at", "2024-01-01 x"]);
  });

  it("clamps hostile pagination so range() never receives 1e18 or negatives", async () => {
    const { client, calls } = createMockSupabase();
    mocks.client = client;

    await listCostingRequests({ limit: 999999999999999999, offset: -5, roles: ["pbd"] });

    const call = lastCall(calls);
    expect(call.chain.range).toEqual([0, 4999]); // offset clamped to 0, limit to 5000

    const { client: c2, calls: calls2 } = createMockSupabase();
    mocks.client = c2;
    await listCostingRequests({ offset: 999999999999999999, roles: ["pbd"] });
    const call2 = lastCall(calls2);
    expect(call2.chain.range).toEqual([1000000, 1000004]); // offset capped, default pageSize 5
  });

  it("keeps sane pagination untouched", async () => {
    const { client, calls } = createMockSupabase();
    mocks.client = client;

    await listCostingRequests({ limit: 20, offset: 40, roles: ["pbd"] });

    const call = lastCall(calls);
    expect(call.chain.range).toEqual([40, 59]);
  });

  it("treats PostgREST PGRST103 (range beyond available rows) as an empty page, not an error", async () => {
    const { client, calls } = createMockSupabase({
      costing_requests: {
        select: () => ({
          data: null,
          error: { code: "PGRST103", message: "Requested range not satisfiable" } as never
        })
      }
    });
    mocks.client = client;

    const result = await listCostingRequests({ offset: 999999, roles: ["pbd"] });

    expect(result).toEqual({ data: [], total: 0 });
    expect(calls.some((c) => c.table === "costing_requests" && c.terminal === "select")).toBe(true);
  });
});