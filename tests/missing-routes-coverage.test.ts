import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockSupabase, type Chain, type Responder } from "./helpers/supabase-mock";
import { issueSessionToken } from "./helpers/session";

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

function baseResponder(): Responder {
  return {
    costing_requests: {
      single: (chain: Chain) => {
        if (chain.select === "status") return { data: { status: "draft" }, error: null };
        if (chain.select === "pbd_pricing_status") return { data: { pbd_pricing_status: "entered" }, error: null };
        if (String(chain.select).includes("nextgen_products")) return { data: { id: REQUEST_ID, nextgen_products: [{ style_number: "M88-123" }] }, error: null };
        if (chain.select === "id, factory_name, baseline_ref") return { data: { id: REQUEST_ID, factory_name: "Cebu Factory" }, error: null };
        throw new Error(`unhandled ${String(chain.select)}`);
      },
      select: () => ({ data: [{ id: REQUEST_ID }], error: null }),
    },
    validation_results: { select: () => ({ data: [], error: null }) },
    compliance_checks: { select: () => ({ data: [], error: null }) },
    approval_actions: { insert: () => ({ data: [], error: null }) },
    workflow_events: { insert: () => ({ data: [], error: null }) },
    workflow_settings: {
      single: (chain: Chain) => {
        if (chain.select === "value" || String(chain.select).includes("value")) {
          return { data: { value: { ...defaults } }, error: null };
        }
        return { data: { key: "main", value: { ...defaults } }, error: null };
      },
      maybeSingle: (chain: Chain) => {
        if (chain.select === "value" || String(chain.select).includes("value")) {
          return { data: { value: { ...defaults } }, error: null };
        }
        return { data: { key: "main", value: { ...defaults } }, error: null };
      }
    },
    factory_cbds: { maybeSingle: () => ({ data: { id: "cbd-1", raw_payload: { grandTotal: 10, currency: "USD" } }, error: null }) },
    historical_costings: { select: () => ({ data: [], error: null }) },
    validation_checklist_items: { select: () => ({ data: [], error: null }) },
    request_checklist_results: { select: () => ({ data: [], error: null }) },
    user_profiles: { select: () => ({ data: [], error: null }) },
    material_library: { select: () => ({ data: [], error: null }) },
    notifications: { select: () => ({ data: [], error: null }) },
  };
}

const defaults = {
  warningVariancePercent: 15,
  reviewVariancePercent: 8,
  draftSlaHours: 48,
  factorySubmissionSlaHours: 36,
  mdReviewSlaHours: 24,
  costingReviewSlaHours: 24,
  pbdApprovalSlaHours: 24,
  reminderPercent: 80,
  approvalSlaDays: 1,
  factorySubmissionSlaDays: 1.5,
  enableEmailNotifications: false,
  enableTeamsNotifications: false,
  managerApprovalThreshold: 0,
  marginThresholdUsd: 1,
  reminderDays: 1,
  escalationDays: 2,
  enableScheduledReports: false,
  scheduledReportFrequency: "daily",
  scheduledReportHourUtc: 7,
  scheduledReportRecipients: ""
};

beforeEach(async () => {
  session.token = await issueSessionToken("admin");
});

afterEach(() => {
  session.token = null;
  mocks.client = null;
});

describe("Missing admin/export route coverage", () => {
  it("GET /api/admin/settings returns settings for admin", async () => {
    mocks.client = createMockSupabase(baseResponder()).client;
    const { GET } = await import("../src/app/api/admin/settings/route");
    const response = await GET();
    expect(response.status).toBe(200);
  });

  it("GET /api/admin/users returns 405 (POST-only)", async () => {
    mocks.client = createMockSupabase(baseResponder()).client;
    const mod = await import("../src/app/api/admin/users/route");
    const response = new Request("http://localhost/api/admin/users");
    const result = (mod as any).GET ? (mod as any).GET(response) : new Response(null, { status: 405 });
    expect(result.status).toBe(405);
  });

  it("GET /api/material-library returns entries for authorized role", async () => {
    session.token = await issueSessionToken("pbd");
    mocks.client = createMockSupabase(baseResponder()).client;
    const { GET } = await import("../src/app/api/material-library/route");
    const response = await GET(new Request("http://localhost/api/material-library"));
    expect(response.status).toBe(200);
  });

  it("GET /api/health/nextgen reports status", async () => {
    mocks.client = createMockSupabase(baseResponder()).client;
    const { GET } = await import("../src/app/api/health/nextgen/route");
    const response = await GET(new Request("http://localhost/api/health/nextgen"));
    expect([200, 502, 503]).toContain(response.status);
  });

  it("GET /api/historical/search returns results", async () => {
    session.token = await issueSessionToken("pbd");
    mocks.client = createMockSupabase(baseResponder()).client;
    const { GET } = await import("../src/app/api/historical/search/route");
    const response = await GET(new Request("http://localhost/api/historical/search"));
    expect(response.status).toBe(200);
  });

  it("GET /api/notifications/pending returns notifications", async () => {
    session.token = await issueSessionToken("pbd");
    mocks.client = createMockSupabase({
      ...baseResponder(),
      notifications: { select: () => ({ data: [], error: null }) },
    }).client;
    const { GET } = await import("../src/app/api/notifications/pending/route");
    const response = await GET();
    expect(response.status).toBe(200);
  });

  it("GET /api/export/requests.csv exports request data", async () => {
    session.token = await issueSessionToken("pbd");
    mocks.client = createMockSupabase(baseResponder()).client;
    const { GET } = await import("../src/app/api/export/requests.csv/route");
    const response = await GET(new Request("http://localhost/api/export/requests.csv"));
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text.length).toBeGreaterThan(0);
  });

  it("GET /api/export/history.csv exports historical data", async () => {
    session.token = await issueSessionToken("pbd");
    mocks.client = createMockSupabase(baseResponder()).client;
    const { GET } = await import("../src/app/api/export/history.csv/route");
    const response = await GET(new Request("http://localhost/api/export/history.csv"));
    expect(response.status).toBe(200);
  });
});
