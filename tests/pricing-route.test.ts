import { describe, expect, it, vi } from "vitest";
import { GET } from "../src/app/api/costing/requests/[id]/pricing/route";
import { createMockSupabase } from "./helpers/supabase-mock";
import { issueSessionToken } from "./helpers/session";

// Regression: PBD pricing is internal-only. The factory supplies the cost basis
// but must never read the customer-facing selling price — neither through the
// detail page UI nor the pricing API. Viewer stays blocked too; every other
// role (internal team + admin) can read it.

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

function responder() {
  return {
    costing_requests: {
      single: () => ({
        data: {
          pbd_pricing: { wholesalePrice: 8.5, retailPrice: 14.99 },
          pbd_pricing_status: "entered",
          pbd_pricing_updated_at: "2026-01-01T00:00:00Z",
          pbd_pricing_updated_by: "pbd"
        },
        error: null
      })
    }
  };
}

async function call(role: string) {
  session.token = await issueSessionToken(role as never);
  mocks.client = createMockSupabase(responder()).client;
  const res = await GET(new Request(`http://localhost/api/costing/requests/${REQUEST_ID}/pricing`), {
    params: { id: REQUEST_ID }
  } as never);
  return { status: res.status, body: await res.json() };
}

describe("GET /api/costing/requests/[id]/pricing — role visibility", () => {
  it("blocks factory (403) — selling price is PBD-owned", async () => {
    const { status, body } = await call("factory");
    expect(status).toBe(403);
    expect(body.ok).toBe(false);
    expect(body.error).toContain("Factory");
  });

  it("blocks viewer (401)", async () => {
    const { status, body } = await call("viewer");
    expect(status).toBe(401);
    expect(body.ok).toBe(false);
  });

  it.each(["pbd", "costing", "md", "admin", "superadmin", "manager"])(
    "allows %s to read pricing",
    async (role) => {
      const { status, body } = await call(role);
      expect(status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.data.pbd_pricing_status).toBe("entered");
      expect(body.data.pbd_pricing.wholesalePrice).toBe(8.5);
    }
  );
});
