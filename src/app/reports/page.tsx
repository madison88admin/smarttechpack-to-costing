import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { PrintButton } from "@/components/print-button";
import { HBarChart } from "@/components/charts";
import { PaginatedHBarChart } from "@/components/paginated-hbar-chart";
import { SearchableFilter } from "@/components/searchable-filter";
import { IconDownload, IconX } from "@/components/ui/icons";
import { canAccessInternalCostData, canDownloadCostingReports, getCurrentRole } from "@/lib/auth/roles";
import { tryGetReportData, type ReportFilters } from "@/lib/reporting";
import { tryGetNextGenFilterOptions } from "@/lib/nextgen/filter-options";
import { statusLabels } from "@/lib/workflow/status";

export const metadata = { title: "Reports — Smart TP" };

export default async function ReportsPage({
  searchParams
}: {
  searchParams?: {
    factory?: string;
    brand?: string;
    customer?: string;
    season?: string;
    status?: string;
    page?: string;
    sort?: string;
    dir?: string;
    from?: string;
    to?: string;
  };
}) {
  const role = getCurrentRole();
  // Reporting is a read-only internal workspace. Operational dashboards stay
  // hidden for Super Admin, and factory accounts never receive internal cost data.
  const canView = role !== "superadmin" && canAccessInternalCostData(role);
  if (!canView) {
    redirect("/");
  }
  // Reading the report is an internal-dashboard right; downloading it is a lane
  // right. Both export routes gate on canDownloadCostingReports, so the buttons
  // read that same rule — MD and Viewer could read this page and were offered
  // downloads that answered 401.
  const canExport = canDownloadCostingReports(role);

  const filters: ReportFilters = {
    factory: searchParams?.factory?.trim() || null,
    brand: searchParams?.brand?.trim() || null,
    customer: searchParams?.customer?.trim() || null,
    season: searchParams?.season?.trim() || null,
    status: searchParams?.status?.trim() || null,
    from: searchParams?.from?.trim() || null,
    to: searchParams?.to?.trim() || null
  };
  const exportParams = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) exportParams.set(key, value);
  }
  const exportQuery = exportParams.toString();
  const excelHref = `/api/export/report.xlsx${exportQuery ? `?${exportQuery}` : ""}`;
  const csvHref = `/api/export/report.csv${exportQuery ? `?${exportQuery}` : ""}`;
  const hasFilters = Boolean(filters.factory || filters.brand || filters.customer || filters.season || filters.status || filters.from || filters.to);

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
  // Removes a single filter while preserving the rest (used by the chips).
  const removeFilterHref = (key: string) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) {
      if (!v || k === key) continue;
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
    filters.to ? { key: "to", label: `To ${filters.to}` } : null
  ].filter((chip): chip is { key: string; label: string } => chip !== null);

  const statusOptions = [
    { value: "", label: "All statuses" },
    ...Object.entries(statusLabels).map(([value, label]) => ({ value, label }))
  ];

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
  const r = data;
  const topFactoryRows = r?.byFactory ?? [];
  const topBrandRows = r?.byBrand ?? [];
  const topCustomerRows = r?.byCustomer ?? [];
  const topSeasonRows = r?.bySeason ?? [];


  return (
    <AppShell>
      <div className="hero">
        <div>
          <p className="eyebrow">Reporting</p>
          <h1>Costing Reports</h1>
          <p className="hero-copy">
            Compare request volume and approved cost drivers by factory, brand, customer, season, and construction inputs. Filter, drill into a category, or export the current view.
          </p>
          {r ? <span className="report-source-badge">Live data · {r.dataSource} · Refreshed {formatDateTime(r.generatedAt)}</span> : null}
        </div>
        <div className="hero-actions">
          {canExport ? (
            <Link className="button secondary" href={excelHref}>
              <IconDownload size={14} /> Export Excel
            </Link>
          ) : null}
          <PrintButton label="Export PDF" />
          {canExport ? (
            <Link className="button secondary btn-sm" href={csvHref}>
              <IconDownload size={14} /> CSV
            </Link>
          ) : null}
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
          <span>Gray shows total requests and green shows approved requests. Factory, brand, customer, and season bars open the matching filtered view. Cost-driver charts show average approved costing, not total spend.</span>
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
          <div className="split">
            <section className="panel">
              <div className="section-heading"><div><p className="eyebrow">Top 8 by request volume</p><h2>By Factory</h2></div></div>
              <p className="chart-caption">Use this to identify which factories have the most active work. Gray is total requests; green is internally approved. Select a bar to filter the report; five results are shown per page.</p>
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
              <div className="section-heading"><div><p className="eyebrow">Top 8 by request volume</p><h2>By Brand</h2></div></div>
              <p className="chart-caption">Use this to prioritize brand workload. Compare total requests with approvals, then select a bar to filter the report; five results are shown per page.</p>
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
              <div className="section-heading"><div><p className="eyebrow">Top 8 by request volume</p><h2>By Customer</h2></div></div>
              <p className="chart-caption">Use this to understand customer demand and approval progress. Select a bar to filter the report; five results are shown per page.</p>
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
              <div className="section-heading"><div><p className="eyebrow">Top 8 by request volume</p><h2>By Season</h2></div></div>
              <p className="chart-caption">Use this to see which seasons are driving the current workload. Select a bar to filter the report; five results are shown per page.</p>
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
                <h2>Approved cost by construction inputs</h2>
              </div>
            </div>
            <p className="chart-caption">Use this to compare average approved cost across yarn, knit type, machine, construction, and customer. It is decision support for costing review; excluded outliers are omitted.</p>
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
