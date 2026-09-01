import { AppShell } from "@/components/app-shell";
import { tryGetFinanceMetrics } from "@/lib/reporting/finance-metrics";
import { canAccessInternalCostData, getCurrentRole } from "@/lib/auth/roles";
import { redirect } from "next/navigation";

export default async function FinancePage() {
  const role = getCurrentRole();
  if (!canAccessInternalCostData(role)) redirect("/");
  const { metrics, error } = await tryGetFinanceMetrics();

  return (
    <AppShell>
      <div className="hero">
        <div>
          <p className="eyebrow">Reporting</p>
          <h1>Finance Metrics Dashboard</h1>
          <p className="hero-copy">
            Aggregate costing metrics, approval rates, cycle times, and factory performance for finance and leadership review.
          </p>
        </div>
      </div>

      {error ? <p className="notice">Unable to load metrics: {error}</p> : null}

      {metrics ? (
        <>
          <div className="metrics-grid">
            <div className="metric-card">
              <span className="metric-label">Total Requests</span>
              <span className="metric-value">{metrics.totalRequests}</span>
              <span className="metric-sub">All time</span>
            </div>
            <div className="metric-card">
              <span className="metric-label">Approval Rate</span>
              <span className="metric-value text-green">
                {metrics.approvalRate !== null ? `${metrics.approvalRate.toFixed(1)}%` : "—"}
              </span>
              <span className="metric-sub">{metrics.approvedCount} approved</span>
            </div>
            <div className="metric-card">
              <span className="metric-label">Rejection Rate</span>
              <span className="metric-value text-red">
                {metrics.rejectionRate !== null ? `${metrics.rejectionRate.toFixed(1)}%` : "—"}
              </span>
              <span className="metric-sub">{metrics.rejectedCount} rejected</span>
            </div>
            <div className="metric-card">
              <span className="metric-label">Avg Cycle Time</span>
              <span className="metric-value">
                {metrics.averageCycleTimeDays !== null ? `${metrics.averageCycleTimeDays.toFixed(1)}d` : "—"}
              </span>
              <span className="metric-sub">Create to approval</span>
            </div>
            <div className="metric-card">
              <span className="metric-label">Avg Cost Variance</span>
              <span className="metric-value text-amber">
                {metrics.averageCostVariancePercent !== null
                  ? `${metrics.averageCostVariancePercent.toFixed(1)}%`
                  : "—"}
              </span>
              <span className="metric-sub">vs historical benchmark</span>
            </div>
            <div className="metric-card">
              <span className="metric-label">Approved Value</span>
              <span className="metric-value">
                {metrics.totalApprovedValue !== null
                  ? `${metrics.currency} ${metrics.totalApprovedValue.toFixed(0)}`
                  : "—"}
              </span>
              <span className="metric-sub">Total of approved CBDs</span>
            </div>
            <div className="metric-card">
              <span className="metric-label">Pending</span>
              <span className="metric-value text-amber">{metrics.pendingCount}</span>
              <span className="metric-sub">Active workflow items</span>
            </div>
          </div>

          <div className="split">
            <section className="panel">
              <h2>Monthly Trend</h2>
              <p className="eyebrow">Requests and approvals over the last 12 months</p>
              {metrics.monthlyTrend.length > 0 ? (
                <div className="chart-bar-container" style={{ height: 140, marginBottom: 24 }}>
                  {metrics.monthlyTrend.map((row) => {
                    const maxCount = Math.max(...metrics.monthlyTrend.map((r) => r.requestCount), 1);
                    const height = (row.requestCount / maxCount) * 100;
                    return (
                      <div
                        key={row.month}
                        className="chart-bar"
                        style={{ height: `${Math.max(8, height)}%` }}
                        title={`${row.month}: ${row.requestCount} requests, ${row.approvedCount} approved`}
                      >
                        <span className="chart-bar-value">{row.requestCount}</span>
                        <span className="chart-bar-label">{row.month.slice(5)}</span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="notice">No trend data available yet.</p>
              )}
              <table className="table compact">
                <thead>
                  <tr>
                    <th>Month</th>
                    <th>Requests</th>
                    <th>Approved</th>
                    <th>Approval Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.monthlyTrend.map((row) => (
                    <tr key={row.month}>
                      <td><strong>{row.month}</strong></td>
                      <td>{row.requestCount}</td>
                      <td>{row.approvedCount}</td>
                      <td>{row.requestCount > 0 ? `${((row.approvedCount / row.requestCount) * 100).toFixed(0)}%` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section className="panel">
              <h2>Factory Performance</h2>
              <p className="eyebrow">Top factories by request volume</p>
              {metrics.factoryPerformance.length > 0 ? (
                <table className="table compact">
                  <thead>
                    <tr>
                      <th>Factory</th>
                      <th>Total</th>
                      <th>Approved</th>
                      <th>Approval Rate</th>
                      <th>Avg Cycle Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.factoryPerformance.map((row) => (
                      <tr key={row.factoryName}>
                        <td><strong>{row.factoryName}</strong></td>
                        <td>{row.totalRequests}</td>
                        <td>{row.approvedCount}</td>
                        <td>
                          {row.totalRequests > 0
                            ? `${((row.approvedCount / row.totalRequests) * 100).toFixed(0)}%`
                            : "—"}
                        </td>
                        <td>
                          {row.averageCycleTimeDays !== null
                            ? `${row.averageCycleTimeDays.toFixed(1)}d`
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="notice">No factory performance data available.</p>
              )}
            </section>
          </div>

          <section className="panel" style={{ marginTop: 16 }}>
            <h2>Status Breakdown</h2>
            <div className="metrics-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))" }}>
              {metrics.statusBreakdown.map((row) => (
                <div key={row.status} className="metric-card">
                  <span className="metric-label">{row.status.replace(/_/g, " ")}</span>
                  <span className="metric-value" style={{ fontSize: "1.4rem" }}>{row.count}</span>
                </div>
              ))}
            </div>
          </section>
        </>
      ) : null}
    </AppShell>
  );
}
