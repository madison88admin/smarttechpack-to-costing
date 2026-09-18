import { describe, expect, it, vi } from "vitest";
import { createMockSupabase } from "./helpers/supabase-mock";

const mocks = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServiceClient: () => mocks.client }));

import {
  dedupeHistoricalImports,
  historicalImportKey,
  listExistingHistoricalImportKeys
} from "../src/lib/costing/history";

// The identity every import path de-duplicates on. A real export carries the ERP
// costing record (uuid `id` in the Data Bank export, numeric `Id` in the NextGen
// product grid), so the record -- not the row's style, cost or import date -- is
// what decides whether a sync run has seen it before.
describe("historical import identity", () => {
  const dataBankRow = (overrides: Record<string, unknown> = {}) => ({
    style_number: "SW011555",
    factory_name: "Hangzhou U-Jump",
    total_cost: 3.75,
    currency: "USD",
    raw_payload: { id: "9aa52cc6-8033-4b7d-9c42-40a53dcd4f4e", rn: "2" },
    ...overrides
  });

  it("keys on the ERP record, case-insensitively", () => {
    const key = historicalImportKey(dataBankRow());
    expect(key).toBe("erp:9aa52cc6-8033-4b7d-9c42-40a53dcd4f4e");
    expect(historicalImportKey(dataBankRow({ raw_payload: { id: key.slice(4).toUpperCase() } }))).toBe(key);
  });

  it("keeps the same key when a later export moved the cost or the revision", () => {
    const first = historicalImportKey(dataBankRow());
    const later = historicalImportKey(
      dataBankRow({ total_cost: 4.2, raw_payload: { id: "9aa52cc6-8033-4b7d-9c42-40a53dcd4f4e", rn: "5" } })
    );
    expect(later).toBe(first);
  });

  it("reads the NextGen product grid's numeric Id, and the entity column when the payload has none", () => {
    expect(historicalImportKey({ raw_payload: { Id: 14451 } })).toBe("erp:14451");
    expect(historicalImportKey({ nextgen_entity_id: " 14451 ", raw_payload: {} })).toBe("erp:14451");
  });

  // Exports without an id still have to be re-runnable: the fallback is the
  // record's own content, deliberately without a timestamp, because the route
  // restamps `approved_at` with "now" whenever the file omits it.
  it("falls back to content for id-less exports, ignoring the import timestamp", () => {
    const row = { style_number: " M88-100 ", factory_name: "Factory", total_cost: 2, currency: "usd" };
    const key = historicalImportKey({ ...row, approved_at: "2026-08-26T07:05:14.656Z" } as never);
    expect(historicalImportKey({ ...row, approved_at: "2027-01-01T00:00:00.000Z" } as never)).toBe(key);
    expect(historicalImportKey({ ...row, total_cost: 2.5, approved_at: null } as never)).not.toBe(key);
  });

  it("drops a batch's own repeats before insert, keeping the first occurrence", () => {
    const records = [
      dataBankRow({ total_cost: 1 }),
      dataBankRow({ total_cost: 9 }),
      dataBankRow({ raw_payload: { id: "other-uuid" } })
    ];
    const { rows, skipped } = dedupeHistoricalImports(records, new Set());
    expect(rows.map((row) => row.total_cost)).toEqual([1, 3.75]);
    expect(skipped).toBe(1);
  });

  it("skips records the pool already holds", () => {
    const records = [dataBankRow(), dataBankRow({ raw_payload: { id: "other-uuid" } })];
    const existing = new Set([historicalImportKey(records[0])]);
    const { rows, skipped } = dedupeHistoricalImports(records, existing);
    expect(rows).toHaveLength(1);
    expect(skipped).toBe(1);
  });
});

