import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../src/app/api/admin/import-historical/route";
import { createMockSupabase, inserts, type Call } from "./helpers/supabase-mock";
import { issueSessionToken } from "./helpers/session";

// Route tests for the Data Bank / ERP historical import, focused on the one
// thing a re-upload must never do: add a second row for a record the pool
// already holds. Records are matched by the ERP record id they carry.

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

type ImportedRow = {
  style_number: string;
  factory_name: string | null;
  total_cost: number | null;
  currency: string;
  nextgen_entity_id?: string | null;
  raw_payload: Record<string, unknown>;
};

const importedRows = (calls: Call[]) => inserts(calls, "historical_costings").flat() as ImportedRow[];

/** The pool after a run, as PostgREST projects it for the identity lookup. */
const storedRows = (rows: ImportedRow[]) =>
  rows.map((row) => ({
    style_number: row.style_number,
    factory_name: row.factory_name,
    total_cost: row.total_cost,
    currency: row.currency,
    nextgen_entity_id: row.nextgen_entity_id ?? null,
    payload_id: row.raw_payload?.id ?? null,
    payload_Id: row.raw_payload?.Id ?? null
  }));

const importRequest = (records: unknown[]) =>
  POST(
    new Request("http://localhost/api/admin/import-historical", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ records })
    })
  );

const erpRecord = (id: string, overrides: Record<string, unknown> = {}) => ({
  style_number: "SW011555-P1",
  customer: "SMARTWOOL",
  season: "F23-INDO",
  total_cost: 3.75,
  currency: "USD",
  raw_payload: { id, rn: 1, style_number: "SW011555-P1" },
  ...overrides
});

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
  session.token = null;
});

describe("POST /api/admin/import-historical", () => {
  it("requires admin", async () => {
    session.token = await issueSessionToken("costing");
    const response = await importRequest([erpRecord("uuid-1")]);
    expect(response.status).toBe(403);
  });

  it("imports the batch once, then adds nothing when the same export is re-uploaded", async () => {
    session.token = await issueSessionToken("admin");
    const records = [
      erpRecord("9aa52cc6-8033-4b7d-9c42-40a53dcd4f4e"),
      erpRecord("66ce423f-d45b-4d3f-aeb2-97c7a5737ded", { style_number: "CL2812", total_cost: 4.02 })
    ];

    const first = createMockSupabase({
      historical_costings: { select: () => ({ data: [], error: null }), insert: () => ({ data: [], error: null }) }
    });
    mocks.client = first.client;
    const firstBody = await (await importRequest(records)).json();
    expect(firstBody.imported).toBe(2);
    expect(firstBody.skippedDuplicates).toBe(0);

    const pool = storedRows(importedRows(first.calls));
    expect(pool).toHaveLength(2);

    const second = createMockSupabase({
      historical_costings: { select: () => ({ data: pool, error: null }), insert: () => ({ data: [], error: null }) }
    });
    mocks.client = second.client;
    const secondBody = await (await importRequest(records)).json();

    expect(secondBody.imported).toBe(0);
    expect(secondBody.skippedDuplicates).toBe(2);
    expect(inserts(second.calls, "historical_costings")).toHaveLength(0);
  });

  // The regression this replaced: the old key was style + factory + import date,
  // and the route stamps `approved_at` with "now" when the file has no date, so
  // every re-upload looked like new rows.
  it("still recognises an id-less export on a later day, when approved_at is restamped", async () => {
    session.token = await issueSessionToken("admin");
    const noId = { style_number: "M88-100", factory_name: "Import Factory", total_cost: 2, currency: "USD" };

    const first = createMockSupabase({
      historical_costings: { select: () => ({ data: [], error: null }), insert: () => ({ data: [], error: null }) }
    });
    mocks.client = first.client;
    expect((await (await importRequest([noId])).json()).imported).toBe(1);

    const pool = storedRows(importedRows(first.calls));
    expect(pool[0].payload_id).toBeNull();

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-17T04:00:00.000Z"));
    const second = createMockSupabase({
      historical_costings: { select: () => ({ data: pool, error: null }), insert: () => ({ data: [], error: null }) }
    });
    mocks.client = second.client;
    const secondBody = await (await importRequest([noId])).json();
    vi.useRealTimers();

    expect(secondBody.imported).toBe(0);
    expect(secondBody.skippedDuplicates).toBe(1);
  });

  it("imports only the records in the file that the pool does not hold", async () => {
    session.token = await issueSessionToken("admin");
    const held = erpRecord("held-uuid");
    const fresh = erpRecord("fresh-uuid", { style_number: "A7WFL" });

    const first = createMockSupabase({
      historical_costings: { select: () => ({ data: [], error: null }), insert: () => ({ data: [], error: null }) }
    });
    mocks.client = first.client;
    await importRequest([held]);

    const second = createMockSupabase({
      historical_costings: {
        select: () => ({ data: storedRows(importedRows(first.calls)), error: null }),
        insert: () => ({ data: [], error: null })
      }
    });
    mocks.client = second.client;
    const body = await (await importRequest([held, fresh, fresh])).json();

    // `held` is already there and the file lists `fresh` twice.
    expect(body.imported).toBe(1);
    expect(body.skippedDuplicates).toBe(2);
    expect(importedRows(second.calls).map((row) => row.style_number)).toEqual(["A7WFL"]);
  });
});
