import { AppShell } from "@/components/app-shell";
import { tryGetCbdDiff } from "@/lib/costing/cbd-diff";
import Link from "next/link";
import { IconArrowLeft, IconArrowRight } from "@/components/ui/icons";
import { getCurrentRole, getCurrentUserId } from "@/lib/auth/roles";
import { resolveFactoryProfileId } from "@/lib/admin/assignments";
import { tryGetCostingRequest } from "@/lib/costing/requests";
import { changeValuesMatch, readCbdFieldValue, tryListChangeRequests } from "@/lib/costing/change-requests";
import { redirect } from "next/navigation";
import { FieldChangeRequest } from "@/components/field-change-request";
import { DismissChangeRequest } from "@/components/dismiss-change-request";
import { ValidationFindingsPanel } from "@/components/validation-findings-panel";

const stepBySection = { "Header Info": 0, Yarn: 1, "Fabric & Trim": 2, "Knitting & Operations": 3, "Packaging & Overhead": 4, Notes: 5 } as const;

function formatDelta(delta: number | null): string {
  if (delta === null) return "";
  const sign = delta > 0 ? "+" : "";
  return `${sign}${delta.toFixed(1)}%`;
}

function formatCurrency(value: number, currency: string): string {
  return `${currency} ${value.toFixed(2)}`;
}

