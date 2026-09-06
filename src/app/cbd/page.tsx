import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { StatusPill } from "@/components/status-pill";
import { canAccessInternalCostData, getCurrentRole } from "@/lib/auth/roles";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getStatusesForRoles } from "@/lib/costing/requests";
import { maskStatusForRole } from "@/lib/workflow/status";
import { redirect } from "next/navigation";
import { IconSearch } from "@/components/ui/icons";

export const dynamic = "force-dynamic";

// CBD Review — browse every submitted factory cost breakdown from one page.
// Internal only: Factory users get their own CBD queue via Factory View and
// never see this cross-factory comparison surface.
export default async function CbdReviewPage({
  searchParams
}: {
  searchParams?: { q?: string };
}) {
  const role = getCurrentRole();
  if (!canAccessInternalCostData(role)) redirect("/");

  const q = (searchParams?.q ?? "").trim().toLowerCase();
  const supabase = createSupabaseServiceClient();

  // Visibility: never leak CBDs of requests the caller cannot see in the UI.
  const visibleStatuses = getStatusesForRoles([role]);
  const { data: visibleRequests, error: visibleError } = await supabase
    .from("costing_requests")
    .select("id")
    .in("status", visibleStatuses);
  if (visibleError) {
    return <ErrorShell message={visibleError.message} />;
  }
  const visibleIds = (visibleRequests ?? []).map((request) => request.id);

  // Latest submitted CBD per request, with request + style context.
  const { data: cbds, error: cbdError } = await supabase
    .from("factory_cbds")
    .select(
      `id, status, submitted_at, costing_request_id,
       costing_requests!inner (request_number, factory_name, status, nextgen_products (style_number, name)),
       cbd_material_lines (id)`
    )
    .eq("status", "submitted")
    .in("costing_request_id", visibleIds.length ? visibleIds : ["00000000-0000-0000-0000-000000000000"])
    .order("submitted_at", { ascending: false })
    .limit(500);
  if (cbdError) {
    return <ErrorShell message={cbdError.message} />;
  }

  // Keep only the most recent submission per request (dedupe by request id).
  const latestByRequest = new Map<string, CbdRow>();
  for (const cbd of (cbds ?? []) as CbdRow[]) {
    const request = Array.isArray(cbd.costing_requests) ? cbd.costing_requests[0] : cbd.costing_requests;
    const product = Array.isArray(request?.nextgen_products) ? request.nextgen_products[0] : request?.nextgen_products;
    const requestId = cbd.costing_request_id;
    if (!requestId || latestByRequest.has(requestId)) continue;
    latestByRequest.set(requestId, {
      ...cbd,
      costing_request_id: requestId,
      request_number: request?.request_number ?? "",
      factory_name: request?.factory_name ?? "",
      request_status: request?.status ?? "",
      style_number: product?.style_number ?? "",
      product_name: product?.name ?? "",
      lineCount: Array.isArray(cbd.cbd_material_lines) ? cbd.cbd_material_lines.length : 0
    });
  }
  let rows = [...latestByRequest.values()];
  if (q) {
    rows = rows.filter((row) =>
      row.request_number?.toLowerCase().includes(q) ||
      row.style_number?.toLowerCase().includes(q) ||
      row.product_name?.toLowerCase().includes(q) ||
      row.factory_name?.toLowerCase().includes(q)
    );
  }
  rows.sort((a, b) => String(b.submitted_at).localeCompare(String(a.submitted_at)));

  return (
    <AppShell>
      <div className="dashboard-page">
        <div className="hero dashboard-hero">
          <div>
            <p className="eyebrow">Cost Breakdown Review · internal</p>
            <h1>CBD Review</h1>
            <p className="hero-copy">
              Every submitted factory cost breakdown, one per request — open a request for the full detail, validation, and decision.
            </p>
          </div>
          <div className="hero-actions">
            <Link className="button secondary" href="/requests">
              All Requests
            </Link>
          </div>
        </div>

        <section className="panel dashboard-request-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Submitted CBDs</p>
              <h2>Factory Cost Breakdowns</h2>
            </div>
            <div className="section-heading-right">
              <span className="status green">{rows.length} shown</span>
            </div>
          </div>
          <form className="toolbar filter-toolbar" action="/cbd" style={{ marginBottom: 12 }}>
            <div className="filter-search">
              <IconSearch size={16} className="search-icon" />
              <input
                className="input search-input"
                name="q"
                defaultValue={searchParams?.q ?? ""}
                placeholder="Search request number, style, product, or factory..."
              />
            </div>
            <div className="report-filter-actions">
              <button className="button" type="submit">Search</button>
              {q ? <Link className="button secondary" href="/cbd">Clear</Link> : null}
            </div>
          </form>
          {rows.length === 0 ? (
            <div className="empty-state">
              <strong>{q ? "No CBDs match that search." : "No submitted CBDs yet."}</strong>
              <p>{q ? "Try a different request number, style, or factory." : "CBDs appear here once a factory submits a cost breakdown."}</p>
            </div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>REQUEST</th>
                  <th>STYLE</th>
                  <th>FACTORY</th>
                  <th>REQUEST STATUS</th>
                  <th>SUBMITTED</th>
                  <th>MATERIAL LINES</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.costing_request_id}>
                    <td>
                      <Link className="link" href={`/requests/${row.costing_request_id}`}>
                        {row.request_number ?? row.costing_request_id.slice(0, 8)}
                      </Link>
                    </td>
                    <td>{row.style_number ?? "Pending style"}{row.product_name ? <small className="table-sub">{row.product_name}</small> : null}</td>
                    <td>{row.factory_name ?? "Unassigned"}</td>
                    <td><StatusPill status={maskStatusForRole(row.request_status ?? "", role)} /></td>
                    <td>{formatDate(row.submitted_at ?? "")}</td>
                    <td>{row.lineCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </AppShell>
  );
}

type CbdRow = {
  id: string;
  status: string | null;
  submitted_at: string | null;
  // Set on every row that reaches the table: rows with a null request id are
  // dropped during dedupe.
  costing_request_id: string;
  costing_requests?: Array<{
    request_number?: string | null;
    factory_name?: string | null;
    status?: string | null;
    nextgen_products?: Array<{ style_number?: string | null; name?: string | null }> | { style_number?: string | null; name?: string | null } | null;
  }> | null;
  cbd_material_lines?: Array<{ id: string }> | null;
  request_number?: string;
  factory_name?: string;
  request_status?: string;
  style_number?: string;
  product_name?: string;
  lineCount?: number;
};

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function ErrorShell({ message }: { message: string }) {
  return (
    <AppShell>
      <div className="dashboard-page">
        <section className="panel">
          <h2>CBD Review unavailable</h2>
          <p className="notice">Live data could not be loaded: {message}</p>
        </section>
      </div>
    </AppShell>
  );
}