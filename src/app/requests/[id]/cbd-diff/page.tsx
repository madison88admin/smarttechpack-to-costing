import { AppShell } from "@/components/app-shell";
import { tryGetCbdDiff } from "@/lib/costing/cbd-diff";
import Link from "next/link";
import { IconArrowLeft, IconArrowRight } from "@/components/ui/icons";

function formatDelta(delta: number | null): string {
  if (delta === null) return "";
  const sign = delta > 0 ? "+" : "";
  return `${sign}${delta.toFixed(1)}%`;
}

function formatCurrency(value: number, currency: string): string {
  return `${currency} ${value.toFixed(2)}`;
}

export default async function CbdDiffPage({ params }: { params: { id: string } }) {
  const { result, error } = await tryGetCbdDiff(params.id);

  return (
    <AppShell>
      <div className="topbar">
        <div>
          <p className="eyebrow">Purchasing / CBD Revision History</p>
          <h1>CBD Revision Diff</h1>
        </div>
        <Link className="button secondary" href={`/requests/${params.id}`}>
          <IconArrowLeft size={14} /> Back to Request
        </Link>
      </div>

      {error ? <p className="notice">Unable to load diff: {error}</p> : null}

      {result ? (
        <>
          <p className="eyebrow">
            Request: <strong>{result.requestNumber ?? params.id}</strong> — {result.revisions.length} revision(s)
          </p>

          {result.revisions.length < 2 ? (
            <div className="empty-state">
              <strong>Only one CBD revision exists</strong>
              <p>A diff view will be available once the factory submits a revised CBD (e.g., after clarification).</p>
            </div>
          ) : null}

          {result.diffs.map((diff, index) => {
            const prevRev = result.revisions[index];
            const currRev = result.revisions[index + 1];
            const changedCount = diff.filter((d) => d.changed).length;
            const costImpact = result.costImpacts[index];

            return (
              <section key={index} className="panel" style={{ marginTop: 16 }}>
                <h2>
                  Revision {index + 1} → {index + 2}
                </h2>
                <p className="eyebrow">
                  {new Date(prevRev.submittedAt).toLocaleString()} →{" "}
                  {new Date(currRev.submittedAt).toLocaleString()}
                  {" — "}
                  <strong className={changedCount > 0 ? "text-amber" : "text-green"}>
                    {changedCount} field(s) changed
                  </strong>
                </p>

                {/* Cost Impact Summary */}
                {costImpact ? (
                  <div
                    className="cost-impact-summary"
                    style={{
                      marginTop: 12,
                      padding: 12,
                      borderRadius: 8,
                      background: "var(--surface-2, #f8f9fa)",
                      border: "1px solid var(--border, #e0e0e0)"
                    }}
                  >
                    <h3 style={{ margin: "0 0 8px 0", fontSize: "0.95rem" }}>Cost Impact</h3>
                    <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
                      <div>
                        <span className="eyebrow">FOB</span>
                        <br />
                        <span style={{ fontSize: "0.85rem" }}>
                          {formatCurrency(costImpact.fobBefore, costImpact.currency)} →{" "}
                          <strong>{formatCurrency(costImpact.fobAfter, costImpact.currency)}</strong>
                        </span>
                        <span
                          className="delta-badge"
                          style={{
                            marginLeft: 8,
                            padding: "2px 8px",
                            borderRadius: 4,
                            fontSize: "0.8rem",
                            fontWeight: 600,
                            background:
                              costImpact.fobDelta > 0
                                ? "rgba(185, 28, 28, 0.1)"
                                : costImpact.fobDelta < 0
                                  ? "rgba(21, 128, 61, 0.1)"
                                  : "rgba(107, 114, 128, 0.1)",
                            color:
                              costImpact.fobDelta > 0
                                ? "#b91c1c"
                                : costImpact.fobDelta < 0
                                  ? "#15803d"
                                  : "#6b7280"
                          }}
                        >
                          {formatDelta(costImpact.fobDeltaPercent)}
                        </span>
                      </div>
                      <div>
                        <span className="eyebrow">Landed Cost</span>
                        <br />
                        <span style={{ fontSize: "0.85rem" }}>
                          {formatCurrency(costImpact.landedBefore, costImpact.currency)} →{" "}
                          <strong>{formatCurrency(costImpact.landedAfter, costImpact.currency)}</strong>
                        </span>
                        <span
                          className="delta-badge"
                          style={{
                            marginLeft: 8,
                            padding: "2px 8px",
                            borderRadius: 4,
                            fontSize: "0.8rem",
                            fontWeight: 600,
                            background:
                              costImpact.landedDelta > 0
                                ? "rgba(185, 28, 28, 0.1)"
                                : costImpact.landedDelta < 0
                                  ? "rgba(21, 128, 61, 0.1)"
                                  : "rgba(107, 114, 128, 0.1)",
                            color:
                              costImpact.landedDelta > 0
                                ? "#b91c1c"
                                : costImpact.landedDelta < 0
                                  ? "#15803d"
                                  : "#6b7280"
                          }}
                        >
                          {formatDelta(costImpact.landedDeltaPercent)}
                        </span>
                      </div>
                    </div>
                  </div>
                ) : null}

                {changedCount > 0 ? (
                  <table className="diff-table" style={{ marginTop: 12 }}>
                    <thead>
                      <tr>
                        <th>Field</th>
                        <th>Previous Value</th>
                        <th>New Value</th>
                        <th>Change</th>
                      </tr>
                    </thead>
                    <tbody>
                      {diff
                        .filter((d) => d.changed)
                        .map((d, i) => (
                          <tr key={i} className="diff-changed">
                            <td className="diff-field">{d.field}</td>
                            <td className="diff-old">{d.oldValue}</td>
                            <td className="diff-new">{d.newValue}</td>
                            <td>
                              {d.deltaPercent !== null ? (
                                <span
                                  style={{
                                    fontWeight: 600,
                                    color:
                                      d.deltaPercent > 0
                                        ? "#b91c1c"
                                        : d.deltaPercent < 0
                                          ? "#15803d"
                                          : "#6b7280"
                                  }}
                                >
                                  {formatDelta(d.deltaPercent)}
                                </span>
                              ) : (
                                <span style={{ color: "#6b7280" }}>—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="notice">No changes between these revisions.</p>
                )}

                <details style={{ marginTop: 12 }}>
                  <summary className="eyebrow" style={{ cursor: "pointer" }}>
                    Show all fields (including unchanged)
                  </summary>
                  <table className="diff-table" style={{ marginTop: 8 }}>
                    <thead>
                      <tr>
                        <th>Field</th>
                        <th>Previous Value</th>
                        <th>New Value</th>
                        <th>Change</th>
                      </tr>
                    </thead>
                    <tbody>
                      {diff.map((d, i) => (
                        <tr key={i} className={d.changed ? "diff-changed" : ""}>
                          <td className="diff-field">{d.field}</td>
                          <td className={d.changed ? "diff-old" : ""}>{d.oldValue}</td>
                          <td className={d.changed ? "diff-new" : ""}>{d.newValue}</td>
                          <td>
                            {d.changed && d.deltaPercent !== null ? (
                              <span
                                style={{
                                  fontWeight: 600,
                                  color:
                                    d.deltaPercent > 0
                                      ? "#b91c1c"
                                      : d.deltaPercent < 0
                                        ? "#15803d"
                                        : "#6b7280"
                                }}
                              >
                                {formatDelta(d.deltaPercent)}
                              </span>
                            ) : (
                              <span style={{ color: "#6b7280" }}>—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              </section>
            );
          })}
        </>
      ) : null}
    </AppShell>
  );
}
