import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { AnomalyAlertsPanel } from "@/components/anomaly-alerts-panel";
import { tryListCostingRequests } from "@/lib/costing/requests";
import { getUnreadInAppAlerts } from "@/lib/notifications/in-app";
import { ChangeAlertsPanel } from "@/components/change-alerts-panel";
import { MarginAnalyticsPanel } from "@/components/margin-analytics-panel";
import { FactoryScorecardPanel } from "@/components/factory-scorecard-panel";
import { SavingsOpportunityPanel } from "@/components/savings-opportunity-panel";
import { canCreateRequest, canRunPbdAction, canRunCostingAction, getCurrentRole, getCurrentUserId } from "@/lib/auth/roles";
import { resolveFactoryScope, scopeRowsForRole } from "@/lib/costing/request-listing";
import { getAgingSummary, scopeSlaRowsForRole, tryGetAgingData } from "@/lib/costing/aging";
import { getMarginAnalytics } from "@/lib/costing/margin-analytics";
import { getFactoryScorecard } from "@/lib/costing/factory-scorecard";
import { getSavingsOpportunity } from "@/lib/costing/savings-opportunity";
import { defaultWorkflowSettings, getWorkflowSettings } from "@/lib/admin/settings";
import { IconArrowRight } from "@/components/ui/icons";
import { StatusPill } from "@/components/status-pill";
import { maskStatusForRole } from "@/lib/workflow/status";
import { SlaBreachTable } from "@/components/sla-breach-table";
import { AnalyticsTabs, type AnalyticsTab } from "@/components/analytics-tabs";

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
  const role = getCurrentRole();
  const canCreate = canCreateRequest(role);
  // Independent sources load concurrently — these were previously awaited one
  // by one, stacking ~7 Supabase roundtrips of network latency onto every
  // navigation to `/`. Nothing below depends on anything else in this block.
  const [factoryScope, listed, workflowSettings, aging, unreadAlerts] = await Promise.all([
    resolveFactoryScope(role, getCurrentUserId() ?? ""),
    // Fetch overall counts for metrics (respect brand/customer/season/date filters for pipeline accuracy)
    tryListCostingRequests({
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
    }),
    getWorkflowSettings().catch(() => defaultWorkflowSettings),
    // Aging analysis
    tryGetAgingData(),
    // Unread in-app change alerts (BOM changed / PBD pricing updated) per request.
    getUnreadInAppAlerts(role).catch(() => ({ alerts: [], totalUnread: 0, perRequest: {} as Record<string, number> }))
  ]);
  const { factoryProfileId } = factoryScope;
  const { data: allRows } = listed;
  // Same assignment gate for metrics: factory users only count their own requests.
  const metricsRows = scopeRowsForRole(allRows ?? [], role, factoryProfileId);
  const forReview = metricsRows.filter((row) => row.status === "for_pbd_review").length;
  const forCosting = metricsRows.filter((row) => row.status === "for_costing_review").length;
  const clarification = metricsRows.filter((row) => row.status === "needs_clarification").length;
  const approved = metricsRows.filter((row) => row.status === "approved").length;
  const active = metricsRows.filter((row) => !["approved", "rejected"].includes(row.status)).length;

  // Portfolio margin analytics (internal roles only — margin/pricing never
  // reaches the factory; the panel itself is never rendered for them).
  // Factory scorecard — quote accuracy vs master benchmark, cycle time per
  // stage, and clarification/rework rate. Internal analytics only.
  // Savings opportunity — over-benchmark material lines quantified per
  // garment / per MOQ order. Internal analytics only.
  // These three are independent of each other (margin only needs the settings
  // value already resolved above), so they run side by side as well.
  const [marginAnalytics, factoryScorecard, savingsOpportunity] =
    role === "factory"
      ? [null, null, null]
      : await Promise.all([
          getMarginAnalytics(workflowSettings.marginThresholdUsd),
          getFactoryScorecard(),
          getSavingsOpportunity()
        ]);
  // SLA is an accountability view, not a company-wide leaderboard. Each
  // operational role sees only items currently waiting for that role. Factory
  // users are additionally restricted to requests assigned to their profile.
  const scopedAgingRows = scopeSlaRowsForRole(aging.rows, role, factoryProfileId);
  const agingSummary = getAgingSummary(scopedAgingRows);
  const actionStatuses = getActionStatuses(role);
  const actionRows = metricsRows.filter((row: any) => actionStatuses.includes(row.status)).slice(0, 5);
  const queueLabel = getQueueLabel(role);

  const unreadCounts = unreadAlerts.perRequest;

  // The heavy analytics panels live behind tabs so the dashboard stays short.
  // Each panel keeps its full depth — the tab bar only decides what is visible.
  const analyticsTabs: AnalyticsTab[] = [];

  if (agingSummary && agingSummary.overdue > 0) {
    analyticsTabs.push({
      id: "sla",
      label: "SLA Breaches",
      badge: String(agingSummary.overdue),
      badgeTone: "red",
      content: (
        <section className="panel" style={{ marginTop: 12, borderColor: "#dc2626" }}>
          <div className="section-heading">
            <div>
              <p className="eyebrow">SLA breach report — who owns the request, when it started, and when it breached</p>
              <h2 style={{ color: "#dc2626" }}>SLA Breaches</h2>
            </div>
            <span className="status red">{agingSummary.overdue} breached</span>
          </div>
          <p className="eyebrow">This list contains only requests whose next action belongs to your role.</p>
          <SlaBreachTable rows={scopedAgingRows.filter((r) => r.is_overdue)} statusLabels={Object.fromEntries(scopedAgingRows.map((r) => [r.status, maskStatusForRole(r.status, role)]))} role={role} />
        </section>
      )
    });
  }

  if (role !== "factory" && marginAnalytics?.data) {
    analyticsTabs.push({
      id: "margin",
      label: "Margin Analytics",
      badge: String(marginAnalytics.data.belowThresholdCount),
      badgeTone: marginAnalytics.data.belowThresholdCount > 0 ? "amber" : "green",
      content: <MarginAnalyticsPanel analytics={marginAnalytics.data} thresholdUsd={workflowSettings.marginThresholdUsd} />
    });
  }

  if (role !== "factory" && factoryScorecard?.data) {
    analyticsTabs.push({
      id: "scorecard",
      label: "Factory Scorecard",
      badge: String(factoryScorecard.data.rows.length),
      badgeTone: "blue",
      content: <FactoryScorecardPanel scorecard={factoryScorecard.data} />
    });
  }

  if (role !== "factory" && savingsOpportunity?.data) {
    analyticsTabs.push({
      id: "savings",
      label: "Savings Opportunity",
      badge: String(savingsOpportunity.data.flaggedLines),
      badgeTone: "amber",
      content: <SavingsOpportunityPanel savings={savingsOpportunity.data} />
    });
  }

  if (canRunPbdAction(role)) {
    analyticsTabs.push({
      id: "anomalies",
      label: "Cost Anomalies",
      content: (
        <section className="panel" style={{ marginTop: 12 }}>
          <h2>Cost Anomaly Alerts</h2>
          <AnomalyAlertsPanel />
        </section>
      )
    });
  }

  return (
    <AppShell>
      <div className="dashboard-page">
      <div className="grid metrics">
        {role !== "superadmin" && canRunCostingAction(role) ? (
          <Link href="/requests?status=for_costing_review" className="metric metric-clickable">
            <span className="metric-label">For Costing Review</span>
            <strong>{forCosting}</strong>
            <small>Awaiting Costing Team validation</small>
          </Link>
        ) : null}
        {role !== "superadmin" && (["admin", "pbd", "manager"].includes(role)) ? (
          <Link href="/requests?status=for_pbd_review" className="metric metric-clickable">
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
        {role !== "superadmin" ? <Link href="/requests?status=needs_clarification" className="metric metric-clickable">
          <span className="metric-label">Needs Clarification</span>
          <strong>{clarification}</strong>
          <small>Returned to factory</small>
        </Link> : null}
        {role !== "factory" ? <Link href="/requests?status=approved" className="metric metric-clickable">
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

      {role === "superadmin" ? <section className="panel"><div className="empty-state compact-empty"><strong>Administration workspace</strong><p>Operational queues are hidden for Super Admin. Use All Requests, Reporting, Audit Logs, and User Management to monitor the system.</p></div></section> : <section className="panel action-queue-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Role-based queue</p>
            <h2>My action queue</h2>
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
      </section>}

      {/* BOM and PBD pricing alerts are internal Madison88 review data.
          Factory users receive their clarification action through the
          assigned queue/request banner instead of this internal feed. */}
      {role !== "factory" ? <ChangeAlertsPanel /> : null}

      {role !== "superadmin" ? <>
      {agingSummary && agingSummary.total > 0 ? (
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
      ) : null}

      {analyticsTabs.length > 1 ? (
        <AnalyticsTabs tabs={analyticsTabs} />
      ) : analyticsTabs.length === 1 ? (
        analyticsTabs[0].content
      ) : null}

      <div style={{ height: 16 }} />

      <section className="process-strip">
        <div className="process-step done">
          <strong>1. Pull from NextGen</strong>
          <span>Style, product, BOM</span>
        </div>
        <div className="process-step">
          <strong>2. Factory CBD</strong>
          <span>Cost, MOQ, lead time</span>
        </div>
        {role === "factory" ? <div className="process-step">
          <strong>3. Under Review</strong>
          <span>Madison88 internal review</span>
        </div> : <>
          <div className="process-step">
            <strong>3. MD Technical Review</strong>
            <span>Construction and product check</span>
          </div>
          <div className="process-step">
            <strong>4. Costing Validation</strong>
            <span>Warnings and checklist</span>
          </div>
          <div className="process-step">
            <strong>5. PBD Approval</strong>
            <span>Approve, reject, or request clarification</span>
          </div>
          <div className="process-step">
            <strong>6. Customer Review</strong>
            <span>Submit, negotiate, and close</span>
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
            <span className="status green">Live Data</span>
            <Link className="button secondary btn-sm" href="/requests">
              Open All Requests <IconArrowRight size={14} />
            </Link>
          </div>
        </div>
        <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>
          The full request list — filters, search, bulk actions, and exports — lives on the{" "}
          <Link href="/requests">All Requests</Link> page, so this dashboard stays focused on your queue and analytics.
        </p>
      </section>
      </> : null}
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
  return ["for_costing_review", "for_pbd_review", "needs_clarification"];
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
