"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/ui/toast";

type ImportState = "idle" | "parsing" | "preview" | "submitting" | "done" | "error";

type ParsedPreview = {
  customer: string | null;
  season: string | null;
  styleNumber: string | null;
  styleName: string | null;
  costedQty?: string | null;
  finishWeight?: string | null;
  moq?: number | null;
  leadTimeDays?: number | null;
  yarnLines: Array<{ name: string; consumption: string; materialPrice: string; materialCost: string }>;
  fabricLines: Array<{ name: string; consumption: string; materialPrice: string; materialCost: string }>;
  trimLines: Array<{ name: string; consumption: string; materialPrice: string; materialCost: string }>;
  knittingLines: Array<{ machineType: string; knittingTime: string; sah: string; knittingCost: string }>;
  operationsLines: Array<{ operation: string; operationCost: string }>;
  standardPackagingCost: number | null;
  specialPackagingCost: number | null;
  overheadCost: number | null;
  profitCost: number | null;
  totalFactoryCost: number | null;
  sourceFileName?: string | null;
  sourceFileType?: string | null;
  warnings: string[];
  errors: string[];
};

function formatBytes(bytes: number) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / 1024 / 1024).toFixed(1) + " MB";
}

function FileIcon({ type }: { type: string }) {
  const isPdf = type.includes("pdf");
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 36,
        height: 36,
        borderRadius: 8,
        background: isPdf ? "#fef2f2" : "#ecfdf5",
        border: `1px solid ${isPdf ? "#fca5a5" : "#a7f3d0"}`,
        fontSize: 12,
        fontWeight: 800,
        color: isPdf ? "#b91c1c" : "#065f46",
      }}
    >
      {isPdf ? "PDF" : "XLS"}
    </span>
  );
}