export default async function CbdDiffPage({ params }: { params: { id: string } }) {
  const role = getCurrentRole();
  if (role === "viewer") redirect("/");
  const request = await tryGetCostingRequest(params.id);
  if (role === "factory") {
    const profileId = await resolveFactoryProfileId(getCurrentUserId()).catch(() => null);
    if (!profileId || request.data?.assigned_factory_user_id !== profileId) redirect("/factory");
  }
  const { result, error } = await tryGetCbdDiff(params.id);
  // Structured change requests: what each reviewer asked for, what the
  // latest CBD actually carries, and what is still open (remaining work).
  const { data: changeRequests } = await tryListChangeRequests(params.id);
  const latestRevision = result && result.revisions.length > 0 ? result.revisions[result.revisions.length - 1] : null;
  const changeStatuses = (changeRequests ?? []).map((row) => {
    const actual = latestRevision
      ? readCbdFieldValue(latestRevision.payload, latestRevision.materialLines, row.field_key)
      : null;
    const satisfied = row.status !== "open" || changeValuesMatch(actual, row.requested_value);
    return { row, actual: actual ?? "—", satisfied };
  });
  const remainingCount = changeStatuses.filter((item) => item.row.status === "open" && !item.satisfied).length;
  // Changes and validation findings are reviewed together: a reviewer looking
  // at what the factory changed must see the open errors/warnings on the same
  // screen instead of bouncing back to the request detail.
  const validation = (request.data?.validation_results ?? []) as Array<{
    id: string;
    severity: string;
    rule_code: string;
    message: string;
    field_path: string | null;
  }>;

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
          <section className="panel" style={{ marginTop: 12 }}>
            <p className="eyebrow">How to use this comparison</p>
            <h2>Review every changed input before the next decision</h2>
            <p>Each row shows the prior CBD input beside the latest submitted value. Added, removed, and changed items are identified separately. Use the CBD section link to confirm the source input; cost impact shows whether the revision changed FOB or landed cost.</p>
          </section>

          <ValidationFindingsPanel
            requestId={params.id}
            issues={validation}
            canOpenCbd={role === "factory"}
          />

          {changeStatuses.length > 0 ? (
            <section className="panel" style={{ marginTop: 12 }}>
              <div className="section-heading"><div>
                <p className="eyebrow">Requested vs actual · {remainingCount} remaining</p>
                <h2>Requested changes</h2>
              </div></div>
              <p className="eyebrow">Each row links the reviewer&apos;s requested target to what the latest CBD actually carries. Open rows the factory has not matched yet are remaining work.</p>
              <table className="table compact diff-table" style={{ marginTop: 8 }}>
                <thead>
                  <tr>
                    <th>Section / Field</th>
                    <th>Requested target</th>
                    <th>Actual (latest CBD)</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {changeStatuses.map(({ row, actual, satisfied }) => (
                    <tr key={row.id} className={satisfied ? "" : "diff-changed"}>
                      <td>
                        <span className="status blue">{row.cbd_section || "CBD"}</span>
                        <br />
                        <span className="diff-field">{row.field_label || row.field_key}</span>
                        <br />
                        <span className="eyebrow">{row.requested_by_role ?? "reviewer"}{row.priority && row.priority !== "normal" ? ` · ${row.priority}` : ""}{row.due_date ? ` · due ${row.due_date}` : ""}</span>
                        <br />
                        <span className="eyebrow">{row.reason}</span>
                      </td>
                      <td className="diff-new"><s>{row.current_value || "—"}</s> → <strong>{row.requested_value}</strong></td>
                      <td className={satisfied ? "" : "diff-old"}>{actual}</td>
                      <td>
                        {row.status === "addressed" ? (
                          <span className="status green">Addressed</span>
                        ) : row.status === "dismissed" ? (
                          <span className="status neutral">Dismissed</span>
                        ) : satisfied ? (
                          <span className="status green">Matched — will clear on submit</span>
                        ) : (
                          <span className="status amber">Open — remaining</span>
                        )}
                        {row.status === "open" && !satisfied && role !== "factory" ? (
                          <>
                            <br />
                            <DismissChangeRequest requestId={params.id} changeId={row.id} />
                          </>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : null}

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
            const clarification = result.clarificationRequests[index];

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
                <p className="eyebrow">Purpose: confirms exactly what the factory changed in this submission before MD, Costing, or PBD continues the workflow.</p>

                <section className="notice" style={{ marginTop: 12 }}>
                  <p className="eyebrow">Requested change</p>
                  {clarification ? <>
                    <strong>{clarification.actorRole?.toUpperCase() ?? "Reviewer"} requested clarification</strong>
                    <span className="eyebrow"> · {new Date(clarification.requestedAt).toLocaleString()}</span>
                    <p style={{ marginBottom: 0 }}>{clarification.comment?.trim() || "No written clarification note was recorded. Review the changed fields below."}</p>
                  </> : <p style={{ marginBottom: 0 }}>No specific clarification was recorded for this resubmission. The comparison below still shows every submitted CBD change.</p>}
                </section>

                {/* Cost Impact Summary — money totals stay internal; the
                    factory sees structure (fields/values it submitted) but
                    never aggregated cost impacts. */}
                {costImpact && role !== "factory" ? (
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
                        <th>CBD Section</th>
                        <th>Field</th>
                        <th>Previous Value</th>
                        <th>New Value</th>
                        <th>Change / Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {diff
                        .filter((d) => d.changed)
                        .map((d, i) => (
                          <tr key={i} className="diff-changed">
                            <td><span className="status blue">{d.section}</span></td>
                            <td className="diff-field">{d.field}</td>
                            <td className="diff-old">{d.oldValue}</td>
                            <td className="diff-new">{d.newValue}</td>
                            <td>
                              <strong className={d.changeType === "removed" ? "text-red" : d.changeType === "added" ? "text-green" : "text-amber"}>{d.changeType}</strong>
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
                              ) : null}
                              <br /><Link className="table-action" href={`/factory/${params.id}?step=${stepBySection[d.section]}&revision=${index}&change=${encodeURIComponent(d.fieldKey)}`}>Open section</Link>
                              {index === result.diffs.length - 1 ? <FieldChangeRequest requestId={params.id} role={role} status={request.data?.status ?? "draft"} section={d.section} field={d.field} fieldKey={d.fieldKey} currentValue={d.newValue} /> : null}
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
                        <th>CBD Section</th>
                        <th>Field</th>
                        <th>Previous Value</th>
                        <th>New Value</th>
                        <th>Change</th>
                      </tr>
                    </thead>
                    <tbody>
                      {diff.map((d, i) => (
                        <tr key={i} className={d.changed ? "diff-changed" : ""}>
                          <td>{d.section}</td>
                          <td className="diff-field">{d.field}</td>
                          <td className={d.changed ? "diff-old" : ""}>{d.oldValue}</td>
                          <td className={d.changed ? "diff-new" : ""}>{d.newValue}</td>
                          <td>
                            {d.changed ? <strong>{d.changeType}</strong> : "unchanged"}{" "}
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
