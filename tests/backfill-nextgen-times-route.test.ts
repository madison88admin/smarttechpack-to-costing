import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "../src/app/api/admin/backfill-nextgen-times/route";
import { createMockSupabase, inserts, updates, type Responder } from "./helpers/supabase-mock";

// Admin backfill: re-fetch NextGen rows and push knitting_time/SMV values into
// EXISTING source='nextgen' historical rows once NextGen starts returning them.
// Only changed values are written, nulls are never written over data, and rows
// that are not NextGen-synced are never touched.

const { mocks } = vi.hoisted(() => ({
  mocks: {
    role: "admin",
    rows: [] as Record<string, unknown>[],
    client: null as unknown
  }
}));

vi.mock("@/lib/auth/roles", () => ({
  canAccessAdmin: (role: string) => role === "admin" || role === "superadmin",
  getCurrentRole: () => mocks.role
}));

vi.mock("@/lib/nextgen/historical", () => ({
  NEXTGEN_HISTORICAL_SOURCE: "nextgen",
  NEXTGEN_HISTORICAL_STATUSES: ["Dropped"],
  historicalDedupKey: (s: string | null, f: string | null) =>
    `${(s ?? "").trim().toLowerCase()}|${(f ?? "").trim().toLowerCase()}`,
  fetchNextGenHistoricalProducts: async () => ({
    rows: mocks.rows,
    scanned: mocks.rows.length,
    perStatus: [{ status: "Dropped", total: mocks.rows.length }]
  }),
  mapNextGenProductToHistorical: (row: Record<string, unknown>) => ({
    style_number: String(row.Name ?? ""),
    factory_name: String(row.Supplier ?? ""),
    knitting_time: typeof row.GsdSMV === "number" ? row.GsdSMV : null,
    average_consumption: null,
    nextgen_entity_id: String(row.Id ?? "")
  }),
  enrichWithBomConsumption: async () => {}
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: () => mocks.client
}));

