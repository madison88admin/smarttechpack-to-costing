"use client";

import Link from "next/link";
import { useState } from "react";
import { smvSourceStatus, type HistoricalCostingRow } from "@/lib/costing/history";
import { SkeletonTable } from "@/components/ui/skeleton";

export function HistoryTable({ rows }: { rows?: HistoricalCostingRow[] | null }) {
  const data = rows ?? [];
  const [searching, setSearching] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<{ style: string; results: any[] } | null>(null);

  // Search for costing requests matching this style number
  async function benchmarkByStyle(styleNumber: string) {
    setSearching(styleNumber);
    setSearchResults(null);
    try {
      // Search for existing costing requests with this style
      const res = await fetch(`/api/costing/requests?q=${encodeURIComponent(styleNumber)}`);
      const data = await res.json();
      if (data.ok && data.data) {
        setSearchResults({ style: styleNumber, results: data.data.slice(0, 5) });
      } else {
        setSearchResults({ style: styleNumber, results: [] });
      }
    } catch {
      setSearchResults({ style: styleNumber, results: [] });
    } finally {
      setSearching(null);
    }
  }

  return (
    <>
      {!data.length ? (
        <div className="empty-state">
          <strong>No approved costings found</strong>
          <p>Adjust the filters or approve a costing request to add it to the historical library.</p>
        </div>
      ) : null}
      {data.length ? (
      <table className="table">
        <thead>
          <tr>
            <th>Style</th>
            <th>Factory</th>
            <th>Match Attributes</th>
            <th>Approved Cost</th>
            <th>Approved Date</th>
            <th>SMV Source</th>
            <th>Use</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr key={row.id}>
              <td>
                <strong>{row.style_number ?? "No style"}</strong>
              </td>
              <td>{row.factory_name ?? "Unassigned"}</td>
              <td>
                <span className="eyebrow">
                  {[row.yarn_type, row.knit_type, row.machine_type, row.construction, row.product_category]
                    .filter(Boolean)
                    .join(" / ") || "No attributes"}
                </span>
              </td>
              <td>
                {row.currency ?? "USD"} {formatCost(row.total_cost)}
              </td>
              <td>{row.approved_at ? new Date(row.approved_at).toLocaleDateString() : "Pending"}</td>
              <td>
                <SmvSourceCell row={row} />
              </td>
              <td>
                {row.costing_request_id ? (
                  <Link className="table-action" href={`/requests/${row.costing_request_id}`}>
                    Open Request
                  </Link>
                ) : row.style_number ? (
                  <button
                    className="table-action"
                    onClick={() => benchmarkByStyle(row.style_number!)}
                    disabled={searching === row.style_number}
                  >
                    {searching === row.style_number ? "Searching..." : "Use Benchmark"}
                  </button>
                ) : (
                  "—"
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      ) : null}

      {/* Benchmark search results modal */}
      {searchResults ? (
        <div className="modal-overlay" onClick={() => setSearchResults(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Benchmark for Style {searchResults.style}</h3>
              <button className="modal-close" onClick={() => setSearchResults(null)}>×</button>
            </div>
            <p className="eyebrow">
              Use this historical cost as a benchmark for a new or existing costing request.
            </p>
            {searching ? <SkeletonTable rows={3} /> : null}
            {searchResults.results.length > 0 ? (
              <>
                <p><strong>Matching costing requests found:</strong></p>
                <ul className="list compact-list">
                  {searchResults.results.map((r: any) => (
                    <li key={r.id}>
                      <Link href={`/requests/${r.id}`}>
                        <strong>{r.request_number ?? r.id.slice(0, 8)}</strong>
                      </Link>
                      {" — "}
                      {r.factory_name ?? "Unassigned"} / {r.status}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <>
                <p>No existing costing requests found for style <strong>{searchResults.style}</strong>.</p>
                <p>You can create a new request and use this historical cost as a benchmark.</p>
                <Link
                  className="button"
                  href={`/requests/new?style=${encodeURIComponent(searchResults.style)}`}
                >
                  Create New Request for {searchResults.style}
                </Link>
              </>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}

function SmvSourceCell({ row }: { row: HistoricalCostingRow }) {
  const status = smvSourceStatus(row);
  const tone = status.key === "missing" ? "red" : status.key === "nextgen" ? "blue" : "green";
  const title =
    status.key === "missing"
      ? "No knitting time recorded yet"
      : status.key === "nextgen"
        ? "Knitting time from NextGen (GsdSMV)"
        : "Knitting time from the approved factory costing";
  return (
    <span className={`status ${tone}`} title={title}>
      <span className="status-dot" />
      <span className="status-label">{status.label}</span>
    </span>
  );
}

function formatCost(value: number | null) {
  if (value === null) return "Pending";
  return value.toFixed(2);
}
