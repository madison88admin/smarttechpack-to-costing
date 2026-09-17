import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { listAuditEvents } from "@/lib/admin/logs";
import { canAccessAdmin, getCurrentRole } from "@/lib/auth/roles";
import { IconSearch, IconDownload, IconArrowLeft, IconArrowRight } from "@/components/ui/icons";

const PAGE_SIZE = 25;

export default async function AdminAuditPage({
  searchParams
}: {
  searchParams?: { q?: string; eventType?: string; page?: string };
}) {
  const role = getCurrentRole();

  if (!canAccessAdmin(role)) {
    return (
      <AppShell>
        <section className="panel">
          <div className="empty-state">
            <strong>Access Denied</strong>
            <p>Your role ({role}) does not have access to audit logs.</p>
          </div>
        </section>
      </AppShell>
    );
  }

  const query = searchParams?.q ?? "";
  const eventType = searchParams?.eventType ?? "all";
  const page = Math.max(1, parseInt(searchParams?.page ?? "1", 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const { data: events, total } = await listAuditEvents({
    limit: PAGE_SIZE,
    offset,
    query,
    eventType
  }).catch(() => ({ data: [], total: 0 }));

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const exportParams = new URLSearchParams({ q: query, eventType });
  const exportHref = `/api/admin/audit.csv?${exportParams.toString()}`;

  function buildPageUrl(p: number) {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (eventType !== "all") params.set("eventType", eventType);
    params.set("page", String(p));
    return `/admin/audit?${params.toString()}`;
  }

  return (
    <AppShell>
      <div className="hero">
        <div>
          <p className="eyebrow">Audit Trail</p>
          <h1>Workflow Event Viewer</h1>
          <p className="hero-copy">
            Track factory submits, customer status updates, approvals, and reminders.
          </p>
        </div>
        {events.length > 0 ? (
          <div className="hero-actions">
            <Link className="button secondary" href={exportHref}>
              <IconDownload size={14} /> Export CSV
            </Link>
          </div>
        ) : null}
      </div>

      <form className="toolbar filter-toolbar" action="/admin/audit" method="get">
        <div className="filter-search">
          <IconSearch size={16} className="search-icon" />
          <input
            className="input search-input"
            name="q"
            defaultValue={query}
            placeholder="Search event type or actor..."
          />
        </div>
        <select className="input filter-select" name="eventType" defaultValue={eventType}>
          <option value="all">All event types</option>
          <option value="factory_submit">Factory Submit</option>
          <option value="costing_complete">Costing Complete</option>
          <option value="approve">PBD Approve</option>
          <option value="reject">PBD Reject</option>
          <option value="send_to_factory">Send to Factory</option>
          <option value="clarify">Clarification Requested</option>
          <option value="md_review">MD Review</option>
          <option value="customer_status_changed">Customer Status Change</option>
          <option value="escalation">Escalation</option>
          <option value="reminder">Reminder</option>
          <option value="nextgen_backfill">NextGen Backfill</option>
        </select>
        <button className="button" type="submit">
          Filter
        </button>
        {query || eventType !== "all" ? (
          <Link className="button secondary" href="/admin/audit">
            Clear
          </Link>
        ) : null}
      </form>

      <section className="panel">
        {!events.length ? (
          <div className="empty-state">
            <strong>No workflow events found</strong>
            <p>{query || eventType !== "all" ? "Try adjusting your filters." : "Factory submits, customer status updates, approvals, and reminders will appear here."}</p>
          </div>
        ) : (
          <>
            <table className="table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Event</th>
                  <th>Actor</th>
                  <th>What changed</th>
                  <th>Notification</th>
                  <th>Request</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.id}>
                    <td>{new Date(event.created_at).toLocaleString()}</td>
                    <td><strong>{formatLabel(event.event_type)}</strong></td>
                    <td><strong>{event.actor_role?.toUpperCase() ?? "SYSTEM"}</strong><br /><span className="eyebrow">{event.actor_user_id ?? "Automated process"}</span></td>
                    <td><AuditDetails payload={event.payload} /></td>
                    <td>{event.notification_status}</td>
                    <td>
                      {event.costing_request_id ? (
                        <Link href={`/requests/${event.costing_request_id}`}>Open request</Link>
                      ) : event.event_type === "nextgen_backfill" ? (
                        <span className="eyebrow">{formatBackfillCounts(event.payload)}</span>
                      ) : (
                        "N/A"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="pagination">
              <span className="pagination-info">
                Showing {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total} events
              </span>
              <div className="pagination-controls">
                {page > 1 ? (
                  <Link className="button secondary small-btn" href={buildPageUrl(page - 1)}>
                    <IconArrowLeft size={14} /> Prev
                  </Link>
                ) : null}
                <span className="pagination-page">Page {page} of {totalPages}</span>
                {page < totalPages ? (
                  <Link className="button secondary small-btn" href={buildPageUrl(page + 1)}>
                    Next <IconArrowRight size={14} />
                  </Link>
                ) : null}
              </div>
            </div>
          </>
        )}
      </section>
    </AppShell>
  );
}

function AuditDetails({ payload }: { payload: Record<string, unknown> | null }) {
  if (!payload || Object.keys(payload).length === 0) return <span className="eyebrow">No field details</span>;
  const changes = Array.isArray(payload.changes) ? payload.changes : null;
  const entries = changes ?? Object.entries(payload).filter(([key]) => !["fromStatus", "toStatus"].includes(key));
  return (
    <details className="audit-details">
      <summary>{changes ? `${changes.length} field change${changes.length === 1 ? "" : "s"}` : "View details"}</summary>
      <div className="audit-details-body">
        {changes ? changes.map((change, index) => <div key={index}>{typeof change === "string" ? change : JSON.stringify(change)}</div>) : entries.map(([key, value]) => <div key={key}><strong>{key}:</strong> {typeof value === "object" ? JSON.stringify(value) : String(value)}</div>)}
        {payload.fromStatus || payload.toStatus ? <div><strong>Status:</strong> {String(payload.fromStatus ?? "—")} → {String(payload.toStatus ?? "—")}</div> : null}
      </div>
    </details>
  );
}

function formatLabel(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatBackfillCounts(payload: Record<string, unknown> | null) {
  if (!payload || typeof payload.updated !== "number") return "N/A";
  const parts = [`updated: ${payload.updated}`, `scanned: ${payload.scanned ?? "?"}`];
  if (typeof payload.skipped === "number") parts.push(`skipped: ${payload.skipped}`);
  return parts.join(" · ");
}
