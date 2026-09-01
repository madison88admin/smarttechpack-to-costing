"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { HistoricalCostingRow, LikeStyleMatchInput } from "@/lib/costing/history";
import type { SavedComparisonSet } from "@/lib/comparison-sets";
import { CopyShareLink } from "@/components/copy-share-link";

type ComparisonRow = HistoricalCostingRow & { matchScore: number; matchReasons?: string[] };

type Benchmark = { averageConsumption?: number | null; averageKnittingTime?: number | null; sampleSize?: number };

export function LikeStylesPanel({
  rows,
  requestId,
  canRecordComparison,
  requestNumber = null,
  attributes = null,
  benchmark = null,
  savedSets = []
}: {
  rows: ComparisonRow[];
  requestId?: string;
  canRecordComparison?: boolean;
  requestNumber?: string | null;
  attributes?: LikeStyleMatchInput | null;
  benchmark?: Benchmark | null;
  savedSets?: SavedComparisonSet[];
}) {
  const router = useRouter();
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [decision, setDecision] = useState("reviewed");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  // Saving the whole comparison set as a named, shareable snapshot.
  const [savingSet, setSavingSet] = useState(false);
  const [setErrorMsg, setSetErrorMsg] = useState("");
  const [savedShareUrl, setSavedShareUrl] = useState("");

  async function recordComparison(row: ComparisonRow) {
    if (!requestId) return;
    setRecordingId(row.id);
    setError("");
    setSaved(null);

    const response = await fetch(`/api/costing/requests/${requestId}/comparisons`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        comparedHistoricalId: row.id,
        comparedStyleNumber: row.style_number,
        decision,
        notes: notes.trim() || undefined
      })
    });

    const result = await response.json();

    if (!response.ok || !result.ok) {
      setError(result.error ?? "Unable to record comparison");
      setRecordingId(null);
      return;
    }

    setSaved(row.id);
    setRecordingId(null);
    setNotes("");
    setDecision("reviewed");
    router.refresh();
  }

  // Save the current comparison set (exact results + the filters that produced
  // them) anchored to this request, then expose the share link for PBD review.
  async function saveComparisonSet() {
    if (!requestId || !rows.length) return;
    setSavingSet(true);
    setSetErrorMsg("");
    try {
      const response = await fetch("/api/comparison-sets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `${requestNumber ?? "Request"} comparison set`,
          requestId,
          filters: {
            yarnType: attributes?.yarnType ?? null,
            knitType: attributes?.knitType ?? null,
            machineType: attributes?.machineType ?? null,
            construction: attributes?.construction ?? null,
            category: attributes?.productCategory ?? null
          },
          results: rows,
          benchmark
        })
      });
      const body = await response.json();
      if (!response.ok || !body.ok) {
        setSetErrorMsg(body.error ?? "Unable to save comparison set");
      } else {
        setSavedShareUrl(`${window.location.origin}/comparison-sets/${body.set.shareToken}`);
        router.refresh();
      }
    } catch {
      setSetErrorMsg("Unable to save comparison set — check the connection and retry.");
    } finally {
      setSavingSet(false);
    }
  }

  return (
    <section className="panel">
      <h2>Like Styles <span className="eyebrow" style={{ fontWeight: 400 }}>Auto-matched by yarn / knit / machine</span></h2>
      {rows.length ? (
        <ul className="list compact-list">
          {rows.map((row) => (
            <li key={row.id}>
              <strong>{row.style_number ?? "No style"}</strong>
              <span className="activity-role">{row.matchScore} match</span>
              {row.matchReasons?.length ? <span className="eyebrow"> — {row.matchReasons.join(", ")}</span> : null}
              <br />
              {row.factory_name ?? "Unassigned"} / {row.currency ?? "USD"} {row.total_cost?.toFixed(2) ?? "Pending"}
              {row.yarn_type || row.knit_type || row.machine_type ? (
                <>
                  <br />
                  <span className="eyebrow">
                    {[row.yarn_type, row.knit_type, row.machine_type].filter(Boolean).join(" / ")}
                  </span>
                </>
              ) : null}
              {row.costing_request_id ? (
                <>
                  <br />
                  <Link className="table-action" href={`/requests/${row.costing_request_id}`}>
                    Open approved costing
                  </Link>
                </>
              ) : null}
              {canRecordComparison && requestId ? (
                <div className="comparison-form">
                  <select
                    className="input comparison-select"
                    value={recordingId === row.id ? decision : "reviewed"}
                    onChange={(e) => setDecision(e.target.value)}
                    disabled={recordingId === row.id}
                  >
                    <option value="reviewed">Reviewed</option>
                    <option value="acceptable">Acceptable</option>
                    <option value="variance_noted">Variance Noted</option>
                    <option value="rejected_comparison">Rejected Comparison</option>
                  </select>
                  <input
                    className="input comparison-notes"
                    placeholder="Comparison notes..."
                    value={recordingId === row.id ? notes : ""}
                    onChange={(e) => setNotes(e.target.value)}
                    disabled={recordingId === row.id}
                  />
                  <button
                    className="button secondary small-btn"
                    onClick={() => recordComparison(row)}
                    disabled={recordingId === row.id}
                  >
                    {recordingId === row.id ? "Recording..." : "Record Comparison"}
                  </button>
                  {saved === row.id ? <span className="form-message saved">Recorded</span> : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="eyebrow">No similar approved styles yet. This will improve as more CBDs are approved.</p>
      )}
      {error ? <p className="action-error">{error}</p> : null}

      {rows.length && requestId ? (
        <div className="save-set-block" style={{ marginTop: 12 }}>
          {savedShareUrl ? (
            <>
              <span className="status green">Saved — share with PBD/Costing</span>
              <div className="input-row">
                <input className="input" readOnly value={savedShareUrl} onFocus={(e) => e.target.select()} />
                <CopyShareLink url={savedShareUrl} label="Copy" />
                <Link className="button secondary small-btn" href={`/comparison-sets/${savedShareUrl.split("/").pop()}`}>
                  Open
                </Link>
              </div>
            </>
          ) : (
            <>
              <button className="button secondary small-btn" onClick={saveComparisonSet} disabled={savingSet}>
                {savingSet ? "Saving…" : "Save comparison set"}
              </button>
              <span className="eyebrow">Named snapshot of this request&apos;s comparables — shareable link for PBD review.</span>
            </>
          )}
          {setErrorMsg ? <p className="action-error">{setErrorMsg}</p> : null}
        </div>
      ) : null}

      {savedSets.length ? (
        <div className="save-set-list">
          <strong className="eyebrow">Saved comparison sets for this request</strong>
          <ul className="list">
            {savedSets.map((set) => (
              <li key={set.id}>
                <span>
                  {set.name}
                  <span className="eyebrow">
                    {" "}· saved by {set.createdBy ?? set.createdByRole ?? "Costing"} · {formatDate(set.createdAt)} · {set.results.length} styles
                  </span>
                </span>
                <Link className="table-action" href={`/comparison-sets/${set.shareToken}`}>
                  Open shared link
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function formatDate(iso: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