// The lookup is the shared idempotency check: it reads back exactly the records
// the batch asked about, on the same path the batch's ids came from, so it can
// never be "as new" merely because a style was renamed between exports.
describe("listExistingHistoricalImportKeys", () => {
  it("filters on the id path the export used, and returns stored keys", async () => {
    const { client, calls } = createMockSupabase({
      historical_costings: {
        select: () => ({
          data: [
            {
              style_number: "SW011555",
              factory_name: "Hangzhou U-Jump",
              total_cost: 3.75,
              currency: "USD",
              nextgen_entity_id: null,
              payload_id: "9aa52cc6-8033-4b7d-9c42-40a53dcd4f4e",
              payload_Id: null
            }
          ],
          error: null
        })
      }
    });
    mocks.client = client;

    const keys = await listExistingHistoricalImportKeys([
      {
        style_number: "SW011555",
        factory_name: "Hangzhou U-Jump",
        total_cost: 3.75,
        currency: "USD",
        raw_payload: { id: "9AA52CC6-8033-4b7D-9C42-40A53DCD4F4E" }
      }
    ]);

    expect(keys).toEqual(new Set(["erp:9aa52cc6-8033-4b7d-9c42-40a53dcd4f4e"]));
    expect(calls).toHaveLength(1);
    expect(calls[0].chain.in).toEqual([
      ["raw_payload->>id", ["9AA52CC6-8033-4b7D-9C42-40A53DCD4F4E"]]
    ]);
    // The projection has to carry every field the key is rebuilt from.
    expect(String(calls[0].chain.select)).toContain("payload_id:raw_payload->>id");
    expect(String(calls[0].chain.select)).toContain("payload_Id:raw_payload->>Id");
  });

  it("queries each id source once, and styles only for records without an id", async () => {
    const { client, calls } = createMockSupabase({
      historical_costings: { select: () => ({ data: [], error: null }) }
    });
    mocks.client = client;

    await listExistingHistoricalImportKeys([
      { raw_payload: { id: "uuid-1" }, style_number: "A" },
      { raw_payload: { Id: 14451 }, style_number: "B" },
      { raw_payload: { rn: 1 }, style_number: "C" }
    ]);

    expect(calls.map((call) => call.chain.in?.[0]?.[0])).toEqual([
      "raw_payload->>id",
      "raw_payload->>Id",
      "style_number"
    ]);
    expect(calls[0].chain.in?.[0]?.[1]).toEqual(["uuid-1"]);
    expect(calls[1].chain.in?.[0]?.[1]).toEqual(["14451"]);
    expect(calls[2].chain.in?.[0]?.[1]).toEqual(["C"]);
  });

  it("reads nothing when the batch is empty", async () => {
    const { client, calls } = createMockSupabase({});
    mocks.client = client;
    expect(await listExistingHistoricalImportKeys([])).toEqual(new Set());
    expect(calls).toHaveLength(0);
  });

  // A style chunk can match more rows than one PostgREST response carries (it caps
  // at 1000 whatever `limit` asks), so a single read would report records the pool
  // holds as new -- the duplicate this check exists to prevent.
  it("pages past the response cap and keeps keys from every page", async () => {
    const stored = (id: string) => ({
      style_number: "SW011555",
      factory_name: null,
      total_cost: null,
      currency: null,
      nextgen_entity_id: null,
      payload_id: id,
      payload_Id: null
    });
    const fullPage = Array.from({ length: 1000 }, (_, i) => stored(`id-${i}`));
    const { client, calls } = createMockSupabase({
      historical_costings: {
        select: (chain) => (chain.range?.[0] === 0 ? { data: fullPage, error: null } : { data: [stored("id-last")], error: null })
      }
    });
    mocks.client = client;

    const keys = await listExistingHistoricalImportKeys([{ raw_payload: { id: "id-last" } }]);

    expect(keys.has("erp:id-last")).toBe(true);
    expect(calls.map((call) => call.chain.range)).toEqual([
      [0, 999],
      [1000, 1999]
    ]);
    expect(calls[0].chain.order?.[0][0]).toBe("id");
  });
});
