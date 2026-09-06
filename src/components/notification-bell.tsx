"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { IconBell, IconCheckCircle, IconAlertCircle, IconClock } from "@/components/ui/icons";
import {
  groupNotifications,
  dismissKeysForGroup,
  badgeLabel,
  applyDismissResult,
  pruneFailedKeys,
  type FeedNotification,
  type FeedGroup
} from "@/lib/notifications/feed-logic";
import { dispatchNotifSync, subscribeNotifSync } from "@/lib/notifications/sync";
import { CoalescedRunner } from "@/lib/notifications/coalesced";

type Notification = FeedNotification;
type Group = FeedGroup;

// Read receipt: the server records these keys as seen for the current role and
// the feed (the single source of truth) stops re-surfacing them on every poll,
// on every device. Returns true only when the server accepted the receipts —
// the bell never hides anything locally, so a failed write leaves the item
// visible for retry instead of drifting from what the server will show.
async function markRead(keys: string[]): Promise<boolean> {
  const unique = [...new Set(keys.filter(Boolean))];
  if (unique.length === 0) return true;
  try {
    const res = await fetch("/api/notifications/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keys: unique }),
      cache: "no-store"
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  // True unread count from the server — can exceed the 20-row tray cap.
  const [totalUnread, setTotalUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  // Keys whose dismissal write failed. The item stays visible (the server never
  // recorded the receipts) and shows a subtle Retry affordance instead of
  // silently losing the user's action.
  const [failedKeys, setFailedKeys] = useState<Set<string>>(new Set());
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadNotifications();
    // Refresh every 60 seconds
    const interval = setInterval(loadNotifications, 60_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Keep the two notification stores in sync with the rest of the dashboard:
  // the change-alerts panel and request-row badges refetch when the bell marks
  // receipts (notif-sync), and the bell reloads when the panel marks all read.
  useEffect(() => {
    return subscribeNotifSync(window, loadNotifications);
  }, []);

  // Forget failure markers once the item leaves the feed (dismissed on another
  // device, aged out, or a retry succeeded) so the set never goes stale.
  useEffect(() => {
    setFailedKeys((prev) => pruneFailedKeys(prev, notifications.map((n) => n.key)) ?? prev);
  }, [notifications]);

  async function fetchNotifications() {
    try {
      const res = await fetch("/api/notifications/pending", { cache: "no-store" });
      const data = await res.json();
      if (!data.ok) return;
      const next = (data.notifications ?? []) as Notification[];
      setNotifications(next);
      if (typeof data.totalUnread === "number") {
        setTotalUnread(data.totalUnread);
      }
    } catch {
      // Silent fail — bell just shows no notifications
    } finally {
      setLoading(false);
    }
  }

  // Coalesce concurrent feed loads: the 60s poll, dismissal-triggered reloads,
  // and the panel's "Mark all read" can fire near-simultaneously. Concurrent
  // callers share one in-flight fetch; if a write (a dismissal recording read
  // receipts) landed while that shared fetch was running, a single catch-up
  // load runs after it settles so the tray never shows stale items until the
  // next poll.
  const loaderRef = useRef<CoalescedRunner | null>(null);
  if (!loaderRef.current) loaderRef.current = new CoalescedRunner(fetchNotifications);

  function loadNotifications() {
    return loaderRef.current?.load() ?? Promise.resolve();
  }

  // The feed response is the source of truth: the server already filters out
  // every key recorded as read, so no in-session shadow state is needed — the
  // tray always shows exactly what the server reports as unread.
  const groups = useMemo<Group[]>(() => groupNotifications(notifications), [notifications]);

  const urgentCount = notifications.filter((n) => n.type === "urgent").length;
  const totalCount = notifications.length;
  const badge = badgeLabel(totalUnread, totalCount);

  // Dismissing bell items also clears the same requests' in-app change-alert
  // badges (the read route handles the server side). Tell the dashboard to
  // refetch, and soft-refresh the route so the server-rendered badge counts
  // re-render from the fresh read state.
  function syncAfterMark() {
    dispatchNotifSync(window);
    router.refresh();
  }

  // Dismiss = write the receipts to the server, then announce. The announce
  // makes this bell (and every other surface) refetch the feed immediately, so
  // the tray converges on the server state in one roundtrip — never waiting for
  // the 60s poll. If the write fails, nothing is announced and the item stays
  // visible: the server never recorded it, so hiding it would be a lie — but
  // instead of failing silently, the item shows a subtle Retry affordance.
  async function dismissKeys(keys: string[]) {
    const ok = await markRead(keys);
    setFailedKeys((prev) => applyDismissResult(prev, keys, ok));
    if (ok) syncAfterMark();
  }

  function dismissOne(key: string, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    void dismissKeys([key]);
  }

  function retryOne(key: string, e: React.MouseEvent) {
    e.stopPropagation();
    void dismissKeys([key]);
  }

  function dismissGroup(group: Group) {
    void dismissKeys(dismissKeysForGroup(group));
  }

  function clearAll() {
    void dismissKeys(notifications.map((n) => n.key));
  }

  const typeIcon = {
    urgent: IconAlertCircle,
    review: IconClock,
    info: IconCheckCircle
  };

  const typeColor = {
    urgent: "var(--red, #a83d37)",
    review: "var(--amber, #a76112)",
    info: "var(--blue, #2f617f)"
  };

  const groupLabel = (group: Group) =>
    group.requestNumber ?? (group.requestId !== "general" ? `Request ${group.requestId.slice(0, 8)}` : "General");

  return (
    <div className="notif-bell" ref={ref}>
      <button
        className="bell-button"
        onClick={() => setOpen(!open)}
        aria-label={`Notifications (${badge ?? "0"} pending)`}
        aria-expanded={open}
      >
        <IconBell size={20} />
        {badge ? (
          <span className={`bell-badge ${urgentCount > 0 ? "bell-badge-urgent" : ""}`}>{badge}</span>
        ) : null}
      </button>

      {open ? (
        <div className="notif-dropdown">
          <div className="notif-header">
            <strong>Notifications</strong>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {totalCount > 0 ? <span className="notif-count">{totalUnread} pending</span> : null}
              {totalCount > 0 ? (
                <button
                  className="button secondary small"
                  style={{ padding: "2px 8px", fontSize: 11, minHeight: 24 }}
                  onClick={clearAll}
                >
                  Clear all
                </button>
              ) : null}
            </div>
          </div>
          <div className="notif-list">
            {loading ? (
              <div className="notif-empty">Loading...</div>
            ) : notifications.length === 0 ? (
              <div className="notif-empty">
                <IconCheckCircle size={24} />
                <p>All caught up — no pending notifications</p>
              </div>
            ) : (
              groups.map((group) => (
                <div key={group.requestId} className="notif-group">
                  <div
                    className="notif-group-head"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 8,
                      padding: "6px 8px 2px 8px",
                      borderTop: "1px solid var(--line, #e5e5e5)",
                      marginTop: 4
                    }}
                  >
                    <strong style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>
                      {groupLabel(group)}
                      {group.items.length > 1 ? (
                        <span className="notif-count" style={{ marginLeft: 6 }}>
                          {group.items.length} alerts
                        </span>
                      ) : null}
                    </strong>
                    {group.items.length > 1 ? (
                      <button
                        className="notif-group-dismiss"
                        aria-label={`Dismiss all alerts for ${groupLabel(group)}`}
                        title="Dismiss all for this request"
                        onClick={() => dismissGroup(group)}
                        style={{
                          border: "none",
                          background: "none",
                          cursor: "pointer",
                          fontSize: 11,
                          color: "var(--muted, #6b7280)",
                          textDecoration: "underline",
                          padding: 0,
                          lineHeight: 1.4
                        }}
                      >
                        Dismiss all
                      </button>
                    ) : null}
                  </div>
                  {group.items.map((n) => {
                    const Icon = typeIcon[n.type];
                    return (
                      <div key={n.key} className="notif-item" style={{ position: "relative", paddingRight: 32 }}>
                        <Link
                          href={n.href}
                          className="notif-item-link"
                          onClick={() => {
                            // Click-through navigates immediately; mark read in
                            // the background and announce only if recorded.
                            void markRead([n.key]).then((ok) => {
                              if (ok) syncAfterMark();
                            });
                            setOpen(false);
                          }}
                          style={{ display: "flex", gap: 10, flex: 1, textDecoration: "none", color: "inherit" }}
                        >
                          <span className="notif-icon" style={{ color: typeColor[n.type] }}>
                            <Icon size={16} />
                          </span>
                          <div className="notif-content">
                            <strong>{n.title}</strong>
                            <span>{n.description}</span>
                            <small>{new Date(n.createdAt).toLocaleString()}</small>
                          </div>
                        </Link>
                        {failedKeys.has(n.key) ? (
                          <button
                            className="notif-retry"
                            aria-label="Retry dismissal"
                            title="Dismissal failed — click to retry"
                            onClick={(e) => retryOne(n.key, e)}
                            style={{
                              position: "absolute",
                              right: 36,
                              top: "50%",
                              transform: "translateY(-50%)",
                              border: "none",
                              background: "none",
                              cursor: "pointer",
                              fontSize: 11,
                              color: "var(--red, #a83d37)",
                              textDecoration: "underline",
                              padding: 0,
                              lineHeight: 1.4
                            }}
                          >
                            Retry
                          </button>
                        ) : null}
                        <button
                          aria-label="Dismiss notification"
                          title="Dismiss"
                          onClick={(e) => dismissOne(n.key, e)}
                          style={{
                            position: "absolute",
                            right: 6,
                            top: "50%",
                            transform: "translateY(-50%)",
                            width: 24,
                            height: 24,
                            borderRadius: 6,
                            border: "1px solid var(--line)",
                            background: "#fff",
                            cursor: "pointer",
                            display: "grid",
                            placeItems: "center",
                            fontSize: 12,
                            lineHeight: 1
                          }}
                        >
                          ×
                        </button>
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
