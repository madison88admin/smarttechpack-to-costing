// Shared notification key builders.
//
// The derived notification feed (/api/notifications/pending) emits one stable
// key per role + request + situation. Both the feed and the mark-read routes
// must build identical keys so that viewing a request (or clearing the
// dashboard change alerts) marks exactly the same receipts the bell filters
// on. The request's updated_at is embedded (second precision): an item that
// sits unchanged stays dismissed after being read, while any status change or
// request touch produces a fresh key and re-nags.

export function notificationKeyVersion(updatedAt: string | null | undefined): string {
  if (!updatedAt) return "";
  const ms = new Date(updatedAt).getTime();
  return Number.isFinite(ms) ? `-${Math.floor(ms / 1000)}` : "";
}

export function overdueNotificationKey(row: { id: string; updated_at?: string | null }): string {
  return `overdue${notificationKeyVersion(row.updated_at)}-${row.id}`;
}

export function reviewNotificationKey(row: { id: string; status: string; updated_at?: string | null }): string {
  return `review-${row.status}${notificationKeyVersion(row.updated_at)}-${row.id}`;
}

const REQUEST_ID_SUFFIX = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/**
 * Extracts the request id embedded at the end of every feed key
 * (`overdue-<version>-<uuid>`, `review-<status>-<version>-<uuid>`). The
 * mark-read route uses it to clear the same request's in-app change-alert
 * badges, keeping both notification stores in sync. Returns null for keys
 * that carry no request id.
 */
export function requestIdFromNotificationKey(key: string): string | null {
  return key.match(REQUEST_ID_SUFFIX)?.[1] ?? null;
}