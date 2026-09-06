import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../src/app/api/notifications/read/route";
import { getCurrentRole } from "../src/lib/auth/roles";
import { markNotificationsRead } from "../src/lib/notifications/read-state";
import { markInAppAlertsRead } from "../src/lib/notifications/in-app";
import {
  overdueNotificationKey,
  reviewNotificationKey,
  requestIdFromNotificationKey
} from "../src/lib/notifications/keys";

vi.mock("@/lib/auth/roles", () => ({ getCurrentRole: vi.fn() }));
vi.mock("@/lib/notifications/read-state", () => ({ markNotificationsRead: vi.fn() }));
vi.mock("@/lib/notifications/in-app", () => ({ markInAppAlertsRead: vi.fn() }));

const REQ_A = "11111111-1111-4111-8111-111111111111";
const REQ_B = "22222222-2222-4222-8222-222222222222";
const UPDATED_1 = "2026-08-05T14:00:00Z";
const UPDATED_2 = "2026-08-06T09:30:00Z";

// The shared key builders are the drift-proof source of truth for both the feed
// (emits keys) and the read routes (stores them), so the route test drives the
// re-nag semantics through them exactly like production does.
const BEFORE = { id: REQ_A, status: "for_pbd_review", updated_at: UPDATED_1 } as never;
const AFTER = { id: REQ_A, status: "for_costing_review", updated_at: UPDATED_2 } as never;
const OLD_REVIEW_KEY = reviewNotificationKey(BEFORE);
const NEW_REVIEW_KEY = reviewNotificationKey(AFTER);
const OLD_OVERDUE_KEY = overdueNotificationKey(BEFORE);
const NEW_OVERDUE_KEY = overdueNotificationKey(AFTER);

// Mirrors what the real lib does against the DB: keys land in a store the feed
// filters on, and in-app alert marking records which requests were cleared.
const readKeys = new Set<string>();
let lastUpdated: number;
let lastInAppRequestIds: string[] | undefined;
let inAppUpdated: number;

