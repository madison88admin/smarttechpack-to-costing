import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { AnomalyAlertsPanel } from "@/components/anomaly-alerts-panel";
import { BulkActions } from "@/components/bulk-actions";
import { RequestTable } from "@/components/request-table";
import { tryListCostingRequests } from "@/lib/costing/requests";
import { getUnreadInAppAlerts } from "@/lib/notifications/in-app";
import { ChangeAlertsPanel } from "@/components/change-alerts-panel";
import { MarginAnalyticsPanel } from "@/components/margin-analytics-panel";
import { FactoryScorecardPanel } from "@/components/factory-scorecard-panel";
import { SavingsOpportunityPanel } from "@/components/savings-opportunity-panel";
import { canCreateRequest, canRunPbdAction, canRunCostingAction, getCurrentRole, getCurrentUserId, getRoleLabel } from "@/lib/auth/roles";
import { resolveFactoryProfileId } from "@/lib/admin/assignments";
import { getAgingSummary, tryGetAgingData } from "@/lib/costing/aging";
import { getMarginAnalytics } from "@/lib/costing/margin-analytics";
import { getFactoryScorecard } from "@/lib/costing/factory-scorecard";
import { getSavingsOpportunity } from "@/lib/costing/savings-opportunity";
import { defaultWorkflowSettings, getWorkflowSettings } from "@/lib/admin/settings";
import { IconSearch, IconDownload, IconX, IconArrowLeft, IconArrowRight } from "@/components/ui/icons";
import { StatusPill } from "@/components/status-pill";
import { maskStatusForRole } from "@/lib/workflow/status";
import { SlaBreachTable } from "@/components/sla-breach-table";
import { SearchableFilter } from "@/components/searchable-filter";
import { tryGetNextGenFilterOptions } from "@/lib/nextgen/filter-options";

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

// Factory never sees the internal MD/Costing/PBD/Manager review statuses or
// the internally-approved outcome — those belong to the Madison88 team.
const factoryStatusOptions = allStatusOptions.filter(
  (option) =>
    !["for_md_review", "for_costing_review", "for_pbd_review", "pending_manager_approval", "approved"].includes(option.value)
);

// PBD sees all statuses (they track requests through the full pipeline)
const pbdStatusOptions = allStatusOptions;

const PAGE_SIZE = 5;

