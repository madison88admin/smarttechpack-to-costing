"use client";

import { useState } from "react";
import type { FactoryScorecard } from "@/lib/costing/factory-scorecard";

function formatHours(hours: number | null, samples: number) {
  if (hours === null) return <span className="eyebrow">—</span>;
  const value = hours < 48 ? `${Math.round(hours)}h` : `${(hours / 24).toFixed(1)}d`;
  return <>{value}{samples > 1 ? <span className="eyebrow"> ({samples})</span> : null}</>;
}

function accuracyClass(pct: number | null) {
  if (pct === null) return "";
  if (pct >= 90) return "text-green";
  if (pct >= 70) return "text-amber";
  return "text-red";
}

/**
 * Factory scorecard — internal analytics only. The factory never sees this
 * panel (it is rendered exclusively for internal roles on the dashboard).
 */
export function FactoryScorecardPanel({ scorecard }: { scorecard: FactoryScorecard }) {
  const rows = scorecard.rows;
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(rows.length / 5));
  const currentPage = Math.min(page, pageCount - 1);
  const visibleRows = rows.slice(currentPage * 5, (currentPage + 1) * 5);
  return (
    <section className="panel" style={{ marginTop: 12 }}>
      <div className="section-heading">
        <div>
          <p className="eyebrow">Quote accuracy · cycle time · rework — internal only</p>
          <h2>Factory Scorecard</h2>
        </div>
        <span className="status blue">
          {rows.length} factory{rows.length === 1 ? "" : "ies"} · {scorecard.benchmarkLines} benchmark lines
        </span>
      </div>
      <p className="chart-caption">
        Quote accuracy = % of material lines within the master-benchmark tolerance (30% above average). Cycle time = avg hours in each completed stage from the approval trail. Rework = clarifications per submitted request.
      </p>
      <div className="table-wrapper">
        <table className="table compact">
          <thead>
            <tr>
              <th>Factory</th>
              <th>Requests</th>
              <th>Quote accuracy</th>
              <th>CBD response</th>
              <th>Costing review</th>
              <th>PBD review</th>
              <th>End-to-end</th>
              <th>Clarifications</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => {
              const stage = (key: string) => row.stages.find((item) => item.key === key);
              const cbd = stage("sent_to_factory");
              const costing = stage("for_costing_review");
              const pbd = stage("for_pbd_review");
              const e2e = stage("end_to_end");
              const rate = row.clarificationRate;
              return (
                <tr key={row.factoryName}>
                  <td>
                    <strong>{row.factoryName}</strong>
                    <span className="eyebrow" style={{ display: "block" }}>
                      {row.submitted} submitted · {row.approved} approved{row.overBenchmarkLines > 0 ? ` · ${row.overBenchmarkLines}/${row.matchedLines} lines over benchmark` : ""}
                    </span>
                  </td>
                  <td>{row.requests}</td>
                  <td>
                    {row.quoteAccuracyPct !== null ? (
                      <strong className={accuracyClass(row.quoteAccuracyPct)}>{row.quoteAccuracyPct.toFixed(1)}%</strong>
                    ) : (
                      <span className="eyebrow">—</span>
                    )}
                    {row.avgVariancePct !== null && row.avgVariancePct > 0 ? (
                      <span className="eyebrow" style={{ display: "block" }}>avg +{row.avgVariancePct.toFixed(1)}% vs benchmark</span>
                    ) : null}
                  </td>
                  <td>{formatHours(cbd?.avgHours ?? null, cbd?.samples ?? 0)}</td>
                  <td>{formatHours(costing?.avgHours ?? null, costing?.samples ?? 0)}</td>
                  <td>{formatHours(pbd?.avgHours ?? null, pbd?.samples ?? 0)}</td>
                  <td>{formatHours(e2e?.avgHours ?? null, e2e?.samples ?? 0)}</td>
                  <td>
                    {rate === null ? (
                      <span className="eyebrow">—</span>
                    ) : (
                      <strong className={rate > 0.3 ? "text-red" : rate > 0 ? "text-amber" : "text-green"}>
                        {row.clarifications}
                      </strong>
                    )}
                    {rate !== null ? (
                      <span className="eyebrow" style={{ display: "block" }}>{Math.round(rate * 100)}% of submitted</span>
                    ) : null}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 ? (
              <tr><td colSpan={8} className="table-empty">No factories tracked yet.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {pageCount > 1 ? <div className="pagination-controls"><button className="button secondary btn-sm" type="button" onClick={() => setPage((value) => Math.max(0, value - 1))} disabled={currentPage === 0}>Previous</button><span className="eyebrow">{currentPage * 5 + 1}–{Math.min((currentPage + 1) * 5, rows.length)} of {rows.length}</span><button className="button secondary btn-sm" type="button" onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))} disabled={currentPage === pageCount - 1}>Next 5</button></div> : null}
      <p className="chart-footnote" style={{ marginTop: 8 }}>
        Cycle times cover completed stage segments only (in-progress requests are excluded until they move on). Benchmark auto-aggregates every submitted CBD, with MD/Costing-curated overrides.
      </p>
    </section>
  );
}
