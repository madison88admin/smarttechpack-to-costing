import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as listGet, POST } from "../src/app/api/comparison-sets/route";
import { GET as tokenGet } from "../src/app/api/comparison-sets/[token]/route";
import { createMockSupabase } from "./helpers/supabase-mock";
import { issueSessionToken } from "./helpers/session";

// Role-gated save/list/fetch of named comparison sets with share tokens.

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

const TOKEN = "ab".repeat(16);

const savedRow = {
  id: "set-1",
  name: "Acrylic beanies — SS27 review",
  request_id: "11111111-1111-4111-8111-111111111111",
  filters: { yarnType: "Acrylic" },
  results: [{ id: "h1", style_number: "M88-100", matchScore: 6 }],
  benchmark: { averageConsumption: 0.8 },
  share_token: TOKEN,
  created_by: "Costing Team",
  created_by_role: "costing",
  created_at: "2026-08-11T00:00:00Z"
};

beforeEach(async () => {
  session.token = await issueSessionToken("costing");
});

afterEach(() => {
  session.token = null;
  mocks.client = null;
});

function postBody(name = "My set") {
  return new Request("http://localhost/api/comparison-sets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      requestId: "11111111-1111-4111-8111-111111111111",
      filters: { yarnType: "Acrylic" },
      results: Array.from({ length: 600 }, (_, i) => ({ id: `h${i}` })),
      benchmark: { sampleSize: 1 }
    })
  });
}

describe("POST /api/comparison-sets", () => {
  it("rejects factory", async () => {
    session.token = await issueSessionToken("factory");
    const { client } = createMockSupabase({});
    mocks.client = client;
    const res = await POST(postBody());
    expect(res.status).toBe(403);
  });

  it("requires a name and a valid request id", async () => {
    const { client } = createMockSupabase({});
    mocks.client = client;
    expect((await POST(postBody("  "))).status).toBe(400);
    const badReq = new Request("http://localhost/api/comparison-sets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "x", requestId: "not-a-uuid" })
    });
    expect((await POST(badReq)).status).toBe(400);
  });

  it("saves the set with role/actor and caps results at 500", async () => {
    const { client, calls } = createMockSupabase({
      saved_comparison_sets: {
        single: () => ({ data: savedRow, error: null })
      }
    });
    mocks.client = client;

    const res = await POST(postBody());
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.set.shareToken).toBe(TOKEN);

    const insert = calls.find((c) => c.table === "saved_comparison_sets" && c.chain.payload);
    const payload = insert!.chain.payload as Record<string, unknown>;
    expect(payload.name).toBe("My set");
    expect(payload.created_by_role).toBe("costing");
    expect(payload.created_by).toBe("costing");
    expect(Array.isArray(payload.results)).toBe(true);
    expect((payload.results as unknown[]).length).toBe(500);
  });
});

describe("GET /api/comparison-sets", () => {
  it("lists saved sets for a request", async () => {
    const { client } = createMockSupabase({
      saved_comparison_sets: { select: () => ({ data: [savedRow], error: null }) }
    });
    mocks.client = client;

    const res = await listGet(new Request("http://localhost/api/comparison-sets?requestId=11111111-1111-4111-8111-111111111111"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sets).toHaveLength(1);
    expect(body.sets[0].name).toContain("SS27");
  });
});

describe("GET /api/comparison-sets/[token]", () => {
  it("rejects a malformed token", async () => {
    const { client } = createMockSupabase({});
    mocks.client = client;
    const res = await tokenGet(new Request("http://localhost/x"), { params: { token: "short" } });
    expect(res.status).toBe(400);
  });

  it("returns 404 when the token does not exist", async () => {
    const { client } = createMockSupabase({
      saved_comparison_sets: { maybeSingle: () => ({ data: null, error: null }) }
    });
    mocks.client = client;
    const res = await tokenGet(new Request("http://localhost/x"), { params: { token: TOKEN } });
    expect(res.status).toBe(404);
  });

  it("returns the shared set by token", async () => {
    const { client } = createMockSupabase({
      saved_comparison_sets: { maybeSingle: () => ({ data: savedRow, error: null }) }
    });
    mocks.client = client;

    const res = await tokenGet(new Request("http://localhost/x"), { params: { token: TOKEN } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.set.shareToken).toBe(TOKEN);
    expect(body.set.results).toHaveLength(1);
  });
});
