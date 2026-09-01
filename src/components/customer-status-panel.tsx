"use client";

import { useMemo, useState } from "react";

const statuses = [
  ["not_submitted", "Not Submitted"],
  ["pending_customer_submission", "Ready for Customer"],
  ["sent_to_customer", "Sent to Customer"],
  ["under_negotiation", "Under Negotiation"],
  ["customer_rejected_revised", "Revision Required"],
  ["customer_approved", "Customer Approved"],
  ["closed", "Closed"]
] as const;

const statusOrder = statuses.map(([value]) => value);
const statusLabels = Object.fromEntries(statuses);

type Action = { status: string; label: string; tone?: "primary" | "secondary" | "danger" };

export function CustomerStatusPanel({
  requestId,
  status,
  notes,
  customerSubmittedAt,
  customerDecisionAt,
  revisionDueAt,
  revisionNumber = 0,
  canEdit = true
}: {
  requestId: string;
  status: string;
  notes?: string | null;
  customerSubmittedAt?: string | null;
  customerDecisionAt?: string | null;
  revisionDueAt?: string | null;
  revisionNumber?: number;
  canEdit?: boolean;
}) {
  const [value, setValue] = useState(statusOrder.includes(status as (typeof statusOrder)[number]) ? status : "not_submitted");
  const [noteValue, setNoteValue] = useState(notes ?? "");
  const [referenceUrl, setReferenceUrl] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const currentIndex = Math.max(0, statusOrder.indexOf(value as (typeof statusOrder)[number]));
  const actions = useMemo<Action[]>(() => {
    switch (value) {
      case "not_submitted":
        return [{ status: "pending_customer_submission", label: "Mark Ready for Customer", tone: "primary" }];
      case "pending_customer_submission":
        return [{ status: "sent_to_customer", label: "Mark Sent to Customer", tone: "primary" }];
      case "sent_to_customer":
        return [
          { status: "under_negotiation", label: "Start Negotiation", tone: "secondary" },
          { status: "customer_rejected_revised", label: "Record Customer Revision", tone: "danger" },
          { status: "customer_approved", label: "Record Customer Approval", tone: "primary" }
        ];
      case "under_negotiation":
        return [
          { status: "customer_rejected_revised", label: "Record Customer Revision", tone: "danger" },
          { status: "customer_approved", label: "Record Customer Approval", tone: "primary" }
        ];
      case "customer_approved":
        return [{ status: "closed", label: "Close Request", tone: "primary" }];
      default:
        return [];
    }
  }, [value]);

  async function save(nextStatus: string) {
    if (nextStatus === "customer_rejected_revised" && !noteValue.trim()) {
      setMessage("Add the customer revision reason before saving.");
      return;
    }

    setBusy(true);
    setMessage("Saving...");
    try {
      const response = await fetch(`/api/costing/requests/${requestId}/customer-status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus, notes: noteValue, referenceUrl })
      });
      const result = await response.json();
      if (!response.ok || !result.ok) {
        setMessage(result.error ?? "Unable to save customer status");
        return;
      }
      setValue(nextStatus);
      setReferenceUrl("");
      setMessage("Customer status saved");
      window.location.reload();
    } catch {
      setMessage("Network error — please try again");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">External review</p>
          <h2>Customer Review</h2>
        </div>
        {revisionNumber > 0 ? <span className="status amber">Revision {revisionNumber}</span> : null}
      </div>

      <div className="customer-timeline" aria-label="Customer review progress">
        {statuses.map(([statusValue, label], idx) => {
          const isDone = idx < currentIndex;
          const isCurrent = idx === currentIndex;
          const isRevision = statusValue === "customer_rejected_revised";
          const cls = isRevision && isCurrent ? "step-rejected" : isCurrent ? "step-current" : isDone ? "step-done" : "step-pending";
          return (
            <div key={statusValue} className={`timeline-step ${cls}`} title={label}>
              <span className="timeline-step-number">{isDone ? "✓" : idx + 1}</span>
              <span>{label}</span>
            </div>
          );
        })}
      </div>

      <div className="customer-meta-grid">
        <span><strong>Current:</strong> {statusLabels[value] ?? value}</span>
        {customerSubmittedAt ? <span><strong>Sent:</strong> {formatDate(customerSubmittedAt)}</span> : null}
        {customerDecisionAt ? <span><strong>Decision:</strong> {formatDate(customerDecisionAt)}</span> : null}
        {revisionDueAt ? <span><strong>Revision due:</strong> {formatDate(revisionDueAt)}</span> : null}
      </div>

      {value === "customer_rejected_revised" ? (
        <p className="notice warning-notice">The request is back in the factory correction queue. A new approved costing will reopen customer submission.</p>
      ) : null}

      {canEdit && actions.length ? (
        <>
          <div className="field" style={{ marginTop: 14 }}>
            <label htmlFor="customerNotes">Customer notes / negotiation update</label>
            <textarea
              id="customerNotes"
              className="input textarea small-textarea"
              value={noteValue}
              onChange={(event) => setNoteValue(event.target.value)}
              placeholder="Add submission notes, negotiation update, or revision reason"
            />
          </div>
          <div className="field" style={{ marginTop: 10 }}>
            <label htmlFor="customerReferenceUrl">Reference link (optional)</label>
            <input
              id="customerReferenceUrl"
              className="input"
              type="url"
              value={referenceUrl}
              onChange={(event) => setReferenceUrl(event.target.value)}
              placeholder="https://sharepoint/... or customer approval link"
            />
          </div>
          <div className="action-buttons-row" style={{ marginTop: 12 }}>
            {actions.map((action) => (
              <button
                key={action.status}
                type="button"
                className={`button ${action.tone === "secondary" ? "secondary" : action.tone === "danger" ? "secondary btn-danger" : ""}`}
                onClick={() => save(action.status)}
                disabled={busy}
              >
                {busy ? <><span className="spinner" /> Saving...</> : action.label}
              </button>
            ))}
          </div>
        </>
      ) : null}

      {notes && !canEdit ? <p className="eyebrow" style={{ marginTop: 12 }}>Notes: {notes}</p> : null}
      {message ? <p className={`form-message ${message === "Saving..." ? "" : message.includes("error") ? "error" : "saved"}`}>{message}</p> : null}
    </section>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
