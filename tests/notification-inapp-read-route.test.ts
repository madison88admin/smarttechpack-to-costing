import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../src/app/api/notifications/in-app/read/route";
import { getCurrentRole } from "../src/lib/auth/roles";
import { markInAppAlertsRead } from "../src/lib/notifications/in-app";
import { markNotificationsRead } from "../src/lib/notifications/read-state";
import { tryListCostingRequests } from "../src/lib/costing/requests";
import { overdueNotificationKey, reviewNotificationKey } from "../src/lib/notifications/keys";

vi.mock("@/lib/auth/roles", () => ({ getCurrentRole: vi.fn() }));
vi.mock("@/lib/notifications/in-app", () => ({ markInAppAlertsRead: vi.fn() }));
vi.mock("@/lib/notifications/read-state", () => ({ markNotificationsRead: vi.fn() }));
vi.mock("@/lib/costing/requests", () => ({ tryListCostingRequests: vi.fn() }));

const REQ_A = "11111111-1111-4111-8111-111111111111";
const REQ_B = "22222222-2222-4222-8222-222222222222";
const UPDATED_A = "2026-08-05T14:00:00Z";

function row(id: string, status: string, updatedAt = UPDATED_A) {
  return { id, status, updated_at: updatedAt } as never;
}

function request(body: unknown) {
  return new Request("http://localhost/api/notifications/in-app/read", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

beforeEach(() => {
  vi.mocked(getCurrentRole).mockReturnValue("pbd");
  vi.mocked(markInAppAlertsRead).mockResolvedValue(2);
  vi.mocked(markNotificationsRead).mockImplementation(async (_role, keys) => keys.length);
  vi.mocked(tryListCostingRequests).mockResolvedValue({ data: [], error: null, total: 0 } as never);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/notifications/in-app/read", () => {
  it("rejects viewers before any work", async () => {
    vi.mocked(getCurrentRole).mockReturnValue("viewer");

    const res = await POST(request({ requestIds: [REQ_A] }));
    expect(res.status).toBe(401);
    expect(markInAppAlertsRead).not.toHaveBeenCalled();
  });

  it("marks in-app alerts and the bell receipts for the given requests", async () => {
    vi.mocked(tryListCostingRequests).mockResolvedValue({
      data: [row(REQ_A, "for_pbd_review"), row(REQ_B, "for_costing_review")],
      error: null,
      total: 2
    } as never);

    const res = await POST(request({ requestIds: [REQ_A] }));
    const body = await res.json();

    expect(body).toEqual({ ok: true, updated: 2, bellKeys: 2 });
    expect(markInAppAlertsRead).toHaveBeenCalledWith("pbd", { requestIds: [REQ_A] });

    const rowA = { id: REQ_A, status: "for_pbd_review", updated_at: UPDATED_A };
    expect(markNotificationsRead).toHaveBeenCalledWith("pbd", [
      overdueNotificationKey(rowA),
      reviewNotificationKey(rowA)
    ]);
  });

  it("marks every request's receipts when no requestIds are given (mark all read)", async () => {
    vi.mocked(tryListCostingRequests).mockResolvedValue({
      data: [row(REQ_A, "for_pbd_review"), row(REQ_B, "for_md_review")],
      error: null,
      total: 2
    } as never);

    const res = await POST(request({}));
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(markInAppAlertsRead).toHaveBeenCalledWith("pbd", { requestIds: undefined });
    const keys = vi.mocked(markNotificationsRead).mock.calls[0][1];
    expect(keys).toHaveLength(4);
    expect(keys).toContain(`overdue-${Math.floor(new Date(UPDATED_A).getTime() / 1000)}-${REQ_A}`);
    expect(keys).toContain(`review-for_md_review-${Math.floor(new Date(UPDATED_A).getTime() / 1000)}-${REQ_B}`);
  });

  it("skips bell marking when no request matches", async () => {
    vi.mocked(tryListCostingRequests).mockResolvedValue({
      data: [row(REQ_B, "for_md_review")],
      error: null,
      total: 1
    } as never);

    const res = await POST(request({ requestIds: [REQ_A] }));
    const body = await res.json();

    expect(body).toEqual({ ok: true, updated: 2, bellKeys: 0 });
    expect(markNotificationsRead).not.toHaveBeenCalled();
  });

  it("still succeeds when bell marking fails (best-effort)", async () => {
    vi.mocked(tryListCostingRequests).mockResolvedValue({
      data: [row(REQ_A, "for_pbd_review")],
      error: null,
      total: 1
    } as never);
    vi.mocked(markNotificationsRead).mockRejectedValue(new Error("read-state down"));

    const res = await POST(request({ requestIds: [REQ_A] }));
    const body = await res.json();

    expect(body).toEqual({ ok: true, updated: 2, bellKeys: 0 });
  });

  it("rejects a non-array requestIds body", async () => {
    const res = await POST(request({ requestIds: "nope" }));
    expect(res.status).toBe(400);
  });
});