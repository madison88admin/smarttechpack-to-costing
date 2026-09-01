"use client";

import { useState, type FormEvent } from "react";

type ChecklistItem = {
  id: string;
  code: string;
  label: string;
  is_required: boolean;
  sort_order: number;
  is_active: boolean;
};

export function AdminChecklistManager({ items }: { items: ChecklistItem[] }) {
  const [message, setMessage] = useState("");

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("Saving checklist item...");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/admin/checklist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: form.get("code"),
        label: form.get("label"),
        sortOrder: form.get("sortOrder"),
        isRequired: form.get("isRequired") === "on",
        isActive: form.get("isActive") === "on"
      })
    });
    const result = await response.json();
    setMessage(response.ok && result.ok ? "Checklist item saved. Refreshing..." : result.error ?? "Unable to save item");
    if (response.ok && result.ok) window.location.reload();
  }

  async function toggle(item: ChecklistItem) {
    setMessage("Updating checklist...");
    const response = await fetch("/api/admin/checklist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: item.code,
        label: item.label,
        sortOrder: item.sort_order,
        isRequired: item.is_required,
        isActive: !item.is_active
      })
    });
    const result = await response.json();
    setMessage(response.ok && result.ok ? "Checklist updated. Refreshing..." : result.error ?? "Unable to update item");
    if (response.ok && result.ok) window.location.reload();
  }

  return (
    <div className="grid">
      <form className="form-grid" onSubmit={save}>
        <div className="field">
          <label htmlFor="code">Code</label>
          <input id="code" name="code" className="input" placeholder="e.g. fabric_test_checked" required />
        </div>
        <div className="field">
          <label htmlFor="label">Label</label>
          <input id="label" name="label" className="input" placeholder="Checklist label" required />
        </div>
        <div className="field">
          <label htmlFor="sortOrder">Sort order</label>
          <input id="sortOrder" name="sortOrder" className="input" defaultValue="10" />
        </div>
        <label className="checkbox-row">
          <input name="isRequired" type="checkbox" defaultChecked />
          Required before approval
        </label>
        <label className="checkbox-row">
          <input name="isActive" type="checkbox" defaultChecked />
          Active
        </label>
        <div className="form-actions">
          <button className="button" type="submit">Save Checklist Item</button>
        </div>
      </form>

      <table className="table compact">
        <thead>
          <tr>
            <th>Label</th>
            <th>Code</th>
            <th>Required</th>
            <th>Status</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.code}>
              <td><strong>{item.label}</strong></td>
              <td><span className="eyebrow">{item.code}</span></td>
              <td>{item.is_required ? "Yes" : "No"}</td>
              <td>{item.is_active ? "Active" : "Inactive"}</td>
              <td>
                <button className="button secondary" type="button" onClick={() => toggle(item)}>
                  {item.is_active ? "Disable" : "Enable"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {message ? <p className="form-message saved">{message}</p> : null}
    </div>
  );
}
