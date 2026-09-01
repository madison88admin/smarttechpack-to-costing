import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getLastOutlierAcknowledgement,
  hasValidOutlierAcknowledgement,
  isOutlierAcknowledgementValid,
  tryGetLastOutlierAcknowledgement
} from "../src/lib/costing/outlier-review";
import { createMockSupabase, type Responder } from "./helpers/supabase-mock";

// Shared read path for the last outlier acknowledgment (who, when,
// justification, flag snapshot) used by the PBD approval gate, the Costing
// acknowledgment route, and the SmartReviewPanel info box.

const { mocks } = vi.hoisted(() => ({ mocks: { client: null as unknown } }));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: () => mocks.client
}));

import { createSupabaseServiceClient } from "@/lib/supabase/server";

// The mocked factory returns the fake client at runtime while keeping the
// real SupabaseClient type, so call sites typecheck exactly like the app code.
function fakeClient() {
  return createSupabaseServiceClient();
}

afterEach(() => {
  mocks.client = null;
});

function responderWithAck(ack: unknown): Responder {
  return {
    approval_actions: {
      maybeSingle: (chain) => {
        const isOutlierAck = chain.eq?.some(([col, val]) => col === "action" && val === "outlier_acknowledged");
        if (isOutlierAck) return { data: ack, error: null };
        throw new Error("unexpected approval_actions query");
      }
    }
  };
}

describe("getLastOutlierAcknowledgement", () => {
  it("maps the acknowledgment row (actor, comment, metadata, created_at)", async () => {
    const { client, calls } = createMockSupabase(
      responderWithAck({
        id: "ack-9",
        actor_name: "Costing Team",
        actor_role: "costing",
        comment: "Premium yarn drives consumption",
        metadata: {
          riskLevel: "high",
          flags: ["Grand total is 30.0% above historical average"]
        },
        created_at: "2026-08-11T00:00:00Z"
      })
    );
    mocks.client = client;

    const ack = await getLastOutlierAcknowledgement(fakeClient(), "req-1");
    expect(ack).toEqual({
      id: "ack-9",
      actorName: "Costing Team",
      actorRole: "costing",
      justification: "Premium yarn drives consumption",
      flags: ["Grand total is 30.0% above historical average"],
      riskLevel: "high",
      acknowledgedAt: "2026-08-11T00:00:00Z"
    });

    const query = calls.find((c) => c.table === "approval_actions" && c.terminal === "maybeSingle");
    expect(query!.chain.select).toContain("actor_name");
    expect(query!.chain.eq).toEqual([
      ["costing_request_id", "req-1"],
      ["action", "outlier_acknowledged"]
    ]);
  });

  it("returns null when Costing has never acknowledged", async () => {
    const { client } = createMockSupabase(responderWithAck(null));
    mocks.client = client;
    expect(await getLastOutlierAcknowledgement(fakeClient(), "req-1")).toBeNull();
  });

  it("surfaces nulls and empty flags when the row is sparse", async () => {
    const { client } = createMockSupabase(responderWithAck({ id: "ack-1", created_at: "2026-08-11T00:00:00Z" }));
    mocks.client = client;

    const ack = await getLastOutlierAcknowledgement(fakeClient(), "req-1");
    expect(ack!.actorName).toBeNull();
    expect(ack!.justification).toBeNull();
    expect(ack!.flags).toEqual([]);
    expect(ack!.riskLevel).toBeNull();
  });

  it("tryGetLastOutlierAcknowledgement never throws", async () => {
    const { client } = createMockSupabase({
      approval_actions: {
        maybeSingle: () => {
          throw new Error("db down");
        }
      }
    });
    mocks.client = client;

    const { data, error } = await tryGetLastOutlierAcknowledgement("req-1");
    expect(data).toBeNull();
    expect(error).toContain("db down");
  });
});

describe("isOutlierAcknowledgementValid", () => {
  const ack = {
    id: "ack-1",
    actorName: "Costing Team",
    actorRole: "costing",
    justification: "ok",
    flags: [],
    riskLevel: "high",
    acknowledgedAt: "2026-08-11T00:00:00Z"
  };

  it("is valid when recorded after the latest CBD submission", () => {
    expect(isOutlierAcknowledgementValid(ack, "2026-08-10T00:00:00Z")).toBe(true);
  });

  it("is stale when the CBD was revised after the acknowledgment", () => {
    expect(isOutlierAcknowledgementValid(ack, "2026-08-12T00:00:00Z")).toBe(false);
  });

  it("accepts the acknowledgment when there is no revision timestamp", () => {
    expect(isOutlierAcknowledgementValid(ack, null)).toBe(true);
  });

  it("is invalid when there is no acknowledgment", () => {
    expect(isOutlierAcknowledgementValid(null, "2026-08-10T00:00:00Z")).toBe(false);
    expect(isOutlierAcknowledgementValid(null, null)).toBe(false);
  });
});

describe("hasValidOutlierAcknowledgement", () => {
  it("delegates to the shared read + validity logic", async () => {
    const { client } = createMockSupabase(
      responderWithAck({ id: "ack-1", created_at: "2026-08-11T00:00:00Z" })
    );
    mocks.client = client;

    expect(await hasValidOutlierAcknowledgement(fakeClient(), "req-1", "2026-08-10T00:00:00Z")).toBe(true);
    expect(await hasValidOutlierAcknowledgement(fakeClient(), "req-1", "2026-08-12T00:00:00Z")).toBe(false);
  });
});
