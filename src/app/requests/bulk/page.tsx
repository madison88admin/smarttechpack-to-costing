"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/ui/toast";
import { IconSearch, IconCheck, IconX, IconAlert, IconArrowRight } from "@/components/ui/icons";
import { SkeletonTable } from "@/components/ui/skeleton";

type ValidationResult = {
  styleNumber: string;
  productName: string;
  status: "pending" | "searching" | "found" | "not_found" | "error" | "no_bom";
  entityId?: string;
  bomCount?: number;
  bomLines?: Array<{ id: string; category: string; materialName: string; usage?: string | number; size?: string }>;
  error?: string;
};

type CreateResult = {
  styleNumber: string;
  ok: boolean;
  requestId?: string;
  error?: string;
};

export default function BulkCreatePage() {
  const router = useRouter();
  const [csvText, setCsvText] = useState("");
  const [factoryName, setFactoryName] = useState("");
  const [season, setSeason] = useState("");
  const [brand, setBrand] = useState("");
  const [customer, setCustomer] = useState("");

  const [validationStage, setValidationStage] = useState<"input" | "validating" | "validated" | "creating" | "done">("input");
  const [validationResults, setValidationResults] = useState<ValidationResult[]>([]);
  const [createResults, setCreateResults] = useState<CreateResult[]>([]);

  const validatedItems = validationResults.filter((r) => r.status === "found" && (r.bomCount ?? 0) > 0);
  const invalidItems = validationResults.filter((r) => r.status !== "found" || (r.bomCount ?? 0) === 0);
  const canCreate = validatedItems.length > 0 && validationStage === "validated";

  function parseCsv(): string[] {
    return csvText
      .trim()
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => line.split(",")[0].trim())
      .filter(Boolean);
  }

  async function validateFromNextGen() {
    const styleNumbers = parseCsv();
    if (styleNumbers.length === 0) {
      toast.add({ type: "warning", description: "Enter at least one style number" });
      return;
    }

    setValidationStage("validating");
    setValidationResults(styleNumbers.map((s) => ({ styleNumber: s, productName: s, status: "pending" })));
    setCreateResults([]);

    for (let i = 0; i < styleNumbers.length; i++) {
      const styleNumber = styleNumbers[i];
      setValidationResults((prev) => prev.map((r, idx) => idx === i ? { ...r, status: "searching" } : r));

      try {
        // Step 1: Search NextGen for the style
        const searchRes = await fetch(`/api/product/search?q=${encodeURIComponent(styleNumber)}`);
        const searchData = await searchRes.json();

        if (!searchRes.ok || !searchData.ok || !Array.isArray(searchData.data) || searchData.data.length === 0) {
          setValidationResults((prev) => prev.map((r, idx) =>
            idx === i ? { ...r, status: "not_found", error: "Style not found in NextGen" } : r
          ));
          continue;
        }

        // Find exact match or use first result
        const match = searchData.data.find((p: any) => p.styleNumber === styleNumber) ?? searchData.data[0];

        // Step 2: Load BOM from NextGen
        const bomRes = await fetch(`/api/product/${encodeURIComponent(match.entityId)}/bom`);
        const bomData = await bomRes.json();

        if (!bomRes.ok || !bomData.ok) {
          setValidationResults((prev) => prev.map((r, idx) =>
            idx === i ? { ...r, status: "no_bom", entityId: match.entityId, productName: match.name, error: "BOM fetch failed" } : r
          ));
          continue;
        }

        const bomLines = Array.isArray(bomData.data) ? bomData.data : [];

        if (bomLines.length === 0) {
          setValidationResults((prev) => prev.map((r, idx) =>
            idx === i ? { ...r, status: "no_bom", entityId: match.entityId, productName: match.name, bomCount: 0, error: "No BOM lines in NextGen" } : r
          ));
          continue;
        }

        setValidationResults((prev) => prev.map((r, idx) =>
          idx === i ? {
            ...r,
            status: "found",
            entityId: match.entityId,
            productName: match.name,
            bomCount: bomLines.length,
            bomLines: bomLines.map((b: any) => ({
              id: b.id,
              category: b.category ?? "",
              materialName: b.materialName ?? "",
              usage: b.usage,
              size: b.size
            }))
          } : r
        ));
      } catch (err) {
        setValidationResults((prev) => prev.map((r, idx) =>
          idx === i ? { ...r, status: "error", error: err instanceof Error ? err.message : "Validation failed" } : r
        ));
      }
    }

    setValidationStage("validated");
  }

  async function createValidated() {
    if (validatedItems.length === 0) return;
    setValidationStage("creating");
    setCreateResults([]);

    const items = validatedItems.map((v) => ({
      styleNumber: v.styleNumber,
      productName: v.productName,
      entityId: v.entityId,
      bomLines: v.bomLines?.map((b) => ({
        id: b.id,
        category: b.category,
        materialName: b.materialName,
        usage: b.usage,
        size: b.size
      }))
    }));

    try {
      const res = await fetch("/api/costing/requests/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items,
          factoryName: factoryName || undefined,
          season: season || undefined,
          brand: brand || undefined,
          customer: customer || undefined
        })
      });
      const data = await res.json();

      if (data.results) {
        setCreateResults(data.results);
      }

      if (data.created > 0) {
        toast.add({ type: "success", description: `Created ${data.created} request(s)` });
        setTimeout(() => router.push("/"), 2500);
      } else {
        toast.add({ type: "warning", description: "No requests were created" });
        setValidationStage("validated");
      }
    } catch {
      toast.add({ type: "error", description: "Bulk create failed" });
      setValidationStage("validated");
    }
  }

  function resetAll() {
    setValidationStage("input");
    setValidationResults([]);
    setCreateResults([]);
  }

  return (
    <div className="bulk-create-page">
      <div className="hero bulk-hero">
        <div>
          <p className="eyebrow">PBD / Batch Operations</p>
          <h1>Bulk Create Costing Requests</h1>
          <p>Create multiple costing requests by validating style numbers against NextGen and loading BOM data before creation.</p>
        </div>
        <div className="bulk-hero-note">
          <strong>Before you begin</strong>
          <span>Only styles with a valid NextGen BOM can be sent to Factory.</span>
        </div>
      </div>

      <div className="step-list bulk-steps" aria-label="Bulk create progress">
        <div className={`step ${validationStage === "input" ? "current" : "done"}`}>
          <span className="step-number">1</span>
          <span>Enter Styles</span>
        </div>
        <div className={`step ${validationStage === "validating" ? "current" : validationStage === "validated" || validationStage === "creating" || validationStage === "done" ? "done" : ""}`}>
          <span className="step-number">2</span>
          <span>Validate NextGen + BOM</span>
        </div>
        <div className={`step ${validationStage === "creating" ? "current" : validationStage === "done" ? "done" : ""}`}>
          <span className="step-number">3</span>
          <span>Create Requests</span>
        </div>
      </div>

      {/* Step 1: Input */}
      {validationStage === "input" ? (
        <section className="panel bulk-entry-card">
          <div className="section-heading bulk-entry-heading">
            <div>
              <p className="eyebrow">Step 1 of 3</p>
              <h2>Enter style numbers</h2>
              <p className="form-message">Add one style per line. You may optionally add a product name after a comma.</p>
            </div>
            <span className="bulk-required">NextGen validation required</span>
          </div>

          <div className="form-grid bulk-context-fields">
            <div className="field">
              <label htmlFor="factoryName">Factory Name (applies to all)</label>
              <input id="factoryName" className="input" value={factoryName} onChange={(e) => setFactoryName(e.target.value)} placeholder="e.g. Cebu Factory" />
            </div>
            <div className="field">
              <label htmlFor="season">Season</label>
              <input id="season" className="input" value={season} onChange={(e) => setSeason(e.target.value)} placeholder="e.g. SS27" />
            </div>
            <div className="field">
              <label htmlFor="brand">Brand</label>
              <input id="brand" className="input" value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="e.g. M88" />
            </div>
            <div className="field">
              <label htmlFor="customer">Customer</label>
              <input id="customer" className="input" value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="e.g. Customer account" />
            </div>
          </div>

          <div className="field full bulk-style-field">
            <div className="bulk-style-label-row">
              <label htmlFor="csvInput">Styles to create</label>
              <span className="eyebrow">One per line or <code>style_number, product_name</code></span>
            </div>
            <textarea
              id="csvInput"
              className="input textarea"
              rows={8}
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              placeholder={"M88118568\nM8836232\nM8845678"}
            />
          </div>

          <div className="form-actions bulk-actions-row">
            <span className="eyebrow">We will check every style and BOM before anything is created.</span>
            <button className="button" onClick={validateFromNextGen} disabled={!csvText.trim()}>
              <IconSearch size={16} /> Validate Against NextGen
            </button>
          </div>
        </section>
      ) : null}

      {/* Step 2: Validation Results */}
      {validationStage === "validating" || validationStage === "validated" || validationStage === "creating" || validationStage === "done" ? (
        <section className="panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Step 2 — NextGen Validation</p>
              <h2>Validation Results</h2>
            </div>
            {validationStage === "validated" ? (
              <button className="button secondary btn-sm" onClick={resetAll}>
                <IconX size={14} /> Reset
              </button>
            ) : null}
          </div>

          {/* Summary */}
          <div className="grid metrics" style={{ marginBottom: 16 }}>
            <div className="metric">
              <span className="metric-label">Valid (with BOM)</span>
              <strong className="text-green">{validatedItems.length}</strong>
              <small>Ready to create</small>
            </div>
            <div className="metric">
              <span className="metric-label">Invalid</span>
              <strong className="text-red">{invalidItems.length}</strong>
              <small>Not found or no BOM</small>
            </div>
            <div className="metric">
              <span className="metric-label">Total Styles</span>
              <strong>{validationResults.length}</strong>
              <small>Entered</small>
            </div>
          </div>

          {/* Validation table */}
          <table className="table compact">
            <thead>
              <tr>
                <th>Style</th>
                <th>Product Name</th>
                <th>NextGen</th>
                <th>BOM Lines</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {validationResults.map((r, i) => (
                <tr key={i} className={r.status === "found" ? "row-approved" : "row-rejected"}>
                  <td><strong>{r.styleNumber}</strong></td>
                  <td>{r.productName}</td>
                  <td>
                    {r.status === "found" ? (
                      <span className="text-green"><IconCheck size={14} /> Found</span>
                    ) : r.status === "not_found" ? (
                      <span className="text-red"><IconX size={14} /> Not found</span>
                    ) : r.status === "searching" ? (
                      <span className="text-amber">Searching...</span>
                    ) : r.status === "pending" ? (
                      <span className="text-muted">Pending</span>
                    ) : (
                      <span className="text-red"><IconAlert size={14} /> Error</span>
                    )}
                  </td>
                  <td>
                    {r.bomCount !== undefined ? (
                      r.bomCount > 0 ? (
                        <span className="text-green">{r.bomCount} lines</span>
                      ) : (
                        <span className="text-red">0 lines</span>
                      )
                    ) : r.status === "no_bom" ? (
                      <span className="text-red">No BOM</span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td>
                    {r.status === "found" ? (
                      <span className="status green">Ready</span>
                    ) : r.status === "not_found" ? (
                      <span className="status red">Not in NextGen</span>
                    ) : r.status === "no_bom" ? (
                      <span className="status red">No BOM</span>
                    ) : r.status === "searching" ? (
                      <span className="status blue">Searching...</span>
                    ) : r.status === "error" ? (
                      <span className="status red">{r.error ?? "Error"}</span>
                    ) : (
                      <span className="status neutral">Pending</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Invalid items detail */}
          {invalidItems.length > 0 && validationStage === "validated" ? (
            <div className="notice" style={{ marginTop: 12 }}>
              <strong>{invalidItems.length} style(s) cannot be created:</strong>
              <ul style={{ margin: "6px 0 0", paddingLeft: 20 }}>
                {invalidItems.map((r, i) => (
                  <li key={i}>
                    <strong>{r.styleNumber}</strong> — {r.error ?? (r.status === "not_found" ? "Not found in NextGen" : r.status === "no_bom" ? "No BOM lines available" : "Validation error")}
                  </li>
                ))}
              </ul>
              <p style={{ margin: "6px 0 0" }}>Only styles with valid NextGen BOM data will be created. Remove invalid styles or fix them in NextGen first.</p>
            </div>
          ) : null}

          {/* Create button */}
          {validationStage === "validated" ? (
            <div className="form-actions" style={{ marginTop: 16 }}>
              <button className="button" onClick={createValidated} disabled={!canCreate}>
                <IconCheck size={16} /> Create {validatedItems.length} Request(s)
              </button>
              <button className="button secondary" onClick={resetAll}>
                <IconX size={14} /> Cancel
              </button>
            </div>
          ) : null}

          {/* Creating progress */}
          {validationStage === "creating" ? (
            <div className="form-actions" style={{ marginTop: 16 }}>
              <span className="form-message"><span className="spinner" /> Creating requests...</span>
            </div>
          ) : null}

          {/* Create results */}
          {createResults.length > 0 ? (
            <div style={{ marginTop: 16 }}>
              <h3>Creation Results</h3>
              <table className="table compact">
                <thead>
                  <tr>
                    <th>Style</th>
                    <th>Status</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {createResults.map((r, i) => (
                    <tr key={i} className={r.ok ? "row-approved" : "row-rejected"}>
                      <td><strong>{r.styleNumber}</strong></td>
                      <td className={r.ok ? "text-green" : "text-red"}>
                        {r.ok ? <><IconCheck size={14} /> Created</> : <><IconX size={14} /> Failed</>}
                      </td>
                      <td>{r.error ?? r.requestId ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {validationStage === "done" ? (
                <p className="form-message saved" style={{ marginTop: 8 }}>
                  Redirecting to dashboard... <IconArrowRight size={14} />
                </p>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