export function CbdImportUpload({ requestId }: { requestId: string }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<ImportState>("idle");
  const [dragOver, setDragOver] = useState(false);
  const [message, setMessage] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [parsedData, setParsedData] = useState<ParsedPreview | null>(null);
  const [validation, setValidation] = useState<{ isValid: boolean; errors: string[]; warnings: string[] } | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  const MAX_BYTES = 10 * 1024 * 1024;

  async function parseFile(file: File) {
    if (file.size > MAX_BYTES) {
      setState("error");
      setMessage(`File too large (${formatBytes(file.size)}). Max 10 MB.`);
      toast.add({ type: "error", description: "File too large — max 10 MB" });
      return;
    }
    const ext = file.name.toLowerCase().split(".").pop();
    if (ext && !["xlsx", "xls", "csv", "pdf"].includes(ext)) {
      setState("error");
      setMessage(`Unsupported .${ext} — please upload .xlsx, .xls or .pdf`);
      return;
    }
    setSelectedFile(file);
    setState("parsing");
    setMessage("");
    const formData = new FormData();
    formData.append("file", file);
    formData.append("costingRequestId", requestId);
    try {
      const res = await fetch("/api/costing/import", { method: "POST", body: formData });
      const result = await res.json();
      if (!result.ok) {
        setState("error");
        setMessage(result.error || "Parse failed");
        toast.add({ type: "error", description: result.error || "Parse failed" });
        return;
      }
      setParsedData(result.parsedData);
      setValidation(result.validation);
      setState("preview");
    } catch {
      setState("error");
      setMessage("Failed to parse file — check network and retry");
    }
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) await parseFile(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) parseFile(file);
  }

  async function handleImport(autoSubmit: boolean) {
    if (!selectedFile) return;
    setState("submitting");
    const formData = new FormData();
    formData.append("file", selectedFile);
    formData.append("costingRequestId", requestId);
    formData.append("status", autoSubmit ? "submitted" : "draft");
    formData.append("autoSubmit", autoSubmit ? "true" : "false");
    try {
      const res = await fetch("/api/costing/import", { method: "POST", body: formData });
      const result = await res.json();
      if (!result.ok) {
        setState("error");
        setMessage(result.error);
        toast.add({ type: "error", description: result.error });
        return;
      }
      setState("done");
      setMessage(autoSubmit ? "CBD imported and submitted for MD review!" : "CBD imported as draft — you can review then submit.");
      toast.add({ type: "success", description: autoSubmit ? "Submitted for MD review" : "Draft saved" });
      router.refresh();
    } catch {
      setState("error");
      setMessage("Import failed — please retry");
    }
  }

  function downloadTemplate() {
    // Generate a minimal valid template client-side so user can test import instantly
    import("xlsx").then((XLSX) => {
      const rows: (string | number | null)[][] = [
        ["Customer", "Internal Live Test", "", "Season", "F27"],
        ["Style #", "M88-DEMO", "", "Style Name", "Demo Beanie"],
        ["MOQ", 500, "", "Leadtime", "30 days"],
        ["Finish Weight", "100gr", "", "Costed Qty", "1000 pcs"],
        [],
        ["YARN", "Consumption (g)", "Price (USD/kg)", "Cost"],
        ["100%ACRYLIC", 50, 5, 0.25],
        ["e-tip yarn", 5, 2, 0.01],
        [],
        ["FABRIC", "Consumption", "Price", "Cost"],
        ["leather", 0.1, 8, 0.8],
        [],
        ["TRIM", "Consumption", "Price", "Cost"],
        ["Sewing Thread", 1, 0.05, 0.05],
        [],
        ["KNITTING", "Time (mins)", "SAH", "Cost"],
        ["Flat-7GG", 10, 0.02, 0.2],
        [],
        ["OPERATIONS", "", "", "Cost"],
        ["Linking", "", "", 0.15],
        [],
        ["PACKAGING", "", "", "Cost"],
        ["Standard", "", "", 0.1],
        ["Special", "", "", 0.02],
        [],
        ["OVERHEAD / PROFIT", "", "", "Cost"],
        ["Overhead", "", "", 0.2],
        ["Profit", "", "", 0.25],
        [],
        ["TOTAL FACTORY COST", "", "", 2.05],
      ];
      const ws = XLSX.utils.aoa_to_sheet(rows);
      ws["!cols"] = [{ wch: 24 }, { wch: 16 }, { wch: 16 }, { wch: 14 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "FTY CBD");
      XLSX.writeFile(wb, "FTY_CBD_Template.xlsx");
      toast.add({ type: "success", description: "Template downloaded" });
    });
  }

  function reset() {
    setState("idle");
    setSelectedFile(null);
    setParsedData(null);
    setValidation(null);
    setShowDetails(false);
    setMessage("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const canSubmit = validation?.isValid;
  const hasWarnings = (validation?.warnings?.length ?? 0) > 0 || (parsedData?.warnings?.length ?? 0) > 0;

  return (
    <div className="panel" style={{ marginBottom: 16 }}>
      <div className="section-heading">
        <div>
          <p className="eyebrow">Import from Excel / PDF</p>
          <h2>Upload FTY CBD</h2>
          <p className="muted" style={{ fontSize: 12, margin: "4px 0 0" }}>
            Excel (.xlsx/.xls) recommended — PDF text extraction works for digital PDFs (not scanned images). Max 10 MB.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="button secondary small" onClick={downloadTemplate}>
            Download Template
          </button>
          {state !== "idle" && (
            <button type="button" className="button secondary small" onClick={reset}>
              Reset
            </button>
          )}
        </div>
      </div>

      {state === "idle" && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          style={{
            border: `2px dashed ${dragOver ? "var(--brand)" : "var(--line)"}`,
            borderRadius: 12,
            padding: 28,
            textAlign: "center",
            background: dragOver ? "var(--brand-soft)" : "#fbfcfb",
            transition: "border-color 0.2s, background 0.2s",
          }}
        >
          <p style={{ marginBottom: 8, fontWeight: 700 }}>Drag & drop Excel or PDF here</p>
          <p style={{ fontSize: 12, color: "#666", marginBottom: 14 }}>or click to browse — supports .xlsx, .xls, .pdf</p>
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv,.pdf" onChange={handleFileSelect} style={{ display: "none" }} />
          <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
            <button type="button" className="button" onClick={() => fileInputRef.current?.click()}>
              Select File
            </button>
            <button type="button" className="button secondary" onClick={downloadTemplate}>
              Get Template
            </button>
          </div>
          <p style={{ fontSize: 11, color: "#888", marginTop: 12 }}>Tip: PDF must be text-based (digital), not a photo/scan. Scanned PDFs → please use Excel.</p>
        </div>
      )}

      {selectedFile && state !== "idle" && state !== "done" && state !== "error" && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", border: "1px solid var(--line)", borderRadius: 10, background: "#fff", marginBottom: 12 }}>
          <FileIcon type={selectedFile.type || selectedFile.name} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <strong style={{ display: "block", fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selectedFile.name}</strong>
            <span style={{ fontSize: 11, color: "#666" }}>
              {formatBytes(selectedFile.size)} · {selectedFile.name.toLowerCase().endsWith(".pdf") ? "PDF" : "Excel"} {parsedData?.sourceFileType ? `· parsed as ${parsedData.sourceFileType}` : ""}
            </span>
          </div>
          <span className="status neutral" style={{ fontSize: 11 }}>{state === "parsing" ? "Parsing…" : state === "preview" ? "Preview" : state === "submitting" ? "Saving…" : ""}</span>
        </div>
      )}

      {state === "parsing" && (
        <div style={{ textAlign: "center", padding: 24 }}>
          <span className="spinner" aria-label="Parsing" />
          <p style={{ marginTop: 12, fontSize: 13, color: "#666" }}>Extracting yarn, fabric, knitting…</p>
        </div>
      )}

      {state === "preview" && parsedData && (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px,1fr))", gap: 10, marginBottom: 14 }}>
            <div className="field" style={{ margin: 0, padding: 10, border: "1px solid var(--line)", borderRadius: 8, background: "#fff" }}>
              <span className="eyebrow" style={{ fontSize: 10 }}>Customer</span>
              <strong style={{ display: "block", marginTop: 4 }}>{parsedData.customer || "—"}</strong>
            </div>
            <div className="field" style={{ margin: 0, padding: 10, border: "1px solid var(--line)", borderRadius: 8, background: "#fff" }}>
              <span className="eyebrow" style={{ fontSize: 10 }}>Season</span>
              <strong style={{ display: "block", marginTop: 4 }}>{parsedData.season || "—"}</strong>
            </div>
            <div className="field" style={{ margin: 0, padding: 10, border: "1px solid var(--line)", borderRadius: 8, background: "#fff" }}>
              <span className="eyebrow" style={{ fontSize: 10 }}>Style #</span>
              <strong style={{ display: "block", marginTop: 4 }}>{parsedData.styleNumber || "—"}</strong>
            </div>
            <div className="field" style={{ margin: 0, padding: 10, border: "1px solid var(--line)", borderRadius: 8, background: "#fff" }}>
              <span className="eyebrow" style={{ fontSize: 10 }}>Style Name</span>
              <strong style={{ display: "block", marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{parsedData.styleName || "—"}</strong>
            </div>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
            <span className="status neutral">Yarn {parsedData.yarnLines?.length ?? 0}</span>
            <span className="status neutral">Fabric {parsedData.fabricLines?.length ?? 0}</span>
            <span className="status neutral">Trim {parsedData.trimLines?.length ?? 0}</span>
            <span className="status neutral">Knitting {parsedData.knittingLines?.length ?? 0}</span>
            <span className="status neutral">Ops {parsedData.operationsLines?.length ?? 0}</span>
            {parsedData.totalFactoryCost != null && <span className="status green">Total {parsedData.totalFactoryCost.toFixed(2)}</span>}
          </div>

          {hasWarnings && (
            <div className="notice" style={{ marginBottom: 10, background: "#fffbeb", borderColor: "#fcd34d", color: "#92400e" }}>
              <strong style={{ display: "flex", gap: 6, alignItems: "center" }}>⚠️ Warnings ({(validation?.warnings?.length ?? 0) + (parsedData.warnings?.length ?? 0)})</strong>
              <ul style={{ margin: "6px 0 0 16px", fontSize: 12 }}>
                {[...(validation?.warnings ?? []), ...(parsedData.warnings ?? [])].map((w: string, i: number) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}
          {validation && validation.errors?.length > 0 && (
            <div className="notice" style={{ marginBottom: 10, background: "#fef2f2", borderColor: "#fca5a5", color: "#b91c1c" }}>
              <strong>❌ Must fix before import ({validation.errors.length})</strong>
              <ul style={{ margin: "6px 0 0 16px", fontSize: 12 }}>
                {validation.errors.map((e: string, i: number) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </div>
          )}
          {validation?.isValid && !hasWarnings && <div className="notice" style={{ background: "#f0fdf4", borderColor: "#86efac", color: "#166534" }}>✓ All checks passed — ready to import</div>}
          {validation?.isValid && hasWarnings && <div className="notice" style={{ background: "#f0fdf4", borderColor: "#86efac", color: "#166534" }}>✓ Required fields ok — you can import (warnings shown above)</div>}

          <button type="button" className="button secondary small" style={{ marginTop: 10 }} onClick={() => setShowDetails(!showDetails)}>
            {showDetails ? "Hide" : "Show"} extracted tables
          </button>
          {showDetails && (
            <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
              {[
                { label: "Yarn", rows: parsedData.yarnLines, cols: ["name", "consumption", "materialPrice", "materialCost"] },
                { label: "Fabric", rows: parsedData.fabricLines, cols: ["name", "consumption", "materialPrice", "materialCost"] },
                { label: "Trim", rows: parsedData.trimLines, cols: ["name", "consumption", "materialPrice", "materialCost"] },
                { label: "Knitting", rows: parsedData.knittingLines, cols: ["machineType", "knittingTime", "sah", "knittingCost"] },
                { label: "Operations", rows: parsedData.operationsLines, cols: ["operation", "operationCost"] },
              ].map(({ label, rows, cols }) =>
                rows?.length ? (
                  <div key={label} style={{ border: "1px solid var(--line)", borderRadius: 8, overflow: "hidden" }}>
                    <div style={{ padding: "8px 10px", background: "#f8faf8", fontWeight: 700, fontSize: 12 }}>{label} ({rows.length})</div>
                    <div style={{ overflowX: "auto" }}>
                      <table className="table compact" style={{ margin: 0 }}>
                        <thead>
                          <tr>
                            {cols.map((c) => (
                              <th key={c} style={{ fontSize: 11 }}>{c}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {rows.slice(0, 8).map((r: Record<string, string>, i: number) => (
                            <tr key={i}>
                              {cols.map((c) => (
                                <td key={c} style={{ fontSize: 12 }}>{r[c] || "—"}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {rows.length > 8 && <div style={{ padding: 6, textAlign: "center", fontSize: 11, color: "#666" }}>+{rows.length - 8} more rows</div>}
                  </div>
                ) : null
              )}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px,1fr))", gap: 8 }}>
                <div style={{ padding: 8, border: "1px solid var(--line)", borderRadius: 8, fontSize: 12 }}>Std Pack: <strong>{parsedData.standardPackagingCost ?? "—"}</strong></div>
                <div style={{ padding: 8, border: "1px solid var(--line)", borderRadius: 8, fontSize: 12 }}>Special: <strong>{parsedData.specialPackagingCost ?? "—"}</strong></div>
                <div style={{ padding: 8, border: "1px solid var(--line)", borderRadius: 8, fontSize: 12 }}>Overhead: <strong>{parsedData.overheadCost ?? "—"}</strong></div>
                <div style={{ padding: 8, border: "1px solid var(--line)", borderRadius: 8, fontSize: 12 }}>Profit: <strong>{parsedData.profitCost ?? "—"}</strong></div>
              </div>
            </div>
          )}

          <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
            <button type="button" className="button secondary" onClick={() => handleImport(false)} disabled={!canSubmit} title={!canSubmit ? "Fix errors above" : ""}>
              Import as Draft
            </button>
            <button type="button" className="button" onClick={() => handleImport(true)} disabled={!canSubmit} title={!canSubmit ? "Fix errors above" : ""}>
              Import & Submit for MD Review
            </button>
            {!canSubmit && <span style={{ fontSize: 11, color: "#b91c1c", alignSelf: "center" }}>Fix errors to enable import</span>}
          </div>
          {hasWarnings && canSubmit && <p style={{ fontSize: 11, color: "#92400e", marginTop: 8 }}>Warnings won’t block import, but please verify the highlighted fields.</p>}
        </div>
      )}

      {state === "submitting" && (
        <div style={{ textAlign: "center", padding: 24 }}>
          <span className="spinner" aria-label="Importing" />
          <p style={{ marginTop: 12, fontSize: 13, color: "#666" }}>Saving CBD…</p>
        </div>
      )}

      {state === "done" && (
        <div className="notice" style={{ textAlign: "center", padding: 20, background: "#f0fdf4", borderColor: "#86efac", color: "#166534" }}>
          <strong>✓ {message}</strong>
          <div style={{ marginTop: 12 }}>
            <button className="button" onClick={reset}>
              Import Another File
            </button>
          </div>
        </div>
      )}

      {state === "error" && (
        <div className="notice" style={{ textAlign: "center", padding: 20, background: "#fef2f2", borderColor: "#fca5a5", color: "#b91c1c" }}>
          <strong>Import failed</strong>
          <p style={{ marginTop: 8, fontSize: 12 }}>{message}</p>
          {message?.includes("Scanned PDF") && <p style={{ fontSize: 11, marginTop: 8 }}>Tip: Print the PDF to Excel or request a digital PDF from the factory.</p>}
          <button className="button secondary" style={{ marginTop: 12 }} onClick={reset}>
            Try Again
          </button>
        </div>
      )}
    </div>
  );
}
