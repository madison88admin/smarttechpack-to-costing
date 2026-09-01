"use client";

import { useState } from "react";
import Link from "next/link";
import type { SavingsOpportunity } from "@/lib/costing/savings-opportunity";

function formatMoney(value: number) {
  return new Intl.NumberFormat("en", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

function formatMoney2(value: number) {
  return new Intl.NumberFormat("en", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
}

/**
 * Savings-opportunity metric — the cost-saving potential hidden in the
 * pipeline: over-benchmark material lines quantified per garment and per MOQ
 * order, with drill-down to the exact lines. Internal data only (benchmark
 * references are never shown to the factory).
 */
export function SavingsOpportunityPanel({ savings }: { savings: SavingsOpportunity }) {
  const hasLines = savings.lines.length > 0;
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(savings.lines.length / 5));
  const currentPage = Math.min(page, pageCount - 1);
  const visibleLines = savings.lines.slice(currentPage * 5, (currentPage + 1) * 5);
  return (
    <section className="panel" style={{ marginTop: 12 }}>
      <div className="section-heading">
        <div>
          <p className="eyebrow">Over-benchmark material lines — internal only</p>
          <h2>Savings Opportunity</h2>
        </div>
        <span className="status amber">
          {savings.flaggedLines} flagged line{savings.flaggedLines === 1 ? "" : "s"} · {savings.flaggedRequests} request{savings.flaggedRequests === 1 ? "" : "s"}
        </span>
      </div>
      <p className="chart-caption">
        Material lines priced more than 30% above the master-benchmark average. The gap is quantified per garment (gap × consumption) and per MOQ order — the savings if the factory priced at benchmark.
      </p>
      <div className="grid metrics">
        <div className="metric metric-accent-amber">
          <span className="metric-label">Savings per order</span>
          {savings.flaggedLines > 0 && savings.orderRequests === 0 ? (
            <strong>MOQ missing</strong>
          ) : (
            <strong>{formatMoney(savings.totalPerOrderUsd)}</strong>
          )}
          <small>{savings.flaggedLines > 0 && savings.orderRequests === 0 ? "Flagged requests lack an order quantity" : `Σ (gap × consumption × MOQ) over ${savings.orderRequests} request${savings.orderRequests === 1 ? "" : "s"} with MOQ`}</small>
        </div>
        <div className="metric metric-accent-green">
          <span className="metric-label">Savings per garment</span>
          <strong>{formatMoney2(savings.totalPerGarmentUsd)}</strong>
          <small>Σ (gap × consumption) — quantity-agnostic</small>
        </div>
        <div className="metric metric-accent-red">
          <span className="metric-label">Flagged Lines</span>
          <strong>{savings.flaggedLines}</strong>
          <small>Over 30% above benchmark average</small>
        </div>
        <div className="metric metric-accent-violet">
          <span className="metric-label">Requests Affected</span>
          <strong>{savings.flaggedRequests}</strong>
          <small>With at least one over-benchmark line</small>
        </div>
      </div>

      {hasLines ? (
        <div className="table-wrapper" style={{ marginTop: 16 }}>
          <table className="table compact">
            <thead>
              <tr>
                <th>Request</th>
                <th>Material</th>
                <th>Benchmark avg</th>
                <th>Unit cost</th>
                <th>Variance</th>
                <th>Consumption</th>
                <th>Per garment</th>
                <th>Per order (MOQ)</th>
              </tr>
            </thead>
            <tbody>
              {visibleLines.map((line, index) => (
                <tr key={`${line.requestId}-${index}`}>
                  <td>
                    <Link className="req-link" href={`/requests/${line.requestId}`}>
                      <strong>{line.requestNumber ?? line.requestId.slice(0, 8)}</strong>
                    </Link>
                    <span className="eyebrow" style={{ display: "block" }}>{line.factoryName ?? "—"}</span>
                  </td>
                  <td>{line.materialName ?? "Unnamed material"}</td>
                  <td>{formatMoney2(line.benchmarkAvg)}</td>
                  <td>{formatMoney2(line.unitCost)}</td>
                  <td><strong className="text-red">+{line.variancePercent.toFixed(1)}%</strong></td>
                  <td>{line.consumption !== null ? line.consumption.toFixed(2) : "—"}</td>
                  <td>{formatMoney2(line.perGarmentSavingsUsd)}</td>
                  <td>
                    {line.orderSavingsUsd !== null
                      ? <strong className="text-amber">{formatMoney(line.orderSavingsUsd)}</strong>
                      : <span className="eyebrow">MOQ missing</span>}
                    {line.moq !== null ? <span className="eyebrow" style={{ display: "block" }}>× {line.moq} pcs</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty-state compact-empty" style={{ marginTop: 16 }}>
          <strong>No over-benchmark lines right now</strong>
          <p>All submitted material lines are within 30% of the master benchmark, or no CBDs are submitted yet.</p>
        </div>
      )}
      {hasLines && pageCount > 1 ? <div className="pagination-controls"><button className="button secondary btn-sm" type="button" onClick={() => setPage((value) => Math.max(0, value - 1))} disabled={currentPage === 0}>Previous</button><span className="eyebrow">{currentPage * 5 + 1}–{Math.min((currentPage + 1) * 5, savings.lines.length)} of {savings.lines.length}</span><button className="button secondary btn-sm" type="button" onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))} disabled={currentPage === pageCount - 1}>Next 5</button></div> : null}
      <p className="chart-footnote" style={{ marginTop: 8 }}>
        Benchmark = median-anchored average of every submitted CBD, overridden by MD/Costing-curated references. Savings assume the factory could match the benchmark price at the same quality — a negotiation target, not a guarantee.
      </p>
    </section>
  );
}
