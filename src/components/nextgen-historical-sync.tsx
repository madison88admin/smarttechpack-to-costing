"use client";

import { useState } from "react";

function fmtNum(value: number | null): string {
  return value === null ? "—" : String(value);
}

type StatusCount = { status: string; total: number };

type PreviewData = {
  ok: boolean;
  statuses: StatusCount[];
  totalInNextGen?: number;
  alreadySynced?: number;
  error?: string;
};

type SyncData = {
  ok: boolean;
  scanned?: number;
  mapped?: number;
  alreadySynced?: number;
  inserted?: number;
  failed?: number;
  perStatus?: StatusCount[];
  errors?: string[];
  enrichBom?: boolean;
  message?: string;
  error?: string;
  // Backfill response fields
  candidates?: number;
  matched?: number;
  updated?: number;
  skipped?: number;
  // Backfill dry-run preview fields
  dryRun?: boolean;
  wouldUpdate?: number;
  wouldSkip?: number;
  preview?: DryRunChange[];
  totalPreview?: number;
  previewTruncated?: boolean;
};

type DryRunChange = {
  style_number: string | null;
  factory_name: string | null;
  knitting_time?: { from: number | null; to: number };
  average_consumption?: { from: number | null; to: number };
};

/**
 * Admin tool: pull Dropped/archived products + default costing from NextGen
 * into historical_costings so AI search, comparisons, and analytics can use
 * the historical archive. Synced rows are source='nextgen' and excluded from
 * cost benchmarks (they are dropped products, not approved costings).
 */
