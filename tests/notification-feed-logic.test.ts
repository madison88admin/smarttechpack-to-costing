import { describe, expect, it } from "vitest";
import {
  groupNotifications,
  dismissKeysForGroup,
  badgeLabel,
  applyDismissResult,
  pruneFailedKeys,
  type FeedNotification
} from "../src/lib/notifications/feed-logic";

const REQ_A = "11111111-1111-4111-8111-111111111111";
const REQ_B = "22222222-2222-4222-8222-222222222222";

function notif(overrides: Partial<FeedNotification> & { key: string }): FeedNotification {
  return {
    id: overrides.key,
    type: "review",
    title: "For PBD Review",
    description: "CR-7001 — Hangzhou U-Jump",
    href: "/requests/11111111-1111-4111-8111-111111111111",
    createdAt: "2026-08-05T14:00:00Z",
    requestId: REQ_A,
    requestNumber: "CR-7001",
    status: "for_pbd_review",
    ...overrides
  };
}

// One request with three alerts (an SLA breach + two review items) and a second
// request with a single alert — the multi-alert group scenario.
function multiAlertFeed(): FeedNotification[] {
  return [
    notif({
      key: `overdue-1722794400-${REQ_A}`,
      type: "urgent",
      title: "SLA Breached",
      description: "CR-7001 — for pbd review",
      createdAt: "2026-08-05T14:00:00Z"
    }),
    notif({
      key: `review-for_pbd_review-1722794400-${REQ_A}`,
      createdAt: "2026-08-05T13:00:00Z"
    }),
    notif({
      key: `review-for_costing_review-1722708000-${REQ_A}`,
      title: "For Costing Review",
      status: "for_costing_review",
      createdAt: "2026-08-04T10:00:00Z"
    }),
    notif({
      key: `review-for_pbd_review-1722700000-${REQ_B}`,
      requestId: REQ_B,
      requestNumber: "CR-7002",
      description: "CR-7002 — Dongguan Knitwear",
      href: "/requests/22222222-2222-4222-8222-222222222222",
      createdAt: "2026-08-06T09:00:00Z"
    })
  ];
}

describe("groupNotifications", () => {
  it("groups multiple alerts for one request into a single group", () => {
    const groups = groupNotifications(multiAlertFeed());

    expect(groups).toHaveLength(2);
    const groupA = groups.find((g) => g.requestId === REQ_A)!;
    const groupB = groups.find((g) => g.requestId === REQ_B)!;
    expect(groupA.items).toHaveLength(3);
    expect(groupB.items).toHaveLength(1);
    expect(groupA.requestNumber).toBe("CR-7001");
  });

  it("sorts urgent groups first, then by newest alert", () => {
    const groups = groupNotifications(multiAlertFeed());

    // REQ_A carries the SLA breach → urgent group wins over REQ_B's newer review.
    expect(groups[0].requestId).toBe(REQ_A);
    expect(groups[0].items.some((n) => n.type === "urgent")).toBe(true);
  });

  it("falls back to a general group for notifications without a request id", () => {
    const groups = groupNotifications([
      notif({ key: "info-welcome", requestId: null, requestNumber: null, type: "info", title: "Welcome" })
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].requestId).toBe("general");
  });
});

describe("dismissKeysForGroup (per-request dismiss-all)", () => {
  it("returns exactly the dismissed request's keys, never another group's", () => {
    const groups = groupNotifications(multiAlertFeed());
    const groupA = groups.find((g) => g.requestId === REQ_A)!;
    const groupB = groups.find((g) => g.requestId === REQ_B)!;

    const keysA = dismissKeysForGroup(groupA);
    expect(keysA).toHaveLength(3);
    expect(keysA.every((k) => k.endsWith(`-${REQ_A}`))).toBe(true);
    expect(keysA.some((k) => k.endsWith(`-${REQ_B}`))).toBe(false);

    const keysB = dismissKeysForGroup(groupB);
    expect(keysB).toEqual([`review-for_pbd_review-1722700000-${REQ_B}`]);
  });

  it("dismissing one group leaves the other request's alerts visible", () => {
    const feed = multiAlertFeed();
    const groups = groupNotifications(feed);
    const groupA = groups.find((g) => g.requestId === REQ_A)!;

    // What the bell does on "Dismiss all": hide the group's keys, keep the rest.
    const hidden = new Set(dismissKeysForGroup(groupA));
    const visible = feed.filter((n) => !hidden.has(n.key));

    expect(visible).toHaveLength(1);
    expect(visible[0].requestId).toBe(REQ_B);
    expect(hidden.size).toBe(3);
  });
});

describe("badgeLabel (totalUnread beyond the 20-row cap)", () => {
  it("shows the true unread total when it exceeds the 20-row tray cap", () => {
    // The feed returns only 20 rows but reports 31 unread — the badge must
    // show 31, not the capped row count.
    expect(badgeLabel(31, 20)).toBe("31");
    expect(badgeLabel(31, 5)).toBe("31");
  });

  it("caps the badge at 99+", () => {
    expect(badgeLabel(100, 20)).toBe("99+");
    expect(badgeLabel(120, 20)).toBe("99+");
  });

  it("hides the badge when the tray is empty even if a server count lags", () => {
    expect(badgeLabel(31, 0)).toBeNull();
  });

  it("renders a plain count below the cap", () => {
    expect(badgeLabel(7, 7)).toBe("7");
    expect(badgeLabel(0, 0)).toBeNull();
  });
});

describe("dismiss retry markers (applyDismissResult / pruneFailedKeys)", () => {
  const KEY_1 = `review-for_pbd_review-1722794400-${REQ_A}`;
  const KEY_2 = `overdue-1722700000-${REQ_B}`;

  it("adds keys to the retry set when the dismissal write fails", () => {
    const next = applyDismissResult(new Set(), [KEY_1, KEY_2], false);
    expect(next).toEqual(new Set([KEY_1, KEY_2]));
  });

  it("clears markers when the dismissal (or a retry) succeeds", () => {
    const failed = new Set([KEY_1, KEY_2]);
    const afterOne = applyDismissResult(failed, [KEY_1], true);
    expect(afterOne).toEqual(new Set([KEY_2]));
    expect(applyDismissResult(afterOne, [KEY_2], true)).toEqual(new Set());
  });

  it("is idempotent for repeated failures and ignores unrelated keys", () => {
    const failed = new Set([KEY_1]);
    expect(applyDismissResult(failed, [KEY_1], false)).toEqual(new Set([KEY_1]));
    expect(applyDismissResult(failed, ["info-welcome"], true)).toEqual(new Set([KEY_1]));
  });

  it("prunes markers for keys no longer in the feed", () => {
    const failed = new Set([KEY_1, KEY_2]);
    expect(pruneFailedKeys(failed, [KEY_2])).toEqual(new Set([KEY_2]));
    expect(pruneFailedKeys(failed, [])).toEqual(new Set());
  });

  it("returns null when there is nothing to prune", () => {
    expect(pruneFailedKeys(new Set(), [KEY_1])).toBeNull();
    expect(pruneFailedKeys(new Set([KEY_1]), [KEY_1])).toBeNull();
  });
});