"use client";

import { useEffect, useState, type FormEvent } from "react";

type CuratedRow = {
  id: string;
  label: string;
  category: "material" | "operation" | "knitting";
  curated_average: number | null;
  curated_median: number | null;
  curated_max: number | null;
  is_time: boolean;
  notes: string | null;
  is_active: boolean;
  updated_by: string | null;
  updated_at: string;
};

const CATEGORIES = [
  { value: "material", label: "Material (USD)" },
  { value: "operation", label: "Operation (USD)" },
  { value: "knitting", label: "Knitting (minutes)" }
] as const;

export function MasterBenchmarkEditor() {
  const [rows, setRows] = useState<CuratedRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [form, setForm] = useState({
    id: "",
    label: "",
    category: "material" as "material" | "operation" | "knitting",
    curatedAverage: "",
    curatedMedian: "",
    curatedMax: "",
    notes: ""
  });

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/master-benchmark");
      const data = await res.json();
      if (data.ok) setRows(data.data ?? []);
      else setMessage(data.error ?? "Failed to load curated benchmarks");
    } catch {
      setMessage("Failed to load curated benchmarks");
    } finally {
      setLoading(false);
    }
  }

  function startEdit(row: CuratedRow) {
    setForm({
      id: row.id,
      label: row.label,
      category: row.category,
      curatedAverage: row.curated_average != null ? String(row.curated_average) : "",
      curatedMedian: row.curated_median != null ? String(row.curated_median) : "",
      curatedMax: row.curated_max != null ? String(row.curated_max) : "",
      notes: row.notes ?? ""
    });
    setMessage("");
  }

  function resetForm() {
    setForm({ id: "", label: "", category: "material", curatedAverage: "", curatedMedian: "", curatedMax: "", notes: "" });
    setMessage("");
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/admin/master-benchmark", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: form.id || null,
          label: form.label,
          category: form.category,
          curatedAverage: form.curatedAverage || null,
          curatedMedian: form.curatedMedian || null,
          curatedMax: form.curatedMax || null,
          isTime: form.category === "knitting",
          notes: form.notes || null
        })
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setMessage(data.error ?? "Unable to save benchmark");
      } else {
        setMessage(form.id ? "Curated benchmark updated." : "Curated benchmark added.");
        resetForm();
        await load();
      }
    } catch {
      setMessage("Unable to save benchmark");
    } finally {
      setBusy(false);
    }
  }

  async function remove(row: CuratedRow) {
    if (!confirm(`Remove curated reference "${row.label}"?`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/master-benchmark/${row.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setMessage(data.error ?? "Unable to delete benchmark");
      } else {
        setMessage("Curated benchmark removed.");
        if (form.id === row.id) resetForm();
        await load();
      }
    } catch {
      setMessage("Unable to delete benchmark");
    } finally {
      setBusy(false);
    }
  }

  const isTime = form.category === "knitting";
  const unit = isTime ? "min" : "USD";

  return (
    <div className="grid" style={{ marginTop: 16 }}>
      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Curated reference values</p>
            <h2>{form.id ? "Edit Reference" : "Add Reference"}</h2>
          </div>
          {form.id ? (
            <button type="button" className="button secondary small" onClick={resetForm}>Cancel Edit</button>
          ) : null}
        </div>
        <form onSubmit={save}>
          <div className="form-grid">
            <div className="field full">
              <label htmlFor="mb-label">Description (material name / operation / machine type)</label>
              <input id="mb-label" className="input" value={form.label} required
                onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="e.g. 100% Acrylic yarn" />
            </div>
            <div className="field">
              <label htmlFor="mb-category">Category</label>
              <select id="mb-category" className="input" value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value as typeof form.category })}>
                {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="mb-average">Average ({unit})</label>
              <input id="mb-average" className="input" type="number" step="any" min="0" value={form.curatedAverage}
                onChange={(e) => setForm({ ...form, curatedAverage: e.target.value })} placeholder={isTime ? "e.g. 25" : "e.g. 2.50"} />
            </div>
            <div className="field">
              <label htmlFor="mb-median">Median ({unit})</label>
              <input id="mb-median" className="input" type="number" step="any" min="0" value={form.curatedMedian}
                onChange={(e) => setForm({ ...form, curatedMedian: e.target.value })} placeholder="optional" />
            </div>
            <div className="field">
              <label htmlFor="mb-max">Max ({unit})</label>
              <input id="mb-max" className="input" type="number" step="any" min="0" value={form.curatedMax}
                onChange={(e) => setForm({ ...form, curatedMax: e.target.value })} placeholder="optional" />
            </div>
            <div className="field full">
              <label htmlFor="mb-notes">Notes (why this reference, source, validity)</label>
              <textarea id="mb-notes" className="input textarea" value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="e.g. premium yarn, verified Q3 supplier price" />
            </div>
          </div>
          <div className="form-actions">
            <button className="button" type="submit" disabled={busy}>{busy ? "Saving..." : form.id ? "Save Changes" : "Add Reference"}</button>
            {message ? <span className={`form-message ${message.includes("updated") || message.includes("added") ? "saved" : "error"}`}>{message}</span> : null}
          </div>
        </form>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Existing curated references</p>
            <h2>Curated List ({rows.length})</h2>
          </div>
          <span className="status blue">override derived</span>
        </div>
        {loading ? <p className="eyebrow">Loading…</p> : null}
        {!loading && rows.length === 0 ? <p className="notice">No curated references yet — the benchmark is currently derived from submitted CBDs only.</p> : null}
        {rows.length ? (
          <table className="table compact">
            <thead>
              <tr>
                <th>Category</th>
                <th>Description</th>
                <th>Avg</th>
                <th>Median</th>
                <th>Max</th>
                <th>Updated</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td><span className={`status ${row.category === "knitting" ? "teal" : row.category === "operation" ? "violet" : "blue"}`}>{row.category}</span></td>
                  <td>
                    <strong>{row.label}</strong>
                    {row.notes ? <><br /><span className="eyebrow">{row.notes}</span></> : null}
                    {row.updated_by ? <><br /><span className="eyebrow">by {row.updated_by}</span></> : null}
                  </td>
                  <td>{row.curated_average != null ? `${row.curated_average}${row.is_time ? " min" : ""}` : "—"}</td>
                  <td>{row.curated_median != null ? `${row.curated_median}${row.is_time ? " min" : ""}` : "—"}</td>
                  <td>{row.curated_max != null ? `${row.curated_max}${row.is_time ? " min" : ""}` : "—"}</td>
                  <td className="eyebrow">{new Date(row.updated_at).toLocaleDateString()}</td>
                  <td>
                    <button className="button secondary tiny" type="button" onClick={() => startEdit(row)}>Edit</button>{" "}
                    <button className="button tertiary tiny" type="button" disabled={busy} onClick={() => remove(row)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>
    </div>
  );
}
