import { describe, it, expect, vi } from "vitest";
import { createMockSupabase } from "./helpers/supabase-mock";
const mocks = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServiceClient: () => mocks.client }));
import { listHistoricalCostings } from "../src/lib/costing/history";

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
