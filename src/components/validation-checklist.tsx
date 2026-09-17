"use client";

import { useState } from "react";

type ChecklistItem = {
  code: string;
  label: string;
  is_checked: boolean;
  comment: string;
  is_required?: boolean;
};

export function ValidationChecklist({
  requestId,
  items,
  canEdit
}: {
  requestId: string;
  items: ChecklistItem[];
  // The checklist IS the Costing validation verdict, so only the lane that owns
  // the server route (Costing team / admin tier) may tick it. Other internal
  // roles see the same content read-only.
  canEdit: boolean;
}) {
  const [rows, setRows] = useState(items);
  const [message, setMessage] = useState("");

  async function save() {
    if (!canEdit) return;
    setMessage("Saving...");
    const response = await fetch(`/api/costing/requests/${requestId}/checklist`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: rows.map((row) => ({
          code: row.code,
          isChecked: row.is_checked,
          comment: row.comment
        }))
      })
    });
    const result = await response.json();
    setMessage(response.ok && result.ok ? "Checklist saved" : result.error ?? "Unable to save checklist");
  }

  const requiredCount = rows.filter(r => r.is_required).length;
  const requiredChecked = rows.filter(r => r.is_required && r.is_checked).length;

  return (
    <section className="panel">
      <div className="toolbar">
        <div>
          <p className="eyebrow">Costing Validation</p>
          <h2>Checklist</h2>
          <p className="eyebrow" style={{ marginTop: 4 }}>
            {requiredChecked}/{requiredCount} required items checked
          </p>
        </div>
        {canEdit ? (
          <button className="button secondary" type="button" onClick={save}>
            Save Checklist
          </button>
        ) : (
          <span className="eyebrow">Read-only — the Costing Team saves this checklist.</span>
        )}
      </div>
      <div className="checklist">
        {rows.map((row, index) => (
          <label className={`check-row ${row.is_required ? "check-required" : "check-optional"}`} key={row.code}>
            <input
              type="checkbox"
              checked={row.is_checked}
              disabled={!canEdit}
              onChange={(event) =>
                setRows((current) =>
                  current.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, is_checked: event.target.checked } : item
                  )
                )
              }
            />
            <span>{row.label}</span>
            {row.is_required ? (
              <span className="badge badge-required" style={{ marginLeft: 8, fontSize: 10, padding: "2px 6px", background: "#fee", color: "#c33", borderRadius: 4 }}>Required</span>
            ) : (
              <span className="badge badge-optional" style={{ marginLeft: 8, fontSize: 10, padding: "2px 6px", background: "#eef", color: "#669", borderRadius: 4 }}>Optional</span>
            )}
          </label>
        ))}
      </div>
      {message ? <p className="form-message saved">{message}</p> : null}
    </section>
  );
}
