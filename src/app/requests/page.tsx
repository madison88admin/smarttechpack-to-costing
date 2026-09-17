import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { BulkActions } from "@/components/bulk-actions";
import { RequestTable } from "@/components/request-table";
import { SearchableFilter } from "@/components/searchable-filter";
import { StatusPill } from "@/components/status-pill";
import { canDownloadRequestExports, canRunCostingAction, canRunPbdAction, getCurrentRole, getCurrentUserId, getRoleLabel } from "@/lib/auth/roles";
import { listScopedRequestPage, REQUEST_PAGE_SIZE } from "@/lib/costing/request-listing";
import { getUnreadInAppAlerts } from "@/lib/notifications/in-app";
import { getAgingSummary, tryGetAgingData } from "@/lib/costing/aging";
import { maskStatusForRole } from "@/lib/workflow/status";
import { tryGetNextGenFilterOptions } from "@/lib/nextgen/filter-options";
import { IconSearch, IconDownload, IconX, IconArrowLeft, IconArrowRight } from "@/components/ui/icons";

const allStatusOptions = [
  { value: "all", label: "All statuses" },
  { value: "draft", label: "Draft" },
  { value: "sent_to_factory", label: "Sent to Factory" },
  { value: "for_md_review", label: "For MD Review" },
  { value: "for_costing_review", label: "For Costing Review" },
  { value: "for_pbd_review", label: "For PBD Review" },
  { value: "needs_clarification", label: "Needs Clarification" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "overdue", label: "Overdue" }
];

// Factory never sees the internal MD/Costing/PBD review statuses or the
// internally-approved outcome — those belong to the Madison88 team.
const factoryStatusOptions = allStatusOptions.filter(
  (option) => !["for_md_review", "for_costing_review", "for_pbd_review", "approved"].includes(option.value)
);

// PBD sees all statuses (they track requests through the full pipeline).
const pbdStatusOptions = allStatusOptions;