export default async function Home({
  searchParams
}: {
  searchParams?: { q?: string; status?: string; brand?: string; customer?: string; season?: string; from?: string; to?: string; page?: string; sortBy?: string; sortDir?: string };
}) {
  const query = searchParams?.q ?? "";
  const status = searchParams?.status ?? "all";
  const brand = searchParams?.brand ?? "";
  const customer = searchParams?.customer ?? "";
  const season = searchParams?.season ?? "";
  const from = searchParams?.from ?? "";
  const to = searchParams?.to ?? "";
  const page = Math.max(1, parseInt(searchParams?.page ?? "1", 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;
  const sortBy = searchParams?.sortBy ?? "created_at";
  const sortDir = (searchParams?.sortDir === "asc" ? "asc" : "desc") as "asc" | "desc";
  const exportHref = `/api/export/requests.csv?${new URLSearchParams({ q: query, status, brand, customer, season, from, to } as Record<string, string>).toString()}`;
  const role = getCurrentRole();
  const canCreate = canCreateRequest(role);
  const factoryProfileId = role === "factory"
    ? await resolveFactoryProfileId(getCurrentUserId()).catch(() => null)
    : null;

  // Role-based visibility: pass the user's role to filter visible statuses
  const listed = await tryListCostingRequests({
    query,
    status: status === "overdue" ? "all" : status,
    brand: brand || undefined,
    customer: customer || undefined,
    season: season || undefined,
    from: from || undefined,
    to: to || undefined,
    limit: role === "factory" ? 1000 : PAGE_SIZE,
    offset: role === "factory" ? 0 : offset,
    roles: [role],
    sortBy,
    sortDir
  });
  // Factory users only see requests assigned to them. Draft is always
  // filtered out for unassigned factory users; sent_to_factory and
  // needs_clarification must also be restricted to the caller's assignment
  // so that factory users cannot access other factories' queues.
  const visibleListedRows = (listed.data ?? []).filter((row) =>
    role !== "factory" || Boolean(factoryProfileId && row.assigned_factory_user_id === factoryProfileId)
  );
  const rows = role === "factory" ? visibleListedRows.slice(offset, offset + PAGE_SIZE) : visibleListedRows;
  const total = role === "factory" ? visibleListedRows.length : listed.total;
  const error = listed.error;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Fetch overall counts for metrics (respect brand/customer/season/date filters for pipeline accuracy)
  const { data: allRows } = await tryListCostingRequests({
    query,
    status: "all",
    brand: brand || undefined,
    customer: customer || undefined,
    season: season || undefined,
    from: from || undefined,
    to: to || undefined,
    limit: 1000,
    offset: 0,
    roles: [role]
  });
  // Same assignment gate for metrics: factory users only count their own requests.
  const metricsRows = (allRows ?? []).filter((row) =>
    role !== "factory" || Boolean(factoryProfileId && row.assigned_factory_user_id === factoryProfileId)
  );
  const forReview = metricsRows.filter((row) => row.status === "for_pbd_review").length;
  const forCosting = metricsRows.filter((row) => row.status === "for_costing_review").length;
  const clarification = metricsRows.filter((row) => row.status === "needs_clarification").length;
  const approved = metricsRows.filter((row) => row.status === "approved").length;
  const active = metricsRows.filter((row) => !["approved", "rejected"].includes(row.status)).length;

  // Portfolio margin analytics (internal roles only — margin/pricing never
  // reaches the factory; the panel itself is never rendered for them).
  const workflowSettings = await getWorkflowSettings().catch(() => defaultWorkflowSettings);
  const marginAnalytics = role === "factory"
    ? null
    : await getMarginAnalytics(workflowSettings.marginThresholdUsd);
  // Factory scorecard — quote accuracy vs master benchmark, cycle time per
  // stage, and clarification/rework rate. Internal analytics only.
  const factoryScorecard = role === "factory" ? null : await getFactoryScorecard();
  // Savings opportunity — over-benchmark material lines quantified per
  // garment / per MOQ order. Internal analytics only.
  const savingsOpportunity = role === "factory" ? null : await getSavingsOpportunity();

  // Aging analysis
  const aging = await tryGetAgingData();
  // Factory users only see SLA data for their own assigned requests.
  const factoryAgingRows = role === "factory" && factoryProfileId
    ? aging.rows.filter((r) => {
        const matched = visibleListedRows.find((row) => row.id === r.id);
        return Boolean(matched && matched.assigned_factory_user_id === factoryProfileId);
      })
    : aging.rows;
  const agingSummary = getAgingSummary(factoryAgingRows);
  const overdueIds = new Set(factoryAgingRows.filter((r) => r.is_overdue).map((r) => r.id));
  // When overdue filter is active, show all overdue rows (not just current page)
  const displayRows = status === "overdue"
    ? metricsRows.filter((row: any) => overdueIds.has(row.id))
    : rows;
  const actionStatuses = getActionStatuses(role);
  const actionRows = metricsRows.filter((row: any) => actionStatuses.includes(row.status)).slice(0, 5);
  const queueLabel = getQueueLabel(role);

  // Options for Brand/Customer/Season dropdowns — primary from NexGen (live), fallback to pipeline
  const nextGenOpts = role === "factory"
    ? { brands: [], customers: [], seasons: [] }
    : await tryGetNextGenFilterOptions().catch(() => ({ brands: [], customers: [], seasons: [] }));
  const pipelineBrands = [...new Set(metricsRows.map((r: { brand?: string | null }) => r.brand).filter((v): v is string => Boolean(v)))].sort();
  const pipelineCustomers = [...new Set(metricsRows.map((r: { customer?: string | null }) => r.customer).filter((v): v is string => Boolean(v)))].sort();
  const pipelineSeasons = [...new Set(metricsRows.map((r: { season?: string | null }) => r.season).filter((v): v is string => Boolean(v)))].sort();
  // Merge NexGen + pipeline, NexGen first (more authoritative for master data)
  const brandOptions = [...new Set([...(nextGenOpts.brands ?? []), ...pipelineBrands])].sort();
  const customerOptions = [...new Set([...(nextGenOpts.customers ?? []), ...pipelineCustomers])].sort();
  const seasonOptions = [...new Set([...(nextGenOpts.seasons ?? []), ...pipelineSeasons])].sort();

  // Unread in-app change alerts (BOM changed / PBD pricing updated) per request.
  const unreadAlerts = await getUnreadInAppAlerts(role).catch(() => ({ alerts: [], totalUnread: 0, perRequest: {} as Record<string, number> }));
  const unreadCounts = unreadAlerts.perRequest;

  return (
    <AppShell>
      <div className="dashboard-page">
      <div className="hero dashboard-hero">
        <div>
          <p className="eyebrow">Costing Workspace · {getRoleLabel(role)}</p>
          <h1>Costing Dashboard</h1>
          <p className="hero-copy">
            {role === "factory" ? "Submit your cost breakdown, respond to clarifications, and track factory queue — no pricing is shown here." : role === "costing" ? "Validate factory CBDs, check the 4-item checklist, and release to PBD — outlier flags need your ack to unblock approval." : role === "md" ? "Review construction, yarn and machine against the BOM — pass to release to Costing." : role === "pbd" ? "Review validated costs, enter selling price, and approve — customer status follows approval." : "Track tech-pack costing from NextGen pull to customer close."}
          </p>
          <div className="dashboard-hero-next">
            <strong>Your next step:</strong> {getNextStepHint(role, { forCosting, forReview, clarification, factoryQueue: metricsRows.filter((r) => ["draft","sent_to_factory","needs_clarification"].includes(r.status)).length })}
          </div>
        </div>
        <div className="hero-actions">
          {role !== "factory" ? <Link className="button secondary" href="/qa">
            Pilot QA
          </Link> : null}
          {canCreate ? (
            <Link className="button" href="/requests/new">
              New Request
            </Link>
          ) : null}
          {role === "factory" ? <Link className="button" href="/factory">Go to Factory View →</Link> : null}
        </div>
      </div>

      <div className="dashboard-utility-row" aria-label="Dashboard shortcuts">
        <span className="dashboard-utility-caption">Workspace view</span>
        <Link className={`dashboard-chip${status === "all" ? " active" : ""}`} href="/">All requests</Link>
        <Link className="dashboard-chip" href="/?status=overdue">Overdue</Link>
        <Link className="dashboard-chip" href="/?status=needs_clarification">Needs clarification</Link>
        {role !== "factory" ? <Link className="dashboard-chip dashboard-chip-accent" href="/reports">Open reporting</Link> : null}
      </div>

      <div className="grid metrics">
        {canRunCostingAction(role) ? (
          <Link href="/?status=for_costing_review" className="metric metric-clickable">
            <span className="metric-label">For Costing Review</span>
            <strong>{forCosting}</strong>
            <small>Awaiting Costing Team validation</small>
          </Link>
        ) : null}
        {(["admin", "pbd", "manager"].includes(role)) ? (
          <Link href="/?status=for_pbd_review" className="metric metric-clickable">
            <span className="metric-label">For PBD Review</span>
            <strong>{forReview}</strong>
            <small>Waiting for buyer decision</small>
          </Link>
        ) : null}
        {role === "factory" ? (
          <Link href="/factory" className="metric metric-clickable">
            <span className="metric-label">For CBD Submission</span>
            <strong>{metricsRows.filter((row) => ["draft", "sent_to_factory", "needs_clarification"].includes(row.status)).length}</strong>
            <small>Open factory queue</small>
          </Link>
        ) : null}
        <Link href="/?status=needs_clarification" className="metric metric-clickable">
          <span className="metric-label">Needs Clarification</span>
          <strong>{clarification}</strong>
          <small>Returned to factory</small>
        </Link>
        {role !== "factory" ? <Link href="/?status=approved" className="metric metric-clickable">
          <span className="metric-label">Internally Approved</span>
          <strong>{approved}</strong>
          <small>Saved to history</small>
        </Link> : null}
        <div className="metric">
          <span className="metric-label">Active Requests</span>
          <strong>{active}</strong>
          <small>Open workflow items</small>
        </div>
      </div>

      <section className="panel action-queue-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Role-based queue</p>
            <h2>My actions today</h2>
          </div>
          <span className="status blue">{queueLabel}</span>
        </div>
        {actionRows.length ? (
          <div className="quick-action-list">
            {actionRows.map((row: any) => {
              const product = Array.isArray(row.nextgen_products) ? row.nextgen_products[0] : row.nextgen_products;
              const href = role === "factory" && ["draft", "sent_to_factory", "needs_clarification"].includes(row.status) ? `/factory/${row.id}` : `/requests/${row.id}`;
              return (
                <Link key={row.id} href={href} className="quick-action-item">
                  <span><strong>{row.request_number ?? row.id.slice(0, 8)}</strong>{unreadCounts[row.id] ? <span className="inapp-badge" title={`${unreadCounts[row.id]} unread change alert${unreadCounts[row.id] > 1 ? "s" : ""}`}>{unreadCounts[row.id]}</span> : null}<small>{product?.style_number ?? "Pending style"} · {row.factory_name ?? "Unassigned"}</small></span>
                  <span className="quick-action-status"><StatusPill status={maskStatusForRole(row.status, role)} /></span>
                </Link>
              );
            })}
          </div>
        ) : <div className="empty-state compact-empty"><strong>No action items right now</strong><p>Your role queue is clear.</p></div>}
      </section>

      {/* BOM and PBD pricing alerts are internal Madison88 review data.
          Factory users receive their clarification action through the
          assigned queue/request banner instead of this internal feed. */}
      {role !== "factory" ? <ChangeAlertsPanel /> : null}

      {agingSummary && agingSummary.total > 0 ? (
        <>
          <div className="grid metrics" style={{ marginTop: 12 }}>
            <div className="metric">
              <span className="metric-label">Fresh (0-2d)</span>
              <strong className="text-green">{agingSummary.fresh}</strong>
              <small>Within SLA</small>
            </div>
            <div className="metric">
              <span className="metric-label">Aging (3-5d)</span>
              <strong className="text-amber">{agingSummary.aging}</strong>
              <small>Approaching SLA</small>
            </div>
            <div className="metric">
              <span className="metric-label">Overdue</span>
              <strong className="text-red">{agingSummary.overdue}</strong>
              <small>SLA breach</small>
            </div>
            <div className="metric">
              <span className="metric-label">Avg Days in Status</span>
              <strong>{agingSummary.averageDaysInStatus?.toFixed(1) ?? "—"}</strong>
              <small>Across active requests</small>
            </div>
          </div>
          {agingSummary.overdue > 0 ? (
            <section className="panel" style={{ marginTop: 12, borderColor: "#dc2626" }}>
              <div className="section-heading">
                <div>
                  <p className="eyebrow">SLA breach report — who owns the request, when it started, and when it breached</p>
                  <h2 style={{ color: "#dc2626" }}>SLA Breaches</h2>
                </div>
                <span className="status red">{agingSummary.overdue} breached</span>
              </div>
              <SlaBreachTable rows={factoryAgingRows.filter((r) => r.is_overdue)} statusLabels={Object.fromEntries(factoryAgingRows.map((r) => [r.status, maskStatusForRole(r.status, role)]))} role={role} />
            </section>
          ) : null}
        </>
      ) : null}

      {role !== "factory" && marginAnalytics?.data ? (
        <MarginAnalyticsPanel analytics={marginAnalytics.data} thresholdUsd={workflowSettings.marginThresholdUsd} />
      ) : null}

      {role !== "factory" && factoryScorecard?.data ? (
        <FactoryScorecardPanel scorecard={factoryScorecard.data} />
      ) : null}

      {role !== "factory" && savingsOpportunity?.data ? (
        <SavingsOpportunityPanel savings={savingsOpportunity.data} />
      ) : null}

      {canRunPbdAction(role) ? (
        <section className="panel" style={{ marginTop: 12 }}>
          <h2>Cost Anomaly Alerts</h2>
          <AnomalyAlertsPanel />
        </section>
      ) : null}

      <div style={{ height: 16 }} />

      <section className="process-strip">
        <div className="process-step done">
          <strong>1. Pull NextGen</strong>
          <span>Style, product, BOM</span>
        </div>
        <div className="process-step current">
          <strong>2. Factory CBD</strong>
          <span>Cost, MOQ, lead time</span>
        </div>
        {role === "factory" ? <div className="process-step">
          <strong>3. Under Review</strong>
          <span>Madison88 internal review</span>
        </div> : <>
          <div className="process-step">
            <strong>3. Costing Review</strong>
            <span>Validation + checklist</span>
          </div>
          <div className="process-step">
            <strong>4. PBD Approval</strong>
            <span>Review, approve, reject, or clarify</span>
          </div>
          <div className="process-step">
            <strong>5. Customer Status</strong>
            <span>Submit, negotiate, close</span>
          </div>
        </>}
      </section>

      <section className="workflow-glossary" aria-label="Workflow terminology">
        <span><abbr title="Bill of Materials">BOM</abbr> = NextGen material list</span>
        <span><abbr title="Cost Breakdown Details">CBD</abbr> = Factory costing submission</span>
        <span><abbr title="Product Business Development">PBD</abbr> = Product review owner</span>
        <span><abbr title="Material Purchase Order">MPO</abbr> = Material purchase order</span>
      </section>

      <div style={{ height: 16 }} />

      <section className="panel dashboard-request-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Live Queue</p>
            <h2>Costing Requests</h2>
          </div>
          <div className="section-heading-right">
            <span className={`status ${error ? "red" : "green"}`}>{error ? "Data Unavailable" : "Live Data"}</span>
            {role !== "factory" ? <Link className="button secondary btn-sm" href={exportHref}>
              <IconDownload size={14} /> Export CSV
            </Link> : null}
            {role !== "factory" ? <Link className="button secondary btn-sm" href="/api/export/cbd-detail.csv">
              <IconDownload size={14} /> CBD Detail
            </Link> : null}
          </div>
        </div>
        {error ? (
          <p className="notice">
            Live data is unavailable. No sample records are being shown. Check the Supabase connection and application logs, then retry.
          </p>
        ) : null}
        <form className="toolbar filter-toolbar report-filter-grid" action="/" style={{ marginBottom: 12 }}>
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
              <Link className="button secondary" href="/">
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
              Showing {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total} requests
            </span>
            <div className="pagination-controls">
              {page > 1 ? (
                <Link
                  className="button secondary small-btn"
                  href={`/?${buildPaginationUrl(query, status, page - 1, { brand, customer, season, from, to })}`}
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
                  href={`/?${buildPaginationUrl(query, status, page + 1, { brand, customer, season, from, to })}`}
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

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(value));
}

function getActionStatuses(role: string) {
  if (role === "factory") return ["draft", "sent_to_factory", "needs_clarification"];
  if (role === "costing") return ["for_costing_review"];
  if (role === "md") return ["for_md_review"];
  if (role === "manager") return ["for_pbd_review"];
  if (role === "pbd") return ["for_pbd_review", "needs_clarification"];
  return ["for_costing_review", "for_pbd_review", "pending_manager_approval", "needs_clarification"];
}

function getQueueLabel(role: string) {
  if (role === "factory") return "Factory queue";
  if (role === "costing") return "Costing validation";
  if (role === "manager") return "PBD review";
  if (role === "md") return "MD review";
  if (role === "pbd") return "PBD review";
  return "All operational queues";
}

function getNextStepHint(role: string, counts: { forCosting: number; forReview: number; clarification: number; factoryQueue: number }) {
  if (role === "factory") return counts.factoryQueue ? `${counts.factoryQueue} in factory queue — open Factory View and submit CBD.` : "No factory actions — queue clear.";
  if (role === "costing") return counts.forCosting ? `${counts.forCosting} awaiting validation — open Costing Review.` : counts.clarification ? `${counts.clarification} returned to factory — monitor clarifications.` : "No Costing actions.";
  if (role === "md") return "Check MD review queue — pass to release to Costing.";
  if (role === "pbd") return counts.forReview ? `${counts.forReview} awaiting PBD approval — enter pricing then approve.` : counts.clarification ? `${counts.clarification} with factory — awaiting resubmit.` : "No PBD actions.";
  if (role === "manager") return counts.forReview ? `${counts.forReview} awaiting PBD approval.` : "No PBD actions.";
  return counts.clarification ? `${counts.clarification} needs clarification — factory is correcting.` : "All queues monitored.";
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
