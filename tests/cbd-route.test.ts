import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "../src/app/api/costing/requests/[id]/cbd/route";
import { createMockSupabase, inserts, updates } from "./helpers/supabase-mock";
import { issueSessionToken } from "./helpers/session";

// Route-level tests for the factory CBD endpoint: the role gate, body
// validation, status pre-check, and the happy path, all with a mocked Supabase
// client and a real signed session token.

const REQUEST_ID = "11111111-1111-4111-8111-111111111111";

const { session, mocks } = vi.hoisted(() => ({
  session: { token: null as string | null },
  mocks: { client: null as unknown, factoryOwnsRequest: true }
}));

vi.mock("next/headers", () => ({
  cookies: () => ({ get: () => (session.token ? { value: session.token } : undefined) })
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: () => mocks.client
}));

vi.mock("@/lib/admin/assignments", () => ({
  factoryOwnsRequest: () => Promise.resolve(mocks.factoryOwnsRequest)
}));

function request(body: unknown) {
  return new Request("http://localhost/api/costing/requests/xyz/cbd", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

const VALID_BODY = {
  status: "submitted",
  currency: "USD",
  laborCost: "2",
  overheadCost: "1",
  moq: "100",
  leadTimeDays: "30",
  materialBufferPercent: "5",
  packagingCost: "0.5",
  testingCost: "0.5",
  brandNominatedItems: "None",
  m88Packaging: "Standard",
  yarnType: "Cotton",
  knitType: "Jersey",
  machineType: "Flat knit",
  lines: [{ materialName: "Yarn", unitCost: "5", consumption: "1" }]
};

function submitResponder(requestStatus: string) {
  return {
    costing_requests: {
      single: () => ({
        data: {
          status: requestStatus,
          factory_name: "Cebu Factory",
          nextgen_products: [{ style_number: "M88-123", name: "Beanie" }]
        },
        error: null
      }),
      // The optimistic-lock status update (.update().eq().eq().select("id"))
      // returns one row when the lock is won, zero when the race is lost.
      select: () => ({ data: [{ id: REQUEST_ID }], error: null })
    },
    factory_cbds: {
      maybeSingle: () => ({ data: null, error: null }), // GET: no CBD
      single: () => ({ data: { id: "cbd-1" }, error: null }) // POST insert
    },
    historical_costings: { select: () => ({ data: [], error: null }) },
    workflow_settings: { maybeSingle: () => ({ data: null, error: null }) }
  };
}

beforeEach(async () => {
  session.token = await issueSessionToken("factory");
  mocks.factoryOwnsRequest = true;
});

afterEach(() => {
  session.token = null;
  mocks.client = null;
});

describe("factory tenant isolation", () => {
  it("rejects a factory user that does not own the request", async () => {
    const { client } = createMockSupabase({});
    mocks.client = client;
    mocks.factoryOwnsRequest = false;

    const res = await GET(new Request("http://localhost/"), { params: { id: REQUEST_ID } });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain("assigned to this Factory user");
  });
});

describe("GET /cbd", () => {
  it("returns the latest CBD", async () => {
    const { client } = createMockSupabase({
      factory_cbds: {
        maybeSingle: () => ({ data: { id: "cbd-1", status: "submitted", raw_payload: {} }, error: null })
      }
    });
    mocks.client = client;

    const res = await GET(new Request("http://localhost/"), { params: { id: REQUEST_ID } });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.id).toBe("cbd-1");
  });

  it("returns 404 when no CBD exists", async () => {
    const { client } = createMockSupabase({
      factory_cbds: { maybeSingle: () => ({ data: null, error: null }) }
    });
    mocks.client = client;

    const res = await GET(new Request("http://localhost/"), { params: { id: REQUEST_ID } });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("No CBD found");
  });
});

describe("POST /cbd", () => {
  it("rejects a non-factory role with 403", async () => {
    session.token = await issueSessionToken("pbd");
    const { client } = createMockSupabase({});
    mocks.client = client;

    const res = await POST(request(VALID_BODY), { params: { id: REQUEST_ID } });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("Current role cannot save factory CBD");
  });

  it("rejects an invalid body with 400", async () => {
    const { client } = createMockSupabase({});
    mocks.client = client;

    const res = await POST(request({ status: "explode" }), { params: { id: REQUEST_ID } });
    expect(res.status).toBe(400);
  });

  it("returns 409 when the request status does not allow submission", async () => {
    const { client } = createMockSupabase(submitResponder("draft"));
    mocks.client = client;

    const res = await POST(request(VALID_BODY), { params: { id: REQUEST_ID } });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("cannot submit CBD from status");
  });

  it("submits a clean CBD with 201 and advances the request", async () => {
    const { client, calls } = createMockSupabase(submitResponder("sent_to_factory"));
    mocks.client = client;

    const res = await POST(request(VALID_BODY), { params: { id: REQUEST_ID } });
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.data.id).toBe("cbd-1");
    expect(updates(calls, "costing_requests")[0]).toMatchObject({ status: "for_md_review" });
    expect(inserts(calls, "approval_actions")[0]).toMatchObject({
      action: "submit",
      to_status: "for_md_review",
      actor_role: "factory"
    });
  });

  it("returns 409 when a concurrent submit wins the optimistic lock", async () => {
    const responder = submitResponder("sent_to_factory");
    responder.costing_requests.select = () => ({ data: [], error: null });
    const { client } = createMockSupabase(responder);
    mocks.client = client;

    const res = await POST(request(VALID_BODY), { params: { id: REQUEST_ID } });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("request status changed");
  });
});
