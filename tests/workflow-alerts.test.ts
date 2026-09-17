import { afterEach, describe, expect, it, vi } from "vitest";
import {
  bomChangedAlertBody,
  enqueueChangeAlert,
  enqueueRoleChangeAlert,
  outlierAcknowledgedAlertBody,
  pbdPricingAlertBody
} from "../src/lib/notifications/workflow-alerts";

const { mocks } = vi.hoisted(() => ({ mocks: { client: null as unknown } }));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: () => mocks.client
}));

vi.mock("@/lib/admin/settings", () => ({
  getWorkflowSettings: () =>
    Promise.resolve({ enableEmailNotifications: true, enableTeamsNotifications: false })
}));

import { createMockSupabase, inserts, type Responder } from "./helpers/supabase-mock";

afterEach(() => {
  mocks.client = null;
  delete process.env.NEXT_PUBLIC_APP_URL;
});

describe("bomChangedAlertBody", () => {
  const base = {
    requestNumber: "CR-1",
    factoryName: "Hangzhou U-Jump",
    changedCount: 2,
    fobBefore: 10,
    fobAfter: 12.5,
    currency: "USD"
  } as const;

  it("reports changed fields and the FOB delta", () => {
    const { subject, body } = bomChangedAlertBody({ ...base, changedCount: 3, ownerRole: "costing" });

    expect(subject).toContain("CR-1");
    expect(subject).toContain("3 field(s)");
    expect(body).toContain("FOB: USD 10.00 → USD 12.50 (+25.0%)");
  });

  // The copy names whoever actually owns the next step, so nobody is asked to
  // do another role's job.
  it.each([
    ["costing", "Costing re-validation required", "Next step (Costing): re-validate the revised costs before approval."],
    ["md", "MD review required", "Next step (MD): review the revised material, construction, and consumption figures."]
  ] as const)("addresses the %s lane", (ownerRole, subjectLabel, nextStepLine) => {
    const { subject, body } = bomChangedAlertBody({ ...base, ownerRole });

    expect(subject).toContain(subjectLabel);
    expect(body).toContain(nextStepLine);
    expect(body).not.toContain("Please re-validate before approval");
  });

  it("lists per-field old → new lines when changes are provided", () => {
    const { body } = bomChangedAlertBody({
      ...base,
      ownerRole: "costing",
      changes: [
        { field: "Labor Cost", oldValue: "0.75", newValue: "0.80" },
        { field: "MOQ", oldValue: "500", newValue: "1000" }
      ]
    });

    expect(body).toContain("• Labor Cost: 0.75 → 0.80");
    expect(body).toContain("• MOQ: 500 → 1000");
  });

  it("caps the field list and notes the remainder", () => {
    const changes = Array.from({ length: 10 }, (_, i) => ({
      field: `Field ${i}`,
      oldValue: "0",
      newValue: "1"
    }));
    const { body } = bomChangedAlertBody({ ...base, factoryName: null, changedCount: 10, ownerRole: "costing", changes });

    expect(body).toContain("• Field 7: 0 → 1");
    expect(body).not.toContain("• Field 8: 0 → 1");
    expect(body).toContain("…and 2 more field(s)");
  });
});

describe("outlierAcknowledgedAlertBody", () => {
  it("names the acknowledged actor, justification, and the flagged outliers", () => {
    const { subject, body } = outlierAcknowledgedAlertBody({
      acknowledgedBy: "Costing Team",
      justification: "Premium yarn drives consumption",
      flags: ["Grand total is 30.0% above historical average", "Consumption 0.45 is 25% above benchmark"]
    });

    expect(subject).toBe("Costing acknowledged outlier flags — approval gate released");
    expect(body).toContain("Acknowledged by: Costing Team");
    expect(body).toContain("Justification: Premium yarn drives consumption");
    expect(body).toContain("• Grand total is 30.0% above historical average");
    expect(body).toContain("approval gate is released");
  });

  it("omits the justification line and falls back the actor when absent", () => {
    const { subject, body } = outlierAcknowledgedAlertBody({
      acknowledgedBy: null,
      justification: null,
      flags: []
    });

    expect(subject).toContain("approval gate released");
    expect(body).toContain("Acknowledged by: Costing");
    expect(body).not.toContain("Justification:");
    expect(body).not.toContain("• ");
  });
});

