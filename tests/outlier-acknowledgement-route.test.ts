import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../src/app/api/costing/requests/[id]/outlier-acknowledgement/route";
import { createMockSupabase, inserts, type Responder } from "./helpers/supabase-mock";
import { issueSessionToken } from "./helpers/session";

// Costing acknowledges high-risk outlier flags to release the PBD approval
// gate. The action is recorded in approval_actions with a snapshot of the
// flags; non-costing roles are rejected, and a no-op when nothing is blocking.

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
  return new Request(`http://localhost/api/costing/requests/${REQUEST_ID}/outlier-acknowledgement`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

// High-risk fixture: computed FOB 13 vs historical average 10 → 30% variance.
function highRiskResponder(): Responder {
  return {
    costing_requests: {
      single: (chain) => {
        if (chain.select === "id, factory_name, baseline_ref") return { data: { id: REQUEST_ID, factory_name: "Cebu Factory" }, error: null };
        if (chain.select === "status") return { data: { status: "for_pbd_review" }, error: null };
        throw new Error(`unhandled single select: ${String(chain.select)}`);
      }
    },
    factory_cbds: {
      maybeSingle: () => ({
        data: {
          id: "cbd-1",
          submitted_at: "2026-08-10T00:00:00Z",
          raw_payload: { yarnType: "100% Acrylic", knitType: "Jacquard", machineType: "7G", knittingTime: 0.45 },
          cbd_material_lines: [{ consumption: 0.2, total_cost: 13, currency: "USD", material_name: "Yarn" }]
        },
        error: null
      })
    },
    validation_results: { select: () => ({ data: [], error: null }) },
    historical_costings: {
      select: () => ({
        data: [
          {
            id: "h1",
            costing_request_id: "other-req",
            style_number: "M88-OLD",
            factory_name: "Cebu Factory",
            total_cost: 10,
            currency: "USD",
            approved_at: "2025-01-10T00:00:00Z",
            yarn_type: "100% Acrylic",
            knit_type: "Jacquard",
            machine_type: "7G",
            construction: "Rib",
            product_category: "Hats",
            average_consumption: 0.2,
            knitting_time: 0.45,
            benchmark_excluded: false
          }
        ],
        error: null
      })
    },
    approval_actions: {
      single: () => ({ data: { id: "ack-1", created_at: "2026-08-11T00:00:00Z" }, error: null })
    }
  };
}

beforeEach(async () => {
  session.token = await issueSessionToken("costing");
});

afterEach(() => {
  session.token = null;
  mocks.client = null;
});

describe("POST /outlier-acknowledgement", () => {
  it("rejects a non-costing role with 403 before any DB work", async () => {
    session.token = await issueSessionToken("factory");
    const { client, calls } = createMockSupabase({});
    mocks.client = client;

    const res = await POST(request({ comment: "ok" }), { params: { id: REQUEST_ID } });
    expect(res.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it("rejects an invalid request id", async () => {
    session.token = await issueSessionToken("costing");
    const { client } = createMockSupabase({});
    mocks.client = client;

    const res = await POST(request({}), { params: { id: "not-a-uuid" } });
    expect(res.status).toBe(400);
  });

  it("records the acknowledgment with a flag snapshot and justification", async () => {
    const { client, calls } = createMockSupabase(highRiskResponder());
    mocks.client = client;

    const res = await POST(request({ comment: "Premium yarn drives consumption" }), { params: { id: REQUEST_ID } });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.acknowledged).toBe(true);
    expect(body.flags.length).toBeGreaterThan(0);

    const ackCall = calls.find((c) => c.table === "approval_actions" && c.chain.payload);
    expect(ackCall).toBeTruthy();
    const payload = ackCall!.chain.payload as Record<string, unknown>;
    expect(payload).toMatchObject({
      costing_request_id: REQUEST_ID,
      actor_role: "costing",
      action: "outlier_acknowledged",
      from_status: "for_pbd_review",
      to_status: "for_pbd_review",
      comment: "Premium yarn drives consumption"
    });
    const metadata = payload.metadata as Record<string, unknown>;
    expect(metadata.riskLevel).toBe("high");
    expect(Array.isArray(metadata.flags)).toBe(true);
    expect((metadata.flags as string[]).join(" ")).toContain("above historical average");
  });

  it("enqueues an in-app PBD alert plus email when acknowledged", async () => {
    const responder = highRiskResponder();
    responder.costing_requests.maybeSingle = () => ({
      data: { request_number: "CR-7001", factory_name: "Cebu Factory" },
      error: null
    });
    responder.user_profiles = {
      select: () => ({ data: [{ email: "pbd@example.com" }], error: null })
    };
    const { client, calls } = createMockSupabase(responder);
    mocks.client = client;

    const res = await POST(request({ comment: "Premium yarn drives consumption" }), {
      params: { id: REQUEST_ID }
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.acknowledged).toBe(true);

    // In-app alert for PBD, type outlier_acknowledged, body carries flags + justification.
    const inApp = inserts(calls, "in_app_alerts") as Array<Record<string, unknown>>;
    expect(inApp).toHaveLength(1);
    expect(inApp[0]).toMatchObject({
      costing_request_id: REQUEST_ID,
      alert_type: "outlier_acknowledged",
      recipient_role: "pbd"
    });
    const title = String(inApp[0].title);
    const alertBody = String(inApp[0].body);
    expect(title).toContain("CR-7001");
    expect(title).toContain("approval gate released");
    expect(alertBody).toContain("Premium yarn drives consumption");
    expect(alertBody).toContain("above historical average");

    // Email enqueued to the active PBD recipients.
    const emails = (inserts(calls, "notification_queue") as Array<Record<string, unknown>>).filter(
      (p) => p.channel === "email"
    );
    expect(emails).toHaveLength(1);
    expect(emails[0]).toMatchObject({
      costing_request_id: REQUEST_ID,
      recipient: "pbd@example.com",
      status: "pending"
    });
    expect(String(emails[0].body)).toContain("View request:");
  });

  it("still acknowledges when the notification enqueue fails (best-effort)", async () => {
    const responder = highRiskResponder();
    responder.costing_requests.maybeSingle = () => ({ data: null, error: new Error("boom") });
    responder.user_profiles = {
      select: () => {
        throw new Error("recipient lookup down");
      }
    };
    const { client, calls } = createMockSupabase(responder);
    mocks.client = client;

    const res = await POST(request({ comment: "ok" }), { params: { id: REQUEST_ID } });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.acknowledged).toBe(true);
    expect(calls.filter((c) => c.table === "approval_actions" && c.chain.payload)).toHaveLength(1);
    expect(inserts(calls, "in_app_alerts")).toHaveLength(0);
  });

  it("is a no-op when no high-risk outliers are active", async () => {
    const responder = highRiskResponder();
    responder.historical_costings = { select: () => ({ data: [], error: null }) };
    const { client, calls } = createMockSupabase(responder);
    mocks.client = client;

    const res = await POST(request({ comment: "nothing to do" }), { params: { id: REQUEST_ID } });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.acknowledged).toBe(false);
    expect(body.message).toContain("No active high-risk outliers");
    expect(calls.filter((c) => c.table === "approval_actions" && c.chain.payload)).toHaveLength(0);
  });
});
