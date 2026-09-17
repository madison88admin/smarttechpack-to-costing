import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../src/app/api/costing/requests/bulk-actions/route";
import { createMockSupabase, inserts, updates, type Responder } from "./helpers/supabase-mock";
import { issueSessionToken } from "./helpers/session";

// Route-level tests for the bulk-actions endpoint: body validation, the
// request fetch, and per-request behavior for approve / cost_sheet_ready /
// send_to_factory, including per-request error isolation.

const REQ_A = "11111111-1111-4111-8111-111111111111";
const REQ_B = "22222222-2222-4222-8222-222222222222";

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
  return new Request("http://localhost/api/costing/requests/bulk-actions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

afterEach(() => {
  session.token = null;
  mocks.client = null;
});

// Full approve responder: one request in for_pbd_review (approves cleanly),
// one in rejected (fails the transition gate inside runCostingAction).
function approveResponder(): Responder {
  return {
    costing_requests: {
      single: (chain) => {
        const id = chain.eq?.find(([col]) => col === "id")?.[1];
        if (chain.select === "status") {
          return { data: { status: id === REQ_B ? "rejected" : "for_pbd_review" }, error: null };
        }
        if (chain.select === "pbd_pricing_status") return { data: { pbd_pricing_status: "entered" }, error: null };
        if (chain.select === "id, factory_name, baseline_ref") return { data: { id, factory_name: "Cebu Factory" }, error: null };
        if (String(chain.select).includes("nextgen_products")) {
          return {
            data: { id, factory_name: "Cebu Factory", nextgen_products: [{ style_number: "M88-123", name: "Beanie" }] },
            error: null
          };
        }
        throw new Error(`unexpected single select: ${String(chain.select)}`);
      },
      select: (chain) => {
        if (chain.payload) return { data: [{ id: REQ_A }], error: null }; // updates
        return {
          data: [
            { id: REQ_A, status: "for_pbd_review", request_number: "RQ-1" },
            { id: REQ_B, status: "rejected", request_number: "RQ-2" }
          ],
          error: null
        }; // bulk fetch
      }
    },
    validation_results: { select: () => ({ data: [], error: null }) },
    compliance_checks: { select: () => ({ data: [], error: null }) },
    approval_actions: {
      maybeSingle: () => ({ data: { metadata: { decision: "pass" } }, error: null }),
      insert: () => ({ data: [], error: null })
    },
    workflow_settings: { single: () => ({ data: { key: "manager_approval_threshold", value: "15" }, error: null }) },
    factory_cbds: {
      maybeSingle: () => ({ data: { id: "cbd-1", raw_payload: { grandTotal: 10, landedCost: 0, currency: "USD" } }, error: null })
    },
    historical_costings: {
      maybeSingle: () => ({ data: null, error: null }),
      delete: () => ({ data: [], error: null }),
      insert: () => ({ data: [], error: null })
    },
    workflow_events: { insert: () => ({ data: [], error: null }) }
  };
}

describe("POST /bulk-actions — request validation", () => {
  it("rejects an empty requestIds array", async () => {
    const { client, calls } = createMockSupabase({});
    mocks.client = client;

    const res = await POST(request({ action: "approve", requestIds: [] }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("requestIds must be a non-empty array");
    expect(calls).toHaveLength(0);
  });

  it("rejects more than 50 requests", async () => {
    const { client } = createMockSupabase({});
    mocks.client = client;

    const ids = Array.from({ length: 51 }, (_, i) => `req-${i}`);
    const res = await POST(request({ action: "approve", requestIds: ids }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Maximum 50 requests per bulk action");
  });

  it("returns 404 when no requests match", async () => {
    const { client } = createMockSupabase({
      costing_requests: { select: () => ({ data: [], error: null }) }
    });
    mocks.client = client;

    const res = await POST(request({ action: "approve", requestIds: [REQ_A] }));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("No matching requests found");
  });
});

describe("POST /bulk-actions — approve", () => {
  beforeEach(async () => {
    session.token = await issueSessionToken("pbd");
  });

  it("approves eligible requests and isolates failures per request", async () => {
    const { client, calls } = createMockSupabase(approveResponder());
    mocks.client = client;

    const res = await POST(request({ action: "approve", requestIds: [REQ_A, REQ_B] }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ action: "approve", total: 2, succeeded: 1, failed: 1 });

    const [resultA, resultB] = body.results;
    expect(resultA).toMatchObject({ id: REQ_A, ok: true, note: "Internally approved" });
    expect(resultB).toMatchObject({ id: REQ_B, ok: false });
    expect(resultB.error).toContain("not allowed from status");

    expect(inserts(calls, "approval_actions")).toHaveLength(1); // only req-a recorded
  });

  it("notes when a request is routed to manager threshold approval", async () => {
    const responder = approveResponder();
    responder.factory_cbds = {
      maybeSingle: () => ({ data: { id: "cbd-1", raw_payload: { grandTotal: 30, landedCost: 0, currency: "USD" } }, error: null })
    };
    const { client } = createMockSupabase(responder);
    mocks.client = client;

    const res = await POST(request({ action: "approve", requestIds: [REQ_A] }));
    const body = await res.json();
    expect(body.succeeded).toBe(1);
    expect(body.results[0].note).toBe("Internally approved");
  });
});

describe("POST /bulk-actions — cost_sheet_ready", () => {
  it("marks approved requests ready and skips non-approved ones", async () => {
    session.token = await issueSessionToken("costing");
    const { client, calls } = createMockSupabase({
      costing_requests: {
        select: (chain) => {
          if (chain.payload) return { data: [], error: null };
          return {
            data: [
              { id: REQ_A, status: "approved", request_number: "RQ-1" },
              { id: REQ_B, status: "for_pbd_review", request_number: "RQ-2" }
            ],
            error: null
          };
        }
      },
      workflow_events: { insert: () => ({ data: [], error: null }) }
    });
    mocks.client = client;

    const res = await POST(request({ action: "cost_sheet_ready", requestIds: [REQ_A, REQ_B] }));
    const body = await res.json();
    expect(body).toMatchObject({ total: 2, succeeded: 1, failed: 1 });
    expect(body.results[0]).toMatchObject({ id: REQ_A, ok: true });
    expect(body.results[1]).toMatchObject({ id: REQ_B, ok: false, error: "Status is for_pbd_review, must be approved" });

    expect(updates(calls, "costing_requests")[0]).toMatchObject({ cost_sheet_ready: true, cost_sheet_ready_by: "costing" });
    expect(inserts(calls, "workflow_events")[0]).toMatchObject({ event_type: "cost_sheet_ready", payload: { ready: true, bulkAction: true } });
  });

  it("rejects the whole batch when the role cannot flag cost sheets", async () => {
    session.token = await issueSessionToken("pbd");
    const { client, calls } = createMockSupabase({
      costing_requests: {
        select: () => ({
          data: [{ id: REQ_A, status: "approved", request_number: "RQ-1" }],
          error: null
        })
      }
    });
    mocks.client = client;

    const res = await POST(request({ action: "cost_sheet_ready", requestIds: [REQ_A] }));
    const body = await res.json();
    expect(body).toMatchObject({ succeeded: 0, failed: 1 });
    expect(body.results[0].error).toBe("403: Only Costing/admin can mark cost sheet ready");
    expect(updates(calls, "costing_requests")).toHaveLength(0);
  });
});

describe("POST /bulk-actions — send_to_factory", () => {
  it("sends draft requests and skips non-draft ones", async () => {
    session.token = await issueSessionToken("pbd");
    const { client, calls } = createMockSupabase({
      costing_requests: {
        select: (chain) => {
          if (chain.payload) return { data: [], error: null };
          return {
            data: [
              { id: REQ_A, status: "draft", request_number: "RQ-1" },
              { id: REQ_B, status: "approved", request_number: "RQ-2" }
            ],
            error: null
          };
        }
      },
      workflow_events: { insert: () => ({ data: [], error: null }) }
    });
    mocks.client = client;

    const res = await POST(request({ action: "send_to_factory", requestIds: [REQ_A, REQ_B] }));
    const body = await res.json();
    expect(body).toMatchObject({ total: 2, succeeded: 1, failed: 1 });
    expect(body.results[0]).toMatchObject({ id: REQ_A, ok: true });
    expect(body.results[1]).toMatchObject({ id: REQ_B, ok: false, error: "Status is approved, must be draft" });

    expect(updates(calls, "costing_requests")[0]).toMatchObject({ status: "sent_to_factory" });
    expect(inserts(calls, "approval_actions")[0]).toMatchObject({
      action: "send_to_factory",
      from_status: "draft",
      to_status: "sent_to_factory"
    });
    expect(inserts(calls, "workflow_events")[0]).toMatchObject({ event_type: "send_to_factory" });
  });

  it("rejects an unknown action for every request", async () => {
    session.token = await issueSessionToken("pbd");
    const { client } = createMockSupabase({
      costing_requests: {
        select: () => ({
          data: [{ id: REQ_A, status: "draft", request_number: "RQ-1" }],
          error: null
        })
      }
    });
    mocks.client = client;

    const res = await POST(request({ action: "explode", requestIds: [REQ_A] }));
    const body = await res.json();
    expect(body).toMatchObject({ succeeded: 0, failed: 1 });
    expect(body.results[0].error).toBe("Unknown action: explode");
  });
});
