import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell } from "@/components/app-shell";
import { PrintButton } from "@/components/print-button";
import { HBarChart, LineChart, Sparkline } from "@/components/charts";
import { PaginatedHBarChart } from "@/components/paginated-hbar-chart";
import { ReportRegisterPrefs } from "@/components/report-register-prefs";
import { SearchableFilter } from "@/components/searchable-filter";
import { IconChart, IconCheckCircle, IconClock, IconDashboard, IconDollar, IconDownload, IconLayers, IconSend, IconX, IconXCircle } from "@/components/ui/icons";
import { canRunPbdAction, canRunCostingAction, getCurrentRole, getRoleLabel, type UserRole } from "@/lib/auth/roles";
import { countByBucket, normalizeRegisterSort, percentChange, sortReportRows, tryGetReportData, type ReportFilters, type ReportGranularity, type RegisterSortKey } from "@/lib/reporting";
import { tryGetNextGenFilterOptions } from "@/lib/nextgen/filter-options";
import { tryGetAgingData } from "@/lib/costing/aging";
import { computeSlaBreakdown } from "@/lib/costing/sla-report";
import { maskStatusForRole, statusLabels } from "@/lib/workflow/status";

export const metadata = { title: "Reports — Smart TP" };

// Semantic stage colors for the pipeline chart, matching the workflow badge
// palette so each status is recognizable at a glance.
const STATUS_CHART_COLORS: Record<string, string> = {
  draft: "#94a3b8",
  sent_to_factory: "#3b82f6",
  needs_clarification: "#f59e0b",
  for_md_review: "#0d9488",
  for_costing_review: "#6366f1",
  for_pbd_review: "#8b5cf6",
  pending_manager_approval: "#d946ef",
  approved: "#16a34a",
  rejected: "#dc2626"
};

