"use client";

import { useState, useEffect, type FormEvent } from "react";

type Recipient = {
  id: string;
  event_type: string;
  role: string;
  email: string | null;
  is_active: boolean;
  created_at: string;
};

const EVENT_TYPES = [
  { value: "send_to_factory", label: "Send to Factory" },
  { value: "submit", label: "CBD Submitted" },
  { value: "approve", label: "Approved" },
  { value: "reject", label: "Rejected" },
  { value: "clarify", label: "Needs Clarification" },
  { value: "reminder", label: "SLA Reminder" },
  { value: "escalation", label: "Escalation" },
  { value: "customer_status_changed", label: "Customer Status Changed" },
  { value: "cost_sheet_ready", label: "Cost Sheet Ready" }
];

const ROLES = [
  { value: "superadmin", label: "Super Admin" },
  { value: "admin", label: "Admin" },
  { value: "pbd", label: "PBD / Costing" },
  { value: "factory", label: "Factory" },
  { value: "viewer", label: "Viewer" }
];

export function AdminRecipientManager() {
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadRecipients();
  }, []);

  async function loadRecipients() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/recipients");
      const data = await res.json();
      if (data.ok) {
        setRecipients(data.data ?? []);
      } else {
        setMessage(data.error ?? "Failed to load recipients");
      }
    } catch {
      setMessage("Failed to load recipients");
    } finally {
      setLoading(false);
    }
  }

  async function addRecipient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    const res = await fetch("/api/admin/recipients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventType: form.get("eventType"),
        role: form.get("role"),
        email: form.get("email"),
        isActive: form.get("isActive") === "on"
      })
    });
    const data = await res.json();
    if (data.ok) {
      setMessage("Recipient added.");
      event.currentTarget.reset();
      loadRecipients();
    } else {
      setMessage(data.error ?? "Failed to add recipient");
    }
    setBusy(false);
  }

  async function toggleRecipient(recipient: Recipient) {
    setBusy(true);
    const res = await fetch("/api/admin/recipients", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: recipient.id, isActive: !recipient.is_active })
    });
    const data = await res.json();
    if (data.ok) {
      loadRecipients();
    } else {
      setMessage(data.error ?? "Failed to update");
    }
    setBusy(false);
  }

  async function deleteRecipient(recipient: Recipient) {
    if (!confirm(`Delete recipient for ${recipient.event_type} → ${recipient.role}?`)) return;
    setBusy(true);
    const res = await fetch(`/api/admin/recipients?id=${recipient.id}`, {
      method: "DELETE"
    });
    const data = await res.json();
    if (data.ok) {
      setMessage("Recipient deleted.");
      loadRecipients();
    } else {
      setMessage(data.error ?? "Failed to delete");
    }
    setBusy(false);
  }

  return (
    <div className="grid">
      <form className="form-grid" onSubmit={addRecipient}>
        <div className="field">
          <label htmlFor="eventType">Event Type</label>
          <select id="eventType" name="eventType" className="input" required defaultValue="send_to_factory">
            {EVENT_TYPES.map((et) => (
              <option key={et.value} value={et.value}>{et.label}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="role">Role</label>
          <select id="role" name="role" className="input" required defaultValue="pbd">
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="email">Email (optional)</label>
          <input id="email" name="email" className="input" placeholder="name@madison88.com" type="email" />
        </div>
        <label className="checkbox-row">
          <input name="isActive" type="checkbox" defaultChecked />
          Active
        </label>
        <div className="form-actions">
          <button className="button" type="submit" disabled={busy}>
            {busy ? "Adding..." : "Add Recipient"}
          </button>
        </div>
      </form>

      {loading ? (
        <p className="eyebrow">Loading recipients...</p>
      ) : recipients.length === 0 ? (
        <p className="notice">No notification recipients configured. Add one above.</p>
      ) : (
        <table className="table compact">
          <thead>
            <tr>
              <th>Event</th>
              <th>Role</th>
              <th>Email</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {recipients.map((r) => {
              const eventLabel = EVENT_TYPES.find((e) => e.value === r.event_type)?.label ?? r.event_type;
              const roleLabel = ROLES.find((ro) => ro.value === r.role)?.label ?? r.role;
              return (
                <tr key={r.id}>
                  <td><strong>{eventLabel}</strong></td>
                  <td>{roleLabel}</td>
                  <td>{r.email ?? <span className="eyebrow">—</span>}</td>
                  <td>
                    <span className={`status ${r.is_active ? "green" : "neutral"}`}>
                      {r.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td>
                    <button
                      className="button secondary small-btn"
                      type="button"
                      onClick={() => toggleRecipient(r)}
                      disabled={busy}
                    >
                      {r.is_active ? "Disable" : "Enable"}
                    </button>
                    <button
                      className="button secondary small-btn"
                      type="button"
                      onClick={() => deleteRecipient(r)}
                      disabled={busy}
                      style={{ marginLeft: 4 }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {message ? <p className="form-message saved">{message}</p> : null}
    </div>
  );
}
