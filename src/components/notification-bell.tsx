"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { IconBell, IconCheckCircle, IconAlertCircle, IconClock } from "@/components/ui/icons";

type Notification = {
  id: string;
  type: "urgent" | "review" | "info";
  title: string;
  description: string;
  href: string;
  createdAt: string;
};

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
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

  async function loadNotifications() {
    try {
      const res = await fetch("/api/notifications/pending", { cache: "no-store" });
      const data = await res.json();
      if (data.ok) {
        setNotifications(data.notifications ?? []);
      }
    } catch {
      // Silent fail — bell just shows no notifications
    } finally {
      setLoading(false);
    }
  }

  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const visible = notifications.filter((n) => !dismissed.has(n.id));
  const urgentCount = visible.filter((n) => n.type === "urgent").length;
  const totalCount = visible.length;

  function dismiss(id: string, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDismissed((prev) => new Set(prev).add(id));
    // Persist dismissed for this session so it doesn't reappear on next poll
    try {
      const raw = localStorage.getItem("dismissed-notifs");
      const arr = raw ? JSON.parse(raw) : [];
      localStorage.setItem("dismissed-notifs", JSON.stringify([...arr, id]));
    } catch {}
  }

  // Restore dismissed from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem("dismissed-notifs");
      if (raw) setDismissed(new Set(JSON.parse(raw)));
    } catch {}
  }, []);

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

  return (
    <div className="notif-bell" ref={ref}>
      <button
        className="bell-button"
        onClick={() => setOpen(!open)}
        aria-label={`Notifications (${totalCount} pending)`}
        aria-expanded={open}
      >
        <IconBell size={20} />
        {totalCount > 0 ? (
          <span className={`bell-badge ${urgentCount > 0 ? "bell-badge-urgent" : ""}`}>
            {totalCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="notif-dropdown">
          <div className="notif-header">
            <strong>Notifications</strong>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {totalCount > 0 ? <span className="notif-count">{totalCount} pending</span> : null}
              {totalCount > 0 ? (
                <button
                  className="button secondary small"
                  style={{ padding: "2px 8px", fontSize: 11, minHeight: 24 }}
                  onClick={() => {
                    setDismissed(new Set(notifications.map((n) => n.id)));
                    try { localStorage.setItem("dismissed-notifs", JSON.stringify(notifications.map((n) => n.id))); } catch {}
                  }}
                >
                  Clear all
                </button>
              ) : null}
            </div>
          </div>
          <div className="notif-list">
            {loading ? (
              <div className="notif-empty">Loading...</div>
            ) : visible.length === 0 ? (
              <div className="notif-empty">
                <IconCheckCircle size={24} />
                <p>All caught up — no pending notifications</p>
              </div>
            ) : (
              visible.map((n) => {
                const Icon = typeIcon[n.type];
                return (
                  <div key={n.id} className="notif-item" style={{ position: "relative", paddingRight: 32 }}>
                    <Link href={n.href} className="notif-item-link" onClick={() => setOpen(false)} style={{ display: "flex", gap: 10, flex: 1, textDecoration: "none", color: "inherit" }}>
                      <span className="notif-icon" style={{ color: typeColor[n.type] }}>
                        <Icon size={16} />
                      </span>
                      <div className="notif-content">
                        <strong>{n.title}</strong>
                        <span>{n.description}</span>
                        <small>{new Date(n.createdAt).toLocaleString()}</small>
                      </div>
                    </Link>
                    <button
                      aria-label="Dismiss notification"
                      title="Dismiss"
                      onClick={(e) => dismiss(n.id, e)}
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
                        lineHeight: 1,
                      }}
                    >
                      ×
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
