"use client";

import { useCallback, useEffect, useState } from "react";

type VendorQuote = {
  id: string;
  factory_name: string;
  status: string;
  quote_total: number | null;
  currency: string;
  moq: number | null;
  lead_time_days: number | null;
  submitted_at: string | null;
  notes: string | null;
  created_at: string;
};

export function VendorComparisonPanel({ requestId, canEdit }: { requestId: string; canEdit: boolean }) {
  const [quotes, setQuotes] = useState<VendorQuote[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [newFactory, setNewFactory] = useState("");

  const loadQuotes = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/costing/requests/${requestId}/vendor-quotes`);
      const data = await res.json();
      if (data.ok) setQuotes(data.data ?? []);
    } catch {
      setMessage("Failed to load vendor quotes");
    } finally {
      setLoading(false);
    }
  }, [requestId]);

  useEffect(() => {
    loadQuotes();
  }, [loadQuotes]);

  async function addVendor() {
    if (!newFactory.trim()) return;
    setBusy(true);
    setMessage("");
    const res = await fetch(`/api/costing/requests/${requestId}/vendor-quotes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ factoryName: newFactory.trim() })
    });
    const data = await res.json();
    if (data.ok) {
      setNewFactory("");
      loadQuotes();
    } else {
      setMessage(data.error ?? "Failed to add vendor");
    }
    setBusy(false);
  }

  async function updateQuote(quote: VendorQuote, field: string, value: string) {
    setBusy(true);
    const body: Record<string, unknown> = { quoteId: quote.id };
    if (field === "quoteTotal") body.quoteTotal = value ? parseFloat(value) : null;
    if (field === "moq") body.moq = value ? parseInt(value) : null;
    if (field === "leadTimeDays") body.leadTimeDays = value ? parseInt(value) : null;
    if (field === "notes") body.notes = value;
    if (field === "status") {
      body.status = value;
      if (value === "submitted") body.status = "submitted";
    }

    const res = await fetch(`/api/costing/requests/${requestId}/vendor-quotes`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (data.ok) {
      loadQuotes();
    } else {
      setMessage(data.error ?? "Failed to update quote");
    }
    setBusy(false);
  }

  async function deleteQuote(quote: VendorQuote) {
    if (!confirm(`Remove ${quote.factory_name} from comparison?`)) return;
    setBusy(true);
    const res = await fetch(`/api/costing/requests/${requestId}/vendor-quotes?id=${quote.id}`, {
      method: "DELETE"
    });
    const data = await res.json();
    if (data.ok) {
      loadQuotes();
    } else {
      setMessage(data.error ?? "Failed to delete");
    }
    setBusy(false);
  }

  // Find best quote
  const submittedQuotes = quotes.filter((q) => q.quote_total != null && q.status === "submitted");
  const bestQuote = submittedQuotes.length > 0
    ? submittedQuotes.reduce((best, q) => (q.quote_total! < best.quote_total! ? q : best))
    : null;

  if (loading) return <p className="eyebrow">Loading vendor quotes...</p>;

  return (
    <div>
      <div className="section-heading" style={{ marginBottom: 12 }}>
        <div>
          <h3>Multi-Vendor RFQ Comparison</h3>
          <p className="eyebrow">Send the same tech pack to multiple factories and compare quotes side-by-side</p>
        </div>
      </div>

      {canEdit ? (
        <div className="form-actions" style={{ marginBottom: 12 }}>
          <input
            className="input"
            placeholder="Factory name (e.g. Cebu Factory)"
            value={newFactory}
            onChange={(e) => setNewFactory(e.target.value)}
            style={{ maxWidth: 300 }}
          />
          <button className="button" onClick={addVendor} disabled={busy || !newFactory.trim()}>
            Add Vendor to RFQ
          </button>
        </div>
      ) : null}

      {quotes.length === 0 ? (
        <p className="notice">No vendors added yet. Add factories above to start comparing quotes.</p>
      ) : (
        <table className="table compact">
          <thead>
            <tr>
              <th>Factory</th>
              <th>Status</th>
              <th>Quote Total</th>
              <th>Currency</th>
              <th>MOQ</th>
              <th>Lead Time</th>
              <th>Notes</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {quotes.map((q) => {
              const isBest = bestQuote?.id === q.id;
              return (
                <tr key={q.id} className={isBest ? "row-highlight-green" : ""}>
                  <td>
                    <strong>{q.factory_name}</strong>
                    {isBest ? <span className="readiness-badge ready" style={{ marginLeft: 6, fontSize: "0.65rem" }}>BEST</span> : null}
                  </td>
                  <td>
                    {canEdit ? (
                      <select
                        className="input table-input"
                        defaultValue={q.status}
                        onChange={(e) => updateQuote(q, "status", e.target.value)}
                      >
                        <option value="pending">Pending</option>
                        <option value="submitted">Submitted</option>
                        <option value="selected">Selected</option>
                        <option value="rejected">Rejected</option>
                      </select>
                    ) : (
                      <span className={`status ${q.status === "submitted" ? "green" : q.status === "rejected" ? "red" : "neutral"}`}>
                        {q.status}
                      </span>
                    )}
                  </td>
                  <td>
                    {canEdit ? (
                      <input
                        className="input table-input"
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        defaultValue={q.quote_total ?? ""}
                        onBlur={(e) => updateQuote(q, "quoteTotal", e.target.value)}
                      />
                    ) : (
                      q.quote_total?.toFixed(2) ?? "—"
                    )}
                  </td>
                  <td>{q.currency}</td>
                  <td>
                    {canEdit ? (
                      <input
                        className="input table-input"
                        type="number"
                        placeholder="MOQ"
                        defaultValue={q.moq ?? ""}
                        onBlur={(e) => updateQuote(q, "moq", e.target.value)}
                      />
                    ) : (
                      q.moq ?? "—"
                    )}
                  </td>
                  <td>
                    {canEdit ? (
                      <input
                        className="input table-input"
                        type="number"
                        placeholder="days"
                        defaultValue={q.lead_time_days ?? ""}
                        onBlur={(e) => updateQuote(q, "leadTimeDays", e.target.value)}
                      />
                    ) : (
                      q.lead_time_days ? `${q.lead_time_days}d` : "—"
                    )}
                  </td>
                  <td>
                    {canEdit ? (
                      <input
                        className="input table-input"
                        placeholder="Notes"
                        defaultValue={q.notes ?? ""}
                        onBlur={(e) => updateQuote(q, "notes", e.target.value)}
                      />
                    ) : (
                      q.notes ?? "—"
                    )}
                  </td>
                  <td>
                    {canEdit ? (
                      <button className="button secondary small-btn" onClick={() => deleteQuote(q)} disabled={busy}>
                        Remove
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {submittedQuotes.length > 1 ? (
        <div className="rfq-summary" style={{ marginTop: 12 }}>
          <p className="eyebrow">
            <strong>{submittedQuotes.length}</strong> quotes submitted —
            Best: <strong className="text-green">{bestQuote?.factory_name}</strong> at{" "}
            <strong>{bestQuote?.currency} {bestQuote?.quote_total?.toFixed(2)}</strong>
            {" "}(MOQ: {bestQuote?.moq ?? "—"}, Lead: {bestQuote?.lead_time_days ?? "—"}d)
          </p>
        </div>
      ) : null}

      {message ? <p className="form-message error">{message}</p> : null}
    </div>
  );
}
