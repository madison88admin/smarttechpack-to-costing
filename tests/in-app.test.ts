import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getUnreadInAppAlerts,
  markInAppAlertsRead,
  recordInAppAlert,
  tryGetUnreadInAppAlerts
} from "../src/lib/notifications/in-app";

const { mocks } = vi.hoisted(() => ({ mocks: { client: null as unknown } }));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: () => mocks.client
}));

import { createMockSupabase, inserts, type Responder } from "./helpers/supabase-mock";

afterEach(() => {
  mocks.client = null;
});

const ALERT_ROW = {
  id: "alert-1",
  costing_request_id: "req-1",
  alert_type: "bom_changed",
  recipient_role: "costing",
  title: "[CR-1] BOM / CBD changed by factory — 3 field(s)",
  body: "FOB: USD 10.00 → USD 12.50",
  payload: { kind: "bom_changed" },
  created_at: "2026-08-10T01:00:00Z",
  costing_requests: { request_number: "CR-1", factory_name: "Hangzhou U-Jump", status: "for_md_review" }
};

function responder(overrides: Partial<Responder> = {}): Responder {
  return {
    in_app_alerts: {
      select: () => ({ data: [ALERT_ROW], error: null }),
      insert: () => ({ data: [], error: null }),
      update: () => ({ data: [{ id: "alert-1" }], error: null })
    },
    ...overrides
  };
}

describe("recordInAppAlert", () => {
  it("inserts an alert row for the recipient role", async () => {
    const { client, calls } = createMockSupabase(responder());
    mocks.client = client;

    const ok = await recordInAppAlert({
      requestId: "req-1",
      alertType: "pbd_pricing_updated",
      recipientRole: "costing",
      title: "[CR-1] PBD updated costing pricing",
      body: "Wholesale: USD 9.50",
      payload: { kind: "pbd_pricing_updated" }
    });

    expect(ok).toBe(true);
    const rows = inserts(calls, "in_app_alerts");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      costing_request_id: "req-1",
      alert_type: "pbd_pricing_updated",
      recipient_role: "costing",
      title: "[CR-1] PBD updated costing pricing"
    });
  });

  it("never throws — returns false when the insert fails", async () => {
    mocks.client = { from: () => { throw new Error("boom"); } };

    const ok = await recordInAppAlert({
      requestId: "req-1",
      alertType: "bom_changed",
      recipientRole: "costing",
      title: "title"
    });

    expect(ok).toBe(false);
  });
});

describe("getUnreadInAppAlerts", () => {
  it("returns unread alerts with embedded request info and per-request counts", async () => {
    const { client, calls } = createMockSupabase(
      responder({
        in_app_alerts: {
          select: () => ({
            data: [
              ALERT_ROW,
              { ...ALERT_ROW, id: "alert-2", alert_type: "pbd_pricing_updated", costing_request_id: "req-2", costing_requests: { request_number: "CR-2", factory_name: "Other", status: "for_pbd_review" } }
            ],
            error: null
          })
        }
      })
    );
    mocks.client = client;

    const summary = await getUnreadInAppAlerts("costing");

    expect(summary.totalUnread).toBe(2);
    expect(summary.alerts[0].requestNumber).toBe("CR-1");
    expect(summary.alerts[0].factoryName).toBe("Hangzhou U-Jump");
    expect(summary.perRequest).toEqual({ "req-1": 1, "req-2": 1 });

    const query = calls.find((call) => call.table === "in_app_alerts" && call.terminal === "select");
    expect(query!.chain.eq).toEqual([["recipient_role", "costing"]]);
    expect(query!.chain.is).toEqual([["read_at", null]]);
  });

  it("scopes to a single request when requestId is provided", async () => {
    const { client, calls } = createMockSupabase(responder());
    mocks.client = client;

    await getUnreadInAppAlerts("costing", { requestId: "req-1" });

    const query = calls.find((call) => call.table === "in_app_alerts" && call.terminal === "select");
    expect(query!.chain.eq).toEqual([
      ["recipient_role", "costing"],
      ["costing_request_id", "req-1"] // unquoted — quoting never matches on this server
    ]);
  });

  it("returns an empty summary when there are no rows", async () => {
    const { client } = createMockSupabase(
      responder({ in_app_alerts: { select: () => ({ data: [], error: null }) } })
    );
    mocks.client = client;

    const summary = await getUnreadInAppAlerts("costing");
    expect(summary.totalUnread).toBe(0);
    expect(summary.perRequest).toEqual({});
  });
});

describe("markInAppAlertsRead", () => {
  it("marks only the given requests read", async () => {
    const { client, calls } = createMockSupabase(responder());
    mocks.client = client;

    const updated = await markInAppAlertsRead("costing", { requestIds: ["req-1"] });

    expect(updated).toBe(1);
    const update = calls.find((call) => call.table === "in_app_alerts" && call.chain.payload);
    expect(update!.chain.payload).toMatchObject({ read_at: expect.any(String) });
    expect(update!.chain.eq).toEqual([["recipient_role", "costing"]]);
    expect(update!.chain.is).toEqual([["read_at", null]]);
    expect(update!.chain.in).toEqual([["costing_request_id", ["req-1"]]]);
  });

  it("marks all alerts read for the role when no request ids are given", async () => {
    const { client, calls } = createMockSupabase(responder());
    mocks.client = client;

    const updated = await markInAppAlertsRead("costing");

    expect(updated).toBe(1);
    const update = calls.find((call) => call.table === "in_app_alerts" && call.chain.payload);
    expect(update!.chain.in).toBeUndefined();
  });
});

describe("tryGetUnreadInAppAlerts", () => {
  it("surfaces the error instead of throwing", async () => {
    mocks.client = { from: () => { throw new Error("boom"); } };

    const result = await tryGetUnreadInAppAlerts("costing");
    expect(result.error).toContain("boom");
    expect(result.data).toBeNull();
  });
});
