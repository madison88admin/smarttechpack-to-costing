"use client";

import { useState, useEffect, type FormEvent } from "react";

type Material = {
  id: string;
  material_name: string;
  category: string | null;
  uom: string;
  specification: string | null;
  composition: string | null;
  supplier_name: string | null;
  standard_unit_cost: number | null;
  currency: string;
  moq: number | null;
  lead_time_days: number | null;
  is_active: boolean;
  nextgen_material_id: string | null;
};

export function MaterialLibraryManager() {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState("");
  const [syncMessage, setSyncMessage] = useState("");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");

  useEffect(() => {
    loadMaterials();
  }, []);

  async function loadMaterials(query?: string, category?: string) {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (query) params.set("q", query);
      if (category) params.set("category", category);
      const res = await fetch(`/api/material-library?${params.toString()}`);
      const data = await res.json();
      if (data.ok) setMaterials(data.data ?? []);
    } catch {
      setMessage("Failed to load materials");
    } finally {
      setLoading(false);
    }
  }

  async function syncFromNextGen() {
    setSyncing(true);
    setSyncMessage("");
    try {
      const res = await fetch("/api/admin/sync-materials", { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        const d = data.data;
        setSyncMessage(
          `Synced ${d.uniqueMaterials} materials from NextGen — ${d.inserted} new, ${d.updated} updated, ${d.skipped} skipped (${d.productsProcessed} products, ${d.bomLinesFound} BOM lines)`
        );
        loadMaterials(search, categoryFilter);
      } else {
        setSyncMessage(`Sync failed: ${data.error ?? "Unknown error"}`);
      }
    } catch {
      setSyncMessage("Unable to connect to sync service");
    } finally {
      setSyncing(false);
    }
  }

  async function addMaterial(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    const res = await fetch("/api/material-library", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        materialName: form.get("materialName"),
        category: form.get("category"),
        uom: form.get("uom"),
        specification: form.get("specification"),
        composition: form.get("composition"),
        supplierName: form.get("supplierName"),
        standardUnitCost: form.get("standardUnitCost") ? parseFloat(String(form.get("standardUnitCost"))) : null,
        currency: form.get("currency"),
        moq: form.get("moq") ? parseInt(String(form.get("moq"))) : null,
        leadTimeDays: form.get("leadTimeDays") ? parseInt(String(form.get("leadTimeDays"))) : null
      })
    });
    const data = await res.json();
    if (data.ok) {
      setMessage("Material added");
      event.currentTarget.reset();
      loadMaterials(search, categoryFilter);
    } else {
      setMessage(data.error ?? "Failed to add material");
    }
    setBusy(false);
  }

  // Get unique categories for filter dropdown
  const categories = [...new Set(materials.map((m) => m.category).filter(Boolean))] as string[];

  return (
    <div>
      {/* Sync button + search bar */}
      <div className="toolbar" style={{ marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
        <button
          className="button"
          onClick={syncFromNextGen}
          disabled={syncing}
          style={{ whiteSpace: "nowrap" }}
        >
          {syncing ? <><span className="spinner" /> Syncing from NextGen...</> : "Sync from NextGen"}
        </button>
        <input
          className="input"
          placeholder="Search materials by name..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); loadMaterials(e.target.value, categoryFilter); }}
          style={{ maxWidth: 250 }}
        />
        <select
          className="input"
          value={categoryFilter}
          onChange={(e) => { setCategoryFilter(e.target.value); loadMaterials(search, e.target.value); }}
          style={{ maxWidth: 150 }}
        >
          <option value="">All categories</option>
          {categories.map((cat) => (
            <option key={cat} value={cat}>{cat}</option>
          ))}
        </select>
        <span className="eyebrow" style={{ marginLeft: "auto" }}>
          {materials.length} material{materials.length !== 1 ? "s" : ""}
        </span>
      </div>

      {syncMessage ? (
        <p className={`form-message ${syncMessage.startsWith("Synced") ? "saved" : "error"}`} style={{ marginBottom: 12 }}>
          {syncMessage}
        </p>
      ) : null}

      <details style={{ marginBottom: 16 }}>
        <summary className="eyebrow" style={{ cursor: "pointer", marginBottom: 8 }}>Add New Material Manually</summary>
        <form className="form-grid" onSubmit={addMaterial} style={{ marginTop: 8 }}>
          <div className="field">
            <label htmlFor="materialName">Material Name *</label>
            <input id="materialName" name="materialName" className="input" required placeholder="e.g. Wool Yarn 30s" />
          </div>
          <div className="field">
            <label htmlFor="category">Category</label>
            <input id="category" name="category" className="input" placeholder="Yarn, Fabric, Trim..." />
          </div>
          <div className="field">
            <label htmlFor="uom">UOM</label>
            <select id="uom" name="uom" className="input" defaultValue="kg">
              <option>kg</option>
              <option>m</option>
              <option>yd</option>
              <option>pc</option>
              <option>roll</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="specification">Specification</label>
            <input id="specification" name="specification" className="input" placeholder="count, weight, width..." />
          </div>
          <div className="field">
            <label htmlFor="composition">Composition</label>
            <input id="composition" name="composition" className="input" placeholder="100% Wool" />
          </div>
          <div className="field">
            <label htmlFor="supplierName">Supplier Name</label>
            <input id="supplierName" name="supplierName" className="input" placeholder="Supplier company" />
          </div>
          <div className="field">
            <label htmlFor="standardUnitCost">Standard Unit Cost</label>
            <input id="standardUnitCost" name="standardUnitCost" className="input" type="number" step="0.01" placeholder="0.00" />
          </div>
          <div className="field">
            <label htmlFor="currency">Currency</label>
            <select id="currency" name="currency" className="input" defaultValue="USD">
              <option>USD</option>
              <option>PHP</option>
              <option>CNY</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="moq">MOQ</label>
            <input id="moq" name="moq" className="input" type="number" placeholder="e.g. 500" />
          </div>
          <div className="field">
            <label htmlFor="leadTimeDays">Lead Time (days)</label>
            <input id="leadTimeDays" name="leadTimeDays" className="input" type="number" placeholder="e.g. 30" />
          </div>
          <div className="form-actions">
            <button className="button" type="submit" disabled={busy}>
              {busy ? "Adding..." : "Add Material"}
            </button>
          </div>
        </form>
      </details>

      {loading ? (
        <p className="eyebrow">Loading materials...</p>
      ) : materials.length === 0 ? (
        <section className="panel">
          <p className="notice">No materials in library yet.</p>
          <p>Click <strong>Sync from NextGen</strong> above to pull all BOM materials from NextGen automatically, or add materials manually.</p>
        </section>
      ) : (
        <table className="table compact">
          <thead>
            <tr>
              <th>Material</th>
              <th>Category</th>
              <th>Spec</th>
              <th>UOM</th>
              <th>Supplier</th>
              <th>Std Cost</th>
              <th>MOQ</th>
              <th>Lead Time</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {materials.map((m) => (
              <tr key={m.id}>
                <td><strong>{m.material_name}</strong></td>
                <td>{m.category ?? "—"}</td>
                <td>{m.specification ?? "—"}</td>
                <td>{m.uom ?? "—"}</td>
                <td>{m.supplier_name ?? "—"}</td>
                <td>{m.standard_unit_cost ? `${m.currency} ${m.standard_unit_cost}` : "—"}</td>
                <td>{m.moq ?? "—"}</td>
                <td>{m.lead_time_days ? `${m.lead_time_days}d` : "—"}</td>
                <td>
                  {m.nextgen_material_id ? (
                    <span className="status blue" style={{ fontSize: 11 }}>NextGen</span>
                  ) : (
                    <span className="eyebrow">Manual</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {message ? <p className="form-message saved">{message}</p> : null}
    </div>
  );
}