function request(body: unknown) {
  return new Request("http://localhost/api/admin/backfill-nextgen-times", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

function responder(existing: Array<Record<string, unknown>> = []): Responder {
  return {
    historical_costings: {
      select: () => ({ data: existing, error: null }),
      update: () => ({ data: [], error: null })
    }
  };
}

afterEach(() => {
  mocks.client = null;
  mocks.rows = [];
  mocks.role = "admin";
});

describe("POST /api/admin/backfill-nextgen-times", () => {
  it("rejects non-admin roles with 403 before any work", async () => {
    mocks.role = "costing";
    const { client, calls } = createMockSupabase({});
    mocks.client = client;

    const res = await POST(request({}));
    expect(res.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it("updates existing nextgen rows with newly-available knitting times", async () => {
    mocks.rows = [
      { Id: 1, Name: "M88-100", Supplier: "Cebu Factory", GsdSMV: 0.42 },
      { Id: 2, Name: "M88-200", Supplier: "Cebu Factory", GsdSMV: null }, // no value → not a candidate
      { Id: 3, Name: "M88-300", Supplier: "Cebu Factory", GsdSMV: 0.5 } // no existing row → skipped
    ];
    const { client, calls } = createMockSupabase(
      responder([
        { id: "e1", style_number: "M88-100", factory_name: "Cebu Factory", knitting_time: null, average_consumption: null },
        { id: "e2", style_number: "M88-200", factory_name: "Cebu Factory", knitting_time: null, average_consumption: null }
      ])
    );
    mocks.client = client;

    const res = await POST(request({ statuses: "Dropped" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.candidates).toBe(2); // M88-100 + M88-300 (M88-200 has null)
    expect(body.updated).toBe(1);
    expect(body.skipped).toBe(1); // M88-300 has no synced row

    // Only the changed value was written, to the correct row.
    const historyUpdates = updates(calls, "historical_costings");
    expect(historyUpdates).toHaveLength(1);
    expect(historyUpdates[0]).toEqual({ knitting_time: 0.42 });
  });

  it("is idempotent — does not write when the existing value already matches", async () => {
    mocks.rows = [{ Id: 1, Name: "M88-100", Supplier: "Cebu Factory", GsdSMV: 0.42 }];
    const { client, calls } = createMockSupabase(
      responder([
        { id: "e1", style_number: "M88-100", factory_name: "Cebu Factory", knitting_time: 0.42, average_consumption: null }
      ])
    );
    mocks.client = client;

    const res = await POST(request({}));
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.updated).toBe(0);
    expect(updates(calls, "historical_costings")).toHaveLength(0);
  });

  it("reports cleanly when nothing in NextGen carries a value yet", async () => {
    mocks.rows = [{ Id: 1, Name: "M88-100", Supplier: "Cebu Factory", GsdSMV: null }];
    const { client, calls } = createMockSupabase(responder([]));
    mocks.client = client;

    const res = await POST(request({}));
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.candidates).toBe(0);
    expect(body.updated).toBe(0);
    expect(calls.filter((c) => c.table === "historical_costings" && c.chain.payload)).toHaveLength(0);
  });
});

// --- Scheduled (cron) execution + admin alert --------------------------------

function cronRequest(body: unknown, secret?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (secret !== undefined) headers["x-cron-secret"] = secret;
  return new Request("http://localhost/api/admin/backfill-nextgen-times", {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
}

function alertResponder(existing: Array<Record<string, unknown>>, opts: { queueDown?: boolean } = {}): Responder {
  return {
    historical_costings: {
      select: () => ({ data: existing, error: null }),
      update: () => ({ data: [], error: null })
    },
    user_profiles: {
      select: () => ({ data: [{ email: "admin@test.local" }], error: null })
    },
    notification_queue: {
      insert: () => {
        if (opts.queueDown) throw new Error("queue down");
        return { data: [], error: null };
      }
    }
  };
}

describe("POST /api/admin/backfill-nextgen-times (cron)", () => {
  afterEach(() => {
    delete process.env.CRON_SECRET;
    mocks.role = "admin";
    mocks.rows = [];
    mocks.client = null;
  });

  it("runs with the cron secret and no session", async () => {
    process.env.CRON_SECRET = "nightly-secret";
    mocks.rows = [{ Id: 1, Name: "M88-100", Supplier: "Cebu Factory", GsdSMV: 0.42 }];
    const { client, calls } = createMockSupabase(
      alertResponder([
        { id: "e1", style_number: "M88-100", factory_name: "Cebu Factory", knitting_time: null, average_consumption: null }
      ])
    );
    mocks.client = client;

    const res = await POST(cronRequest({}, "nightly-secret"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.updated).toBe(1);
    expect(updates(calls, "historical_costings")).toEqual([{ knitting_time: 0.42 }]);
  });

  it("rejects a wrong cron secret without a session", async () => {
    process.env.CRON_SECRET = "nightly-secret";
    mocks.role = "costing"; // no session either way
    const { client, calls } = createMockSupabase({});
    mocks.client = client;

    const res = await POST(cronRequest({}, "wrong-secret"));
    expect(res.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it("alerts admins by email when new knitting-time values were populated", async () => {
    process.env.CRON_SECRET = "nightly-secret";
    mocks.rows = [{ Id: 1, Name: "M88-100", Supplier: "Cebu Factory", GsdSMV: 0.42 }];
    const { client, calls } = createMockSupabase(
      alertResponder([
        { id: "e1", style_number: "M88-100", factory_name: "Cebu Factory", knitting_time: null, average_consumption: null }
      ])
    );
    mocks.client = client;

    const res = await POST(cronRequest({}, "nightly-secret"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.updated).toBe(1);
    expect(body.alerted).toBe(1);

    const queue = inserts(calls, "notification_queue");
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      channel: "email",
      recipient: "admin@test.local",
      status: "pending"
    });
    expect(String((queue[0] as Record<string, unknown>).subject)).toContain("populated 1 new knitting-time");
    expect(String((queue[0] as Record<string, unknown>).body)).toContain("Rows scanned: 1");
  });

  it("sends no alert when the run populated nothing", async () => {
    process.env.CRON_SECRET = "nightly-secret";
    mocks.rows = [{ Id: 1, Name: "M88-100", Supplier: "Cebu Factory", GsdSMV: 0.42 }];
    const { client, calls } = createMockSupabase(
      alertResponder([
        { id: "e1", style_number: "M88-100", factory_name: "Cebu Factory", knitting_time: 0.42, average_consumption: null }
      ])
    );
    mocks.client = client;

    const res = await POST(cronRequest({}, "nightly-secret"));
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.updated).toBe(0);
    expect(body.alerted).toBe(0);
    expect(inserts(calls, "notification_queue")).toHaveLength(0);
  });

  it("keeps the run green even when the alert queue fails", async () => {
    process.env.CRON_SECRET = "nightly-secret";
    mocks.rows = [{ Id: 1, Name: "M88-100", Supplier: "Cebu Factory", GsdSMV: 0.42 }];
    const { client, calls } = createMockSupabase(
      alertResponder(
        [
          { id: "e1", style_number: "M88-100", factory_name: "Cebu Factory", knitting_time: null, average_consumption: null }
        ],
        { queueDown: true }
      )
    );
    mocks.client = client;

    const res = await POST(cronRequest({}, "nightly-secret"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.updated).toBe(1);
    expect(body.alerted).toBe(0);
    expect(updates(calls, "historical_costings")).toEqual([{ knitting_time: 0.42 }]);
  });
});

// --- Dry-run preview ----------------------------------------------------------

describe("POST /api/admin/backfill-nextgen-times (dry run)", () => {
  afterEach(() => {
    delete process.env.CRON_SECRET;
    mocks.role = "admin";
    mocks.rows = [];
    mocks.client = null;
  });

  it("lists the exact from→to changes and writes nothing", async () => {
    process.env.CRON_SECRET = "nightly-secret";
    mocks.rows = [{ Id: 1, Name: "M88-100", Supplier: "Cebu Factory", GsdSMV: 0.42 }];
    const { client, calls } = createMockSupabase(
      alertResponder([
        { id: "e1", style_number: "M88-100", factory_name: "Cebu Factory", knitting_time: null, average_consumption: null }
      ])
    );
    mocks.client = client;

    const res = await POST(cronRequest({ dryRun: true }, "nightly-secret"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.dryRun).toBe(true);
    expect(body.wouldUpdate).toBe(1);
    expect(body.totalPreview).toBe(1);
    expect(body.previewTruncated).toBe(false);
    expect(body.preview).toEqual([
      {
        style_number: "M88-100",
        factory_name: "Cebu Factory",
        knitting_time: { from: null, to: 0.42 }
      }
    ]);

    // Nothing was written and nothing was alerted.
    expect(updates(calls, "historical_costings")).toEqual([]);
    expect(inserts(calls, "notification_queue")).toHaveLength(0);
    expect(body.updated).toBeUndefined();
    expect(body.alerted).toBeUndefined();
  });

  it("reports zero changes when existing values already match", async () => {
    process.env.CRON_SECRET = "nightly-secret";
    mocks.rows = [{ Id: 1, Name: "M88-100", Supplier: "Cebu Factory", GsdSMV: 0.42 }];
    const { client, calls } = createMockSupabase(
      alertResponder([
        { id: "e1", style_number: "M88-100", factory_name: "Cebu Factory", knitting_time: 0.42, average_consumption: null }
      ])
    );
    mocks.client = client;

    const res = await POST(cronRequest({ dryRun: true }, "nightly-secret"));
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.dryRun).toBe(true);
    expect(body.wouldUpdate).toBe(0);
    expect(body.preview).toEqual([]);
    expect(body.totalPreview).toBe(0);
    expect(updates(calls, "historical_costings")).toEqual([]);
  });

  it("caps the preview list but still counts every change", async () => {
    process.env.CRON_SECRET = "nightly-secret";
    // 105 styles, each gaining a knitting time → 105 changes, preview capped at 100.
    mocks.rows = Array.from({ length: 105 }, (_, i) => ({
      Id: i + 1,
      Name: `M88-${i}`,
      Supplier: "Cebu Factory",
      GsdSMV: 0.4
    }));
    const existing = Array.from({ length: 105 }, (_, i) => ({
      id: `e${i}`,
      style_number: `M88-${i}`,
      factory_name: "Cebu Factory",
      knitting_time: null,
      average_consumption: null
    }));
    const { client, calls } = createMockSupabase(alertResponder(existing));
    mocks.client = client;

    const res = await POST(cronRequest({ dryRun: true }, "nightly-secret"));
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.wouldUpdate).toBe(105);
    expect(body.totalPreview).toBe(105);
    expect(body.preview).toHaveLength(100);
    expect(body.previewTruncated).toBe(true);
    expect(updates(calls, "historical_costings")).toEqual([]);
  });

  it("skips the admin alert entirely in dry-run mode", async () => {
    process.env.CRON_SECRET = "nightly-secret";
    mocks.rows = [{ Id: 1, Name: "M88-100", Supplier: "Cebu Factory", GsdSMV: 0.42 }];
    const { client, calls } = createMockSupabase(
      alertResponder([
        { id: "e1", style_number: "M88-100", factory_name: "Cebu Factory", knitting_time: null, average_consumption: null }
      ])
    );
    mocks.client = client;

    const res = await POST(cronRequest({ dryRun: true }, "nightly-secret"));
    const body = await res.json();

    // No recipient lookup, no queue insert — a preview must be silent.
    expect(calls.some((c) => c.table === "user_profiles")).toBe(false);
    expect(inserts(calls, "notification_queue")).toHaveLength(0);
    expect(body.alerted).toBeUndefined();
  });
});

// --- Audit log recording ------------------------------------------------------

describe("POST /api/admin/backfill-nextgen-times (audit log)", () => {
  afterEach(() => {
    delete process.env.CRON_SECRET;
    mocks.role = "admin";
    mocks.rows = [];
    mocks.client = null;
  });

  it("records a workflow_events audit row with counts on a real run (cron)", async () => {
    process.env.CRON_SECRET = "nightly-secret";
    mocks.rows = [{ Id: 1, Name: "M88-100", Supplier: "Cebu Factory", GsdSMV: 0.42 }];
    const { client, calls } = createMockSupabase(
      alertResponder([
        { id: "e1", style_number: "M88-100", factory_name: "Cebu Factory", knitting_time: null, average_consumption: null }
      ])
    );
    mocks.client = client;

    const res = await POST(cronRequest({}, "nightly-secret"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.audited).toBe(true);

    const events = inserts(calls, "workflow_events");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      costing_request_id: null,
      event_type: "nextgen_backfill",
      actor_role: "system",
      notification_status: "queued"
    });
    const payload = (events[0] as Record<string, unknown>).payload as Record<string, unknown>;
    expect(payload).toMatchObject({
      scanned: 1,
      candidates: 1,
      matched: 1,
      updated: 1,
      skipped: 0,
      enrichBom: false
    });
    expect(Array.isArray(payload.perStatus)).toBe(true);
  });

  it("records the admin role when triggered from a session", async () => {
    mocks.role = "admin";
    mocks.rows = [{ Id: 1, Name: "M88-100", Supplier: "Cebu Factory", GsdSMV: 0.42 }];
    const { client, calls } = createMockSupabase(
      alertResponder([
        { id: "e1", style_number: "M88-100", factory_name: "Cebu Factory", knitting_time: null, average_consumption: null }
      ])
    );
    mocks.client = client;

    // No cron secret → session path → getCurrentRole() returns "admin".
    const res = await POST(request({}));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.audited).toBe(true);
    const events = inserts(calls, "workflow_events");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ actor_role: "admin", event_type: "nextgen_backfill" });
  });

  it("logs the run even when no values were populated", async () => {
    process.env.CRON_SECRET = "nightly-secret";
    mocks.rows = [{ Id: 1, Name: "M88-100", Supplier: "Cebu Factory", GsdSMV: 0.42 }];
    const { client, calls } = createMockSupabase(
      alertResponder([
        { id: "e1", style_number: "M88-100", factory_name: "Cebu Factory", knitting_time: 0.42, average_consumption: null }
      ])
    );
    mocks.client = client;

    const res = await POST(cronRequest({}, "nightly-secret"));
    const body = await res.json();

    expect(body.updated).toBe(0);
    expect(body.audited).toBe(true);
    const events = inserts(calls, "workflow_events");
    expect(events).toHaveLength(1);
    expect((events[0] as Record<string, unknown>).payload).toMatchObject({ updated: 0, skipped: 1 });
  });

  it("never records a dry run", async () => {
    process.env.CRON_SECRET = "nightly-secret";
    mocks.rows = [{ Id: 1, Name: "M88-100", Supplier: "Cebu Factory", GsdSMV: 0.42 }];
    const { client, calls } = createMockSupabase(
      alertResponder([
        { id: "e1", style_number: "M88-100", factory_name: "Cebu Factory", knitting_time: null, average_consumption: null }
      ])
    );
    mocks.client = client;

    const res = await POST(cronRequest({ dryRun: true }, "nightly-secret"));
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.dryRun).toBe(true);
    expect(inserts(calls, "workflow_events")).toHaveLength(0);
    expect(body.audited).toBeUndefined();
  });

  it("keeps the run green even when the audit write fails", async () => {
    process.env.CRON_SECRET = "nightly-secret";
    mocks.rows = [{ Id: 1, Name: "M88-100", Supplier: "Cebu Factory", GsdSMV: 0.42 }];
    const responder = alertResponder([
      { id: "e1", style_number: "M88-100", factory_name: "Cebu Factory", knitting_time: null, average_consumption: null }
    ]);
    responder.workflow_events = {
      insert: () => {
        throw new Error("audit table down");
      }
    };
    const { client } = createMockSupabase(responder);
    mocks.client = client;

    const res = await POST(cronRequest({}, "nightly-secret"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.updated).toBe(1);
    expect(body.audited).toBe(false);
  });
});
