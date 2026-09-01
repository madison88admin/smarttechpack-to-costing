"use client";

import { useCallback, useEffect, useState } from "react";

type ComplianceCheck = {
  id: string;
  check_type: string;
  status: string;
  details: Record<string, unknown>;
  checked_at: string | null;
  notes: string | null;
};

const CHECK_TYPES = [
  { value: "rsl", label: "RSL (Restricted Substances List)" },
  { value: "dpp", label: "DPP (Digital Product Passport)" },
  { value: "reach", label: "REACH Compliance" },
  { value: "oeko_tex", label: "OEKO-TEX Standard 100" },
  { value: "gots", label: "GOTS (Global Organic Textile)" },
  { value: "carbon", label: "Carbon Footprint Assessment" }
];

export function CompliancePanel({ requestId, canEdit }: { requestId: string; canEdit: boolean }) {
  const [checks, setChecks] = useState<ComplianceCheck[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const loadChecks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/costing/requests/${requestId}/compliance`);
      const data = await res.json();
      if (data.ok) setChecks(data.data ?? []);
    } catch {
      setMessage("Failed to load compliance checks");
    } finally {
      setLoading(false);
    }
  }, [requestId]);

  useEffect(() => {
    loadChecks();
  }, [loadChecks]);

  async function addCheck(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const form = new FormData(event.currentTarget);
    const res = await fetch(`/api/costing/requests/${requestId}/compliance`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        checkType: form.get("checkType"),
        status: form.get("status"),
        notes: form.get("notes")
      })
    });
    const data = await res.json();
    if (data.ok) {
      loadChecks();
      event.currentTarget.reset();
    } else {
      setMessage(data.error ?? "Failed to add check");
    }
    setBusy(false);
  }

  const statusColor = (status: string) =>
    status === "passed" ? "text-green" : status === "failed" ? "text-red" : "text-amber";
  const blockingChecks = checks.filter((check) => {
    const type = check.check_type.toLowerCase();
    const status = check.status.toLowerCase();
    return (type === "rsl" || type === "reach") && ["pending", "failed", "fail", "rejected", "non_compliant", "not_compliant"].includes(status);
  });

  if (loading) return <p className="eyebrow">Loading compliance checks...</p>;

  return (
    <div>
      <h3>Sustainability & Compliance</h3>
      <p className="eyebrow">Track RSL, DPP, REACH, OEKO-TEX and other compliance requirements</p>
      {blockingChecks.length ? (
        <p className="notice warning-notice">Approval is blocked until RSL/REACH checks are marked Passed. Current blockers: {blockingChecks.map((check) => `${check.check_type.toUpperCase()} (${check.status})`).join(", ")}.</p>
      ) : null}

      {canEdit ? (
        <details style={{ margin: "12px 0" }}>
          <summary className="eyebrow" style={{ cursor: "pointer" }}>Add Compliance Check</summary>
          <form className="form-grid" onSubmit={addCheck} style={{ marginTop: 8 }}>
            <div className="field">
              <label htmlFor="checkType">Check Type</label>
              <select id="checkType" name="checkType" className="input" defaultValue="rsl">
                {CHECK_TYPES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="status">Status</label>
              <select id="status" name="status" className="input" defaultValue="pending">
                <option value="pending">Pending</option>
                <option value="passed">Passed</option>
                <option value="failed">Failed</option>
                <option value="not_required">Not Required</option>
              </select>
            </div>
            <div className="field full">
              <label htmlFor="notes">Notes</label>
              <input id="notes" name="notes" className="input" placeholder="Test report reference, certificate #, etc." />
            </div>
            <div className="form-actions">
              <button className="button" type="submit" disabled={busy}>Add Check</button>
            </div>
          </form>
        </details>
      ) : null}

      {checks.length === 0 ? (
        <p className="notice">No compliance checks recorded for this request.</p>
      ) : (
        <table className="table compact">
          <thead>
            <tr>
              <th>Check Type</th>
              <th>Status</th>
              <th>Checked At</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {checks.map((c) => {
              const label = CHECK_TYPES.find((t) => t.value === c.check_type)?.label ?? c.check_type;
              return (
                <tr key={c.id}>
                  <td><strong>{label}</strong></td>
                  <td className={statusColor(c.status)}>{c.status}</td>
                  <td>{c.checked_at ? new Date(c.checked_at).toLocaleDateString() : "—"}</td>
                  <td>{c.notes ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {message ? <p className="form-message error">{message}</p> : null}
    </div>
  );
}
