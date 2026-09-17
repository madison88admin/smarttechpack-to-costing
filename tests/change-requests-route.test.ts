import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST, PUT } from "../src/app/api/costing/requests/[id]/change-requests/route";
import { createMockSupabase, inserts, type Responder } from "./helpers/supabase-mock";
import { issueSessionToken } from "./helpers/session";

// Route-level tests for the structured per-field change requests:
// role × status gating, required-field validation, factory assignment gate,
// and the status transition each lane triggers (md_review / costing_clarify /
// clarify) alongside the persisted row.

const REQUEST_ID = "22222222-2222-4222-8222-222222222222";

const { session, mocks } = vi.hoisted(() => ({
  session: { token: null as string | null },
  mocks: { client: null as unknown, owns: true }
}));

vi.mock("next/headers", () => ({
  cookies: () => ({ get: () => (session.token ? { value: session.token } : undefined) })
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: () => mocks.client
}));

vi.mock("@/lib/admin/assignments", () => ({
  factoryOwnsRequest: () => Promise.resolve(mocks.owns)
}));

function request(method: string, body?: unknown) {
  return new Request(`http://localhost/api/costing/requests/${REQUEST_ID}/change-requests`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

function changeBody() {
  return {
    section: "Knitting & Operations",
    field: "Machine / Gauge Type",
    fieldKey: "knittingLines.0.machineType",
    currentValue: "Flat 12G",
    requestedValue: "Flat 7G",
    reason: "Gauge too coarse for the hand feel",
    priority: "high"
  };
}

function laneResponder(fromStatus: string): Responder {
  return {
    costing_requests: {
      single: () => ({ data: { status: fromStatus }, error: null }),
      maybeSingle: () => ({ data: { request_number: "CR-7", factory_name: "Cebu Factory" }, error: null }),
      select: (chain) => (chain.payload ? { data: [{ id: REQUEST_ID }], error: null } : { data: [], error: null })
    },
    cbd_change_requests: {
      single: () => ({ data: { id: "cr-1" }, error: null }),
      select: () => ({
        data: [
          {
            id: "cr-1",
            costing_request_id: REQUEST_ID,
            cbd_section: "Knitting & Operations",
            field_key: "knittingLines.0.machineType",
            field_label: "Machine / Gauge Type",
            current_value: "Flat 12G",
            requested_value: "Flat 7G",
            reason: "Gauge too coarse",
            priority: "high",
            due_date: null,
            status: "open",
            requested_by_role: "md",
            requested_by_name: "md",
            resolved_cbd_id: null,
            created_at: "2026-01-01T00:00:00Z",
            resolved_at: null
          }
        ],
        error: null
      })
    },
    approval_actions: { insert: () => ({ data: [], error: null }) },
    workflow_events: { insert: () => ({ data: [], error: null }) },
    user_profiles: { select: () => ({ data: [], error: null }) },
    notification_queue: { insert: () => ({ data: [], error: null }) },
    in_app_alerts: { insert: () => ({ data: [], error: null }) }
  };
}

beforeEach(async () => {
  session.token = await issueSessionToken("md");
  mocks.owns = true;
});

afterEach(() => {
  session.token = null;
  mocks.client = null;
});

describe("GET /change-requests", () => {
  it("lists rows for an authorized role", async () => {
    const { client } = createMockSupabase(laneResponder("for_md_review"));
    mocks.client = client;

    const res = await GET(request("GET"), { params: { id: REQUEST_ID } });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({ field_key: "knittingLines.0.machineType", status: "open" });
  });

  it("rejects viewers with 401", async () => {
    session.token = await issueSessionToken("viewer");
    const { client } = createMockSupabase({});
    mocks.client = client;

    const res = await GET(request("GET"), { params: { id: REQUEST_ID } });
    expect(res.status).toBe(401);
  });

  it("rejects unassigned factory users with 403", async () => {
    session.token = await issueSessionToken("factory");
    mocks.owns = false;
    const { client } = createMockSupabase({});
    mocks.client = client;

    const res = await GET(request("GET"), { params: { id: REQUEST_ID } });
    expect(res.status).toBe(403);
  });
});

describe("POST /change-requests — gating", () => {
  it("rejects factory and viewer roles with 403", async () => {
    const { client } = createMockSupabase({});
    mocks.client = client;

    session.token = await issueSessionToken("factory");
    expect((await POST(request("POST", changeBody()), { params: { id: REQUEST_ID } })).status).toBe(403);

    session.token = await issueSessionToken("viewer");
    expect((await POST(request("POST", changeBody()), { params: { id: REQUEST_ID } })).status).toBe(403);
  });

  it("rejects missing reason and requested value with 400", async () => {
    const { client } = createMockSupabase(laneResponder("for_md_review"));
    mocks.client = client;

    const res = await POST(request("POST", { ...changeBody(), reason: "  " }), { params: { id: REQUEST_ID } });
    expect(res.status).toBe(400);
  });

  it("rejects md outside for_md_review with 409 and records nothing", async () => {
    const { client, calls } = createMockSupabase(laneResponder("for_costing_review"));
    mocks.client = client;

    const res = await POST(request("POST", changeBody()), { params: { id: REQUEST_ID } });
    expect(res.status).toBe(409);
    expect(inserts(calls, "cbd_change_requests")).toHaveLength(0);
  });
});

describe("PUT /change-requests — dismiss", () => {
  it("dismisses an open row", async () => {
    const { client } = createMockSupabase({
      cbd_change_requests: {
        select: () => ({ data: [{ id: "cr-1" }], error: null })
      }
    });
    mocks.client = client;

    const res = await PUT(
      request("PUT", { id: "11111111-1111-4111-8111-111111111111", status: "dismissed" }),
      { params: { id: REQUEST_ID } }
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, data: { id: "11111111-1111-4111-8111-111111111111", status: "dismissed" } });
  });

  it("404s when nothing flipped (already resolved or foreign row)", async () => {
    const { client } = createMockSupabase({
      cbd_change_requests: {
        select: () => ({ data: [], error: null })
      }
    });
    mocks.client = client;

    const res = await PUT(
      request("PUT", { id: "11111111-1111-4111-8111-111111111111", status: "dismissed" }),
      { params: { id: REQUEST_ID } }
    );
    expect(res.status).toBe(404);
  });

  it("rejects factory roles with 403 and bad shapes with 400", async () => {
    const { client } = createMockSupabase({});
    mocks.client = client;

    session.token = await issueSessionToken("factory");
    expect(
      (await PUT(request("PUT", { id: "11111111-1111-4111-8111-111111111111", status: "dismissed" }), { params: { id: REQUEST_ID } })).status
    ).toBe(403);

    session.token = await issueSessionToken("pbd");
    expect(
      (await PUT(request("PUT", { id: "not-a-uuid", status: "dismissed" }), { params: { id: REQUEST_ID } })).status
    ).toBe(400);
  });
});

describe("POST /change-requests — lane transitions", () => {
  it("md records the row and applies md_review needs_clarification", async () => {
    const { client, calls } = createMockSupabase(laneResponder("for_md_review"));
    mocks.client = client;

    const res = await POST(request("POST", changeBody()), { params: { id: REQUEST_ID } });
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.data).toMatchObject({ id: "cr-1" });
    expect(body.status).toBe("needs_clarification");
    const written = calls.filter((c) => c.table === "cbd_change_requests" && c.chain.payload);
    expect(written).toHaveLength(1);
    expect(written[0].chain.payload).toMatchObject({
      costing_request_id: REQUEST_ID,
      field_key: "knittingLines.0.machineType",
      requested_value: "Flat 7G",
      status: "open",
      requested_by_role: "md"
    });
    expect(inserts(calls, "approval_actions")[0]).toMatchObject({
      action: "md_review",
      from_status: "for_md_review",
      to_status: "needs_clarification"
    });
  });

  it("costing records the row and applies costing_clarify", async () => {
    session.token = await issueSessionToken("costing");
    const { client, calls } = createMockSupabase(laneResponder("for_costing_review"));
    mocks.client = client;

    const res = await POST(request("POST", changeBody()), { params: { id: REQUEST_ID } });
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.status).toBe("needs_clarification");
    expect(inserts(calls, "approval_actions")[0]).toMatchObject({ action: "costing_clarify" });
  });

  it("pbd records the row and applies clarify", async () => {
    session.token = await issueSessionToken("pbd");
    const { client, calls } = createMockSupabase(laneResponder("for_pbd_review"));
    mocks.client = client;

    const res = await POST(request("POST", changeBody()), { params: { id: REQUEST_ID } });
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.status).toBe("needs_clarification");
    expect(inserts(calls, "approval_actions")[0]).toMatchObject({ action: "clarify" });
  });

  it("rolls the row back when the transition loses a race", async () => {
    let statusReads = 0;
    // First status read (route gate) sees for_md_review; the applier's
    // re-read sees a moved request, so the optimistic lock finds no rows.
    const { client: client2, calls: calls2 } = createMockSupabase({
      costing_requests: {
        single: () => {
          statusReads += 1;
          return { data: { status: statusReads === 1 ? "for_md_review" : "for_costing_review" }, error: null };
        },
        maybeSingle: () => ({ data: { request_number: "CR-7", factory_name: "Cebu" }, error: null }),
        select: () => ({ data: [], error: null })
      },
      cbd_change_requests: {
        single: () => ({ data: { id: "cr-9" }, error: null })
      },
      approval_actions: { insert: () => ({ data: [], error: null }) },
      workflow_events: { insert: () => ({ data: [], error: null }) },
      user_profiles: { select: () => ({ data: [], error: null }) },
      notification_queue: { insert: () => ({ data: [], error: null }) },
      in_app_alerts: { insert: () => ({ data: [], error: null }) }
    });
    mocks.client = client2;

    const res = await POST(request("POST", changeBody()), { params: { id: REQUEST_ID } });
    expect(res.status).toBe(409);
    const deletes = calls2.filter((c) => c.table === "cbd_change_requests" && c.terminal === "delete");
    expect(deletes).toHaveLength(1);
  });
});
