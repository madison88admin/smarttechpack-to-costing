import { afterEach, describe, expect, it, vi } from "vitest";
import { backfillCompletedAlertBody, notifyBackfillCompleted } from "../src/lib/notifications/admin-alerts";
import { createMockSupabase, inserts, type Responder } from "./helpers/supabase-mock";

// Admin alert for the scheduled NextGen backfill: subject/body builder is pure,
// and notifyBackfillCompleted only enqueues when new values were populated.

const { mocks } = vi.hoisted(() => ({
  mocks: { client: null as unknown }
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: () => mocks.client
}));

function responder(emails: string[] = ["admin@test.local"]): Responder {
  return {
    user_profiles: {
      select: () => ({ data: emails.map((email) => ({ email })), error: null })
    }
  };
}

afterEach(() => {
  mocks.client = null;
});

describe("backfillCompletedAlertBody", () => {
  it("includes the populated count, scanned total, and status breakdown", () => {
    const { subject, body } = backfillCompletedAlertBody({
      updated: 3,
      scanned: 50,
      perStatus: [
        { status: "Dropped", total: 40 },
        { status: "Archived", total: 10 }
      ]
    });

    expect(subject).toContain("populated 3 new knitting-time / SMV value(s)");
    expect(body).toContain("found 3 historical row(s)");
    expect(body).toContain("Rows scanned: 50");
    expect(body).toContain("• Dropped: 40");
    expect(body).toContain("• Archived: 10");
  });

  it("omits the status breakdown when none is provided", () => {
    const { body } = backfillCompletedAlertBody({ updated: 1, scanned: 5 });
    expect(body).toContain("Rows scanned: 5");
    expect(body).not.toContain("Scanned per status");
  });
});

describe("notifyBackfillCompleted", () => {
  it("enqueues one email per active admin recipient when updated > 0", async () => {
    const { client, calls } = createMockSupabase(
      responder(["admin@madison88.com", "superadmin@madison88.com"])
    );
    mocks.client = client;

    const enqueued = await notifyBackfillCompleted({ updated: 2, scanned: 20 });
    expect(enqueued).toBe(2);

    const queue = inserts(calls, "notification_queue");
    expect(queue).toHaveLength(2);
    expect(queue[0]).toMatchObject({
      channel: "email",
      recipient: "admin@madison88.com",
      status: "pending"
    });
    expect(String((queue[0] as Record<string, unknown>).subject)).toContain("populated 2 new knitting-time");
  });

  it("does nothing when the run populated no values", async () => {
    const { client, calls } = createMockSupabase(responder());
    mocks.client = client;

    const enqueued = await notifyBackfillCompleted({ updated: 0, scanned: 10 });
    expect(enqueued).toBe(0);
    expect(inserts(calls, "notification_queue")).toHaveLength(0);
  });

  it("never throws when the queue insert fails", async () => {
    const { client } = createMockSupabase({
      user_profiles: {
        select: () => ({ data: [{ email: "admin@test.local" }], error: null })
      },
      notification_queue: {
        insert: () => {
          throw new Error("queue down");
        }
      }
    });
    mocks.client = client;

    const enqueued = await notifyBackfillCompleted({ updated: 1, scanned: 5 });
    expect(enqueued).toBe(0);
  });
});
