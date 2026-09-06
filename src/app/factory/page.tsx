import { AppShell } from "@/components/app-shell";
import { FactoryQueue, type FactoryQueueRow } from "@/components/factory-queue";
import { getCurrentRole, getCurrentUserId } from "@/lib/auth/roles";
import { tryListCostingRequests } from "@/lib/costing/requests";
import { tryGetAgingData } from "@/lib/costing/aging";
import { resolveFactoryProfileId } from "@/lib/admin/assignments";

export default async function FactoryPage() {
  const role = getCurrentRole();
  const [{ data, error }, aging, factoryProfileId] = await Promise.all([
    tryListCostingRequests({ roles: [role], limit: 100, offset: 0, sortBy: "updated_at", sortDir: "desc" }),
    tryGetAgingData(),
    resolveFactoryProfileId(getCurrentUserId()).catch(() => null)
  ]);

  const rows = (data ?? []) as unknown as FactoryQueueRow[];
  const agingById = new Map(aging.rows.map((row) => [row.id, row]));
  // A draft is an internal preparation state.  It may only enter a factory
  // queue once an admin/PBD has assigned it to this factory user.  The list
  // query intentionally includes drafts for the factory role so assigned
  // drafts can be opened; filter unassigned drafts out at the presentation
  // boundary to prevent cross-factory/internal work from leaking into the UI.
  const visibleRows = role === "factory"
    ? rows.filter((row) => Boolean(factoryProfileId && row.assigned_factory_user_id === factoryProfileId))
    : rows;
  const assigned = factoryProfileId ? visibleRows.filter((row) => row.assigned_factory_user_id === factoryProfileId) : [];
  const submissionStatuses = new Set(["sent_to_factory", "needs_clarification", "draft"]);
  const reviewStatuses = new Set(["for_costing_review", "for_pbd_review"]);
  const submissionQueue = visibleRows.filter((row) => submissionStatuses.has(row.status));
  const reviewQueue = visibleRows.filter((row) => reviewStatuses.has(row.status));
  const overdue = visibleRows.filter((row) => agingById.get(row.id)?.is_overdue);

  return (
    <AppShell>
      <div className="hero">
        <div>
          <p className="eyebrow">Factory Workspace</p>
          <h1>CBD Queue</h1>
          <p className="hero-copy">See what needs a factory costing response, what is under review, and which requests are overdue.</p>
        </div>
        <div className="hero-actions"><span className="status blue">{visibleRows.length} visible request{visibleRows.length === 1 ? "" : "s"}</span></div>
      </div>

      {error ? <section className="panel"><p className="notice">Unable to load the live factory queue: {error}</p></section> : null}
      {!error ? (
        <>
          <div className="grid metrics factory-queue-metrics">
            <div className="metric"><span className="metric-label">Assigned to me</span><strong>{assigned.length}</strong><small>Requests assigned to your profile</small></div>
            <div className="metric"><span className="metric-label">For CBD submission</span><strong>{submissionQueue.length}</strong><small>New or returned for correction</small></div>
            <div className="metric"><span className="metric-label">Under review</span><strong>{reviewQueue.length}</strong><small>Submitted to Costing / PBD</small></div>
            <div className="metric"><span className="metric-label">Overdue</span><strong className={overdue.length ? "text-red" : "text-green"}>{overdue.length}</strong><small>SLA needs attention</small></div>
          </div>
          <FactoryQueue title="Assigned to me" description="Your assigned requests appear here first." rows={assigned} agingById={agingById} emptyMessage="No requests are assigned to your user yet." />
          <FactoryQueue title="For CBD submission" description="Open a request to complete or revise the Factory CBD." rows={submissionQueue} agingById={agingById} emptyMessage="No CBD submissions are waiting." />
          <FactoryQueue title="Submitted / under review" description="Read-only visibility after you submit the CBD." rows={reviewQueue} agingById={agingById} emptyMessage="No submitted CBD is currently under review." />
        </>
      ) : null}
    </AppShell>
  );
}
