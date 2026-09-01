"use client";

import { useState } from "react";

type Preview = {
  ok: boolean;
  activeRequests?: number;
  uniqueStyles?: number;
  baselined?: number;
  error?: string;
};

type CheckResult = {
  ok: boolean;
  checked?: number;
  changed?: number;
  alertedRequests?: number;
  baselined?: number;
  errors?: string[];
  error?: string;
};

/**
 * Admin tool: compare the stored NextGen BOM version of every active style
 * against the live NextGen BOM and alert the costing team when the BOM changed
 * upstream (HeaderVersionNumber / BomVersionComment).
 */
export function NextGenBomCheck() {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [busy, setBusy] = useState(false);

  async function runPreview() {
    setBusy(true);
    setResult(null);
    try {
      const response = await fetch("/api/admin/check-bom-versions");
      setPreview((await response.json()) as Preview);
    } catch {
      setPreview({ ok: false, error: "Preview request failed" });
    } finally {
      setBusy(false);
    }
  }

  async function runCheck() {
    setBusy(true);
    setResult(null);
    try {
      const response = await fetch("/api/admin/check-bom-versions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      setResult((await response.json()) as CheckResult);
    } catch {
      setResult({ ok: false, error: "Check request failed" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="nextgen-bom-check">
      <div className="import-zone">
        <p>
          <strong>Check NextGen BOM Versions</strong>
        </p>
        <p className="eyebrow">
          Compare stored BOM versions against live NextGen and alert costing when a style&apos;s BOM changed
        </p>
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button type="button" className="button secondary" onClick={runPreview} disabled={busy}>
            {busy ? "Working…" : "Preview"}
          </button>
          <button type="button" className="button" onClick={runCheck} disabled={busy}>
            {busy ? "Checking…" : "Check now"}
          </button>
        </div>
      </div>

      {preview?.error ? <p className="form-message error">{preview.error}</p> : null}

      {preview?.ok ? (
        <div className="import-preview">
          <p className="eyebrow">
            <strong>{preview.activeRequests ?? 0}</strong> active request(s) ·{" "}
            <strong>{preview.uniqueStyles ?? 0}</strong> unique style(s) ·{" "}
            <strong>{preview.baselined ?? 0}</strong> with a stored BOM version
          </p>
        </div>
      ) : null}

      {result ? (
        result.ok ? (
          <div className="import-preview">
            <p className="eyebrow">
              Check complete — <strong>{result.checked ?? 0}</strong> style(s) checked ·{" "}
              <strong>{result.changed ?? 0}</strong> changed ·{" "}
              <strong>{result.alertedRequests ?? 0}</strong> request(s) alerted ·{" "}
              <strong>{result.baselined ?? 0}</strong> baseline(s) recorded
            </p>
            {result.errors?.length ? (
              <p className="form-message error">{result.errors.join("; ")}</p>
            ) : null}
          </div>
        ) : (
          <p className="form-message error">{result.error ?? "Check failed"}</p>
        )
      ) : null}
    </div>
  );
}
