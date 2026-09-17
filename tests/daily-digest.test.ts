import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getDailyDigestData,
  renderDailyDigest,
  sendDailyDigest
} from "../src/lib/notifications/daily-digest";
import { getCbdDiff } from "../src/lib/costing/cbd-diff";

const { mocks } = vi.hoisted(() => ({ mocks: { client: null as unknown } }));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: () => mocks.client
}));

vi.mock("@/lib/costing/cbd-diff", () => ({
  getCbdDiff: vi.fn()
}));

import { createMockSupabase, inserts, type Responder } from "./helpers/supabase-mock";

const mockedGetCbdDiff = vi.mocked(getCbdDiff);

afterEach(() => {
  mocks.client = null;
  mockedGetCbdDiff.mockReset();
  delete process.env.NEXT_PUBLIC_APP_URL;
});

const EVENTS = [
  {
    id: "ev-1",
    costing_request_id: "req-1",
    event_type: "factory_submit",
    actor_role: "factory",
    created_at: "2026-08-10T01:00:00Z",
    payload: { fromStatus: "sent_to_factory", toStatus: "for_md_review", totals: { grandTotal: 8.9 } }
  },
  {
    id: "ev-2",
    costing_request_id: "req-2",
    event_type: "pbd_pricing_updated",
    actor_role: "pbd",
    created_at: "2026-08-10T02:30:00Z",
    payload: {
      pricing: { currency: "USD", wholesalePrice: 9.5, retailPrice: 19.9 },
      actorName: "PBD Test User"
    }
  }
];

function digestResponder(overrides: Partial<Responder> = {}): Responder {
  return {
    workflow_events: {
      select: () => ({ data: EVENTS, error: null })
    },
    costing_requests: {
      select: () => ({
        data: [
          { id: "req-1", request_number: "CR-1001", factory_name: "Test Factory", status: "for_md_review", customer: null, brand: null, season: null },
          { id: "req-2", request_number: "CR-1002", factory_name: "Other Factory", status: "for_pbd_review", customer: null, brand: null, season: null }
        ],
        error: null
      })
    },
    user_profiles: {
      select: () => ({ data: [{ email: "costing@example.com" }], error: null })
    },
    notification_queue: { insert: () => ({ data: [], error: null }) },
    ...overrides
  };
}

describe("getDailyDigestData", () => {
  it("builds entries for CBD submissions with FOB delta from the diff", async () => {
    mockedGetCbdDiff.mockResolvedValue({
      requestId: "req-1",
      requestNumber: "CR-1001",
      revisions: [],
      diffs: [
        [
          { fieldKey: "laborCost", field: "laborCost", section: "Header Info", oldValue: "5", newValue: "6", changed: true, changeType: "changed", deltaPercent: 20 },
          { fieldKey: "moq", field: "moq", section: "Header Info", oldValue: "500", newValue: "500", changed: false, changeType: "changed", deltaPercent: null }
        ]
      ],
      costImpacts: [
        { fobBefore: 7.8, fobAfter: 8.9, fobDelta: 1.1, fobDeltaPercent: 14.1, landedBefore: 0, landedAfter: 0, landedDelta: 0, landedDeltaPercent: 0, currency: "USD" }
      ],
      clarificationRequests: [null]
    });

    const { client } = createMockSupabase(digestResponder());
    mocks.client = client;

    const digest = await getDailyDigestData(24);

    expect(digest.entries).toHaveLength(2);
    expect(digest.distinctRequests).toBe(2);

    const submit = digest.entries.find((entry) => entry.eventType === "factory_submit")!;
    expect(submit.requestNumber).toBe("CR-1001");
    expect(submit.factoryName).toBe("Test Factory");
    expect(submit.details).toContain("FOB: USD 7.80 → USD 8.90");
    expect(submit.details).toContain("1 field(s) changed vs previous submission");

    const pricing = digest.entries.find((entry) => entry.eventType === "pbd_pricing_updated")!;
    expect(pricing.requestNumber).toBe("CR-1002");
    expect(pricing.details).toContain("Wholesale: USD 9.50");
    expect(pricing.details).toContain("Retail: USD 19.90");
  });

  it("builds a BOM-changed entry when the factory resubmit changed lines", async () => {
    const { client } = createMockSupabase(
      digestResponder({
        workflow_events: {
          select: () => ({
            data: [
              {
                id: "ev-3",
                costing_request_id: "req-1",
                event_type: "bom_changed",
                actor_role: "factory",
                created_at: "2026-08-10T03:00:00Z",
                payload: { changedCount: 4, factoryName: "Test Factory" }
              }
            ],
            error: null
          })
        }
      })
    );
    mocks.client = client;

    const digest = await getDailyDigestData(24);

    expect(digest.entries).toHaveLength(1);
    expect(digest.entries[0].eventType).toBe("bom_changed");
    expect(digest.entries[0].details).toContain("4 BOM field(s) changed");

    const text = renderDailyDigest(digest);
    expect(text).toContain("BOM CHANGES (1)");
  });

  it("returns an empty digest when no events fall in the window", async () => {
    const { client } = createMockSupabase(
      digestResponder({
        workflow_events: { select: () => ({ data: [], error: null }) }
      })
    );
    mocks.client = client;

    const digest = await getDailyDigestData(24);

    expect(digest.entries).toHaveLength(0);
    expect(digest.distinctRequests).toBe(0);
  });
});

describe("renderDailyDigest", () => {
  it("renders grouped plain-text sections", async () => {
    mockedGetCbdDiff.mockResolvedValue(null);
    const { client } = createMockSupabase(digestResponder());
    mocks.client = client;

    const digest = await getDailyDigestData(24);
    const text = renderDailyDigest(digest);

    expect(text).toContain("Smart TP Costing — Daily Change Digest");
    expect(text).toContain("CBD SUBMISSIONS (1)");
    expect(text).toContain("CR-1001 — Test Factory (for md review)");
    expect(text).toContain("PBD PRICING CHANGES (1)");
    expect(text).toContain("Wholesale: USD 9.50");
  });

  it("renders an empty-window message when there is no content", () => {
    const text = renderDailyDigest({
      windowStart: "2026-08-09T00:00:00.000Z",
      windowEnd: "2026-08-10T00:00:00.000Z",
      entries: [],
      distinctRequests: 0
    });

    expect(text).toContain("No BOM or pricing changes were recorded in this window.");
  });
});

describe("sendDailyDigest", () => {
  it("enqueues one digest email per costing recipient", async () => {
    mockedGetCbdDiff.mockResolvedValue(null);
    const { client, calls } = createMockSupabase(digestResponder());
    mocks.client = client;
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3120";

    const result = await sendDailyDigest(24);

    expect(result.ok).toBe(true);
    expect(result.enqueued).toBe(1);
    const rows = inserts(calls, "notification_queue");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      channel: "email",
      recipient: "costing@example.com",
      status: "pending"
    });
    expect((rows[0] as any).subject).toContain("2 change(s)");
    expect((rows[0] as any).body).toContain("CR-1001");
  });

  it("skips quietly when there are no changes in the window", async () => {
    const { client, calls } = createMockSupabase(
      digestResponder({
        workflow_events: { select: () => ({ data: [], error: null }) }
      })
    );
    mocks.client = client;

    const result = await sendDailyDigest(24);

    expect(result.ok).toBe(true);
    expect(result).toMatchObject({ skipped: "no changes in window", enqueued: 0 });
    expect(inserts(calls, "notification_queue")).toHaveLength(0);
  });
});
