"use client";

import { useState } from "react";
import Link from "next/link";
import { LineChart, Sparkline } from "@/components/charts";
import { StatusPill } from "@/components/status-pill";
import { maskStatusForRole } from "@/lib/workflow/status";
import type { MarginAnalytics } from "@/lib/costing/margin-analytics";

function formatMoney(value: number | null) {
  if (value === null) return "—";
  return new Intl.NumberFormat("en", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
}

function DimensionTable({ title, rows }: { title: string; rows: MarginAnalytics["byBrand"] }) {
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(rows.length / 5));
  const currentPage = Math.min(page, pageCount - 1);
  const visibleRows = rows.slice(currentPage * 5, (currentPage + 1) * 5);
  return (
    <div className="report-chart-card">
      <h3>{title}</h3>
      {rows.length ? (
        <div className="table-wrapper">
          <table className="table compact">
            <thead>
              <tr><th>Group</th><th>Requests</th><th>Avg margin</th></tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr key={row.label}>
                  <td>{row.label}</td>
                  <td>{row.count}</td>
                  <td className={row.avgMarginUsd !== null && row.avgMarginUsd < 1 ? "text-red" : "text-green"}>
                    {formatMoney(row.avgMarginUsd)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="eyebrow">No priced requests yet.</p>
      )}
      {pageCount > 1 ? <div className="pagination-controls"><button className="button secondary btn-sm" type="button" onClick={() => setPage((value) => Math.max(0, value - 1))} disabled={currentPage === 0}>Previous</button><span className="eyebrow">{currentPage * 5 + 1}–{Math.min((currentPage + 1) * 5, rows.length)} of {rows.length}</span><button className="button secondary btn-sm" type="button" onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))} disabled={currentPage === pageCount - 1}>Next 5</button></div> : null}
    </div>
  );
}

/**
 * Portfolio gross-margin analytics. Internal data only — the factory never
 * sees pricing or margin (the panel is rendered only for internal roles).
 */
export function MarginAnalyticsPanel({ analytics, thresholdUsd }: { analytics: MarginAnalytics; thresholdUsd: number }) {
  const trendValues = analytics.trend.map((point) => point.avgMarginUsd ?? 0);
  return (
    <section className="panel" style={{ marginTop: 12 }}>
      <div className="section-heading">
        <div>
          <p className="eyebrow">Portfolio margin — internal only</p>
          <h2>Margin Analytics</h2>
        </div>
        <span className={`status ${analytics.belowThresholdCount > 0 ? "amber" : "green"}`}>
          {analytics.belowThresholdCount} below ${thresholdUsd.toFixed(2)} guideline
        </span>
      </div>
      <p className="chart-caption">Profit per unit = selling price − landed cost. Prices PBD-entered by the buyer; requests still awaiting pricing use the landed × markup estimate (marked est.).</p>

      <div className="grid metrics">
        <div className="metric metric-accent-green">
          <span className="metric-label">Avg Margin / Unit</span>
          <strong>{formatMoney(analytics.avgMarginUsd)}</strong>
          <small>Across {analytics.totalWithMargin} priced request{analytics.totalWithMargin === 1 ? "" : "s"}</small>
          <Sparkline values={trendValues} color="var(--green)" ariaLabel="Average margin per month" />
        </div>
        <div className="metric metric-accent-amber">
          <span className="metric-label">Lowest Margin</span>
          <strong>{formatMoney(analytics.minMarginUsd)}</strong>
          <small>Best {formatMoney(analytics.maxMarginUsd)}</small>
        </div>
        <div className="metric metric-accent-red">
          <span className="metric-label">Below Guideline</span>
          <strong className="text-red">{analytics.belowThresholdCount}</strong>
          <small>Soft-flag discussion population</small>
        </div>
        <div className="metric metric-accent-violet">
          <span className="metric-label">At Risk (Approved)</span>
          <strong>{analytics.atRisk.length}</strong>
          <small>Approved below ${thresholdUsd.toFixed(2)}/unit</small>
        </div>
      </div>

      <div className="report-chart-card" style={{ marginTop: 16 }}>
        <h3>Average margin trend</h3>
        <p className="chart-caption">Average profit per unit by month of last pricing/approval activity.</p>
        {analytics.trend.length ? (
          <LineChart
            series={[{
              name: "Avg margin / unit",
              color: "var(--green)",
              points: analytics.trend.map((point) => ({ label: point.label, value: point.avgMarginUsd ?? 0 }))
            }]}
          />
        ) : (
          <p className="eyebrow">No margin history yet — appears once PBD pricing is entered.</p>
        )}
      </div>

      <div className="report-chart-grid" style={{ marginTop: 16 }}>
        <DimensionTable title="By brand" rows={analytics.byBrand} />
        <DimensionTable title="By customer" rows={analytics.byCustomer} />
        <DimensionTable title="By factory" rows={analytics.byFactory} />
      </div>

      {analytics.atRisk.length ? (
        <div className="report-chart-card" style={{ marginTop: 16 }}>
          <h3>At-risk approved requests</h3>
          <p className="chart-caption">Approved costings with profit below the ${thresholdUsd.toFixed(2)}/unit guideline — the manual Costing ↔ PBD discussion population. Worst first.</p>
          <div className="table-wrapper">
            <table className="table compact">
              <thead>
                <tr><th>Request</th><th>Status</th><th>Brand / Customer</th><th>Factory</th><th>Wholesale</th><th>Cost basis</th><th>Margin</th></tr>
              </thead>
              <tbody>
                {analytics.atRisk.map((row) => (
                  <tr key={row.requestId}>
                    <td><Link className="req-link" href={`/requests/${row.requestId}`}><strong>{row.requestNumber ?? row.requestId.slice(0, 8)}</strong></Link></td>
                    <td><StatusPill status={maskStatusForRole(row.status, "admin")} /></td>
                    <td>{[row.brand, row.customer].filter(Boolean).join(" / ") || "—"}</td>
                    <td>{row.factoryName ?? "—"}</td>
                    <td>{row.wholesalePrice !== null ? `${formatMoney(row.wholesalePrice)}${row.pricingSource === "derived" ? " est." : ""}` : "—"}</td>
                    <td>{row.costBasis !== null ? formatMoney(row.costBasis) : "—"}</td>
                    <td><strong className="text-red">{formatMoney(row.marginUsd)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </section>
  );
}
