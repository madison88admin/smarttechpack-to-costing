import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../src/app/api/costing/requests/[id]/md-review/route";
import { createMockSupabase, inserts, type Responder } from "./helpers/supabase-mock";
import { issueSessionToken } from "./helpers/session";

// MD technical review notifications: a passing review releases the request to
// Costing validation (costing is notified), a needs_clarification decision
// sends it back to the factory queue (factory is notified). Both are
// best-effort — a notification failure must never fail the review itself.

const REQUEST_ID = "22222222-2222-4222-8222-222222222222";

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
  return new Request(`http://localhost/api/costing/requests/${REQUEST_ID}/md-review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

function mdReviewResponder(overrides: Partial<Responder> = {}): Responder {
  return {
    costing_requests: {
      single: () => ({ data: { status: "for_md_review" }, error: null }),
      select: () => ({ data: [{ id: REQUEST_ID }], error: null }),
      maybeSingle: () => ({ data: { request_number: "CR-7003", factory_name: "Cebu Factory" }, error: null })
    },
    user_profiles: { select: () => ({ data: [{ email: "factory@example.com" }], error: null }) },
    workflow_settings: { maybeSingle: () => ({ data: { value: {} }, error: null }) },
    approval_actions: { insert: () => ({ data: [], error: null }) },
    workflow_events: { insert: () => ({ data: [], error: null }) },
    ...overrides
  };
}

beforeEach(async () => {
  session.token = await issueSessionToken("md");
});

afterEach(() => {
  session.token = null;
  mocks.client = null;
});

describe("POST /md-review — notifications", () => {
  it("rejects a non-MD role with 403 before any DB work", async () => {
    session.token = await issueSessionToken("factory");
    const { client, calls } = createMockSupabase({});
    mocks.client = client;

    const res = await POST(request({ decision: "pass" }), { params: { id: REQUEST_ID } });
    expect(res.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it("rejects an invalid request id", async () => {
    const { client } = createMockSupabase({});
    mocks.client = client;

    const res = await POST(request({ decision: "pass" }), { params: { id: "not-a-uuid" } });
    expect(res.status).toBe(400);
  });

  it("rejects needs_clarification without notes", async () => {
    const { client, calls } = createMockSupabase(mdReviewResponder());
    mocks.client = client;

    const res = await POST(request({ decision: "needs_clarification", notes: "" }), {
      params: { id: REQUEST_ID }
    });
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("returns 409 when the request is not awaiting MD review", async () => {
    const responder = mdReviewResponder();
    responder.costing_requests = {
      ...(responder.costing_requests as Record<string, unknown>),
      single: () => ({ data: { status: "for_pbd_review" }, error: null })
    };
    const { client } = createMockSupabase(responder);
    mocks.client = client;

    const res = await POST(request({ decision: "pass" }), { params: { id: REQUEST_ID } });
    expect(res.status).toBe(409);
  });

  it("advances to for_costing_review on pass and notifies Costing", async () => {
    const responder = mdReviewResponder();
    responder.user_profiles = { select: () => ({ data: [{ email: "costing@example.com" }], error: null }) };
    const { client, calls } = createMockSupabase(responder);
    mocks.client = client;

    const res = await POST(request({ decision: "pass", notes: "Machine check OK" }), {
      params: { id: REQUEST_ID }
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.status).toBe("for_costing_review");

    // In-app alert for Costing — the next owner — carrying the review notes.
    const inApp = inserts(calls, "in_app_alerts") as Array<Record<string, unknown>>;
    expect(inApp).toHaveLength(1);
    expect(inApp[0]).toMatchObject({ recipient_role: "costing", alert_type: "role_change" });
    expect(String(inApp[0].title)).toContain("MD technical review passed");
    expect(String(inApp[0].body)).toContain("Machine check OK");

    const emails = (inserts(calls, "notification_queue") as Array<Record<string, unknown>>).filter(
      (p) => p.channel === "email"
    );
    expect(emails).toHaveLength(1);
    expect(emails[0]).toMatchObject({ recipient: "costing@example.com", status: "pending" });
  });

  it("sends a clarification back to needs_clarification and notifies the factory", async () => {
    const { client, calls } = createMockSupabase(mdReviewResponder());
    mocks.client = client;

    const res = await POST(request({ decision: "needs_clarification", notes: "Yarn count mismatches sample" }), {
      params: { id: REQUEST_ID }
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.status).toBe("needs_clarification");

    const inApp = inserts(calls, "in_app_alerts") as Array<Record<string, unknown>>;
    expect(inApp).toHaveLength(1);
    expect(inApp[0]).toMatchObject({ recipient_role: "factory", alert_type: "role_change" });
    expect(String(inApp[0].title)).toContain("MD requested clarification");
    expect(String(inApp[0].body)).toContain("Yarn count mismatches sample");

    const emails = (inserts(calls, "notification_queue") as Array<Record<string, unknown>>).filter(
      (p) => p.channel === "email"
    );
    expect(emails).toHaveLength(1);
    expect(emails[0]).toMatchObject({ recipient: "factory@example.com", status: "pending" });
  });

  it("still records the review when the notification enqueue fails (best-effort)", async () => {
    const responder = mdReviewResponder();
    responder.user_profiles = {
      select: () => {
        throw new Error("recipient lookup down");
      }
    };
    const { client, calls } = createMockSupabase(responder);
    mocks.client = client;

    const res = await POST(request({ decision: "pass" }), { params: { id: REQUEST_ID } });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.status).toBe("for_costing_review");
    expect(inserts(calls, "in_app_alerts")).toHaveLength(0);
    expect(calls.filter((c) => c.table === "approval_actions" && c.chain.payload)).toHaveLength(1);
  });
});
