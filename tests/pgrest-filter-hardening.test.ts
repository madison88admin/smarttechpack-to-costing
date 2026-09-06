import { afterEach, describe, expect, it, vi } from "vitest";
import { pgrestLike, pgrestOrTerms, pgrestValue } from "../src/lib/supabase/filters";
import { listHistoricalCostings } from "../src/lib/costing/history";
import { createMockSupabase, type Call } from "./helpers/supabase-mock";

const { mocks } = vi.hoisted(() => ({ mocks: { client: null as unknown } }));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: () => mocks.client
}));

afterEach(() => {
  mocks.client = null;
});

describe("pgrestValue / pgrestLike — PostgREST filter-value hardening", () => {
  it("passes plain values through untouched (no quoting — this server compares quoted values literally)", () => {
    expect(pgrestValue("abc")).toBe("abc");
    expect(pgrestLike("abc")).toBe("%abc%");
  });

  it("keeps spaces, commas, quotes, parens and semicolons — all verified safe unquoted on the live server", () => {
    expect(pgrestValue("a,b")).toBe("a,b");
    expect(pgrestValue("x OR y")).toBe("x OR y");
    expect(pgrestValue('a"b')).toBe('a"b');
    expect(pgrestLike("a,b")).toBe("%a,b%");
  });

  it("strips `=` so tautologies cannot hang PostgREST (x OR 1=1 / x AND 1=1 / x OR x=x)", () => {
    // Verified against the live server: a comparison tautology after a logical
    // keyword hangs the request indefinitely — quoted or not. `=` is never
    // legitimate in a filter value here, so it is removed at the boundary.
    // (Quoting is NOT an option: `col=eq.\"x\"` is compared literally, breaking
    // every match.)
    expect(pgrestValue("x OR 1=1 --")).toBe("x OR 11 --");
    expect(pgrestValue("x AND 1=1")).toBe("x AND 11");
    expect(pgrestValue("x OR x=x")).toBe("x OR xx");
    expect(pgrestLike("x OR 1=1 --")).toBe("%x OR 11 --%");
    // Harmless comparisons still lose their `=` (the operator is stripped at
    // the boundary, so the value cannot become a hang trigger).
    expect(pgrestValue("x OR 1=2")).toBe("x OR 12");
  });

  it("truncates oversized values so the client query never trips Kong's URI limit", () => {
    // 607-char input; the first 500 chars are kept, everything past the cap
    // (including any tautology) is dropped.
    const out = pgrestValue(`${"A".repeat(600)} OR 1=1`);
    expect(out).toBe("A".repeat(500));
    expect(out.length).toBe(500);
    // A tautology inside the first 500 chars is still defused after truncation.
    expect(pgrestValue(`${"x OR 1=1 "}${"A".repeat(600)}`)).toBe(`x OR 11 ${"A".repeat(491)}`);
  });

  it("pgrestOrTerms quotes each branch value (verified live: quoted or() values are stripped by the grammar and match; unquoted commas 500)", () => {
    expect(pgrestOrTerms(["a", "b"], "cotton")).toBe('a.ilike."%cotton%",b.ilike."%cotton%"');
    // Comma inside the term is now literal inside the quoted value.
    expect(pgrestOrTerms(["a"], "x,y")).toBe('a.ilike."%x,y%"');
  });

  it("pgrestOrTerms still defuses `=` tautologies and strips embedded double quotes", () => {
    expect(pgrestOrTerms(["a", "b"], "x OR 1=1 --")).toBe('a.ilike."%x OR 11 --%",b.ilike."%x OR 11 --%"');
    // A `"` inside a quoted or() value would break the quoted-string grammar.
    expect(pgrestOrTerms(["a"], 'CR-"7001"')).toBe('a.ilike."%CR-7001%"');
  });

  it("pgrestOrTerms truncates oversized terms before quoting", () => {
    const out = pgrestOrTerms(["a"], "A".repeat(600));
    expect(out).toBe('a.ilike."%' + "A".repeat(500) + '%"');
    expect(out.length).toBe(512); // a.ilike." + % + 500 + % + "
  });

  it("never lets a hostile value reach PostgREST with its `=` trigger intact", () => {
    // Without `=`, the value is a plain literal — SQL comment/terminator shapes
    // are inert inside a filter comparison and match nothing.
    const hostile = 'x"; DROP TABLE historical_costings; --';
    expect(pgrestValue(hostile)).toBe('x"; DROP TABLE historical_costings; --');
    expect(pgrestValue(hostile)).not.toMatch(/[=]/);
  });
});

describe("listHistoricalCostings — user filters reach PostgREST defused but unquoted", () => {
  function lastCall(calls: Call[]) {
    return calls.find((c) => c.table === "historical_costings" && c.terminal === "select")!;
  }

  it("defuses every ilike filter so a tautology cannot hang the request", async () => {
    const { client, calls } = createMockSupabase();
    mocks.client = client;

    await listHistoricalCostings({
      query: "x OR 1=1 --",
      factory: "x OR 1=1 --",
      brand: "x OR 1=1 --",
      customer: "x OR 1=1 --",
      season: "x OR 1=1 --"
    });

    const call = lastCall(calls);
    expect(call.chain.ilike).toContainEqual(["searchable_text", "%x OR 11 --%"]);
    expect(call.chain.ilike).toContainEqual(["factory_name", "%x OR 11 --%"]);
    expect(call.chain.ilike).toContainEqual(["brand", "%x OR 11 --%"]);
    expect(call.chain.ilike).toContainEqual(["customer", "%x OR 11 --%"]);
    expect(call.chain.ilike).toContainEqual(["season", "%x OR 11 --%"]);
  });

  it("passes plain terms through unchanged (unquoted, so normal searches still match)", async () => {
    const { client, calls } = createMockSupabase();
    mocks.client = client;

    await listHistoricalCostings({ query: "Cotton", brand: "Next" });

    const call = lastCall(calls);
    expect(call.chain.ilike).toContainEqual(["searchable_text", "%Cotton%"]);
    expect(call.chain.ilike).toContainEqual(["brand", "%Next%"]);
  });
});