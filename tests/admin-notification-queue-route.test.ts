import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "../src/app/api/admin/notifications/queue/route";
import { getCurrentRole } from "../src/lib/auth/roles";
import { notificationQueueSummary, requeueFailedNotifications } from "../src/lib/notifications/queue";

// The queue panel is an admin surface: it exposes delivery internals and can
// reset delivery state, so the role gate and the "no transport yet" refusal are
// the behaviors worth pinning — the requeue mechanics live in
// tests/notification-queue.test.ts.

vi.mock("@/lib/auth/roles", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/auth/roles")>()),
  getCurrentRole: vi.fn()
}));
vi.mock("@/lib/notifications/queue", () => ({
  notificationQueueSummary: vi.fn(),
  requeueFailedNotifications: vi.fn()
}));

const SUMMARY = {
  transport: "smtp" as const,
  channels: ["email", "reminder", "escalation"],
  pending: 27,
  sent: 9,
  failed: 354,
  lastError: "Email transport is not configured"
};

function post(body: unknown) {
  return new Request("http://localhost/api/admin/notifications/queue", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

beforeEach(() => {
  vi.mocked(getCurrentRole).mockReturnValue("admin");
  vi.mocked(notificationQueueSummary).mockResolvedValue(SUMMARY);
  vi.mocked(requeueFailedNotifications).mockResolvedValue({ requeued: 354, transport: "smtp", channels: ["email"] });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/admin/notifications/queue", () => {
  it.each(["pbd", "costing", "md", "factory", "viewer"] as const)("blocks the %s role before reading the queue", async (role) => {
    vi.mocked(getCurrentRole).mockReturnValue(role);

    const res = await GET();

    expect(res.status).toBe(403);
    expect(notificationQueueSummary).not.toHaveBeenCalled();
  });

  it("returns the queue summary for an admin", async () => {
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, data: SUMMARY });
  });

  it("reports a queue read failure", async () => {
    vi.mocked(notificationQueueSummary).mockRejectedValue(new Error("queue unavailable"));

    const res = await GET();

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({ ok: false, error: "queue unavailable" });
  });
});

describe("POST /api/admin/notifications/queue", () => {
  it("blocks a non-admin role before requeueing", async () => {
    vi.mocked(getCurrentRole).mockReturnValue("pbd");

    const res = await POST(post({}));

    expect(res.status).toBe(403);
    expect(requeueFailedNotifications).not.toHaveBeenCalled();
  });

  it("requeues failed notifications for an admin", async () => {
    const res = await POST(post({}));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(requeueFailedNotifications).toHaveBeenCalledWith({ force: false });
    expect(body).toMatchObject({ ok: true, requeued: 354 });
  });

  it("passes force through so rows can be parked before a transport exists", async () => {
    await POST(post({ force: true }));

    expect(requeueFailedNotifications).toHaveBeenCalledWith({ force: true });
  });

  it("refuses with the reason when no transport is configured", async () => {
    vi.mocked(requeueFailedNotifications).mockResolvedValue({
      requeued: 0,
      transport: "none",
      channels: [],
      skipped: "No email transport configured yet — failed notifications stay parked"
    });

    const res = await POST(post({}));
    const body = await res.json();

    // 409, not 200: nothing was reset and the caller must see why.
    expect(res.status).toBe(409);
    expect(body).toMatchObject({ ok: false, requeued: 0, transport: "none" });
    expect(body.error).toContain("No email transport configured yet");
  });

  it("surfaces an unexpected requeue failure", async () => {
    vi.mocked(requeueFailedNotifications).mockRejectedValue(new Error("queue down"));

    const res = await POST(post({}));

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({ ok: false, error: "queue down" });
  });
});
