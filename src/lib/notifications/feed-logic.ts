// Pure feed logic for the notification bell — grouping, dismiss-key selection,
// and badge rendering. Extracted out of the component so the tray's behavior is
// unit-testable without a DOM: the component and the tests share exactly this code.

export type FeedNotification = {
  id: string;
  key: string;
  type: "urgent" | "review" | "info";
  title: string;
  description: string;
  href: string;
  createdAt: string;
  requestId: string | null;
  requestNumber: string | null;
  status: string | null;
};

export type FeedGroup = {
  requestId: string;
  requestNumber: string | null;
  items: FeedNotification[];
};

/**
 * Groups notifications by request (SLA / review alerts for one request become a
 * single tray group) and orders groups: urgent groups first, then newest first.
 * Notifications without a request id land in a single "general" group.
 */
export function groupNotifications(notifications: FeedNotification[]): FeedGroup[] {
  const byRequest = new Map<string, FeedNotification[]>();
  for (const n of notifications) {
    const groupId = n.requestId ?? "general";
    const list = byRequest.get(groupId) ?? [];
    list.push(n);
    byRequest.set(groupId, list);
  }
  return [...byRequest.entries()]
    .map(([requestId, items]) => ({
      requestId,
      requestNumber: items[0]?.requestNumber ?? null,
      items
    }))
    .sort((a, b) => {
      const aUrgent = a.items.some((n) => n.type === "urgent") ? 0 : 1;
      const bUrgent = b.items.some((n) => n.type === "urgent") ? 0 : 1;
      if (aUrgent !== bUrgent) return aUrgent - bUrgent;
      const aLatest = Math.max(...a.items.map((n) => new Date(n.createdAt).getTime()));
      const bLatest = Math.max(...b.items.map((n) => new Date(n.createdAt).getTime()));
      return bLatest - aLatest;
    });
}

/**
 * The exact keys the per-request "Dismiss all" button sends to the read
 * endpoint: every item in the group, so the whole request stops nagging
 * without touching other groups.
 */
export function dismissKeysForGroup(group: FeedGroup): string[] {
  return group.items.map((n) => n.key);
}

/**
 * Badge text for the bell. `totalUnread` is the true unread count from the
 * feed — it can exceed the 20-row tray cap — while `visibleCount` is what is
 * actually rendered, so the badge disappears once the tray is empty even if a
 * server count lags behind an in-session dismiss. Returns null for no badge,
 * "99+" past 99.
 */
export function badgeLabel(totalUnread: number, visibleCount: number): string | null {
  if (visibleCount === 0) return null;
  return totalUnread > 99 ? "99+" : String(totalUnread);
}

/**
 * Next state for the bell's failed-dismissal markers. A failed write keeps the
 * item visible (the server never recorded the receipts) and adds its keys to
 * the retry set; a successful write — including a retry — clears them. Returns
 * a fresh set so the caller can pass it straight to setState.
 */
export function applyDismissResult(failed: ReadonlySet<string>, keys: string[], ok: boolean): Set<string> {
  const next = new Set(failed);
  for (const key of keys) {
    if (ok) next.delete(key);
    else next.add(key);
  }
  return next;
}

/**
 * Drops failure markers for keys no longer in the feed (dismissed on another
 * device, aged out, or a retry succeeded). Returns null when nothing changed
 * so the caller can keep its previous state reference and skip a re-render.
 */
export function pruneFailedKeys(failed: ReadonlySet<string>, visibleKeys: string[]): Set<string> | null {
  if (failed.size === 0) return null;
  const current = new Set(visibleKeys);
  const next = new Set([...failed].filter((key) => current.has(key)));
  return next.size === failed.size ? null : next;
}