describe("pbdPricingAlertBody", () => {
  it("includes the updated prices and the acting user", () => {
    const { subject, body } = pbdPricingAlertBody({
      requestNumber: "CR-2",
      factoryName: "Other Factory",
      wholesalePrice: 9.5,
      retailPrice: null,
      currency: "USD",
      changedBy: "PBD Test User"
    });

    expect(subject).toContain("PBD updated costing pricing");
    expect(body).toContain("Updated by: PBD Test User");
    expect(body).toContain("Wholesale price: USD 9.50");
    expect(body).toContain("Retail price: —");
  });

  it("shows old → new when previous prices are provided", () => {
    const { body } = pbdPricingAlertBody({
      requestNumber: "CR-2",
      factoryName: "Other Factory",
      wholesalePrice: 9.5,
      retailPrice: 18.0,
      currency: "USD",
      changedBy: "PBD Test User",
      wholesaleBefore: 8.0,
      retailBefore: null
    });

    expect(body).toContain("Wholesale price: USD 8.00 → USD 9.50");
    expect(body).toContain("Retail price: USD 18.00");
  });
});

describe("enqueueChangeAlert", () => {
  /** Recipients are resolved per role, so the responder echoes the queried role. */
  function responder(): Responder {
    return {
      user_profiles: {
        select: (chain) => {
          const role = chain.eq?.find(([column]) => column === "role")?.[1] ?? "costing";
          return {
            data: [{ email: `${role}-a@example.com` }, { email: `${role}-b@example.com` }, { email: null }],
            error: null
          };
        }
      },
      notification_queue: { insert: () => ({ data: [], error: null }) }
    };
  }

  it.each(["costing", "md"] as const)("enqueues an email per %s recipient", async (recipientRole) => {
    const { client, calls } = createMockSupabase(responder());
    mocks.client = client;
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3120";

    const enqueued = await enqueueChangeAlert({
      recipientRole,
      requestId: "req-1",
      requestNumber: "CR-1",
      factoryName: "Hangzhou U-Jump",
      subject: "[CR-1] BOM / CBD changed by factory — 3 field(s)",
      body: "body text",
      kind: "bom_changed"
    });

    expect(enqueued).toBe(2);
    const rows = inserts(calls, "notification_queue");
    expect(rows).toHaveLength(2);
    expect(rows.map((row: any) => row.recipient)).toEqual([
      `${recipientRole}-a@example.com`,
      `${recipientRole}-b@example.com`
    ]);
    for (const row of rows as any[]) {
      expect(row).toMatchObject({
        costing_request_id: "req-1",
        channel: "email",
        status: "pending",
        subject: "[CR-1] BOM / CBD changed by factory — 3 field(s)"
      });
      expect(row.body).toContain("http://localhost:3120/requests/req-1");
    }

    // The change is also surfaced as an in-app alert for the same role, so the
    // dashboard badge lands on whoever owns the next step.
    const inApp = inserts(calls, "in_app_alerts");
    expect(inApp).toHaveLength(1);
    expect(inApp[0]).toMatchObject({
      costing_request_id: "req-1",
      alert_type: "bom_changed",
      recipient_role: recipientRole,
      title: "[CR-1] BOM / CBD changed by factory — 3 field(s)"
    });
  });

  it("falls back to COSTING_NOTIFICATION_EMAIL when no costing profiles exist", async () => {
    const { client, calls } = createMockSupabase({
      user_profiles: { select: () => ({ data: [], error: null }) },
      notification_queue: { insert: () => ({ data: [], error: null }) }
    });
    mocks.client = client;
    process.env.COSTING_NOTIFICATION_EMAIL = "costing-fallback@example.com";

    const enqueued = await enqueueChangeAlert({
      recipientRole: "costing",
      requestId: "req-1",
      requestNumber: "CR-1",
      factoryName: null,
      subject: "subject",
      body: "body",
      kind: "pbd_pricing_updated"
    });

    expect(enqueued).toBe(1);
    expect((inserts(calls, "notification_queue")[0] as any).recipient).toBe(
      "costing-fallback@example.com"
    );
    expect((inserts(calls, "in_app_alerts")[0] as any).alert_type).toBe("pbd_pricing_updated");
    delete process.env.COSTING_NOTIFICATION_EMAIL;
  });

  it("stores per-field changes on the in-app payload when provided", async () => {
    const { client, calls } = createMockSupabase(responder());
    mocks.client = client;

    await enqueueChangeAlert({
      recipientRole: "costing",
      requestId: "req-1",
      requestNumber: "CR-1",
      factoryName: "Hangzhou U-Jump",
      subject: "subject",
      body: "body",
      kind: "bom_changed",
      changes: ["Labor Cost: 0.75 → 0.80"]
    });

    const inApp = inserts(calls, "in_app_alerts");
    expect(inApp).toHaveLength(1);
    expect((inApp[0] as any).payload).toEqual({
      kind: "bom_changed",
      changes: ["Labor Cost: 0.75 → 0.80"]
    });
  });

  it("never throws — a failed recipient lookup degrades to zero enqueued", async () => {
    mocks.client = { from: () => { throw new Error("boom"); } };

    const enqueued = await enqueueChangeAlert({
      recipientRole: "costing",
      requestId: "req-1",
      requestNumber: null,
      factoryName: null,
      subject: "subject",
      body: "body",
      kind: "bom_changed"
    });

    expect(enqueued).toBe(0);
  });
});

