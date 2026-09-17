import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../src/app/api/costing/requests/[id]/cbd/route";
import { createMockSupabase, inserts, updates, type Call, type Responder } from "./helpers/supabase-mock";
import { issueSessionToken } from "./helpers/session";

// Who gets told when a factory resubmission changes the CBD.
//
// The correction re-enters the lane that asked for it. A PBD-requested
// correction returns straight to PBD — Costing's gate already passed and never
// re-opens — so Costing must not receive a "re-validate before approval" alert
// for a revision it will never see. The other lanes do get the change alert,
// addressed (email + in-app) to the role that has to act on the new numbers,
// and PBD's handoff carries the revision summary instead.

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

vi.mock("@/lib/admin/assignments", () => ({
  factoryOwnsRequest: () => Promise.resolve(true)
}));

// Pin the revision diff so the alert decision is what is under test, not the
// diff engine (covered by its own suite).
vi.mock("@/lib/costing/cbd-diff", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/costing/cbd-diff")>()),
  getCbdDiff: () =>
    Promise.resolve({
      requestId: REQUEST_ID,
      requestNumber: "CR-77",
      revisions: [],
      diffs: [
        [
          { fieldKey: "laborCost", field: "laborCost", section: "Header Info", oldValue: "2.00", newValue: "2.40", changed: true, changeType: "changed", deltaPercent: 20 },
          { fieldKey: "moq", field: "moq", section: "Header Info", oldValue: "500", newValue: "1000", changed: true, changeType: "changed", deltaPercent: 100 },
          { fieldKey: "yarnType", field: "yarnType", section: "Header Info", oldValue: "Cotton", newValue: "Cotton", changed: false, changeType: "changed", deltaPercent: null }
        ]
      ],
      costImpacts: [
        { fobBefore: 2.98, fobAfter: 3.38, fobDelta: 0.4, fobDeltaPercent: 13.4, landedBefore: 0, landedAfter: 0, landedDelta: 0, landedDeltaPercent: 0, currency: "USD" }
      ],
      clarificationRequests: []
    })
}));

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

/** Approval trail rows that decide which lane the correction returns to. */
const TRAILS = {
  "PBD-requested (Costing already completed)": [
    { action: "costing_complete", to_status: "for_pbd_review", metadata: {}, created_at: "2026-09-01T00:00:00Z" },
    { action: "md_review", to_status: "for_costing_review", metadata: { decision: "pass" }, created_at: "2026-08-30T00:00:00Z" },
    { action: "clarify", to_status: "needs_clarification", metadata: {}, created_at: "2026-09-02T00:00:00Z" }
  ],
  "Costing-requested": [
    { action: "md_review", to_status: "for_costing_review", metadata: { decision: "pass" }, created_at: "2026-08-30T00:00:00Z" },
    { action: "costing_clarify", to_status: "needs_clarification", metadata: {}, created_at: "2026-09-02T00:00:00Z" }
  ],
  "MD-requested": [
    { action: "md_review", to_status: "needs_clarification", metadata: { decision: "needs_clarification" }, created_at: "2026-08-30T00:00:00Z" }
  ]
} as const;

function responder(trail: ReadonlyArray<Record<string, unknown>>): Responder {
  return {
    costing_requests: {
      single: () => ({
        data: { status: "needs_clarification", factory_name: "Hangzhou U-Jump", nextgen_products: [{ style_number: "M88-123", name: "Beanie" }] },
        error: null
      }),
      // Optimistic-lock update wins the race.
      select: () => ({ data: [{ id: REQUEST_ID }], error: null }),
      // Metadata lookup behind the role handoff alert.
      maybeSingle: () => ({ data: { request_number: "CR-77", factory_name: "Hangzhou U-Jump" }, error: null })
    },
    approval_actions: {
      select: () => ({ data: trail, error: null }),
      insert: () => ({ data: [], error: null })
    },
    factory_cbds: {
      single: () => ({ data: { id: "cbd-1" }, error: null }),
      insert: () => ({ data: { id: "cbd-1" }, error: null })
    },
    user_profiles: {
      select: (chain) => ({
        data: [{ email: `${chain.eq?.find(([column]) => column === "role")?.[1] ?? "unknown"}@example.com` }],
        error: null
      })
    },
    historical_costings: { select: () => ({ data: [], error: null }) },
    workflow_settings: { maybeSingle: () => ({ data: null, error: null }) }
  };
}

function submit() {
  return POST(new Request("http://localhost/api/costing/requests/x/cbd", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(VALID_BODY)
  }), { params: { id: REQUEST_ID } });
}