export function NextGenHistoricalSyncTool() {
  const [status, setStatus] = useState("Dropped");
  const [limit, setLimit] = useState("");
  const [enrichBom, setEnrichBom] = useState(false);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [result, setResult] = useState<SyncData | null>(null);
  const [busy, setBusy] = useState(false);

  async function runPreview() {
    setBusy(true);
    setResult(null);
    try {
      const params = new URLSearchParams({ statuses: status });
      if (limit.trim()) params.set("limit", limit.trim());
      const response = await fetch(`/api/admin/sync-nextgen-historical?${params.toString()}`);
      const data = (await response.json()) as PreviewData;
      setPreview(data);
    } catch {
      setPreview({ ok: false, statuses: [], error: "Preview request failed" });
    } finally {
      setBusy(false);
    }
  }

  async function runSync() {
    setBusy(true);
    setResult(null);
    try {
      const response = await fetch("/api/admin/sync-nextgen-historical", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ statuses: status, limit: limit.trim() || undefined, enrichBom })
      });
      const data = (await response.json()) as SyncData;
      setResult(data);
    } catch {
      setResult({ ok: false, error: "Sync request failed" });
    } finally {
      setBusy(false);
    }
  }

  // Backfill dry-run: preview exactly which rows/fields would change without
  // writing anything, so the real run is a confirmed action.
  async function runBackfillPreview() {
    setBusy(true);
    setResult(null);
    try {
      const response = await fetch("/api/admin/backfill-nextgen-times", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ statuses: status, limit: limit.trim() || undefined, enrichBom, dryRun: true })
      });
      const data = (await response.json()) as SyncData;
      setResult(data);
    } catch {
      setResult({ ok: false, error: "Backfill preview request failed" });
    } finally {
      setBusy(false);
    }
  }

  // Backfill: re-fetch existing NextGen rows and push knitting-time/SMV values
  // (and optionally BOM consumption) into rows that are already synced. Safe to
  // run repeatedly — only changed values are written, never nulls.
  async function runBackfill() {
    setBusy(true);
    setResult(null);
    try {
      const response = await fetch("/api/admin/backfill-nextgen-times", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ statuses: status, limit: limit.trim() || undefined, enrichBom })
      });
      const data = (await response.json()) as SyncData;
      setResult(data);
    } catch {
      setResult({ ok: false, error: "Backfill request failed" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="nextgen-sync-tool">
      <div className="import-zone">
        <p>
          <strong>Sync NextGen Historical Archive</strong>
        </p>
        <p className="eyebrow">
          Pull Dropped/archived styles + default costing from NextGen into the historical table
        </p>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 10 }}>
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="NextGen status">
            <option value="Dropped">Dropped</option>
            <option value="Closed">Closed</option>
            <option value="Completed">Completed</option>
            <option value="Cancelled">Cancelled</option>
            <option value="Archived">Archived</option>
            <option value="Dropped,Closed,Completed,Cancelled,Archived">All historical statuses</option>
          </select>
          <input
            type="number"
            min={1}
            placeholder="Limit (optional)"
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            style={{ width: 130 }}
            aria-label="Sync limit"
          />
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" checked={enrichBom} onChange={(e) => setEnrichBom(e.target.checked)} />
            Enrich BOM consumption
          </label>
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button type="button" className="button secondary" onClick={runPreview} disabled={busy}>
            {busy ? "Working…" : "Check NextGen"}
          </button>
          <button type="button" className="button" onClick={runSync} disabled={busy}>
            {busy ? "Working…" : "Sync now"}
          </button>
          <button
            type="button"
            className="button secondary"
            onClick={runBackfillPreview}
            disabled={busy}
            title="Preview which rows/fields would change before writing anything"
          >
            {busy ? "Working…" : "Preview backfill changes"}
          </button>
          <button type="button" className="button secondary" onClick={runBackfill} disabled={busy} title="Re-fetch existing rows and populate knitting time/SMV once NextGen returns them">
            {busy ? "Working…" : "Backfill knit/SMV times"}
          </button>
        </div>
      </div>

      {preview?.error ? <p className="form-message error">{preview.error}</p> : null}

      {preview?.ok ? (
        <div className="import-preview">
          <p className="eyebrow">
            NextGen has <strong>{preview.totalInNextGen ?? 0} historical product(s)</strong> in{" "}
            {preview.statuses.length} status(es); <strong>{preview.alreadySynced ?? 0} already synced</strong>
          </p>
          <ul className="list compact-list">
            {preview.statuses.map((c) => (
              <li key={c.status}>
                <strong>{c.status}</strong>: {c.total}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {result ? (
        result.ok ? (
          <div className="import-preview">
            {result.dryRun ? (
              <div className="dry-run-preview">
                <p className="eyebrow">
                  Dry run — <strong>{result.wouldUpdate ?? 0} row(s) would change</strong> (
                  {result.totalPreview ?? 0} field update(s)), {result.wouldSkip ?? 0} skipped.{" "}
                  <strong>Nothing was written.</strong>
                </p>
                {result.preview?.length ? (
                  <ul className="list compact-list">
                    {result.preview.slice(0, 50).map((p, i) => (
                      <li key={i}>
                        <strong>{p.style_number ?? "?"}</strong> · {p.factory_name ?? "?"} —{" "}
                        {p.knitting_time
                          ? `knitting time ${fmtNum(p.knitting_time.from)} → ${p.knitting_time.to}`
                          : ""}
                        {p.average_consumption
                          ? `${p.knitting_time ? "; " : ""}consumption ${fmtNum(p.average_consumption.from)} → ${p.average_consumption.to}`
                          : ""}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {result.previewTruncated ? (
                  <p className="eyebrow">
                    Showing first {Math.min(result.preview?.length ?? 0, 50)} of {result.totalPreview ?? 0}{" "}
                    field update(s)…
                  </p>
                ) : null}
                <button
                  type="button"
                  className="button"
                  style={{ marginTop: 10 }}
                  onClick={runBackfill}
                  disabled={busy}
                >
                  Run backfill now (write changes)
                </button>
              </div>
            ) : result.updated != null ? (
              <p className="eyebrow">
                Backfill complete — <strong>{result.updated ?? 0} updated</strong>,{" "}
                <strong>{result.skipped ?? 0} skipped</strong> ({" "}
                {result.candidates ?? 0} candidates matched {result.matched ?? 0} NextGen rows)
              </p>
            ) : (
              <p className="eyebrow">
                Sync complete — <strong>{result.inserted ?? 0} inserted</strong>,{" "}
                <strong>{result.alreadySynced ?? 0} already synced</strong>, {result.failed ?? 0} failed
              </p>
            )}
            {result.message ? <p>{result.message}</p> : null}
            {result.perStatus?.length ? (
              <ul className="list compact-list">
                {result.perStatus.map((c) => (
                  <li key={c.status}>
                    {c.status}: {c.total} in NextGen
                  </li>
                ))}
              </ul>
            ) : null}
            {result.errors?.length ? (
              <p className="form-message error">{result.errors.join("; ")}</p>
            ) : null}
          </div>
        ) : (
          <p className="form-message error">{result.error ?? "Sync failed"}</p>
        )
      ) : null}
    </div>
  );
}