export default async function ReportsPage({
  searchParams
}: {
  searchParams?: {
    factory?: string;
    brand?: string;
    customer?: string;
    season?: string;
    status?: string;
    granularity?: string;
    compare?: string;
    page?: string;
    sort?: string;
    dir?: string;
    from?: string;
    to?: string;
  };
}) {
  const role = getCurrentRole();
  const canView = canRunPbdAction(role) || canRunCostingAction(role) || role === "manager";
  if (!canView) {
    redirect("/");
  }

  const filters: ReportFilters = {
    factory: searchParams?.factory?.trim() || null,
    brand: searchParams?.brand?.trim() || null,
    customer: searchParams?.customer?.trim() || null,
    season: searchParams?.season?.trim() || null,
    status: searchParams?.status?.trim() || null,
    granularity: (searchParams?.granularity?.trim() as ReportGranularity | undefined) || null,
    from: searchParams?.from?.trim() || null,
    to: searchParams?.to?.trim() || null
  };
  const granularity: ReportGranularity = filters.granularity ?? "monthly";
  const bucketLabel = granularity === "daily" ? "day" : granularity === "weekly" ? "week" : "month";
  const compareMode = searchParams?.compare === "previous_season" ? "previous_season" : "previous_period";
  const registerPage = Math.max(1, Number.parseInt(searchParams?.page ?? "1", 10) || 1);
  const registerSort = normalizeRegisterSort(searchParams?.sort);
  const registerDir = searchParams?.dir === "asc" ? "asc" : "desc";
  const exportParams = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) exportParams.set(key, value);
  }
  const exportQuery = exportParams.toString();
  const excelHref = `/api/export/report.xlsx${exportQuery ? `?${exportQuery}` : ""}`;
  const csvHref = `/api/export/report.csv${exportQuery ? `?${exportQuery}` : ""}`;
  const hasFilters = Boolean(filters.factory || filters.brand || filters.customer || filters.season || filters.status || filters.granularity || filters.from || filters.to);

  // Builds a /reports href that preserves the other active filters and applies
  // one drill-down value (used by the chart rows).
  const drillHref = (key: "factory" | "brand" | "customer" | "season" | "status", value: string) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) {
      if (!v || k === key) continue;
      params.set(k, v);
    }
    if (value) params.set(key, value);
    const q = params.toString();
    return `/reports${q ? `?${q}` : ""}`;
  };
  // Export links for the full filtered register (all rows, current sort).
  const registerExportHref = (format: "csv" | "xlsx") => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) {
      if (!v) continue;
      if (k === "granularity" && v === "monthly") continue;
      params.set(k, v);
    }
    if (registerSort !== "created_at") params.set("sort", registerSort);
    if (registerDir !== "desc") params.set("dir", registerDir);
    const q = params.toString();
    return `/api/export/register.${format}${q ? `?${q}` : ""}`;
  };
  // Register pagination link that preserves filters and sort.
  const registerPageHref = (page: number) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) {
      if (!v) continue;
      if (k === "granularity" && v === "monthly") continue;
      params.set(k, v);
    }
    if (page > 1) params.set("page", String(page));
    if (registerSort !== "created_at") params.set("sort", registerSort);
    if (registerDir !== "desc") params.set("dir", registerDir);
    const q = params.toString();
    return `/reports${q ? `?${q}` : ""}`;
  };
  // Removes a single filter while preserving the rest (used by the chips).
  const removeFilterHref = (key: string) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) {
      if (!v || k === key) continue;
      if (k === "granularity" && v === "monthly") continue;
      params.set(k, v);
    }
    const q = params.toString();
    return `/reports${q ? `?${q}` : ""}`;
  };
  const activeFilterChips = [
    filters.factory ? { key: "factory", label: `Factory: ${formatDimensionLabel(filters.factory)}` } : null,
    filters.brand ? { key: "brand", label: `Brand: ${formatDimensionLabel(filters.brand)}` } : null,
    filters.customer ? { key: "customer", label: `Customer: ${formatDimensionLabel(filters.customer)}` } : null,
    filters.season ? { key: "season", label: `Season: ${formatDimensionLabel(filters.season)}` } : null,
    filters.status ? { key: "status", label: `Status: ${formatStatusLabel(filters.status)}` } : null,
    filters.from ? { key: "from", label: `From ${filters.from}` } : null,
    filters.to ? { key: "to", label: `To ${filters.to}` } : null,
    granularity !== "monthly" ? { key: "granularity", label: `Granularity: ${granularity}` } : null
  ].filter((chip): chip is { key: string; label: string } => chip !== null);

  const statusOptions = [
    { value: "", label: "All statuses" },
    ...Object.entries(statusLabels).map(([value, label]) => ({ value, label }))
  ];
  const granularityOptions: Array<{ value: ReportGranularity; label: string }> = [
    { value: "daily", label: "Daily" },
    { value: "weekly", label: "Weekly" },
    { value: "monthly", label: "Monthly" }
  ];
  const granularityHref = (value: ReportGranularity) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) {
      if (!v || k === "granularity") continue;
      params.set(k, v);
    }
    if (value !== "monthly") params.set("granularity", value);
    const q = params.toString();
    return `/reports${q ? `?${q}` : ""}`;
  };

  // Quick date-range presets (preserve the other active filters).
  const today = new Date();
  const isoDaysAgo = (days: number) => {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString().slice(0, 10);
  };
  const presets: Array<{ label: string; from: string | null; to: string | null }> = [
    { label: "Last 7 days", from: isoDaysAgo(7), to: null },
    { label: "Last 30 days", from: isoDaysAgo(30), to: null },
    { label: "Last 90 days", from: isoDaysAgo(90), to: null },
    { label: "Year to date", from: `${today.getFullYear()}-01-01`, to: null },
    { label: "All time", from: null, to: null }
  ];
  const presetHref = (from: string | null, to: string | null) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (!value || key === "from" || key === "to") continue;
      params.set(key, value);
    }
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    const q = params.toString();
    return `/reports${q ? `?${q}` : ""}`;
  };
  const isPresetActive = (preset: { from: string | null; to: string | null }) =>
    (filters.from ?? null) === preset.from && (filters.to ?? null) === preset.to;

  const { data, error } = await tryGetReportData(filters);
  // NexGen live filter options for Brand/Customer/Season (as seen in screenshot: Factory | Brand | Customer | Season)
  // Merge NexGen master data (CustomerName, RangeName, DivisionName) with pipeline fallback
  const nextGenOpts = await tryGetNextGenFilterOptions().catch(() => ({ brands: [], customers: [], seasons: [] }));
  // SLA-compliance breakdown over the active pipeline (same aging source as
  // the dashboard SLA report), scoped to the report's factory/status/date
  // filters where the aging rows carry those fields.
  const aging = await tryGetAgingData();
  const sla = aging.rows.length
    ? computeSlaBreakdown(aging.rows, granularity, {
        factory: filters.factory,
        status: filters.status,
        from: filters.from,
        to: filters.to
      })
    : null;
  const r = data;
  const costTrend = r?.trend.filter((row) => row.avgCost !== null) ?? [];
  const latestCost = costTrend.at(-1)?.avgCost ?? null;
  const forecast = r?.forecast ?? null;
  const historyComparison = r?.historyComparison ?? null;
  const benchmark = r?.benchmark ?? null;
  const seasonComparison = r?.seasonComparison ?? null;
  const showBenchmarkSeries = benchmark?.targetCost !== null && benchmark?.targetCost !== undefined
    && (costTrend.length > 1 || latestCost === null || Math.abs(benchmark.targetCost - latestCost) >= 0.01);
  const topFactoryRows = r?.byFactory ?? [];
  const topBrandRows = r?.byBrand ?? [];
  const topCustomerRows = r?.byCustomer ?? [];
  const topSeasonRows = r?.bySeason ?? [];
  const reportRegisterRows = r ? sortReportRows(r.rows, registerSort, registerDir) : [];
  const registerPageSize = 20;
  const registerTotalPages = Math.max(1, Math.ceil(reportRegisterRows.length / registerPageSize));
  const safeRegisterPage = Math.min(registerPage, registerTotalPages);
  const visibleRegisterRows = reportRegisterRows.slice((safeRegisterPage - 1) * registerPageSize, safeRegisterPage * registerPageSize);
  const comparisonLabel = compareMode === "previous_season" ? "Current season vs previous season" : "Latest period vs previous period";
  const selectedComparison = compareMode === "previous_season"
    ? seasonComparison?.current && seasonComparison.previous
      ? { previousLabel: seasonComparison.previous.season, latestLabel: seasonComparison.current.season, latestCreated: seasonComparison.current.count, latestApproved: seasonComparison.current.approved, createdChange: percentChange(seasonComparison.current.count, seasonComparison.previous.count), approvedChange: percentChange(seasonComparison.current.approved, seasonComparison.previous.approved), avgCost: seasonComparison.current.avgCost === null ? null : formatMoney(seasonComparison.current.avgCost), avgCostChange: seasonComparison.current.avgCost !== null && seasonComparison.previous.avgCost !== null ? percentChange(seasonComparison.current.avgCost, seasonComparison.previous.avgCost) : null }
      : null
    : historyComparison?.latest && historyComparison.previous
      ? { previousLabel: historyComparison.previous.bucket, latestLabel: historyComparison.latest.bucket, latestCreated: historyComparison.latest.created, latestApproved: historyComparison.latest.approved, createdChange: historyComparison.createdChangePct, approvedChange: historyComparison.approvedChangePct, avgCost: historyComparison.latest.avgCost === null ? null : formatMoney(historyComparison.latest.avgCost), avgCostChange: historyComparison.avgCostChangePct }
      : null;
  const selectedBaseline = compareMode === "previous_season"
    ? seasonComparison?.current ? { label: seasonComparison.current.season, created: seasonComparison.current.count, approved: seasonComparison.current.approved, avgCost: seasonComparison.current.avgCost === null ? null : formatMoney(seasonComparison.current.avgCost) } : null
    : historyComparison?.latest ? { label: historyComparison.latest.bucket, created: historyComparison.latest.created, approved: historyComparison.latest.approved, avgCost: historyComparison.latest.avgCost === null ? null : formatMoney(historyComparison.latest.avgCost) } : null;

  // Mini sparklines for the metric cards. Created / approved / avg cost come
  // straight from the trend buckets; the point-in-time states (active, in
  // review, needs clarification, rejected) have no event history, so their
  // sparkline shows the current backlog by creation period (cohort shape).
  const spark = r
    ? {
        created: r.trend.map((row) => row.created),
        approved: r.trend.map((row) => row.approved),
        approvalRate: r.trend.map((row) => (row.created > 0 ? Math.round((row.approved / row.created) * 1000) / 10 : 0)),
        avgCost: costTrend.map((row) => row.avgCost ?? 0),
        active: countByBucket(r.rows, granularity, (row) => !["approved", "rejected"].includes(row.status)),
        inReview: countByBucket(r.rows, granularity, (row) => ["for_md_review", "for_costing_review", "for_pbd_review", "pending_manager_approval"].includes(row.status)),
        clarification: countByBucket(r.rows, granularity, (row) => row.status === "needs_clarification"),
        rejected: countByBucket(r.rows, granularity, (row) => row.status === "rejected")
      }
    : null;

  return (
    <AppShell>
      <Suspense fallback={null}>
        <ReportRegisterPrefs />
      </Suspense>
      <div className="hero">
        <div>
          <p className="eyebrow">Reporting</p>
          <h1>Costing Reports</h1>
          <p className="hero-copy">
            Pipeline, approval, factory, brand, and customer analytics. Filter and export to Excel or PDF.
          </p>
          {r ? <span className="report-source-badge">Live data · {r.dataSource} · Refreshed {formatDateTime(r.generatedAt)}</span> : null}
        </div>
        <div className="hero-actions">
          <Link className="button secondary" href={excelHref}>
            <IconDownload size={14} /> Export Excel
          </Link>
          <PrintButton label="Export PDF" />
          <Link className="button secondary btn-sm" href={csvHref}>
            <IconDownload size={14} /> CSV
          </Link>
        </div>
      </div>

      <form className="toolbar filter-toolbar report-filter-toolbar report-filter-grid" action="/reports">
        <SearchableFilter name="factory" label="Factory" value={formatDimensionLabel(filters.factory ?? "")} options={(r?.byFactory ?? []).map((row) => formatDimensionLabel(row.key))} />
        <SearchableFilter name="brand" label="Brand" value={formatDimensionLabel(filters.brand ?? "")} options={[...new Set([...(nextGenOpts.brands ?? []), ...(r?.byBrand ?? []).map((row) => formatDimensionLabel(row.key))])].sort()} />
        <SearchableFilter name="customer" label="Customer" value={formatDimensionLabel(filters.customer ?? "")} options={[...new Set([...(nextGenOpts.customers ?? []), ...(r?.byCustomer ?? []).map((row) => formatDimensionLabel(row.key))])].sort()} />
        <SearchableFilter name="season" label="Season" value={formatDimensionLabel(filters.season ?? "")} options={[...new Set([...(nextGenOpts.seasons ?? []), ...(r?.bySeason ?? []).map((row) => formatDimensionLabel(row.key))])].sort()} />
        <select className="input filter-select" name="status" defaultValue={filters.status ?? ""} aria-label="Status">
          {statusOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <input className="input" type="date" name="from" defaultValue={filters.from ?? ""} aria-label="From date" />
        <input className="input" type="date" name="to" defaultValue={filters.to ?? ""} aria-label="To date" />
        <select className="input filter-select" name="compare" defaultValue={compareMode} aria-label="Comparison period">
          <option value="previous_period">Compare: Previous period</option>
          <option value="previous_season">Compare: Previous season</option>
        </select>
        <div className="report-filter-actions">
          <button className="button" type="submit">Filter</button>
          {hasFilters ? (
            <Link className="button secondary" href="/reports">
              <IconX size={14} /> Reset filters
            </Link>
          ) : null}
        </div>
      </form>
      <div className="preset-row">
        <span className="preset-label">Quick range:</span>
        {presets.map((preset) => (
          <Link
            key={preset.label}
            href={presetHref(preset.from, preset.to)}
            className={`preset-chip${isPresetActive(preset) ? " preset-chip-active" : ""}`}
          >
            {preset.label}
          </Link>
        ))}
      </div>
      {activeFilterChips.length > 0 ? (
        <div className="filter-chip-row" aria-label="Active filters">
          {activeFilterChips.map((chip) => (
            <Link key={chip.key} href={removeFilterHref(chip.key)} className="filter-chip">
              <IconX size={12} /> {chip.label}
            </Link>
          ))}
        </div>
      ) : null}
      {r ? (
        <p className="report-summary">
          <strong>{r.totalRequests}</strong> request{r.totalRequests === 1 ? "" : "s"}{" "}
          {hasFilters ? `match the current filters (${r.totalAvailableRequests} total available)` : "in the pipeline"}
          {r.approvedCount > 0 ? (
            <>
              {" · "}<strong>{r.approvedCount}</strong> approved
            </>
          ) : null}
        </p>
      ) : null}
      {r ? (
        <div className="report-chart-guide" role="note">
          <strong>How to read this dashboard</strong>
          <span>Counts show workflow volume. Green shows approved work. Cost charts show average approved costing, not total spend. Click a bar to filter the report.</span>
        </div>
      ) : null}
      {r?.freshness.status === "stale" ? (
        <div className="report-data-alert" role="status">
          Data may be stale: last source update was {formatDateTime(r.freshness.lastUpdatedAt ?? "")}. Refresh the NextGen/Supabase sync before making decisions.
        </div>
      ) : null}
      {r?.benchmark.band === "above" ? (
        <div className="report-anomaly-alert" role="alert">
          Cost anomaly detected: latest average approved cost is {Math.abs(r.benchmark.variancePct ?? 0).toFixed(1)}% above the historical benchmark.
        </div>
      ) : null}
      <div style={{ height: 16 }} />

      {error ? (
        <p className="notice">Report data is temporarily unavailable: {error}</p>
      ) : r ? (
        <>
          <div className="grid metrics">
            <div className="metric metric-accent-blue">
              <span className="metric-icon"><IconLayers size={16} /></span>
              <span className="metric-label">Total Requests</span>
              <strong>{r.totalRequests}</strong>
              <small>All-time pipeline</small>
              <Sparkline values={spark?.created ?? []} color="var(--metric-accent)" ariaLabel="Requests created per period" />
            </div>
            <div className="metric metric-accent-teal">
              <span className="metric-icon"><IconDashboard size={16} /></span>
              <span className="metric-label">Active</span>
              <strong>{r.activeRequests}</strong>
              <small>Open workflow items</small>
              <Sparkline values={spark?.active ?? []} color="var(--metric-accent)" ariaLabel="Active requests by creation period" />
            </div>
            <div className="metric metric-accent-amber">
              <span className="metric-icon"><IconClock size={16} /></span>
              <span className="metric-label">In Review</span>
              <strong>{r.inReviewCount}</strong>
              <small>MD / Costing / PBD</small>
              <Sparkline values={spark?.inReview ?? []} color="var(--metric-accent)" ariaLabel="In-review requests by creation period" />
            </div>
            <div className="metric metric-accent-orange">
              <span className="metric-icon"><IconSend size={16} /></span>
              <span className="metric-label">Needs Clarification</span>
              <strong>{r.needsClarificationCount}</strong>
              <small>Back with factory</small>
              <Sparkline values={spark?.clarification ?? []} color="var(--metric-accent)" ariaLabel="Needs-clarification requests by creation period" />
            </div>
            <div className="metric metric-accent-green">
              <span className="metric-icon"><IconCheckCircle size={16} /></span>
              <span className="metric-label">Approved</span>
              <strong className="text-green">{r.approvedCount}</strong>
              <small>Internally approved</small>
              <Sparkline values={spark?.approved ?? []} color="var(--metric-accent)" ariaLabel="Requests approved per period" />
            </div>
            <div className="metric metric-accent-red">
              <span className="metric-icon"><IconXCircle size={16} /></span>
              <span className="metric-label">Rejected</span>
              <strong className="text-red">{r.rejectedCount}</strong>
              <small>Internally rejected</small>
              <Sparkline values={spark?.rejected ?? []} color="var(--metric-accent)" ariaLabel="Rejected requests by creation period" />
            </div>
            <div className="metric metric-accent-violet">
              <span className="metric-icon"><IconChart size={16} /></span>
              <span className="metric-label">Approval Rate</span>
              <strong>{r.approvalRate === null ? "—" : `${r.approvalRate.toFixed(1)}%`}</strong>
              <small>Approved ÷ decided</small>
              <Sparkline values={spark?.approvalRate ?? []} color="var(--metric-accent)" ariaLabel="Approval rate per period" />
            </div>
            <div className="metric metric-accent-indigo">
              <span className="metric-icon"><IconDollar size={16} /></span>
              <span className="metric-label">Avg Approved Cost</span>
              <strong>{r.averageApprovedCost === null ? "—" : formatMoney(r.averageApprovedCost)}</strong>
              <small>Across historical costings</small>
              <Sparkline values={spark?.avgCost ?? []} color="var(--metric-accent)" ariaLabel="Average approved cost per period" />
            </div>
          </div>

          <div style={{ height: 16 }} />

          <div className="report-section-stack">
            <section className="panel">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Current workload</p>
                  <h2>Pipeline by Status</h2>
                </div>
                <span className="status blue">{r.totalRequests} total</span>
              </div>
              <p className="chart-caption">Each bar is the number of requests currently in that stage.</p>
              {r.byStatus.length ? (
                <HBarChart
                  items={r.byStatus.map((row) => ({ label: row.label, value: row.count, key: row.status, color: STATUS_CHART_COLORS[row.status] }))}
                  mainLabel="Requests"
                  rowHref={(item) => drillHref("status", item.key ?? "")}
                  showShare
                />
              ) : <p className="eyebrow">No requests yet.</p>}
            </section>

            <section className="panel">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Time series</p>
                  <h2>History and Outlook</h2>
                  <span className="chart-caption">Review past activity, then see a simple next-period estimate based on recent approved history.</span>
                </div>
                <div className="segmented" role="group" aria-label="Trend granularity">
                  {granularityOptions.map((option) => (
                    <Link
                      key={option.value}
                      href={granularityHref(option.value)}
                      className={`segmented-item${granularity === option.value ? " segmented-active" : ""}`}
                      aria-current={granularity === option.value ? "true" : undefined}
                    >
                      {option.label}
                    </Link>
                  ))}
                </div>
              </div>
              {r.trend.length ? (
                <>
                  <div className="report-chart-grid">
                    <div className="report-chart-card">
                      <h3>Requests moving through the workflow</h3>
                      <p className="chart-caption">Created versus internally approved per {bucketLabel}.</p>
                      <LineChart
                        series={[
                          {
                            name: "Created",
                            color: "var(--blue)",
                            points: r.trend.map((row) => ({ label: row.bucket, value: row.created }))
                          },
                          {
                            name: "Approved",
                            color: "var(--green)",
                            points: r.trend.map((row) => ({ label: row.bucket, value: row.approved }))
                          }
                        ]}
                      />
                    </div>
                    <div className="report-chart-card">
                      <h3>Average approved costing</h3>
                      <p className="chart-caption">Average approved cost per {bucketLabel}.</p>
                      {costTrend.length ? (
                        <LineChart
                          series={[
                            {
                              name: "Average cost",
                              color: "var(--amber)",
                              points: costTrend.map((row) => ({ label: row.bucket, value: row.avgCost ?? 0 }))
                            },
                            ...(showBenchmarkSeries
                              ? [{
                                  name: "Historical benchmark",
                                  color: "var(--red)",
                                  dash: true,
                                  points: costTrend.map((row) => ({ label: row.bucket, value: benchmark.targetCost! }))
                                }]
                              : [])
                          ]}
                        />
                      ) : <p className="eyebrow">No approved cost data in this range.</p>}
                    </div>
                  </div>
                  <div className="report-insight-grid">
                    <section className="report-insight-card report-prediction-card">
                      <div>
                        <p className="eyebrow">Prediction</p>
                        <h3>Next-period outlook</h3>
                      </div>
                      {forecast?.projectedCreated !== null && forecast?.projectedCreated !== undefined ? (
                        <div className="report-prediction-metrics">
                          <div>
                            <strong>{forecast.projectedCreated}</strong>
                            <span>expected requests</span>
                          </div>
                          <div>
                            <strong>{forecast.projectedApproved ?? "—"}</strong>
                            <span>expected approvals</span>
                          </div>
                          <div>
                            <strong>{forecast.projectedAvgCost === null ? "—" : formatMoney(forecast.projectedAvgCost)}</strong>
                            <span>expected average cost</span>
                          </div>
                        </div>
                      ) : (
                        <p className="chart-empty">Prediction needs at least one observed {bucketLabel}; reliability improves as more history is added.</p>
                      )}
                      <p className="chart-footnote">
                        {forecast?.nextBucket ? `For ${forecast.nextBucket}. ` : ""}
                        {forecast ? `${forecast.observedBuckets} observed period${forecast.observedBuckets === 1 ? "" : "s"}; ${forecast.confidence} confidence.` : "No forecast history yet."}
                        {forecast && forecast.observedBuckets < 6 ? " Add at least 6 periods for a reliable prediction." : ""}
                        {forecast?.costSampleBuckets && forecast.costSampleBuckets >= 2 && forecast.projectedAvgCostLow !== null && forecast?.projectedAvgCostLow !== undefined && forecast?.projectedAvgCostHigh !== null && forecast?.projectedAvgCostHigh !== undefined ? ` Cost range ${formatMoney(forecast.projectedAvgCostLow)}–${formatMoney(forecast.projectedAvgCostHigh)}.` : forecast?.projectedAvgCost !== null && forecast?.projectedAvgCost !== undefined ? " Cost range needs at least 2 approved periods." : ""}
                        {forecast?.projectedAvgCost !== null && forecast?.projectedAvgCost !== undefined && forecast.costDirection !== "flat" ? ` Cost trend is ${forecast.costDirection ?? "stable"}.` : ""}
                      </p>
                    </section>
                    <section className="report-insight-card">
                      <div>
                        <p className="eyebrow">Comparison</p>
                        <h3>{comparisonLabel}</h3>
                      </div>
                      {selectedComparison ? (
                        <div className="report-history-comparison">
                          <div className="report-history-periods">
                            <span>{selectedComparison.previousLabel}</span>
                            <span>→</span>
                            <strong>{selectedComparison.latestLabel}</strong>
                          </div>
                          <HistoryChange label="Requests" value={selectedComparison.latestCreated} change={selectedComparison.createdChange} />
                          <HistoryChange label="Approved" value={selectedComparison.latestApproved} change={selectedComparison.approvedChange} />
                          <HistoryChange label="Avg cost" value={selectedComparison.avgCost} change={selectedComparison.avgCostChange} />
                        </div>
                      ) : selectedBaseline ? (
                        <div className="report-history-comparison">
                          <div className="report-history-periods">
                            <strong>{selectedBaseline.label}</strong>
                            <span>current baseline</span>
                          </div>
                          <HistoryChange label="Requests" value={selectedBaseline.created} change={null} />
                          <HistoryChange label="Approved" value={selectedBaseline.approved} change={null} />
                          <HistoryChange label="Avg cost" value={selectedBaseline.avgCost} change={null} />
                          <p className="chart-footnote">A second observed period will unlock period-over-period comparison.</p>
                        </div>
                      ) : (
                        <p className="chart-empty">History comparison will appear when approved history is available.</p>
                      )}
                    </section>
                    <section className="report-insight-card report-benchmark-card" aria-live="polite">
                      <div>
                        <p className="eyebrow">Cost guardrail</p>
                        <h3>Benchmark variance</h3>
                      </div>
                      {benchmark?.band !== "no_data" && benchmark?.targetCost !== null && benchmark?.targetCost !== undefined ? (
                        <>
                          <div className="benchmark-summary">
                            <strong>{benchmark.variancePct === null ? "—" : `${benchmark.variancePct > 0 ? "+" : ""}${benchmark.variancePct.toFixed(1)}%`}</strong>
                            <span className={`benchmark-status benchmark-${benchmark.band}`}>
                              {benchmark.band === "above" ? "Above benchmark" : benchmark.band === "below" ? "Below benchmark" : "Within range"}
                            </span>
                          </div>
                          <div className="benchmark-grid">
                            <div><span>Target</span><strong>{formatMoney(benchmark.targetCost)}</strong></div>
                            <div><span>Latest</span><strong>{benchmark.latestCost === null ? "—" : formatMoney(benchmark.latestCost)}</strong></div>
                          </div>
                          <p className="chart-footnote">Based on {benchmark.sampleCount} approved costing{benchmark.sampleCount === 1 ? "" : "s"}; tolerance ±{benchmark.tolerancePct}%.</p>
                        </>
                      ) : <p className="chart-empty">No benchmark available yet. Approve more costings to establish a target.</p>}
                    </section>
                  </div>
                  <table className="table compact chart-table">
                    <thead>
                      <tr><th>Period</th><th>Created</th><th>Approved</th><th>Avg approved cost</th></tr>
                    </thead>
                    <tbody>
                      {r.trend.map((row) => (
                        <tr key={row.bucket}>
                          <td>{row.bucket}</td>
                          <td>{row.created}</td>
                          <td>{row.approved}</td>
                          <td>{row.avgCost !== null ? formatMoney(row.avgCost) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              ) : <p className="eyebrow">No trend data yet.</p>}
            </section>
          </div>

          <div style={{ height: 16 }} />

          <div className="split">
            <section className="panel">
              <div className="section-heading"><div><p className="eyebrow">Top 8 by volume</p><h2>By Factory</h2></div></div>
              <p className="chart-caption">Gray is total requests; green is internally approved.</p>
              {topFactoryRows.length ? (
                <PaginatedHBarChart
                  items={topFactoryRows.map((row) => ({ label: row.key, value: row.count, sub: row.approved, href: drillHref("factory", row.key) }))}
                  mainLabel="Requests"
                  subLabel="Approved"
                  pageSize={5}
                />
              ) : <p className="eyebrow">No factory data yet.</p>}
            </section>

            <section className="panel">
              <div className="section-heading"><div><p className="eyebrow">Top 8 by volume</p><h2>By Brand</h2></div></div>
              <p className="chart-caption">Compare request volume and approved count by brand.</p>
              {topBrandRows.length ? (
                <PaginatedHBarChart
                  items={topBrandRows.map((row) => ({ label: formatDimensionLabel(row.key), value: row.count, sub: row.approved, href: drillHref("brand", formatDimensionLabel(row.key)) }))}
                  mainLabel="Requests"
                  subLabel="Approved"
                  pageSize={5}
                />
              ) : <p className="eyebrow">No brand data yet.</p>}
            </section>
          </div>

          <div style={{ height: 16 }} />

          <div className="split">
            <section className="panel">
              <div className="section-heading"><div><p className="eyebrow">Top 8 by volume</p><h2>By Customer</h2></div></div>
              <p className="chart-caption">Compare request volume and approved count by customer.</p>
              {topCustomerRows.length ? (
                <PaginatedHBarChart
                  items={topCustomerRows.map((row) => ({ label: formatDimensionLabel(row.key), value: row.count, sub: row.approved, href: drillHref("customer", formatDimensionLabel(row.key)) }))}
                  mainLabel="Requests"
                  subLabel="Approved"
                  pageSize={5}
                />
              ) : <p className="eyebrow">No customer data yet.</p>}
            </section>

            <section className="panel">
              <div className="section-heading"><div><p className="eyebrow">Top 8 by volume</p><h2>By Season</h2></div></div>
              <p className="chart-caption">See which seasons are driving the current pipeline.</p>
              {topSeasonRows.length ? (
                <PaginatedHBarChart
                  items={topSeasonRows.map((row) => ({ label: formatDimensionLabel(row.key), value: row.count, sub: row.approved, href: drillHref("season", formatDimensionLabel(row.key)) }))}
                  mainLabel="Requests"
                  subLabel="Approved"
                  pageSize={5}
                />
              ) : <p className="eyebrow">No season data yet.</p>}
            </section>
          </div>

          <div style={{ height: 16 }} />

          <section className="panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Approved cost drivers</p>
                <h2>Cost trend by construction inputs</h2>
              </div>
            </div>
            <p className="chart-caption">Average approved cost by yarn, knit type, machine, construction, and customer. Excluded outliers are omitted.</p>
            <div className="report-dimension-grid">
              {[
                ["Factory", r.byFactoryCost],
                ["Yarn type", r.byYarn],
                ["Knit type", r.byKnit],
                ["Machine", r.byMachine],
                ["Construction", r.byConstruction],
                ["Customer", r.byCustomerCost]
              ].map(([label, values]) => {
                const rows = (values as typeof r.byYarn).filter((row) => row.avgCost !== null).slice(0, 6);
                return (
                  <div className="report-dimension-card" key={label as string}>
                    <h3>{label as string}</h3>
                    {rows.length ? <HBarChart items={rows.map((row) => ({ label: formatDimensionLabel(row.key), value: row.avgCost ?? 0 }))} mainLabel="Avg cost" /> : <p className="chart-empty">Not enough approved history.</p>}
                  </div>
                );
              })}
            </div>
          </section>

          <div style={{ height: 16 }} />

          <section className="panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">SLA compliance</p>
                <h2>SLA breakdown by stage and owner</h2>
                <span className="chart-caption">Point-in-time snapshot of the filtered pipeline — SLA hours per stage, who owns the backlog, and when the current breaches occurred.</span>
              </div>
              <span className="status red">{sla?.totalBreached ?? 0} breached</span>
            </div>
            {sla && sla.byStatus.length ? (
              <>
                <div className="report-chart-card" style={{ marginBottom: 16 }}>
                  <h3>Breaches over time</h3>
                  <p className="chart-caption">Currently-overdue requests by the {bucketLabel} their SLA deadline fell in.</p>
                  {sla.trend.length ? (
                    <LineChart
                      series={[{
                        name: "Breached",
                        color: "var(--red)",
                        points: sla.trend.map((point) => ({ label: point.bucket, value: point.breached }))
                      }]}
                    />
                  ) : <p className="eyebrow">No breaches in the current scope.</p>}
                </div>
                <div className="report-chart-grid">
                  <div className="report-chart-card">
                    <h3>By stage</h3>
                    <div className="table-wrapper">
                      <table className="table compact">
                        <thead>
                          <tr><th>Stage</th><th>Owner</th><th>SLA</th><th>Active</th><th>Breached</th><th>Worst overdue</th></tr>
                        </thead>
                        <tbody>
                          {sla.byStatus.map((row) => (
                            <tr key={row.status}>
                              <td>{row.label}</td>
                              <td>{row.owner ? ownerLabel(row.owner) : "—"}</td>
                              <td>{row.slaHours !== null ? formatSlaDuration(row.slaHours) : "—"}</td>
                              <td>{row.active}</td>
                              <td className={row.breached ? "text-red" : ""}>{row.breached}</td>
                              <td>{row.maxHoursOverdue !== null ? formatSlaDuration(row.maxHoursOverdue) : "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <div className="report-chart-card">
                    <h3>By owner</h3>
                    <div className="table-wrapper">
                      <table className="table compact">
                        <thead>
                          <tr><th>Owner</th><th>Active</th><th>Breached</th><th>Avg days in status</th></tr>
                        </thead>
                        <tbody>
                          {sla.byOwner.map((row) => (
                            <tr key={row.owner}>
                              <td>{ownerLabel(row.owner)}</td>
                              <td>{row.active}</td>
                              <td className={row.breached ? "text-red" : ""}>{row.breached}</td>
                              <td>{row.avgDaysInStatus === null ? "—" : row.avgDaysInStatus.toFixed(1)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </>
            ) : <p className="eyebrow">No active requests to track in the current scope.</p>}
          </section>

          <div style={{ height: 16 }} />

          <section className="panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Detail</p>
                <h2>Request Register</h2>
              </div>
              <div className="section-heading-actions">
                <span className="status blue">{reportRegisterRows.length} rows · Generated {formatDateTime(r.generatedAt)}</span>
                <div className="report-register-export">
                  <Link className="button secondary btn-sm" href={registerExportHref("csv")}>
                    <IconDownload size={13} /> CSV
                  </Link>
                  <Link className="button secondary btn-sm" href={registerExportHref("xlsx")}>
                    <IconDownload size={13} /> Excel
                  </Link>
                </div>
              </div>
            </div>
            <div className="table-wrapper">
              <table className="table compact report-register-table">
                <thead>
                  <tr>
                    <SortableTh label="Request" sortKey="request_number" registerSort={registerSort} registerDir={registerDir} filters={filters} />
                    <SortableTh label="Style" sortKey="style_number" registerSort={registerSort} registerDir={registerDir} filters={filters} />
                    <SortableTh label="Product" sortKey="product_name" registerSort={registerSort} registerDir={registerDir} filters={filters} />
                    <SortableTh label="Factory" sortKey="factory_name" registerSort={registerSort} registerDir={registerDir} filters={filters} />
                    <SortableTh label="Brand" sortKey="brand" registerSort={registerSort} registerDir={registerDir} filters={filters} />
                    <SortableTh label="Customer" sortKey="customer" registerSort={registerSort} registerDir={registerDir} filters={filters} />
                    <SortableTh label="Season" sortKey="season" registerSort={registerSort} registerDir={registerDir} filters={filters} />
                    <SortableTh label="Status" sortKey="status" registerSort={registerSort} registerDir={registerDir} filters={filters} />
                    <SortableTh label="Created" sortKey="created_at" registerSort={registerSort} registerDir={registerDir} filters={filters} />
                  </tr>
                </thead>
                <tbody>
                  {visibleRegisterRows.map((row) => (
                    <tr key={row.id}>
                      <td><Link className="req-link" href={`/requests/${row.id}`}><strong>{row.request_number ?? row.id.slice(0, 8)}</strong></Link></td>
                      <td>{row.style_number ?? "—"}</td>
                      <td>{row.product_name ?? "—"}</td>
                      <td>{row.factory_name ?? "—"}</td>
                      <td>{row.brand ?? "—"}</td>
                      <td>{row.customer ?? "—"}</td>
                      <td>{row.season ?? "—"}</td>
                      <td><span className="status blue">{formatStatusLabel(maskStatusForRole(row.status, role))}</span></td>
                      <td>{formatDate(row.created_at)}</td>
                    </tr>
                  ))}
                  {visibleRegisterRows.length === 0 ? (
                    <tr><td colSpan={9} className="table-empty">No requests match the current filters.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            {reportRegisterRows.length > registerPageSize ? (
              <div className="report-pagination">
                <span>Page {safeRegisterPage} of {registerTotalPages}</span>
                <div className="report-pagination-actions">
                  {safeRegisterPage > 1 ? <Link className="button secondary btn-sm" href={registerPageHref(safeRegisterPage - 1)}>← Prev</Link> : null}
                  {safeRegisterPage < registerTotalPages ? <Link className="button secondary btn-sm" href={registerPageHref(safeRegisterPage + 1)}>Next →</Link> : null}
                </div>
              </div>
            ) : null}
          </section>
        </>
      ) : null}
    </AppShell>
  );
}

function formatStatusLabel(status: string): string {
  return (statusLabels as Record<string, string>)[status] ?? status.replace(/_/g, " ");
}

function formatDimensionLabel(value: string): string {
  const labels: Record<string, string> = {
    "No brand": "Unknown brand",
    "No customer": "Unknown customer",
    "No season": "Unknown season",
    Unassigned: "Unassigned factory"
  };
  return labels[value] ?? value;
}

function formatDateTime(value: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function SortableTh({ label, sortKey, registerSort, registerDir, filters }: {
  label: string;
  sortKey: RegisterSortKey;
  registerSort: RegisterSortKey;
  registerDir: "asc" | "desc";
  filters: ReportFilters;
}) {
  const active = registerSort === sortKey;
  const nextDir = active && registerDir === "asc" ? "desc" : "asc";
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) {
    if (!v) continue;
    if (k === "granularity" && v === "monthly") continue;
    params.set(k, v);
  }
  if (sortKey !== "created_at" || nextDir !== "asc") params.set("sort", sortKey);
  if (nextDir !== "desc") params.set("dir", nextDir);
  const q = params.toString();
  return (
    <th aria-sort={active ? (registerDir === "asc" ? "ascending" : "descending") : undefined}>
      <Link className={`report-sort-th${active ? " report-sort-active" : ""}`} href={`/reports${q ? `?${q}` : ""}`}>
        {label}
        <span className="report-sort-arrow">{active ? (registerDir === "asc" ? " ▲" : " ▼") : ""}</span>
      </Link>
    </th>
  );
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
}

function formatDate(value: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(date);
}

function formatSlaDuration(hours: number): string {
  if (hours < 48) return `${Math.round(hours)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

function ownerLabel(owner: string): string {
  if (owner === "unassigned") return "Unassigned";
  return getRoleLabel(owner as UserRole);
}

function HistoryChange({ label, value, change }: { label: string; value: string | number | null; change: number | null }) {
  const changeLabel = change === null ? "No baseline" : `${change > 0 ? "+" : ""}${change.toFixed(1)}%`;
  const changeClass = change === null ? "history-change-muted" : change > 0 ? "history-change-up" : change < 0 ? "history-change-down" : "history-change-flat";
  return (
    <div className="report-history-row">
      <span>{label}</span>
      <strong>{value === null ? "—" : value}</strong>
      <small className={changeClass}>{changeLabel}</small>
    </div>
  );
}
