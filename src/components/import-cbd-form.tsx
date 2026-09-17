"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ImportCbdForm() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [factory, setFactory] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!file) return setMessage("Select an Excel CBD file first.");
    setBusy(true); setMessage("");
    const body = new FormData(); body.append("file", file); body.append("factoryName", factory);
    const response = await fetch("/api/costing/requests/import-cbd", { method: "POST", body });
    const result = await response.json(); setBusy(false);
    if (!response.ok || !result.ok) return setMessage(result.error ?? "Import failed");
    setMessage(`Imported ${result.data.styleNumber} as ${result.data.requestNumber}. Opening request…`);
    router.push(`/requests/${result.data.id}`);
  }

  return <section className="panel import-card"><form onSubmit={submit} className="grid" style={{ gap: 16 }}><label className="field"><span>Factory name</span><input className="input" value={factory} onChange={(event) => setFactory(event.target.value)} placeholder="e.g. PT U-Jump Indo" required /></label><label className="field"><span>CBD Excel workbook</span><input className="input file-input" type="file" accept=".xlsx,.xls" onChange={(event) => setFile(event.target.files?.[0] ?? null)} required /><small className="muted">Accepted formats: .xlsx or .xls</small></label><button className="button" disabled={busy}>{busy ? "Importing workbook…" : "Import as draft"}</button>{message ? <p className="notice" role="status">{message}</p> : null}</form></section>;
}
