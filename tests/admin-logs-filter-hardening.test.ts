import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockSupabase, type Call, type Responder } from "./helpers/supabase-mock";
import { issueSessionToken } from "./helpers/session";

// Regression guard for the admin filter hangs discovered by the live fuzz
// harness: eventType=drop table costing_requests;-- and
// severity=drop table costing_requests;-- hung PostgREST for seconds (the
// value is parsed as query grammar server-side). The fix validates both
// filters against their known vocabularies — unknown values fall back to
// "no filter" — so hostile multi-word values can never reach .eq().

const { session, mocks } = vi.hoisted(() => ({
  session: { token: null as string | null },
  mocks: { client: null as unknown, calls: null as unknown }
}));

vi.mock("next/headers", () => ({
  cookies: () => ({ get: () => (session.token ? { value: session.token } : undefined) })
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: () => mocks.client
}));

function baseResponder(): Responder {
  return {
    system_error_logs: { select: () => ({ data: [], error: null, count: 0 }) },
    workflow_events: { select: () => ({ data: [], error: null, count: 0 }) }
  };
}

beforeEach(async () => {
  session.token = await issueSessionToken("admin");
});

afterEach(() => {
  session.token = null;
  mocks.client = null;
  mocks.calls = null;
});

function eqCalls(calls: Call[], table: string): string[] {
  return calls
    .filter((c) => c.table === table)
    .flatMap((c) => (c.chain.eq ?? []).map(([, val]) => String(val)));
}

describe("Admin audit/logs filter vocabulary gate", () => {
  it("hostile eventType values never reach the audit .eq filter (no-filter fallback)", async () => {
    const mock = createMockSupabase(baseResponder());
    mocks.client = mock.client;
    mocks.calls = mock.calls;
    const { listAuditEvents } = await import("../src/lib/admin/logs");
    await listAuditEvents({ eventType: "drop table costing_requests;--", limit: 50, offset: 0 });
    expect(eqCalls(mock.calls, "workflow_events")).toEqual([]);
  });

  it("hostile severity values never reach the logs .eq filter (no-filter fallback)", async () => {
    const mock = createMockSupabase(baseResponder());
    mocks.client = mock.client;
    mocks.calls = mock.calls;
    const { listSystemErrorLogs } = await import("../src/lib/admin/logs");
    await listSystemErrorLogs({ severity: "drop table costing_requests;--", limit: 50, offset: 0 });
    expect(eqCalls(mock.calls, "system_error_logs")).toEqual([]);
  });

  it("legit eventType and severity still filter (vocabulary membership preserved)", async () => {
    const mock = createMockSupabase(baseResponder());
    mocks.client = mock.client;
    mocks.calls = mock.calls;
    const { listAuditEvents, listSystemErrorLogs } = await import("../src/lib/admin/logs");
    // Vocabulary is aligned with what the engine actually emits (approve,
    // clarify, customer_status_changed — not the old pbd_approve labels).
    await listAuditEvents({ eventType: "approve", limit: 50, offset: 0 });
    expect(eqCalls(mock.calls, "workflow_events")).toEqual(["approve"]);
    await listAuditEvents({ eventType: "customer_status_changed", limit: 50, offset: 0 });
    expect(eqCalls(mock.calls, "workflow_events")).toEqual(["approve", "customer_status_changed"]);
    await listSystemErrorLogs({ severity: "error", limit: 50, offset: 0 });
    expect(eqCalls(mock.calls, "system_error_logs")).toEqual(["error"]);
  });

  it("unknown single-token values also fall back to no filter", async () => {
    const mock = createMockSupabase(baseResponder());
    mocks.client = mock.client;
    mocks.calls = mock.calls;
    const { listAuditEvents, listSystemErrorLogs } = await import("../src/lib/admin/logs");
    await listAuditEvents({ eventType: "not_a_real_event", limit: 50, offset: 0 });
    await listSystemErrorLogs({ severity: "nonsense", limit: 50, offset: 0 });
    expect(eqCalls(mock.calls, "workflow_events")).toEqual([]);
    expect(eqCalls(mock.calls, "system_error_logs")).toEqual([]);
  });
});