function request(body: unknown) {
  return new Request("http://localhost/api/notifications/read", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

beforeEach(() => {
  readKeys.clear();
  lastUpdated = 0;
  lastInAppRequestIds = undefined;
  inAppUpdated = 0;
  vi.mocked(getCurrentRole).mockReturnValue("pbd");
  vi.mocked(markNotificationsRead).mockImplementation(async (_role, keys) => {
    keys.forEach((key) => readKeys.add(key));
    lastUpdated = keys.length;
    return lastUpdated;
  });
  vi.mocked(markInAppAlertsRead).mockImplementation(async (_role, opts) => {
    lastInAppRequestIds = opts?.requestIds;
    inAppUpdated = opts?.requestIds?.length ?? 0;
    return inAppUpdated;
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/notifications/read", () => {
  it("rejects viewers before any work", async () => {
    vi.mocked(getCurrentRole).mockReturnValue("viewer");

    const res = await POST(request({ keys: [OLD_REVIEW_KEY] }));
    expect(res.status).toBe(401);
    expect(markNotificationsRead).not.toHaveBeenCalled();
  });

  it("rejects a non-array keys body", async () => {
    const res = await POST(request({ keys: "nope" }));
    expect(res.status).toBe(400);
    expect(markNotificationsRead).not.toHaveBeenCalled();
  });

  it("returns updated 0 without touching any store for an empty key list", async () => {
    const res = await POST(request({ keys: [] }));
    const body = await res.json();

    expect(body).toEqual({ ok: true, updated: 0, inAppUpdated: 0 });
    expect(markNotificationsRead).not.toHaveBeenCalled();
    expect(markInAppAlertsRead).not.toHaveBeenCalled();
  });

  it("marks the provided keys for the current role and reports the count", async () => {
    const res = await POST(request({ keys: [OLD_REVIEW_KEY, OLD_OVERDUE_KEY] }));
    const body = await res.json();

    expect(body).toEqual({ ok: true, updated: 2, inAppUpdated: 1 });
    expect(markNotificationsRead).toHaveBeenCalledWith("pbd", [OLD_REVIEW_KEY, OLD_OVERDUE_KEY]);
    expect(readKeys.has(OLD_REVIEW_KEY)).toBe(true);
    expect(readKeys.has(OLD_OVERDUE_KEY)).toBe(true);
  });

  it("surfaces the underlying error when marking fails", async () => {
    vi.mocked(markNotificationsRead).mockRejectedValue(new Error("read-state down"));

    const res = await POST(request({ keys: [OLD_REVIEW_KEY] }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("read-state down");
  });

  it("keeps an unchanged item dismissed: the identical key is covered by the read receipt", async () => {
    // Mark read, then the feed re-emits for the same status + updated_at.
    await POST(request({ keys: [OLD_REVIEW_KEY] }));

    const sameKey = reviewNotificationKey({ id: REQ_A, status: "for_pbd_review", updated_at: UPDATED_1 } as never);
    expect(sameKey).toBe(OLD_REVIEW_KEY);
    expect(readKeys.has(sameKey)).toBe(true);
  });

  it("re-nags after a request status change: the fresh versioned key is not covered", async () => {
    // 1. Feed emits review key for for_pbd_review @ UPDATED_1; user dismisses it.
    await POST(request({ keys: [OLD_REVIEW_KEY] }));
    expect(readKeys.has(OLD_REVIEW_KEY)).toBe(true);

    // 2. MD passes; the request moves to for_costing_review with a new
    //    updated_at, so the feed emits a different versioned key.
    expect(NEW_REVIEW_KEY).not.toBe(OLD_REVIEW_KEY);
    expect(NEW_REVIEW_KEY).toContain("for_costing_review");

    // 3. The read receipt covers only the old key, so the item re-nags.
    expect(readKeys.has(NEW_REVIEW_KEY)).toBe(false);
  });

  it("re-nags an SLA item when the request is touched: the overdue key version changes", async () => {
    await POST(request({ keys: [OLD_OVERDUE_KEY] }));
    expect(readKeys.has(OLD_OVERDUE_KEY)).toBe(true);

    // A status transition bumps updated_at, which changes the overdue key's
    // embedded version even though its prefix stays the same.
    expect(NEW_OVERDUE_KEY).not.toBe(OLD_OVERDUE_KEY);
    expect(NEW_OVERDUE_KEY.startsWith("overdue-")).toBe(true);
    expect(readKeys.has(NEW_OVERDUE_KEY)).toBe(false);
  });

  it("clears the in-app change-alert badges for the requests in the dismissed keys", async () => {
    const keyA = reviewNotificationKey({ id: REQ_A, status: "for_pbd_review", updated_at: UPDATED_1 } as never);
    const keyB = overdueNotificationKey({ id: REQ_B, updated_at: UPDATED_2 } as never);

    const res = await POST(request({ keys: [keyA, keyB] }));
    const body = await res.json();

    expect(body.inAppUpdated).toBe(2);
    expect(markInAppAlertsRead).toHaveBeenCalledWith("pbd", { requestIds: [REQ_A, REQ_B] });
    expect(lastInAppRequestIds).toEqual([REQ_A, REQ_B]);
  });

  it("dedupes request ids across keys of the same request", async () => {
    // SLA + review items for REQ_A are dismissed together — the in-app store is
    // touched once with a single request id.
    await POST(request({ keys: [OLD_OVERDUE_KEY, OLD_REVIEW_KEY] }));

    expect(markInAppAlertsRead).toHaveBeenCalledTimes(1);
    expect(lastInAppRequestIds).toEqual([REQ_A]);
  });

  it("skips in-app marking when the keys carry no request id", async () => {
    await POST(request({ keys: ["info-welcome"], }));

    expect(markInAppAlertsRead).not.toHaveBeenCalled();
  });

  it("still succeeds when in-app marking fails (best-effort)", async () => {
    vi.mocked(markInAppAlertsRead).mockRejectedValue(new Error("in-app down"));

    const res = await POST(request({ keys: [OLD_REVIEW_KEY] }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, updated: 1, inAppUpdated: 0 });
  });
});

describe("requestIdFromNotificationKey", () => {
  it("extracts the trailing uuid from review and overdue keys", () => {
    expect(requestIdFromNotificationKey(OLD_REVIEW_KEY)).toBe(REQ_A);
    expect(requestIdFromNotificationKey(OLD_OVERDUE_KEY)).toBe(REQ_A);
  });

  it("returns null for keys without a request id", () => {
    expect(requestIdFromNotificationKey("info-welcome")).toBeNull();
    expect(requestIdFromNotificationKey("")).toBeNull();
  });
});