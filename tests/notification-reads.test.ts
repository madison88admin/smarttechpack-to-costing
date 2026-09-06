import { afterEach, describe, expect, it, vi } from "vitest";
import { getReadNotificationKeys, markNotificationsRead } from "../src/lib/notifications/read-state";

const { mocks } = vi.hoisted(() => ({ mocks: { client: null as unknown } }));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: () => mocks.client
}));

import { createMockSupabase, type Responder } from "./helpers/supabase-mock";

afterEach(() => {
  mocks.client = null;
});

describe("getReadNotificationKeys", () => {
  it("returns the role's read keys as a set", async () => {
    const { client } = createMockSupabase({
      notification_reads: {
        select: () => ({
          data: [
            { notification_key: "overdue-1720000000-11111111-1111-4111-8111-111111111111" },
            { notification_key: "review-for_pbd_review-1720000000-11111111-1111-4111-8111-111111111111" }
          ],
          error: null
        })
      }
    });
    mocks.client = client;

    const keys = await getReadNotificationKeys("pbd");
    expect(keys.size).toBe(2);
    expect(keys.has("review-for_pbd_review-1720000000-11111111-1111-4111-8111-111111111111")).toBe(true);
  });

  it("returns an empty set when nothing is read", async () => {
    const { client } = createMockSupabase({
      notification_reads: { select: () => ({ data: [], error: null }) }
    });
    mocks.client = client;

    const keys = await getReadNotificationKeys("pbd");
    expect(keys.size).toBe(0);
  });

  it("rejects with the underlying message when the query fails", async () => {
    const { client } = createMockSupabase({
      notification_reads: { select: () => ({ data: null, error: { message: "boom" } }) }
    });
    mocks.client = client;

    await expect(getReadNotificationKeys("pbd")).rejects.toThrow("boom");
  });
});

describe("markNotificationsRead", () => {
  it("dedupes keys and upserts one read receipt per unique key", async () => {
    const { client, calls } = createMockSupabase({
      notification_reads: { select: () => ({ data: null, error: null }) }
    });
    mocks.client = client;

    const keyA = "overdue-1720000000-11111111-1111-4111-8111-111111111111";
    const keyB = "review-for_pbd_review-1720000000-11111111-1111-4111-8111-111111111111";

    const updated = await markNotificationsRead("pbd", [keyA, keyB, keyA, "", "  "]);

    expect(updated).toBe(2);
    const upsert = calls.find((call) => call.table === "notification_reads" && call.chain.payload);
    expect(upsert!.chain.payload).toEqual([
      { recipient_role: "pbd", notification_key: keyA },
      { recipient_role: "pbd", notification_key: keyB }
    ]);
  });

  it("returns 0 without touching the database when there are no keys", async () => {
    mocks.client = { from: () => { throw new Error("should not be called"); } };

    const updated = await markNotificationsRead("pbd", []);
    expect(updated).toBe(0);
  });

  it("rejects with the underlying message when the upsert fails", async () => {
    const { client } = createMockSupabase({
      notification_reads: { select: () => ({ data: null, error: { message: "db down" } }) }
    });
    mocks.client = client;

    await expect(markNotificationsRead("pbd", ["overdue-1-abc"])).rejects.toThrow("db down");
  });
});
