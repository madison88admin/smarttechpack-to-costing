import { beforeAll, describe, it, expect, vi } from "vitest";
import { createMockSupabase, type Chain } from "./helpers/supabase-mock";
import { issueSessionToken } from "./helpers/session";
const mocks = vi.hoisted(() => ({ client: null as unknown, token: null as string | null }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServiceClient: () => mocks.client }));
vi.mock("next/headers", () => ({
  cookies: () => ({ get: () => (mocks.token ? { value: mocks.token } : undefined) })
}));
import { listHistoricalCostings } from "../src/lib/costing/history";
import { GET as exportRegister } from "../src/app/api/export/history.csv/route";

describe("historical pagination", () => {
  it("reads beyond the server row cap without losing older records", async () => {
    const rows = Array.from({ length: 2829 }, (_, id) => ({ id: String(id) }));
    const { client, calls } = createMockSupabase({ historical_costings: { select: chain => ({ data: rows.slice(chain.range![0], chain.range![1] + 1), error: null }) } });
    mocks.client = client;
    const result = await listHistoricalCostings({ maxRows: 5000 });
    expect(result).toHaveLength(2829);
    expect(new Set(result.map(row => row.id)).size).toBe(2829);
    // 2,829 rows is three pages at the 1,000-row server cap — the fewest round
    // trips the read can take — and no page may ask for more than the cap.
    expect(calls.map(call => call.chain.range![1] - call.chain.range![0] + 1)).toEqual([1000, 1000, 1000]);
    expect(calls).toHaveLength(3);
  });

  // The register's total counts non-excluded rows, so the slice has to be taken
  // over those same rows: filtering after slicing made "Showing X–Y of N" drift
  // by the excluded rows inside the window (and could name rows past N).
  it("excludes benchmark rows in the query, not after slicing the page", async () => {
    const { client, calls } = createMockSupabase({
      historical_costings: { select: () => ({ data: [], error: null }) }
    });
    mocks.client = client;
    await listHistoricalCostings({ maxRows: 500, offset: 500 });
    expect(calls[0].chain.not).toContainEqual(["benchmark_excluded", "is", true]);
    expect(calls[0].chain.range).toEqual([500, 999]);
  });

  it("requests the migration-018 cost columns", async () => {
    const { client, calls } = createMockSupabase({
      historical_costings: { select: () => ({ data: [{ id: "1" }], error: null }) }
    });
    mocks.client = client;
    await listHistoricalCostings();
    expect(String(calls[0].chain.select)).toContain("landed_cost");
    expect(String(calls[0].chain.select)).toContain("selling_price");
  });

  // The app is deployed before the migration is always applied, so a database
  // without the cost columns must still serve the pool (speed-only) rather than
  // failing every Like Styles search.
  it("degrades to the pre-018 column set while the migration is pending", async () => {
    const { client, calls } = createMockSupabase({
      historical_costings: {
        select: (chain) =>
          String(chain.select).includes("landed_cost")
            ? { data: null, error: { message: 'column historical_costings.landed_cost does not exist' } }
            : { data: [{ id: "1", machine_type: "Flat-9GG" }], error: null }
      }
    });
    mocks.client = client;
    const rows = await listHistoricalCostings();
    expect(rows).toEqual([{ id: "1", machine_type: "Flat-9GG" }]);
    expect(String(calls[1].chain.select)).not.toContain("landed_cost");
  });
});

// "Export CSV" is the whole filtered register, not the visible page. It used to
// stop at a fixed 5,000 rows with nothing said, which is the same silent
// truncation the register page was fixed for.
describe("register CSV export", () => {
  beforeAll(async () => {
    mocks.token = await issueSessionToken("costing");
  });

  const responder = (total: number) => ({
    historical_costings: {
      select: (chain: Chain) =>
        chain.range
          ? { data: Array.from({ length: chain.range[1] - chain.range[0] + 1 }, (_, index) => ({ id: `h${index}`, style_number: `S${index}` })), error: null }
          : { data: null, error: null, count: total }
    }
  });

  const records = (csv: string) => csv.trim().split("\n").length - 1;

  it("ships every row the register counts", async () => {
    const { client, calls } = createMockSupabase(responder(3));
    mocks.client = client;
    const response = await exportRegister(new Request("http://localhost/api/export/history.csv"));
    expect(response.status).toBe(200);
    expect(records(await response.text())).toBe(3);
    // Sized by the count, not by a ceiling: one read covering exactly 3 rows.
    const read = calls.find((call) => call.chain.range);
    expect(read?.chain.range).toEqual([0, 2]);
  });

  it("refuses loudly above the safety ceiling instead of truncating", async () => {
    const { client } = createMockSupabase(responder(50_001));
    mocks.client = client;
    const response = await exportRegister(new Request("http://localhost/api/export/history.csv"));
    expect(response.status).toBe(413);
    expect(await response.text()).toContain("50,001 rows");
  });
});
