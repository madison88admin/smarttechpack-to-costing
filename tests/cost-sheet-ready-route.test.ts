import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../src/app/api/costing/requests/[id]/cost-sheet-ready/route";
import { createMockSupabase, inserts } from "./helpers/supabase-mock";
import { issueSessionToken } from "./helpers/session";

// Route-level tests for the cost-sheet-ready endpoint: role gate, not-found,
// the approved-only gate, and the flag set/clear writes.

const REQUEST_ID = "11111111-1111-4111-8111-111111111111";

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

function request(body: unknown) {
  return new Request("http://localhost/api/costing/requests/xyz/cost-sheet-ready", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

beforeEach(async () => {
  session.token = await issueSessionToken("costing");
});

afterEach(() => {
  session.token = null;
  mocks.client = null;
});

describe("POST /cost-sheet-ready", () => {
  it("rejects a non-costing role with 403", async () => {
    session.token = await issueSessionToken("pbd");
    const { client } = createMockSupabase({});
    mocks.client = client;

    const res = await POST(request({ ready: true }), { params: { id: REQUEST_ID } });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("Only Costing Team or admin can mark cost sheet as ready");
  });

  it("returns 404 when the request does not exist", async () => {
    const { client } = createMockSupabase({
      costing_requests: { single: () => ({ data: null, error: null }) }
    });
    mocks.client = client;

    const res = await POST(request({ ready: true }), { params: { id: REQUEST_ID } });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Request not found");
  });

  it("rejects marking a non-approved request ready", async () => {
    const { client } = createMockSupabase({
      costing_requests: { single: () => ({ data: { id: REQUEST_ID, status: "for_pbd_review" }, error: null }) }
    });
    mocks.client = client;

    const res = await POST(request({ ready: true }), { params: { id: REQUEST_ID } });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Cost sheet can only be marked ready for approved requests");
  });

  it("sets the flag on an approved request and logs the event", async () => {
    const { client, calls } = createMockSupabase({
      costing_requests: { single: () => ({ data: { id: REQUEST_ID, status: "approved" }, error: null }) }
    });
    mocks.client = client;

    const res = await POST(request({ ready: true }), { params: { id: REQUEST_ID } });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, ready: true });

    const flagUpdate = calls.find((c) => c.table === "costing_requests" && c.terminal === "select" && c.chain.payload);
    expect(flagUpdate?.chain.payload).toMatchObject({
      cost_sheet_ready: true,
      cost_sheet_ready_by: "costing"
    });
    expect(inserts(calls, "workflow_events")[0]).toMatchObject({
      event_type: "cost_sheet_ready",
      actor_role: "costing",
      payload: { ready: true }
    });
  });

  it("clears the flag from any status without an event payload issue", async () => {
    const { client, calls } = createMockSupabase({
      costing_requests: { single: () => ({ data: { id: REQUEST_ID, status: "for_pbd_review" }, error: null }) }
    });
    mocks.client = client;

    const res = await POST(request({ ready: false }), { params: { id: REQUEST_ID } });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, ready: false });

    const flagUpdate = calls.find((c) => c.table === "costing_requests" && c.terminal === "select" && c.chain.payload);
    expect(flagUpdate?.chain.payload).toMatchObject({
      cost_sheet_ready: false,
      cost_sheet_ready_at: null,
      cost_sheet_ready_by: null
    });
    expect(inserts(calls, "workflow_events")[0]).toMatchObject({ event_type: "cost_sheet_not_ready" });
  });
});
