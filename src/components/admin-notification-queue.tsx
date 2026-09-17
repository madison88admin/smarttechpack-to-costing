"use client";

import { useState, useEffect } from "react";

type QueueSummary = {
  transport: string;
  channels: string[];
  pending: number;
  sent: number;
  failed: number;
  lastError: string | null;
};

const TRANSPORT_LABELS: Record<string, { label: string; tone: string }> = {
  "microsoft-graph": { label: "Microsoft Graph", tone: "green" },
  smtp: { label: "SMTP", tone: "green" },
  "dev-console": { label: "Dev console (no real email is sent)", tone: "amber" },
  none: { label: "Not configured", tone: "red" }
};

export function AdminNotificationQueue() {
  const [summary, setSummary] = useState<QueueSummary | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadSummary();
  }, []);

  async function loadSummary() {
    try {
      const res = await fetch("/api/admin/notifications/queue");
      const data = await res.json();
      if (data.ok) setSummary(data.data);
      else setMessage(data.error ?? "Failed to load the notification queue");
    } catch {
      setMessage("Failed to load the notification queue");
    }
  }

  async function requeue(force: boolean) {
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/admin/notifications/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force })
      });
      const data = await res.json();
      if (data.ok) {
        setMessage(
          data.requeued === 0
            ? "No failed notifications were waiting."
            : `Requeued ${data.requeued} failed notification(s) — they will send on the next queue run.`
        );
      } else {
        setMessage(data.error ?? "Failed to requeue notifications");
      }
      await loadSummary();
    } catch {
      setMessage("Failed to requeue notifications");
    } finally {
      setBusy(false);
    }
  }

  const transport = summary ? TRANSPORT_LABELS[summary.transport] ?? { label: summary.transport, tone: "neutral" } : null;

  return (
    <div className="grid">
      <div className="metrics">
        <div className="metric">
          <span className="metric-label">Waiting</span>
          <strong>{summary?.pending ?? "—"}</strong>
          <small>Pending sends</small>
        </div>
        <div className="metric">
          <span className="metric-label">Sent</span>
          <strong>{summary?.sent ?? "—"}</strong>
          <small>Delivered or logged</small>
        </div>
        <div className="metric">
          <span className="metric-label">Failed</span>
          <strong>{summary?.failed ?? "—"}</strong>
          <small>Out of attempts</small>
        </div>
      </div>

      <p className="eyebrow">
        Transport:{" "}
        {transport ? <span className={`status ${transport.tone}`}>{transport.label}</span> : "loading..."}
        {summary && summary.channels.length > 0 ? <> · channels: {summary.channels.join(", ")}</> : null}
      </p>

      {summary?.failed === 0 && summary.pending > 0 ? (
        <p className="notice">
          Nothing is stuck. Rows sit in <strong>pending</strong> rather than failing while no transport can carry them.
        </p>
      ) : null}

      {summary?.lastError ? (
        <p className="notice">
          Last failure: <strong>{summary.lastError}</strong>
        </p>
      ) : null}

      <p className="eyebrow">
        Failed rows stop after three attempts and never retry on their own. Requeue resets them to pending once a
        transport is configured.
      </p>

      <div className="form-actions">
        <button className="button" type="button" onClick={() => requeue(false)} disabled={busy || !summary || summary.failed === 0}>
          {busy ? "Requeuing..." : `Requeue ${summary?.failed ?? 0} failed`}
        </button>
        {summary?.transport === "none" ? (
          <button className="button secondary" type="button" onClick={() => requeue(true)} disabled={busy}>
            Park as pending anyway
          </button>
        ) : null}
      </div>

      {message ? <p className="form-message saved">{message}</p> : null}
    </div>
  );
}
