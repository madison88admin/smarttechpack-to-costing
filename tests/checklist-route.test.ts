import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../src/app/api/costing/requests/[id]/checklist/route";
import { issueSessionToken } from "./helpers/session";

// The costing checklist IS the Costing validation verdict, so the route must
// carry the lane's separation of duties. Regression: it only refused `viewer`,
// so PBD and MD could write Costing's verdicts (found live in the role matrix).
// The real roles module is exercised here — no role stub — so the guard under
// test is the one production uses, driven by a genuinely signed session cookie.

const REQUEST_ID = "11111111-1111-4111-8111-111111111111";

const { session, mocks } = vi.hoisted(() => ({
  session: { token: null as string | null },
  mocks: { upserted: null as unknown }
}));

vi.mock("next/headers", () => ({
  cookies: () => ({ get: () => (session.token ? { value: session.token } : undefined) })
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: () => ({
    from: (table: string) => ({
      upsert: (payload: unknown) => {
        if (table !== "request_checklist_results") throw new Error(`unexpected table ${table}`);
        mocks.upserted = payload;
        return { error: null };
      }
    })
  })
}));

const post = (body: unknown) =>
  POST(
    new Request(`http://localhost/api/costing/requests/${REQUEST_ID}/checklist`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }),
    { params: { id: REQUEST_ID } }
  );

const CHECKLIST = {
  items: [
    { code: "moq_checked", isChecked: true },
    { code: "lead_time_checked", isChecked: true },
    { code: "packaging_checked", isChecked: true },
    { code: "comparable_style_reviewed", isChecked: true }
  ]
};

beforeEach(() => {
  mocks.upserted = null;
});

afterEach(() => {
  session.token = null;
});

describe("POST /checklist — Costing-owned, enforced server-side", () => {
  it.each(["pbd", "md", "factory", "viewer"] as const)("refuses the %s role with 403 and writes nothing", async (role) => {
    session.token = await issueSessionToken(role);
    const res = await post(CHECKLIST);
    expect(res.status).toBe(403);
    expect(mocks.upserted).toBeNull();
  });

  it.each(["costing", "admin", "superadmin"] as const)("accepts the %s role and persists the verdict", async (role) => {
    session.token = await issueSessionToken(role);
    const res = await post(CHECKLIST);
    expect(res.status).toBe(200);
    const rows = mocks.upserted as Array<{ checklist_code: string; checked_by_role: string }>;
    expect(rows).toHaveLength(4);
    expect(rows.every((row) => row.checked_by_role === role)).toBe(true);
  });

  it("still rejects a malformed body before writing", async () => {
    session.token = await issueSessionToken("costing");
    const res = await post({ items: "nope" });
    expect(res.status).toBe(400);
    expect(mocks.upserted).toBeNull();
  });
});
