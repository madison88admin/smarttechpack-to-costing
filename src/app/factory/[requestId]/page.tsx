import Link from "next/link";
import { Suspense } from "react";
import { AppShell } from "@/components/app-shell";
import { FactoryCbdForm } from "@/components/factory-cbd-form";
import { CbdImportUpload } from "@/components/cbd-import-upload";
import { ValidationFindingsPanel } from "@/components/validation-findings-panel";
import { RequestCommentsPanel } from "@/components/request-comments-panel";
import { MdReviewPanel } from "@/components/md-review-panel";
import { RequestActions } from "@/components/request-actions";
import {
  canRunCostingAction,
  canRunMdAction,
  canRunPbdAction,
  canSubmitFactoryCbd,
  getCurrentRole,
  getCurrentUserId
} from "@/lib/auth/roles";
import { resolveFactoryProfileId } from "@/lib/admin/assignments";
import { tryGetCostingRequest } from "@/lib/costing/requests";
import { tryGetCbdDiff } from "@/lib/costing/cbd-diff";
import { getEscalationStatus } from "@/lib/notifications/escalation";
import { listRequestComments } from "@/lib/costing/request-comments";
import { tryListChangeRequests } from "@/lib/costing/change-requests";
import type { CostingStatus } from "@/lib/workflow/status";
import { IconArrowRight, IconAlert, IconClock } from "@/components/ui/icons";

// Deep links from a requested change open the exact CBD wizard step.
const STEP_BY_SECTION: Record<string, number> = {
  "Header Info": 0,
  Yarn: 1,
  "Fabric & Trim": 2,
  "Knitting & Operations": 3,
  "Packaging & Overhead": 4,
  Notes: 5
};

type CbdStep = 0 | 1 | 2 | 3 | 4 | 5 | 6;

function getProduct(request: Awaited<ReturnType<typeof tryGetCostingRequest>>["data"]) {
  if (!request?.nextgen_products) return null;
  return Array.isArray(request.nextgen_products) ? request.nextgen_products[0] : request.nextgen_products;
}

