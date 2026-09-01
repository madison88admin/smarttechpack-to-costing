import { AppShell } from "@/components/app-shell";
import { HistoryTable } from "@/components/history-table";
import { tryListHistoricalCostings } from "@/lib/costing/history";
import Link from "next/link";
import { canAccessInternalCostData, getCurrentRole } from "@/lib/auth/roles";
import { redirect } from "next/navigation";

export default async function HistoryPage({
  searchParams
}: {
  searchParams?: { q?: string; factory?: string; brand?: string; customer?: string; season?: string };
}) {
  if (!canAccessInternalCostData(getCurrentRole())) redirect("/");
  const query = searchParams?.q ?? "";
  const factory = searchParams?.factory ?? "";
  const brand = searchParams?.brand ?? "";
  const customer = searchParams?.customer ?? "";
  const season = searchParams?.season ?? "";
  const exportHref = `/api/export/history.csv?${new URLSearchParams({ q: query, factory, brand, customer, season }).toString()}`;
  const { data, error } = await tryListHistoricalCostings({ query, factory, brand, customer, season });

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
        <HistoryTable rows={data} />
      </section>
    </AppShell>
  );
}
