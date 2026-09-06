import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "../src/app/api/notifications/pending/route";
import { getCurrentRole, getCurrentUserId } from "../src/lib/auth/roles";
import { tryListCostingRequests } from "../src/lib/costing/requests";
import { tryGetAgingData } from "../src/lib/costing/aging";
import { resolveFactoryProfileId } from "../src/lib/admin/assignments";
import { getReadNotificationKeys } from "../src/lib/notifications/read-state";

vi.mock("@/lib/auth/roles", () => ({
  getCurrentRole: vi.fn(),
  getCurrentUserId: vi.fn()
}));
vi.mock("@/lib/costing/requests", () => ({ tryListCostingRequests: vi.fn() }));
vi.mock("@/lib/costing/aging", () => ({ tryGetAgingData: vi.fn() }));
vi.mock("@/lib/admin/assignments", () => ({ resolveFactoryProfileId: vi.fn() }));
vi.mock("@/lib/notifications/read-state", () => ({
  getReadNotificationKeys: vi.fn(),
  markNotificationsRead: vi.fn()
}));

const REQ_A = "11111111-1111-4111-8111-111111111111";
const REQ_B = "22222222-2222-4222-8222-222222222222";
const UPDATED_A = "2026-08-05T14:00:00Z";
const UPDATED_B = "2026-08-01T09:00:00Z";
const VERSION_A = Math.floor(new Date(UPDATED_A).getTime() / 1000);
const VERSION_B = Math.floor(new Date(UPDATED_B).getTime() / 1000);

type RowOverrides = Partial<{
  id: string;
  request_number: string | null;
  factory_name: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  assigned_factory_user_id: string | null;
}>;

function requestRow(overrides: RowOverrides = {}) {
  return {
    id: REQ_A,
    request_number: "CR-7001",
    factory_name: "Hangzhou U-Jump",
    status: "for_pbd_review",
    created_at: "2026-07-20T09:00:00Z",
    updated_at: UPDATED_A,
    assigned_factory_user_id: null,
    ...overrides
  } as never;
}

function emptyAging() {
  return { rows: [] as Array<{ id: string; is_overdue: boolean }>, settings: null, summary: null, error: null };
}

beforeEach(() => {
  vi.mocked(getCurrentRole).mockReturnValue("pbd");
  vi.mocked(getCurrentUserId).mockReturnValue("u-pbd");
  vi.mocked(tryListCostingRequests).mockResolvedValue({ data: [], error: null, total: 0 } as never);
  vi.mocked(tryGetAgingData).mockResolvedValue(emptyAging() as never);
  vi.mocked(getReadNotificationKeys).mockResolvedValue(new Set());
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/notifications/pending", () => {
  it("returns nothing for viewers without calling data sources", async () => {
    vi.mocked(getCurrentRole).mockReturnValue("viewer");

    const res = await GET();
    const body = await res.json();
    expect(body).toEqual({ ok: true, notifications: [], totalUnread: 0 });
    expect(tryListCostingRequests).not.toHaveBeenCalled();
  });

  it("emits review notifications with stable grouping keys and request context", async () => {
    vi.mocked(tryListCostingRequests).mockResolvedValue({
      data: [requestRow()],
      error: null,
      total: 1
    } as never);

    const res = await GET();
    const body = await res.json();

    expect(body.totalUnread).toBe(1);
    expect(body.notifications).toHaveLength(1);
    const [n] = body.notifications;
    expect(n.type).toBe("review");
    expect(n.key).toBe(`review-for_pbd_review-${VERSION_A}-${REQ_A}`);
    expect(n.requestId).toBe(REQ_A);
    expect(n.requestNumber).toBe("CR-7001");
    expect(n.status).toBe("for_pbd_review");
    expect(n.href).toBe(`/requests/${REQ_A}`);
  });

  it("filters out keys the user has already read and reports the true unread total", async () => {
    vi.mocked(tryListCostingRequests).mockResolvedValue({
      data: [
        requestRow(),
        requestRow({ id: REQ_B, request_number: "CR-7002", updated_at: UPDATED_B })
      ],
      error: null,
      total: 2
    } as never);
    vi.mocked(getReadNotificationKeys).mockResolvedValue(
      new Set([`review-for_pbd_review-${VERSION_A}-${REQ_A}`])
    );

    const res = await GET();
    const body = await res.json();

    expect(body.totalUnread).toBe(1);
    expect(body.notifications).toHaveLength(1);
    expect(body.notifications[0].requestId).toBe(REQ_B);
    expect(body.notifications[0].key).toBe(`review-for_pbd_review-${VERSION_B}-${REQ_B}`);
  });

  it("sorts SLA-breached items first and marks them urgent", async () => {
    vi.mocked(tryListCostingRequests).mockResolvedValue({
      data: [requestRow({ updated_at: UPDATED_B })],
      error: null,
      total: 1
    } as never);
    vi.mocked(tryGetAgingData).mockResolvedValue({
      ...emptyAging(),
      rows: [{ id: REQ_A, is_overdue: true }]
    } as never);

    const res = await GET();
    const body = await res.json();

    expect(body.notifications).toHaveLength(1);
    expect(body.notifications[0].type).toBe("urgent");
    expect(body.notifications[0].title).toBe("SLA Breached");
    expect(body.notifications[0].key).toBe(`overdue-${VERSION_B}-${REQ_A}`);
  });

  it("scopes the feed to requests assigned to the factory user", async () => {
    vi.mocked(getCurrentRole).mockReturnValue("factory");
    vi.mocked(resolveFactoryProfileId).mockResolvedValue("fp-1");
    vi.mocked(tryListCostingRequests).mockResolvedValue({
      data: [
        requestRow({ status: "needs_clarification", assigned_factory_user_id: "fp-1", factory_name: "Factory A" }),
        requestRow({ id: REQ_B, status: "sent_to_factory", assigned_factory_user_id: "fp-2", factory_name: "Factory B" })
      ],
      error: null,
      total: 2
    } as never);

    const res = await GET();
    const body = await res.json();

    expect(body.notifications).toHaveLength(1);
    const [n] = body.notifications;
    expect(n.requestId).toBe(REQ_A);
    expect(n.href).toBe(`/factory/${REQ_A}`);
  });
});