function formatDate(dateString: string) {
  if (!dateString) return "";
  return new Date(dateString).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default async function FactoryRequestPage({ params, searchParams }: { params: { requestId: string }; searchParams?: { step?: string; revision?: string; change?: string } }) {
  const role = getCurrentRole();
  const { data, error } = await tryGetCostingRequest(params.requestId);
  const factoryProfileId = role === "factory"
    ? await resolveFactoryProfileId(getCurrentUserId()).catch(() => null)
    : null;
  const product = getProduct(data);
  const bomLines = product?.nextgen_bom_lines ?? [];
  const latestCbd = data?.factory_cbds?.[0] ?? null;
  const latestClarification = data?.approval_actions?.find((action) => action.action === "clarify");
  const status = (data?.status ?? "draft") as CostingStatus;
  const factoryAssigned = Boolean(factoryProfileId && data?.assigned_factory_user_id === factoryProfileId);
  const factoryCanAccess = role !== "factory" || factoryAssigned;
  const canEdit = canSubmitFactoryCbd(role) && (status === "sent_to_factory" || status === "needs_clarification" || status === "draft");
  const hasNoCbd = !latestCbd;
  const requestedStep = Math.max(0, Math.min(6, Number(searchParams?.step) || 0)) as CbdStep;
  const requestedRevision = Math.max(0, Number(searchParams?.revision) || 0);
  const requestedFieldKey = searchParams?.change ?? "";
  const shouldLoadRevisionChanges = Boolean(requestedFieldKey) || (data?.factory_cbds?.length ?? 0) > 1;
  const diff = shouldLoadRevisionChanges ? await tryGetCbdDiff(params.requestId) : { result: null, error: null };
  const revisionDiffIndex = requestedFieldKey
    ? requestedRevision
    : Math.max(0, (diff.result?.diffs.length ?? 1) - 1);
  const revisionChanges = diff.result?.diffs[revisionDiffIndex]?.filter((entry) => entry.changed) ?? [];
  const revisionChange = diff.result?.diffs[requestedRevision]?.find((entry) => entry.fieldKey === requestedFieldKey && entry.changed) ?? null;
  const validation = data?.validation_results ?? [];
  const escalationStatus = data?.id ? await getEscalationStatus(data.id).catch(() => null) : null;
  const requestComments = data?.id ? await listRequestComments(data.id, role).catch(() => []) : [];
  const canOpenCbd = status === "sent_to_factory" || status === "needs_clarification" || status === "draft";
  // Open structured change requests: what the reviewer asked for, linked to
  // the exact wizard section. Passed into the form as requested-target
  // highlights so each input shows "Requested: old → new".
  const changeRequestRows = data?.id ? (await tryListChangeRequests(data.id)).data ?? [] : [];
  const openChangeRequests = changeRequestRows.filter((row) => row.status === "open");
  // The review the viewer can take from here, so checking the CBD and acting on
  // it are the same screen. Reuses the request page's own components rather
  // than a second copy of the lanes' rules: each gates itself on the status.
  const isInternal = role !== "factory";
  const latestMdReview =
    (data?.approval_actions ?? [])
      .filter((item) => item.action === "md_review")
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0] ?? null;
  const showMdReview = isInternal && canRunMdAction(role);
  const showLaneActions = isInternal && (canRunCostingAction(role) || canRunPbdAction(role));
  const requestedEntries = openChangeRequests.map((row) => ({
    field: row.field_label || row.field_key,
    fieldKey: row.field_key,
    section: row.cbd_section,
    oldValue: row.current_value || "—",
    newValue: row.requested_value || "—",
    requested: true as const
  }));
  const revisionChangesWithRequests = [...requestedEntries, ...revisionChanges];

  const prefill = {
    customer: (data as any)?.customer_name ?? undefined,
    season: (data as any)?.season ?? undefined,
    styleNumber: product?.style_number ?? undefined,
    styleName: product?.name ?? undefined,
  };

  return (
    <AppShell>
      <div className="topbar">
        <div>
          <p className="eyebrow">{data?.request_number ?? params.requestId}</p>
          <h1>{product?.style_number ?? "Factory CBD"}</h1>
          <p className="eyebrow" style={{ marginTop: 4, maxWidth: "640px" }}>
            This is the factory workspace for request #{data?.request_number ?? params.requestId}.
            Submit cost breakdowns, review validation warnings, communicate with the buying team via comments,
            and track SLA status for this request.
          </p>
        </div>
        <Link className="button secondary" href={`/requests/${params.requestId}`}>View Request</Link>
      </div>

      {error ? (
        <section className="panel">
          <p className="notice">Unable to load live request: {error}</p>
        </section>
      ) : !factoryCanAccess ? (
        <section className="panel">
          <h2>Request not assigned to you</h2>
          <p className="notice">This factory request is restricted to its assigned factory user. Ask an admin or PBD user to assign it before opening the CBD workspace.</p>
          <Link className="button secondary" href="/factory">Back to Factory Queue</Link>
        </section>
      ) : (
        <>
          {escalationStatus?.isEscalated ? (
            <section className="panel escalation-banner">
              <span className="status red"><IconAlert size={16} /> SLA Breach — Escalated</span>
              <p>This request has been escalated to management due to an SLA breach. Last escalation: {formatDate(escalationStatus.lastEscalationAt ?? "")}</p>
            </section>
          ) : escalationStatus?.isReminded ? (
            <section className="panel reminder-banner">
              <span className="status amber"><IconClock size={16} /> SLA Reminder</span>
              <p>Approaching SLA threshold. Last reminder: {formatDate(escalationStatus.lastReminderAt ?? "")}</p>
            </section>
          ) : null}

          {latestClarification ? (
            <section className="panel clarification-panel">
              <h2>Clarification Request</h2>
              <p>{latestClarification.comment ?? "PBD requested clarification."}</p>
            </section>
          ) : null}

          {openChangeRequests.length > 0 ? (
            <section className="panel clarification-panel">
              <div className="section-heading"><div>
                <p className="eyebrow">Reviewer-requested changes · {openChangeRequests.length} open</p>
                <h2>What the reviewer asked to change</h2>
              </div></div>
              <p className="eyebrow">Open each linked section, set the exact requested value, then resubmit. Items clear automatically once the new CBD carries the requested value.</p>
              <ul className="list compact-list">
                {openChangeRequests.map((row) => {
                  const step = STEP_BY_SECTION[row.cbd_section];
                  return (
                    <li key={row.id}>
                      <strong>{row.cbd_section || "CBD"} · {row.field_label || row.field_key}</strong>
                      <span className="activity-role">{row.requested_by_role ?? "reviewer"}</span>
                      {row.priority && row.priority !== "normal" ? <span className="activity-role">{row.priority}</span> : null}
                      <br />
                      <span className="eyebrow"><s>{row.current_value || "—"}</s> → <strong>{row.requested_value}</strong></span>
                      <br />
                      <span>{row.reason}</span>
                      {row.due_date ? <><br /><span className="eyebrow">Due: {row.due_date}</span></> : null}
                      {step !== undefined && canOpenCbd ? (
                        <>
                          <br />
                          <Link className="table-action" href={`/factory/${params.requestId}?step=${step}`}>Open {row.cbd_section || "section"}</Link>
                        </>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          {validation.length > 0 ? (
            <ValidationFindingsPanel requestId={params.requestId} issues={validation} canOpenCbd={canOpenCbd} />
          ) : latestCbd ? (
            <section className="panel validation-findings-panel">
              <div className="section-heading"><div><p className="eyebrow">CBD review guide</p><h2>Validation Results</h2></div></div>
              <p className="eyebrow">No validation issues found. The current CBD passed all automated checks.</p>
            </section>
          ) : null}

          {(data?.factory_cbds?.length ?? 0) > 1 ? <section className="panel" style={{ marginBottom: 16 }}>
            <p className="eyebrow">Revision review</p>
            <h2>Compare this CBD with the prior submission</h2>
            <p className="eyebrow">Use this before resubmitting to confirm material, machine, gauge, labor, packaging, and cost changes are intentional.</p>
            <Link className="button secondary btn-sm" href={`/requests/${params.requestId}/cbd-diff`}>Open side-by-side revision comparison <IconArrowRight size={14} /></Link>
          </section> : null}

          {!canSubmitFactoryCbd(role) ? (
            <>
              <section className="panel">
                <div className="toolbar">
                  <span className={`status ${status === "approved" ? "green" : status === "rejected" ? "red" : "blue"}`}>{status.toUpperCase()}</span>
                  <span className="eyebrow">Read-only view</span>
                </div>
              </section>
              {showMdReview ? (
                <MdReviewPanel requestId={params.requestId} status={status} canEdit lastReview={latestMdReview} />
              ) : null}
              {showLaneActions ? (
                <section className="panel">
                  <div className="section-heading">
                    <div>
                      <p className="eyebrow">From this CBD</p>
                      <h2>Review decision</h2>
                    </div>
                  </div>
                  <p className="eyebrow">
                    Validate what the Factory submitted, then send it back for correction or move it forward — without leaving this screen.
                  </p>
                  <RequestActions
                    requestId={params.requestId}
                    status={status}
                    canAct={canRunPbdAction(role)}
                    canCostingAct={canRunCostingAction(role)}
                    pricingReady={data?.pbd_pricing_status === "entered"}
                    openChanges={openChangeRequests.map((row) => ({ field: row.field_label || row.field_key, requestedValue: row.requested_value }))}
                    hideLinks
                  />
                </section>
              ) : null}
              <FactoryCbdForm requestId={params.requestId} bomLines={bomLines} existingCbd={latestCbd} readOnly prefill={prefill} baselineRef={data?.baseline_ref} initialStep={requestedStep} revisionChange={revisionChange} revisionChanges={revisionChangesWithRequests} />
            </>
          ) : !canEdit ? (
            <>
              <section className="panel">
                <div className="toolbar">
                  <span className={`status ${status === "approved" ? "green" : status === "rejected" ? "red" : "blue"}`}>{status.toUpperCase()}</span>
                  <span className="eyebrow">No longer editable</span>
                </div>
              </section>
              <FactoryCbdForm requestId={params.requestId} bomLines={bomLines} existingCbd={latestCbd} readOnly prefill={prefill} baselineRef={data?.baseline_ref} initialStep={requestedStep} revisionChange={revisionChange} revisionChanges={revisionChangesWithRequests} />
            </>
          ) : (
            <>
              {hasNoCbd && <CbdImportUpload requestId={params.requestId} />}
              <FactoryCbdForm requestId={params.requestId} bomLines={bomLines} existingCbd={latestCbd} prefill={prefill} baselineRef={data?.baseline_ref} initialStep={requestedStep} revisionChange={revisionChange} revisionChanges={revisionChangesWithRequests} />
            </>
          )}

          <Suspense fallback={null}>
            <RequestCommentsPanel requestId={params.requestId} initialComments={requestComments} role={role} />
          </Suspense>
        </>
      )}
    </AppShell>
  );
}