export default async function RequestsPage({
  searchParams
}: {
  searchParams?: { q?: string; status?: string; brand?: string; customer?: string; season?: string; from?: string; to?: string; page?: string; sortBy?: string; sortDir?: string };
}) {
  const role = getCurrentRole();
  const userId = getCurrentUserId() ?? "";
  const query = searchParams?.q ?? "";
  const status = searchParams?.status ?? "all";
  const brand = searchParams?.brand ?? "";
  const customer = searchParams?.customer ?? "";
  const season = searchParams?.season ?? "";
  const from = searchParams?.from ?? "";
  const to = searchParams?.to ?? "";
  const page = Math.max(1, parseInt(searchParams?.page ?? "1", 10) || 1);
  const offset = (page - 1) * REQUEST_PAGE_SIZE;
  const sortBy = searchParams?.sortBy ?? "created_at";
  const sortDir = (searchParams?.sortDir === "asc" ? "asc" : "desc") as "asc" | "desc";
  const exportHref = `/api/export/requests.csv?${new URLSearchParams({ q: query, status, brand, customer, season, from, to } as Record<string, string>).toString()}`;

  const listed = await listScopedRequestPage({
    role,
    userId,
    query,
    status,
    brand: brand || undefined,
    customer: customer || undefined,
    season: season || undefined,
    from: from || undefined,
    to: to || undefined,
    offset,
    sortBy,
    sortDir
  });
  const rows = listed.rows;
  const total = listed.total ?? 0;
  const error = listed.error;
  const totalPages = Math.max(1, Math.ceil(total / REQUEST_PAGE_SIZE));

  // Overdue highlighting + the overdue filter come from the aging data.
  const aging = await tryGetAgingData();
  const overdueIds = new Set(aging.rows.filter((r) => r.is_overdue).map((r) => r.id));
  const displayRows = status === "overdue"
    ? rows.filter((row: { id: string }) => overdueIds.has(row.id))
    : rows;

  // Brand/Customer/Season dropdown options — NexGen primary, pipeline fallback.
  const nextGenOpts = role === "factory"
    ? { brands: [], customers: [], seasons: [] }
    : await tryGetNextGenFilterOptions().catch(() => ({ brands: [], customers: [], seasons: [] }));
  const pipelineBrands = [...new Set(rows.map((r: { brand?: string | null }) => r.brand).filter((v): v is string => Boolean(v)))].sort();
  const pipelineCustomers = [...new Set(rows.map((r: { customer?: string | null }) => r.customer).filter((v): v is string => Boolean(v)))].sort();
  const pipelineSeasons = [...new Set(rows.map((r: { season?: string | null }) => r.season).filter((v): v is string => Boolean(v)))].sort();
  const brandOptions = [...new Set([...(nextGenOpts.brands ?? []), ...pipelineBrands])].sort();
  const customerOptions = [...new Set([...(nextGenOpts.customers ?? []), ...pipelineCustomers])].sort();
  const seasonOptions = [...new Set([...(nextGenOpts.seasons ?? []), ...pipelineSeasons])].sort();

  // Unread in-app change alerts per request (BOM changed / PBD pricing updated).
  const unreadAlerts = await getUnreadInAppAlerts(role).catch(() => ({ alerts: [], totalUnread: 0, perRequest: {} as Record<string, number> }));
  const unreadCounts = unreadAlerts.perRequest;

  // The queue's downloads follow the endpoints' own rule (`canDownloadRequestExports`),
  // so Viewer is never offered a link that would answer 401. Factory keeps its
  // downloads on the Factory view, so the queue panel stays link-free for it.
  const canDownloadQueueExports = canDownloadRequestExports(role) && role !== "factory";

  return (
    <AppShell>
      <div className="dashboard-page">
        <div className="hero dashboard-hero">
          <div>
            <p className="eyebrow">Live Queue · {getRoleLabel(role)}</p>
            <h1>All Requests</h1>
            <p className="hero-copy">
              {role === "factory"
                ? "Your assigned requests — submit CBDs and respond to clarifications from here."
                : "Full costing pipeline: filter, search, bulk-actions, and export from one list."}
            </p>
          </div>
          <div className="hero-actions">
            <Link className="button secondary" href="/">
              Back to Dashboard
            </Link>
            {role === "factory" ? <Link className="button" href="/factory">Go to Factory View →</Link> : null}
          </div>
        </div>

        <section className="panel dashboard-request-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Live Queue</p>
              <h2>Costing Requests</h2>
            </div>
            <div className="section-heading-right">
              <span className={`status ${error ? "red" : "green"}`}>{error ? "Data Unavailable" : "Live Data"}</span>
              {canDownloadQueueExports ? (
                <Link className="button secondary btn-sm" href={exportHref}>
                  <IconDownload size={14} /> Export CSV
                </Link>
              ) : null}
              {canDownloadQueueExports ? (
                <Link className="button secondary btn-sm" href="/api/export/cbd-detail.csv">
                  <IconDownload size={14} /> CBD Detail
                </Link>
              ) : null}
            </div>
          </div>
          {error ? (
            <p className="notice">
              Live data is unavailable. No sample records are being shown. Check the Supabase connection and application logs, then retry.
            </p>
          ) : null}
          <form className="toolbar filter-toolbar report-filter-grid" action="/requests" style={{ marginBottom: 12 }}>
            <SearchableFilter name="brand" label="Brand" value={brand} options={brandOptions} />
            <SearchableFilter name="customer" label="Customer" value={customer} options={customerOptions} />
            <SearchableFilter name="season" label="Season" value={season} options={seasonOptions} />
            <select className="input filter-select" name="status" defaultValue={status} aria-label="All statuses">
              {(canRunCostingAction(role) ? allStatusOptions : role === "factory" ? factoryStatusOptions : pbdStatusOptions).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <input className="input" type="date" name="from" defaultValue={from} aria-label="From date" title="From date (mm/dd/yyyy)" />
            <input className="input" type="date" name="to" defaultValue={to} aria-label="To date" title="To date (mm/dd/yyyy)" />
            <div className="filter-search" style={{ gridColumn: "1 / -1" }}>
              <IconSearch size={16} className="search-icon" />
              <input
                className="input search-input"
                name="q"
                defaultValue={query}
                placeholder="Search request number or factory..."
              />
            </div>
            <div className="report-filter-actions" style={{ gridColumn: "1 / -1" }}>
              <button className="button" type="submit">
                Filter
              </button>
              {query || status !== "all" || brand || customer || season || from || to ? (
                <Link className="button secondary" href="/requests">
                  <IconX size={14} /> Clear
                </Link>
              ) : null}
              <span style={{ fontSize: 11, color: "var(--muted)", marginLeft: 8 }}>Date inputs show calendar dropdown on click (mm/dd/yyyy)</span>
            </div>
          </form>
          {!error ? <BulkActions canPbdAct={canRunPbdAction(role)} canCostingAct={canRunCostingAction(role)} /> : null}
          <RequestTable
            rows={error ? null : displayRows}
            sortBy={sortBy}
            sortDir={sortDir}
            queryParams={{ q: query, status, brand, customer, season, from, to, page: String(page) }}
            role={role}
            overdueIds={overdueIds}
            unreadCounts={unreadCounts}
          />
          {!error && total > 0 && status !== "overdue" ? (
            <div className="pagination">
              <span className="pagination-info">
                Showing {offset + 1}–{Math.min(offset + REQUEST_PAGE_SIZE, total)} of {total} requests
              </span>
              <div className="pagination-controls">
                {page > 1 ? (
                  <Link
                    className="button secondary small-btn"
                    href={`/requests?${buildPaginationUrl(query, status, page - 1, { brand, customer, season, from, to })}`}
                  >
                    <IconArrowLeft size={14} /> Prev
                  </Link>
                ) : (
                  <button className="button secondary small-btn" disabled><IconArrowLeft size={14} /> Prev</button>
                )}
                <span className="pagination-page">Page {page} of {totalPages}</span>
                {page < totalPages ? (
                  <Link
                    className="button secondary small-btn"
                    href={`/requests?${buildPaginationUrl(query, status, page + 1, { brand, customer, season, from, to })}`}
                  >
                    Next <IconArrowRight size={14} />
                  </Link>
                ) : (
                  <button className="button secondary small-btn" disabled>Next <IconArrowRight size={14} /></button>
                )}
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </AppShell>
  );
}

function buildPaginationUrl(query: string, status: string, page: number, extra?: { brand?: string; customer?: string; season?: string; from?: string; to?: string }) {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (status && status !== "all") params.set("status", status);
  if (extra?.brand) params.set("brand", extra.brand);
  if (extra?.customer) params.set("customer", extra.customer);
  if (extra?.season) params.set("season", extra.season);
  if (extra?.from) params.set("from", extra.from);
  if (extra?.to) params.set("to", extra.to);
  params.set("page", String(page));
  return params.toString();
}