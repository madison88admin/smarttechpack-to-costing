import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { listSystemErrorLogs } from "@/lib/admin/logs";
import { canAccessAdmin, getCurrentRole } from "@/lib/auth/roles";
import { IconSearch, IconDownload, IconArrowLeft, IconArrowRight } from "@/components/ui/icons";

const PAGE_SIZE = 25;

export default async function AdminLogsPage({
  searchParams
}: {
  searchParams?: { q?: string; severity?: string; page?: string };
}) {
  const role = getCurrentRole();

  if (!canAccessAdmin(role)) {
    return (
      <AppShell>
        <section className="panel">
          <div className="empty-state">
            <strong>Access Denied</strong>
            <p>Your role ({role}) does not have access to error logs.</p>
          </div>
        </section>
      </AppShell>
    );
  }

  const query = searchParams?.q ?? "";
  const severity = searchParams?.severity ?? "all";
  const page = Math.max(1, parseInt(searchParams?.page ?? "1", 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const { data: logs, total } = await listSystemErrorLogs({
    limit: PAGE_SIZE,
    offset,
    query,
    severity
  }).catch(() => ({ data: [], total: 0 }));

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const exportParams = new URLSearchParams({ q: query, severity });
  const exportHref = `/api/admin/logs.csv?${exportParams.toString()}`;

  function buildPageUrl(p: number) {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (severity !== "all") params.set("severity", severity);
    params.set("page", String(p));
    return `/admin/logs?${params.toString()}`;
  }

  return (
    <AppShell>
      <div className="hero">
        <div>
          <p className="eyebrow">Production Monitoring</p>
          <h1>Error Log Dashboard</h1>
          <p className="hero-copy">
            Monitor application errors, warnings, and system issues in real time.
          </p>
        </div>
        {logs.length > 0 ? (
          <div className="hero-actions">
            <Link className="button secondary" href={exportHref}>
              <IconDownload size={14} /> Export CSV
            </Link>
          </div>
        ) : null}
      </div>

      <form className="toolbar filter-toolbar" action="/admin/logs" method="get">
        <div className="filter-search">
          <IconSearch size={16} className="search-icon" />
          <input
            className="input search-input"
            name="q"
            defaultValue={query}
            placeholder="Search message or source..."
          />
        </div>
        <select className="input filter-select" name="severity" defaultValue={severity}>
          <option value="all">All severities</option>
          <option value="error">Error</option>
          <option value="warning">Warning</option>
          <option value="info">Info</option>
        </select>
        <button className="button" type="submit">
          Filter
        </button>
        {query || severity !== "all" ? (
          <Link className="button secondary" href="/admin/logs">
            Clear
          </Link>
        ) : null}
      </form>

      <section className="panel">
        {!logs.length ? (
          <div className="empty-state">
            <strong>No errors found</strong>
            <p>{query || severity !== "all" ? "Try adjusting your filters." : "The system_error_logs table is ready; errors will appear here once app-side logging records them."}</p>
          </div>
        ) : (
          <>
            <table className="table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Severity</th>
                  <th>Source</th>
                  <th>Message</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id}>
                    <td>{new Date(log.created_at).toLocaleString()}</td>
                    <td><span className={`status ${log.severity === "error" ? "red" : log.severity === "warning" ? "amber" : "blue"}`}>{log.severity}</span></td>
                    <td>{log.source}</td>
                    <td>{log.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="pagination">
              <span className="pagination-info">
                Showing {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total} logs
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
