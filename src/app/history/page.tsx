import { AppShell } from "@/components/app-shell";
import { HistoryTable } from "@/components/history-table";
import { countHistoricalCostings, tryListHistoricalCostings } from "@/lib/costing/history";
import Link from "next/link";
import { canAccessHistoricalCostData, getCurrentRole } from "@/lib/auth/roles";
import { redirect } from "next/navigation";

/** Rows rendered per page. The RegisterTable is heavy, so keep pages modest. */
const HISTORY_PAGE_SIZE = 500;

export default async function HistoryPage({
  searchParams
}: {
  searchParams?: { q?: string; factory?: string; brand?: string; customer?: string; season?: string; page?: string };
}) {
  // The register is a historical surface, so its guard is the rule that owns
  // those (internal minus Viewer) — the same one /api/export/history.csv reads.
  // Gating on the broader internal rule here let Viewer read the page and be
  // offered its Export CSV link while the export itself answered 403.
  if (!canAccessHistoricalCostData(getCurrentRole())) redirect("/");
  const query = searchParams?.q ?? "";
  const factory = searchParams?.factory ?? "";
  const brand = searchParams?.brand ?? "";
  const customer = searchParams?.customer ?? "";
  const season = searchParams?.season ?? "";
  const page = Math.max(1, parseInt(searchParams?.page ?? "1", 10) || 1);
  const offset = (page - 1) * HISTORY_PAGE_SIZE;
  const filters = { query, factory, brand, customer, season };
  const exportHref = `/api/export/history.csv?${new URLSearchParams(filters).toString()}`;
  const pageHref = (target: number) =>
    `/history?${new URLSearchParams({ ...filters, page: String(target) }).toString()}`;

  const { data, error } = await tryListHistoricalCostings({ ...filters, maxRows: HISTORY_PAGE_SIZE, offset });
  // The register used to show the newest 500 rows of a much larger pool with no
  // indication that it was a prefix. Read the real total so the page can say
  // which slice is on screen — and page through the rest.
  const total = await countHistoricalCostings(filters).catch(() => null);
  const totalPages = total === null ? null : Math.max(1, Math.ceil(total / HISTORY_PAGE_SIZE));
  const showing = data?.length ?? 0;
  const firstRow = showing === 0 ? 0 : offset + 1;
  const lastRow = offset + showing;

  return (
    <AppShell>
      <div className="topbar">
        <div>
          <p className="eyebrow">Historical Costing</p>
          <h1>Approved Cost Library</h1>
        </div>
      </div>

      <section className="panel">
        {error ? (
          <p className="notice">
            Historical data is temporarily unavailable. No sample records are being shown; check the Supabase connection and retry.
          </p>
        ) : null}
        <form className="toolbar">
          <input
            className="input"
            name="q"
            defaultValue={query}
            placeholder="Search style, factory, currency, or keyword"
          />
          <input className="input" name="factory" defaultValue={factory} placeholder="Factory" />
          <input className="input" name="brand" defaultValue={brand} placeholder="Brand" />
          <input className="input" name="customer" defaultValue={customer} placeholder="Customer" />
          <input className="input" name="season" defaultValue={season} placeholder="Season" />
          <button className="button secondary" type="submit">
            Search
          </button>
          <Link className="button secondary" href={exportHref}>
            Export CSV
          </Link>
        </form>
        <p className="muted small">
          {showing === 0
            ? `No entries on page ${page}${total === null ? "." : ` \u2014 the register holds ${total.toLocaleString()} approved costing${total === 1 ? "" : "s"}.`}`
            : total === null
              ? `Showing ${showing} approved costing${showing === 1 ? "" : "s"}.`
              : `Showing ${firstRow}\u2013${lastRow} of ${total.toLocaleString()} approved costing${total === 1 ? "" : "s"}.`}
          {showing > 0 && totalPages && totalPages > 1 ? ` Page ${page} of ${totalPages}.` : ""}
        </p>
        <HistoryTable rows={data} />
        {totalPages && totalPages > 1 ? (
          <div className="toolbar">
            {page > 1 ? (
              <Link className="button secondary btn-sm" href={pageHref(page - 1)}>
                Previous
              </Link>
            ) : null}
            {page < totalPages ? (
              <Link className="button secondary btn-sm" href={pageHref(page + 1)}>
                Next
              </Link>
            ) : null}
          </div>
        ) : null}
      </section>
    </AppShell>
  );
}
