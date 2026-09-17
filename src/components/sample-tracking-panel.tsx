"use client";

import { useCallback, useEffect, useState } from "react";

type Sample = {
  id: string;
  sample_type: string;
  status: string;
  size: string | null;
  color: string | null;
  quantity: number;
  sent_date: string | null;
  received_date: string | null;
  factory_notes: string | null;
  pbd_notes: string | null;
};

const SAMPLE_TYPES = ["proto", "fit", "pre-production", "top", "shipment", "salesman"];
const STATUSES = ["requested", "in_progress", "sent", "received", "approved", "rejected"];

export function SampleTrackingPanel({ requestId, canEdit }: { requestId: string; canEdit: boolean }) {
  const [samples, setSamples] = useState<Sample[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const loadSamples = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/costing/requests/${requestId}/samples`);
      const data = await res.json();
      if (data.ok) setSamples(data.data ?? []);
    } catch {
      setMessage("Failed to load samples");
    } finally {
      setLoading(false);
    }
  }, [requestId]);

  useEffect(() => {
    loadSamples();
  }, [loadSamples]);

  async function addSample(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const form = new FormData(event.currentTarget);
    const res = await fetch(`/api/costing/requests/${requestId}/samples`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sampleType: form.get("sampleType"),
        status: form.get("status"),
        size: form.get("size") || null,
        color: form.get("color") || null,
        quantity: form.get("quantity") ? parseInt(String(form.get("quantity"))) : 1
      })
    });
    const data = await res.json();
    if (data.ok) {
      loadSamples();
      event.currentTarget.reset();
    } else {
      setMessage(data.error ?? "Failed to add sample");
    }
    setBusy(false);
  }

  async function updateSample(sample: Sample, field: string, value: string) {
    setBusy(true);
    const body: Record<string, unknown> = { sampleId: sample.id };
    if (field === "status") body.status = value;
    if (field === "sentDate") body.sentDate = value || null;
    if (field === "receivedDate") body.receivedDate = value || null;
    if (field === "pbdNotes") body.pbdNotes = value;

    const res = await fetch(`/api/costing/requests/${requestId}/samples`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (data.ok) loadSamples();
    else setMessage(data.error ?? "Failed to update");
    setBusy(false);
  }

  const statusColor = (status: string) =>
    status === "approved" ? "text-green" : status === "rejected" ? "text-red" : "text-amber";

  // The panel renders immediately: the add form is usable before the list has
  // loaded, and the role boundary is visible in the first paint rather than
  // behind a "Loading samples..." placeholder that hides the whole panel.
  return (
    <div>
      <h3>Sample Tracking</h3>
      <p className="eyebrow">Track sample rounds from proto through shipment</p>

      {canEdit ? (
        <details style={{ margin: "12px 0" }}>
          <summary className="eyebrow" style={{ cursor: "pointer" }}>Add Sample Round</summary>
          <form className="form-grid" onSubmit={addSample} style={{ marginTop: 8 }}>
            <div className="field">
              <label htmlFor="sampleType">Sample Type</label>
              <select id="sampleType" name="sampleType" className="input" defaultValue="proto">
                {SAMPLE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="status">Status</label>
              <select id="status" name="status" className="input" defaultValue="requested">
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="size">Size</label>
              <input id="size" name="size" className="input" placeholder="M, L, XL..." />
            </div>
            <div className="field">
              <label htmlFor="color">Color</label>
              <input id="color" name="color" className="input" placeholder="Navy, Black..." />
            </div>
            <div className="field">
              <label htmlFor="quantity">Quantity</label>
              <input id="quantity" name="quantity" className="input" type="number" defaultValue={1} />
            </div>
            <div className="form-actions">
              <button className="button" type="submit" disabled={busy}>Add Sample</button>
            </div>
          </form>
        </details>
      ) : null}

      {loading ? (
        <p className="eyebrow">Loading samples...</p>
      ) : samples.length === 0 ? (
        <p className="notice">No samples tracked yet for this request.</p>
      ) : (
        <table className="table compact">
          <thead>
            <tr>
              <th>Type</th>
              <th>Status</th>
              <th>Size</th>
              <th>Color</th>
              <th>Qty</th>
              <th>Sent Date</th>
              <th>Received</th>
              <th>PBD Notes</th>
            </tr>
          </thead>
          <tbody>
            {samples.map((s) => (
              <tr key={s.id}>
                <td><strong>{s.sample_type}</strong></td>
                <td>
                  {canEdit ? (
                    <select
                      className="input table-input"
                      defaultValue={s.status}
                      onChange={(e) => updateSample(s, "status", e.target.value)}
                    >
                      {STATUSES.map((st) => <option key={st} value={st}>{st}</option>)}
                    </select>
                  ) : (
                    <span className={statusColor(s.status)}>{s.status}</span>
                  )}
                </td>
                <td>{s.size ?? "—"}</td>
                <td>{s.color ?? "—"}</td>
                <td>{s.quantity}</td>
                <td>
                  {canEdit ? (
                    <input
                      className="input table-input"
                      type="date"
                      defaultValue={s.sent_date ?? ""}
                      onChange={(e) => updateSample(s, "sentDate", e.target.value)}
                    />
                  ) : (s.sent_date ?? "—")}
                </td>
                <td>
                  {canEdit ? (
                    <input
                      className="input table-input"
                      type="date"
                      defaultValue={s.received_date ?? ""}
                      onChange={(e) => updateSample(s, "receivedDate", e.target.value)}
                    />
                  ) : (s.received_date ?? "—")}
                </td>
                <td>
                  {canEdit ? (
                    <input
                      className="input table-input"
                      defaultValue={s.pbd_notes ?? ""}
                      placeholder="Notes"
                      onBlur={(e) => updateSample(s, "pbdNotes", e.target.value)}
                    />
                  ) : (s.pbd_notes ?? "—")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {message ? <p className="form-message error">{message}</p> : null}
    </div>
  );
}