/** Emails enqueued for a change alert, with the subject that was written for them. */
function changeAlertEmails(calls: Call[]) {
  return inserts(calls, "notification_queue").filter((row) =>
    String((row as { subject?: string }).subject ?? "").includes("BOM / CBD changed")
  ) as Array<{ recipient: string; subject: string; body: string }>;
}

function inAppChangeAlerts(calls: Call[]) {
  return inserts(calls, "in_app_alerts").filter((row) => (row as { alert_type?: string }).alert_type === "bom_changed") as Array<Record<string, unknown>>;
}

/** The lane the submit handed off to, read from the optimistic-lock update. */
function handedOffTo(calls: Call[]) {
  return (updates(calls, "costing_requests")[0] as { status?: string } | undefined)?.status;
}

beforeEach(async () => {
  session.token = await issueSessionToken("factory");
});

afterEach(() => {
  session.token = null;
  mocks.client = null;
  vi.clearAllMocks();
});

describe("factory resubmit alerts", () => {
  it("sends no change alert when the correction returns straight to PBD", async () => {
    const { client, calls } = createMockSupabase(responder(TRAILS["PBD-requested (Costing already completed)"]));
    mocks.client = client;

    const res = await submit();
    expect(res.status).toBe(201);
    expect(handedOffTo(calls)).toBe("for_pbd_review");

    // Costing is out of the loop for this revision: no email, no in-app badge.
    expect(changeAlertEmails(calls)).toHaveLength(0);
    expect(inAppChangeAlerts(calls)).toHaveLength(0);
    expect(inserts(calls, "notification_queue").some((row) => String((row as { recipient?: string }).recipient ?? "").startsWith("costing@"))).toBe(false);
  });

  it("hands the change summary to PBD instead of dropping it", async () => {
    const { client, calls } = createMockSupabase(responder(TRAILS["PBD-requested (Costing already completed)"]));
    mocks.client = client;

    await submit();

    const pbd = inserts(calls, "notification_queue").find((row) => (row as { recipient?: string }).recipient === "pbd@example.com") as
      | { subject: string; body: string }
      | undefined;
    expect(pbd).toBeTruthy();
    expect(pbd!.subject).toContain("PBD review required");
    expect(pbd!.body).toContain("Changed fields: 2");
    expect(pbd!.body).toContain("FOB: USD 2.98 → USD 3.38");
  });

  it("records the change once, without a second queue fan-out of the same event", async () => {
    const { client, calls } = createMockSupabase(responder(TRAILS["PBD-requested (Costing already completed)"]));
    mocks.client = client;

    await submit();

    const events = inserts(calls, "workflow_events").filter((row) => (row as { event_type?: string }).event_type === "bom_changed");
    expect(events).toHaveLength(1);
    // The submit path notified PBD itself, so the generic fan-out is skipped —
    // otherwise an owner-agnostic copy of the same news goes out behind it.
    expect(events[0]).toMatchObject({ notification_status: "skipped" });
  });

  it("addresses the change alert to Costing when Costing requested the correction", async () => {
    const { client, calls } = createMockSupabase(responder(TRAILS["Costing-requested"]));
    mocks.client = client;

    const res = await submit();
    expect(res.status).toBe(201);
    expect(handedOffTo(calls)).toBe("for_costing_review");

    const emails = changeAlertEmails(calls);
    expect(emails).toHaveLength(1);
    expect(emails[0].recipient).toBe("costing@example.com");
    expect(emails[0].subject).toContain("Costing re-validation required");
    expect(emails[0].body).toContain("Next step (Costing): re-validate the revised costs before approval.");
    expect(emails[0].body).toContain("• Labor Cost: 2.00 → 2.40");

    // The dashboard badge lands on the same role as the email.
    expect(inAppChangeAlerts(calls)).toEqual([
      expect.objectContaining({ recipient_role: "costing", alert_type: "bom_changed" })
    ]);
  });

  it("addresses the change alert to MD when the request is still in MD review", async () => {
    const { client, calls } = createMockSupabase(responder(TRAILS["MD-requested"]));
    mocks.client = client;

    const res = await submit();
    expect(res.status).toBe(201);
    expect(handedOffTo(calls)).toBe("for_md_review");

    const emails = changeAlertEmails(calls);
    expect(emails).toHaveLength(1);
    expect(emails[0].recipient).toBe("md@example.com");
    expect(emails[0].body).toContain("Next step (MD): review the revised material, construction, and consumption figures.");
    // MD is never asked to re-validate costing.
    expect(emails[0].body).not.toContain("re-validate the revised costs");
    expect(inAppChangeAlerts(calls)).toEqual([expect.objectContaining({ recipient_role: "md" })]);
  });
});
