import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { CopyShareLink } from "@/components/copy-share-link";
import {
  canRunCostingAction,
  canRunMdAction,
  canRunPbdAction,
  getCurrentRole
} from "@/lib/auth/roles";
import { buildSetShareUrl, getSavedComparisonSetByToken } from "@/lib/comparison-sets";
import { likeStylesFiltersToQuery } from "@/lib/like-styles-prefs";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// /comparison-sets/<token> — stable, read-only view of a saved Like Styles
// comparison set. Costing saves the set and shares the link; PBD (or any
// review role) opens it and sees the exact same snapshot, even if the
// historical library has changed since.

export default async function ComparisonSetPage({ params }: { params: { token: string } }) {
  const role = getCurrentRole();
  const allowed =
    role === "admin" ||
    canRunCostingAction(role) ||
    canRunPbdAction(role) ||
    canRunMdAction(role);
  if (!allowed) redirect("/");

  const token = (params.token ?? "").trim();
  let set = null;
  let loadError = "";
  if (/^[a-f0-9]{32}$/.test(token)) {
    try {
      set = await getSavedComparisonSetByToken(token);
    } catch (error) {
      loadError = error instanceof Error ? error.message : "Unable to load this comparison set";
    }
  } else {
    loadError = "Invalid share link.";
  }

  const results = set?.results ?? [];
  const benchmark = set?.benchmark as { averageConsumption?: number | null; averageKnittingTime?: number | null; sampleSize?: number } | null;
  const searchHref = `/like-styles?${likeStylesFiltersToQuery((set?.filters ?? {}) as never)}`;
  const shareUrl = set ? buildSetShareUrl(set.shareToken) : "";

  return (
    <AppShell>
      <div className="topbar">
        <div>
          <p className="eyebrow">Shared Comparison Set</p>
          <h1>{set ? set.name : "Comparison Set"}</h1>
        </div>
      </div>

      {loadError ? (
        <section className="panel">
          <p className="notice">{loadError}</p>
        </section>
      ) : !set ? (
        <section className="panel">
          <p className="notice">This comparison set does not exist or the link is invalid.</p>
        </section>
      ) : (
        <>
          <section className="panel">
            <div className="toolbar">
              <div>
                <p className="eyebrow">
                  Saved by {set.createdBy ?? set.createdByRole ?? "Costing"} ·{" "}
                  {formatDate(set.createdAt)}
                  {set.requestId ? <> · anchored to request</> : null}
                </p>
                {set.requestId ? (
                  <Link className="table-action" href={`/requests/${set.requestId}`}>
                    Open request
                  </Link>
                ) : null}
              </div>
              <CopyShareLink url={shareUrl} />
            </div>

            {hasFilters(set.filters) ? (
              <p className="eyebrow" style={{ marginTop: 8 }}>
                Filters: {describeFilters(set.filters)}
              </p>
            ) : null}

            <div className="metrics" style={{ margin: "12px 0" }}>
              <div className="metric">
                <span className="metric-label">Styles in set</span>
                <strong>{results.length}</strong>
              </div>
              <div className="metric">
                <span className="metric-label">Avg consumption</span>
                <strong>{benchmark?.averageConsumption != null ? benchmark.averageConsumption.toFixed(2) : "—"}</strong>
              </div>
              <div className="metric">
                <span className="metric-label">Avg knitting time</span>
                <strong>{benchmark?.averageKnittingTime != null ? benchmark.averageKnittingTime.toFixed(2) : "—"}</strong>
              </div>
            </div>

            <Link className="button secondary small-btn" href={searchHref}>
              Open in Like Styles search
            </Link>
          </section>

          <section className="panel">
            <h2>Comparison Results <span className="eyebrow" style={{ fontWeight: 400 }}>Snapshot from when it was saved</span></h2>
            {results.length ? (
              <ul className="list compact-list">
                {results.map((row, index) => (
                  <li key={String(row.id ?? index)}>
                    <strong>{String(row.style_number ?? "No style")}</strong>
                    <span className="activity-role">{Number(row.matchScore ?? 0)} match{row.scorePercent != null ? ` (${Number(row.scorePercent)}%)` : ""}</span>
                    {row.confidence ? (
                      <span className={`status ${row.confidence === "high" ? "green" : row.confidence === "medium" ? "amber" : "red"}`}>
                        {row.confidence === "high" ? "High" : row.confidence === "medium" ? "Medium" : "Low"} confidence
                      </span>
                    ) : null}
                    {Array.isArray(row.matchReasons) && row.matchReasons.length ? (
                      <span className="eyebrow"> — {row.matchReasons.join(", ")}</span>
                    ) : null}
                    <br />
                    {row.sampleSize != null ? (
                      <>
                        <span className="eyebrow">Based on {Number(row.sampleSize)} historical costing{Number(row.sampleSize) === 1 ? "" : "s"}</span>
                        <br />
                      </>
                    ) : null}
                    {String(row.factory_name ?? "Unassigned")} / {String(row.currency ?? "USD")}{" "}
                    {row.total_cost != null ? Number(row.total_cost).toFixed(2) : "Pending"}
                    {row.yarn_type || row.knit_type || row.machine_type ? (
                      <>
                        <br />
                        <span className="eyebrow">
                          {[row.yarn_type, row.knit_type, row.machine_type].filter(Boolean).join(" / ")}
                        </span>
                      </>
                    ) : null}
                    {row.average_consumption != null || row.knitting_time != null ? (
                      <>
                        <br />
                        <span className="eyebrow">
                          Cons. {row.average_consumption != null ? `${Number(row.average_consumption).toFixed(2)} kg` : "—"} · Knit{" "}
                          {row.knitting_time != null ? `${Number(row.knitting_time).toFixed(2)} min` : "—"}
                        </span>
                      </>
                    ) : null}
                    {row.costing_request_id ? (
                      <>
                        <br />
                        <Link className="table-action" href={`/requests/${row.costing_request_id}`}>
                          Open approved costing
                        </Link>
                      </>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="eyebrow">This set has no results.</p>
            )}
          </section>
        </>
      )}
    </AppShell>
  );
}

function hasFilters(filters: Record<string, unknown>) {
  return Object.entries(filters).some(([key, value]) => (key === "minScore" ? Number(value) !== 0 : Boolean(String(value).trim())));
}

function describeFilters(filters: Record<string, unknown>) {
  const labels: Record<string, string> = {
    yarnType: "Yarn",
    knitType: "Knit",
    machineType: "Machine",
    construction: "Construction",
    category: "Category",
    notes: "Notes"
  };
  return Object.entries(filters)
    .filter(([key, value]) => key !== "minScore" && String(value).trim())
    .map(([key, value]) => `${labels[key] ?? key}: ${value}`)
    .join(" · ");
}

function formatDate(iso: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