describe("enqueueRoleChangeAlert — role-scoped notifications", () => {
  function roleResponder(role: string): Responder {
    return {
      costing_requests: {
        maybeSingle: () => ({
          data: { request_number: "CR-9", factory_name: "Hangzhou U-Jump" },
          error: null
        })
      },
      user_profiles: {
        select: () => ({
          data: [{ email: `${role}-owner@example.com` }],
          error: null
        })
      },
      notification_queue: { insert: () => ({ data: [], error: null }) }
    };
  }

  it("notifies the role that owns the next step (MD on factory submit)", async () => {
    const { client, calls } = createMockSupabase(roleResponder("md"));
    mocks.client = client;

    const enqueued = await enqueueRoleChangeAlert({
      role: "md",
      requestId: "req-1",
      title: "Factory CBD submitted — MD technical review required",
      bodyLines: ["Factory: Hangzhou U-Jump", "The factory submitted the CBD."]
    });

    expect(enqueued).toBe(1);
    const rows = inserts(calls, "notification_queue");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      costing_request_id: "req-1",
      recipient: "md-owner@example.com",
      channel: "email",
      status: "pending"
    });
    expect((rows[0] as any).subject).toContain("MD technical review required");
    expect((rows[0] as any).subject).toContain("CR-9");
    expect((rows[0] as any).body).toContain("/requests/req-1");

    // MD also gets an in-app alert so it shows on their dashboard.
    const inApp = inserts(calls, "in_app_alerts");
    expect(inApp).toHaveLength(1);
    expect(inApp[0]).toMatchObject({
      costing_request_id: "req-1",
      alert_type: "role_change",
      recipient_role: "md"
    });
  });

  it("notifies PBD when costing completes validation", async () => {
    const { client, calls } = createMockSupabase(roleResponder("pbd"));
    mocks.client = client;

    const enqueued = await enqueueRoleChangeAlert({
      role: "pbd",
      requestId: "req-1",
      title: "Costing validation complete — ready for PBD review",
      bodyLines: ["Costing completed the validation checklist."]
    });

    expect(enqueued).toBe(1);
    expect((inserts(calls, "notification_queue")[0] as any).recipient).toBe("pbd-owner@example.com");
  });

  it("queries the costing_requests metadata before enqueuing", async () => {
    const { client, calls } = createMockSupabase(roleResponder("md"));
    mocks.client = client;

    await enqueueRoleChangeAlert({
      role: "md",
      requestId: "req-1",
      title: "title",
      bodyLines: []
    });

    const metadataQuery = calls.find((call) => call.table === "costing_requests" && call.terminal === "maybeSingle");
    expect(metadataQuery).toBeTruthy();
    expect(metadataQuery!.chain.eq).toEqual([["id", "req-1"]]);
  });
});
