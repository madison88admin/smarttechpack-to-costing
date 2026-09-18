import { AppShell } from "@/components/app-shell";
import Link from "next/link";
import { BenchmarkPanel } from "@/components/benchmark-panel";
import { CostingNotesPanel } from "@/components/costing-notes-panel";
import { CostingSummary } from "@/components/costing-summary";
import { CostSheetReadinessToggle } from "@/components/cost-sheet-readiness-toggle";
import { CustomerStatusPanel } from "@/components/customer-status-panel";
import { RequestActions } from "@/components/request-actions";
import { LikeStylesPanel } from "@/components/like-styles-panel";
import { SmartReviewPanel } from "@/components/smart-review-panel";
import { StatusPill } from "@/components/status-pill";
import { ValidationChecklist } from "@/components/validation-checklist";
import { CompliancePanel } from "@/components/compliance-panel";
import { SampleTrackingPanel } from "@/components/sample-tracking-panel";
import { VendorComparisonPanel } from "@/components/vendor-comparison-panel";
import { Tabs } from "@/components/ui/tabs";
import { IconArrowLeft, IconAlert, IconClock, IconArrowRight, IconDownload } from "@/components/ui/icons";
import { ShouldCostPanel } from "@/components/should-cost-panel";
import { WhatIfAnalyzer } from "@/components/what-if-analyzer";
import { computeGrossMarginInfo, generateSmartReviewSync } from "@/lib/ai/smart-review";
import { isHistoricalNextGenStatus, nextGenMetaFromRaw } from "@/lib/nextgen/product-meta";
import { defaultWorkflowSettings, getWorkflowSettings } from "@/lib/admin/settings";
import { canDownloadRequestExports, canRunPbdAction, canRunCostingAction, canRunMdAction, getCurrentRole, getCurrentUserId } from "@/lib/auth/roles";
import { resolveFactoryProfileId } from "@/lib/admin/assignments";
import { getChecklistResults } from "@/lib/costing/checklist";
import { tryListChangeRequests } from "@/lib/costing/change-requests";
import { getNextGenPricingForRequest } from "@/lib/costing/nextgen-pricing";
import { isOutlierAcknowledgementValid, tryGetLastOutlierAcknowledgement, tryGetOutlierReview } from "@/lib/costing/outlier-review";
import { tryGetCostingRequest } from "@/lib/costing/requests";
import { tryListSavedComparisonSetsForRequest } from "@/lib/comparison-sets";
import {
  findLikeStyles,
  tryGetBenchmarkByAttributes,
  tryGetBenchmarkSummary,
  tryListCostingNotes
} from "@/lib/costing/history";
import { calculateCostingTotals } from "@/lib/costing/totals";
import { factoryHiddenStatuses, maskStatusForRole, statusLabels, type CostingStatus } from "@/lib/workflow/status";
import { redirect } from "next/navigation";
import { getEscalationStatus } from "@/lib/notifications/escalation";
import { tryGetCbdDiff } from "@/lib/costing/cbd-diff";
import { tryGetFactoryPhotos } from "@/lib/costing/photos";
import { FactoryPhotosGallery } from "@/components/factory-photos-gallery";
import { ProductImage } from "@/components/product-image";
import { RequestProgressStepper } from "@/components/request-progress-stepper";
import { MarkRequestAlertsRead } from "@/components/mark-request-alerts-read";
import { PbdPricingPanel } from "@/components/pbd-pricing-panel";
import { MdReviewPanel } from "@/components/md-review-panel";
import { MasterBenchmarkPanel } from "@/components/master-benchmark-panel";
import { flagCbdAgainstMasterBenchmark } from "@/lib/costing/master-benchmark";
import { RequestCommentsPanel } from "@/components/request-comments-panel";
import { ValidationFindingsPanel } from "@/components/validation-findings-panel";
import { listRequestComments } from "@/lib/costing/request-comments";

function getProduct(request: Awaited<ReturnType<typeof tryGetCostingRequest>>["data"]) {
  if (!request?.nextgen_products) return null;
  return Array.isArray(request.nextgen_products) ? request.nextgen_products[0] : request.nextgen_products;
}

function isCostingStatus(status: string): status is CostingStatus {
  return status in statusLabels;
}

export default async function RequestDetailPage({ params }: { params: { id: string } }) {
  const role = getCurrentRole();
  const { data, error } = await tryGetCostingRequest(params.id);
  if (!data) {
    return (
      <AppShell>
        <section className="panel empty-state">
          <IconAlert size={28} />
          <h1>Request unavailable</h1>
          <p>{error ?? "The request does not exist or could not be loaded."}</p>
          <Link className="button secondary" href="/">Return to Dashboard</Link>
        </section>
      </AppShell>
    );
  }
  const product = getProduct(data);
  const latestCbd = data?.factory_cbds?.[0];
  const totals = latestCbd
    ? calculateCostingTotals({
        rawPayload: latestCbd.raw_payload,
        lines: latestCbd.cbd_material_lines
      })
    : null;

  // Extract structured CBD data from raw_payload (new Excel-matching format)
  const cbdRaw = latestCbd?.raw_payload as Record<string, unknown> | null;
  const cbdData = cbdRaw ? {
    yarnTotal: typeof cbdRaw.yarnTotal === "number" ? cbdRaw.yarnTotal : undefined,
    fabricTotal: typeof cbdRaw.fabricTotal === "number" ? cbdRaw.fabricTotal : undefined,
    trimTotal: typeof cbdRaw.trimTotal === "number" ? cbdRaw.trimTotal : undefined,
    knittingTotal: typeof cbdRaw.knittingTotal === "number" ? cbdRaw.knittingTotal : undefined,
    operationsTotal: typeof cbdRaw.operationsTotal === "number" ? cbdRaw.operationsTotal : undefined,
    standardPackagingCost: typeof cbdRaw.standardPackagingCost === "number" ? cbdRaw.standardPackagingCost : undefined,
    specialPackagingCost: typeof cbdRaw.specialPackagingCost === "number" ? cbdRaw.specialPackagingCost : undefined,
    overheadCost: typeof cbdRaw.overheadCost === "number" ? cbdRaw.overheadCost : undefined,
    profitCost: typeof cbdRaw.profitCost === "number" ? cbdRaw.profitCost : undefined,
    factoryCostTotal: typeof cbdRaw.factoryCostTotal === "number" ? cbdRaw.factoryCostTotal : undefined,
    packagingTotal: typeof cbdRaw.packagingTotal === "number" ? cbdRaw.packagingTotal : undefined,
  } : null;

  const yarnType = readText(latestCbd?.raw_payload, "yarnType");
  const knitType = readText(latestCbd?.raw_payload, "knitType");
  const machineType = readText(latestCbd?.raw_payload, "machineType");
  const currentKnittingTime = readNumber(latestCbd?.raw_payload, "knittingTime");
  const currentConsumption = computeAverageConsumption(latestCbd?.cbd_material_lines ?? []);

  const benchmarkParams = {
    styleNumber: product?.style_number,
    factoryName: data?.factory_name,
    currentTotal: totals?.grandTotal,
    currency: totals?.currency,
    excludeRequestId: data?.id
  };
  const attributeParams = {
    yarnType,
    knitType,
    machineType,
    excludeRequestId: data?.id
  };
  const likeStylesParams = {
    yarnType,
    knitType,
    machineType,
    construction: readText(latestCbd?.raw_payload, "construction"),
    productCategory: readText(latestCbd?.raw_payload, "productCategory"),
    factoryName: data?.factory_name,
    brand: data?.brand,
    customer: data?.customer,
    season: data?.season,
    excludeRequestId: data?.id
  };  const [
    benchmark,
    attributeBenchmark,
    costingNotes,
    likeStyles,
    checklist,
    escalationStatus,
    cbdDiff,
    workflowSettings,
    factoryPhotos,
    lastAcknowledgement,
    outlierReview,
    savedComparisonSets,
    masterBenchmark,
    requestComments,
    nextGenPricing
  ] = await Promise.all([
    tryGetBenchmarkSummary(benchmarkParams),
    tryGetBenchmarkByAttributes(attributeParams),
    tryListCostingNotes(attributeParams),
    findLikeStyles(likeStylesParams),
    data ? getChecklistResults(data.id) : Promise.resolve([]),
    data ? getEscalationStatus(data.id).catch(() => null) : Promise.resolve(null),
    (data?.factory_cbds?.length ?? 0) > 1 ? tryGetCbdDiff(data!.id) : Promise.resolve({ result: null, error: null }),
    getWorkflowSettings().catch(() => defaultWorkflowSettings),
    data ? tryGetFactoryPhotos(data.id) : Promise.resolve({ data: null, error: null }),
    data ? tryGetLastOutlierAcknowledgement(data.id) : Promise.resolve({ data: null, error: null }),
    data ? tryGetOutlierReview(data.id) : Promise.resolve({ data: null, error: null }),
    data ? tryListSavedComparisonSetsForRequest(data.id) : Promise.resolve({ data: [], error: null }),
    // Master material benchmark — semi-automation for MD review. Internal
    // roles only; the factory never sees the master list references.
    role !== "factory" && latestCbd
      ? flagCbdAgainstMasterBenchmark(
          (latestCbd.cbd_material_lines ?? []).map((line) => ({ material_name: line.material_name, unit_cost: line.unit_cost })),
          extractOperationsLines(latestCbd.raw_payload),
          extractKnittingLines(latestCbd.raw_payload)
        )
      : Promise.resolve({ flags: [], benchmark: [], error: null }),
    data ? listRequestComments(data.id, role).catch(() => []) : Promise.resolve([]),
    // Selling / landed-cost figures ported from NextGen. Resolved through the
    // single pricing owner, which lazily pulls the ERP product-grid row when
    // the stored snapshot has none — PBD never types what NextGen knows.
    data
      ? getNextGenPricingForRequest(data.id)
      : Promise.resolve({ sellingPrice: null, landedCost: null, purchasePrice: null, margin: null, currency: null })
  ]);

  const status = isCostingStatus(data.status) ? data.status : "draft";
  // Factory users only see requests assigned to them — otherwise one factory
  // could open another factory's URL and read its CBD totals, vendor quotes,
  // benchmarks, and decision history. Unassigned requests bounce to the queue.
  if (role === "factory") {
    const factoryProfileId = await resolveFactoryProfileId(getCurrentUserId()).catch(() => null);
    if (!factoryProfileId || data.assigned_factory_user_id !== factoryProfileId) {
      redirect("/factory");
    }
  }
  // Factory must not see requests that are in Madison88 internal review (MD, Costing, or PBD).
  // or that are internally approved — those are invisible to the factory.
  if (role === "factory" && factoryHiddenStatuses.includes(status)) {
    redirect("/");
  }
  // Factory never sees internal review stage names — mask to "Under Review".
  const displayedStatus = maskStatusForRole(status, role);
  const title = product?.name ?? product?.style_number ?? "Untitled request";
  const requestNumber = data.request_number ?? params.id.slice(0, 8);
  const bomLines = product?.nextgen_bom_lines ?? [];
  const validation = data?.validation_results ?? [];
  const actions = data?.approval_actions ?? [];
  const latestMdReview = actions
    .filter((item) => item.action === "md_review")
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0] ?? null;
  const hasCostingReview = actions.some((item) => item.action === "costing_complete");
  const latestClarification = actions
    .filter((item) => {
      if (["clarify", "costing_clarify"].includes(item.action)) return true;
      if (item.action !== "md_review") return false;
      return (item.metadata as { decision?: string } | null)?.decision === "needs_clarification";
    })
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0] ?? null;
  // The customer-facing number is the manual PBD price first, then the
  // NextGen-ported selling price, and only then the derived markup estimate.
  // Merge the actual price in so the low-margin flag and Approval banner
  // reflect the pricing under discussion (never the factory-derived estimate
  // when a real price exists).
  const pbdPricing = (data?.pbd_pricing ?? {}) as Record<string, unknown>;
  const pbdWholesale = typeof pbdPricing.wholesalePrice === "number" ? pbdPricing.wholesalePrice : null;
  const nextgenWholesale = nextGenPricing.sellingPrice;
  const effectiveWholesale = pbdWholesale ?? nextgenWholesale;
  const pricingTotals = totals && effectiveWholesale !== null ? { ...totals, wholesalePrice: effectiveWholesale } : totals;

  const smartReview = outlierReview.data?.review ?? generateSmartReviewSync(
    {
      status,
      totals: pricingTotals,
      benchmark: benchmark.data,
      attributeBenchmark: attributeBenchmark.data,
      currentConsumption,
      currentKnittingTime,
      validation,
      materialLines: latestCbd?.cbd_material_lines ?? [],
      baselineRef: data?.baseline_ref ?? null
    },
    {
      warningVariancePercent: workflowSettings.warningVariancePercent,
      reviewVariancePercent: workflowSettings.reviewVariancePercent,
      marginThresholdUsd: workflowSettings.marginThresholdUsd
    }
  );
  // Structured margin info for the Approval tab banner (PBD sees the exact
  // margin vs the guideline during the manual Costing ↔ PBD discussion).
  const marginInfo = computeGrossMarginInfo(pricingTotals, workflowSettings.marginThresholdUsd);
  const approvalBlockedByOutliers =
    smartReview.riskLevel === "high" &&
    !isOutlierAcknowledgementValid(lastAcknowledgement.data, latestCbd?.submitted_at ?? null);
  const latestDiff = cbdDiff.result;
  const latestDiffImpact = latestDiff?.costImpacts[latestDiff.costImpacts.length - 1];
  const latestDiffChangedCount = latestDiff?.diffs[latestDiff.diffs.length - 1]?.filter((d) => d.changed).length ?? 0;
  // Open structured change requests surface as a warning (never a block) at
  // the PBD decision point, so nothing gets approved sight-unseen.
  const { data: changeRequestRows } = await tryListChangeRequests(data.id);
  const openChangeRequests = (changeRequestRows ?? [])
    .filter((row) => row.status === "open")
    .map((row) => ({ field: row.field_label || row.field_key, requestedValue: row.requested_value }));

  // NextGen metadata captured at request creation (from the product raw_payload).
  const productMeta = product ? nextGenMetaFromRaw(product.raw_payload) : null;
  const storedBomVersion = product?.bom_version ?? null;
  const storedBomVersionComment = product?.bom_version_comment ?? null;

  return (
    <AppShell>
      <MarkRequestAlertsRead requestId={params.id} />
      <div className="detail-header">
        <div className="detail-header-info">
          <Link href="/" className="back-link"><IconArrowLeft size={14} /> Dashboard</Link>
          <p className="eyebrow">{requestNumber}</p>
          <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
            {product?.nextgen_entity_id ? (
              <ProductImage
                entityId={product.nextgen_entity_id}
                alt={title}
                width={80}
                height={80}
              />
            ) : null}
            <div>
              <h1>{title}</h1>
              <div className="detail-meta">
                <StatusPill status={displayedStatus} />
                <span className="meta-item">Factory: {data.factory_name ?? "Unassigned"}</span>
                <span className="meta-item">Priority: {data?.priority ?? "normal"}</span>
                {data?.season ? <span className="meta-item">Season: {data.season}</span> : null}
                {data?.brand ? <span className="meta-item">Brand: {data.brand}</span> : null}
                {data?.customer ? <span className="meta-item">Customer: {data.customer}</span> : null}
                {data?.product_category ? <span className="meta-item">Product Type: {data.product_category}</span> : null}
                {data?.buyer_style_number ? <span className="meta-item">Buyer Style #: {data.buyer_style_number}</span> : null}
                {data?.po_number ? <span className="meta-item">PO #: {data.po_number}</span> : null}
                {data?.mpo_number ? <span className="meta-item">MPO #: {data.mpo_number}</span> : null}
                {data?.notes ? <span className="meta-item">Notes: {data.notes}</span> : null}
              </div>
            </div>
          </div>
        </div>
        <div className="detail-header-actions">
          <RequestActions
            requestId={params.id}
            status={status}
            canAct={canRunPbdAction(role)}
            canCostingAct={canRunCostingAction(role)}
            pricingReady={data?.pbd_pricing_status === "entered"}
            approvalBlockedByOutliers={approvalBlockedByOutliers}
            openChanges={openChangeRequests}
          />
        </div>
      </div>

      <RequestProgressStepper
        status={status}
        customerStatus={data?.customer_status ?? "not_submitted"}
        hasProduct={Boolean(product)}
        hasCbd={Boolean(latestCbd)}
        hasMdReview={Boolean(latestMdReview && (latestMdReview.metadata as { decision?: string } | null)?.decision === "pass")}
        hasCostingReview={hasCostingReview}
        role={role}
      />

      {status === "needs_clarification" && latestClarification ? (
        <section className="panel clarification-banner" aria-live="polite">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Action required</p>
              <h2>Clarification requested</h2>
            </div>
            <span className="status amber">Needs clarification</span>
          </div>
          <p className="clarification-message">
            {latestClarification.comment?.trim() || "Please review the request and update the Factory CBD before resubmitting."}
          </p>
          <p className="eyebrow">
            Requested by {latestClarification.actor_role ?? "Review team"} · {formatDate(latestClarification.created_at)}
          </p>
          {role === "factory" ? <Link className="button" href={`/factory/${params.id}`}>Open Factory CBD</Link> : null}
        </section>
      ) : null}

      <div className="split">
        <section className="panel">
          {error ? (
            <p className="notice">Live request data is temporarily unavailable.</p>
          ) : null}

          {escalationStatus?.isEscalated ? (
            <div className="escalation-banner critical">
              <span className="escalation-icon"><IconAlert size={20} /></span>
              <div className="escalation-text">
                <strong>Escalated — SLA Breach</strong>
                This request has been escalated to management. Last escalation: {formatDate(escalationStatus.lastEscalationAt ?? "")}
              </div>
            </div>
          ) : escalationStatus?.isReminded ? (
            <div className="escalation-banner warning">
              <span className="escalation-icon"><IconClock size={20} /></span>
              <div className="escalation-text">
                <strong>SLA Reminder Sent</strong>
                Approaching SLA threshold. Last reminder: {formatDate(escalationStatus.lastReminderAt ?? "")}
              </div>
            </div>
          ) : null}

          {productMeta && (productMeta.composition || productMeta.smv || productMeta.gsdSmv || productMeta.allowedTime || productMeta.factoryTime || storedBomVersion || productMeta.status) ? (
            <div className="nextgen-meta" style={{ marginBottom: 24 }}>
              <div className="meta-heading">
                <strong>NextGen Product Data</strong>
                <span className="eyebrow">{product?.metadata_checked_at ? `Last refreshed ${timeAgo(product.metadata_checked_at)}` : "Captured at request creation · hourly refresh pending"}</span>
              </div>
              <div className="nextgen-meta-grid">
                {productMeta.status ? (
                  <div className="meta-item">
                    <span className="eyebrow">NextGen Status</span>
                    <strong className={isHistoricalNextGenStatus(productMeta.status) ? "status-historical" : undefined}>{productMeta.status}</strong>
                  </div>
                ) : null}
                {productMeta.composition ? (
                  <div className="meta-item">
                    <span className="eyebrow">Composition</span>
                    <strong>{productMeta.composition}</strong>
                  </div>
                ) : null}
                {productMeta.smv || productMeta.gsdSmv || productMeta.allowedTime || productMeta.factoryTime ? (
                  <div className="meta-item">
                    <span className="eyebrow">SMV / Labor (NextGen)</span>
                    <strong>
                      {[productMeta.smv ? `SMV ${productMeta.smv}` : null, productMeta.gsdSmv ? `GSD ${productMeta.gsdSmv}` : null, productMeta.allowedTime ? `Allowed ${productMeta.allowedTime}` : null, productMeta.factoryTime ? `Factory ${productMeta.factoryTime}` : null].filter(Boolean).join(" · ")}
                    </strong>
                  </div>
                ) : null}
                {storedBomVersion ? (
                  <div className="meta-item">
                    <span className="eyebrow">BOM Version</span>
                    <strong>
                      v{storedBomVersion}
                      {storedBomVersionComment ? ` — ${storedBomVersionComment}` : ""}
                    </strong>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {data?.baseline_ref ? (
            <div className="nextgen-meta baseline-ref" style={{ marginBottom: 24 }}>
              <div className="meta-heading">
                <strong>Copied Baseline</strong>
                <span className="eyebrow">
                  From approved costing {data.baseline_ref.styleNumber ?? ""}
                  {data.baseline_ref.sourceRequestId ? (
                    <>
                      {" · "}
                      <Link href={`/requests/${data.baseline_ref.sourceRequestId}`}>open source</Link>
                    </>
                  ) : null}
                </span>
              </div>
              <div className="nextgen-meta-grid">
                <div className="meta-item">
                  <span className="eyebrow">Approved Cost</span>
                  <strong>
                    {data.baseline_ref.totalCost != null
                      ? `${data.baseline_ref.currency ?? "USD"} ${data.baseline_ref.totalCost.toFixed(2)}`
                      : "—"}
                  </strong>
                </div>
                {data.baseline_ref.factoryName ? (
                  <div className="meta-item">
                    <span className="eyebrow">Factory</span>
                    <strong>{data.baseline_ref.factoryName}</strong>
                  </div>
                ) : null}
                {data.baseline_ref.yarnType ? (
                  <div className="meta-item">
                    <span className="eyebrow">Yarn</span>
                    <strong>{data.baseline_ref.yarnType}</strong>
                  </div>
                ) : null}
                {data.baseline_ref.knitType ? (
                  <div className="meta-item">
                    <span className="eyebrow">Knit</span>
                    <strong>{data.baseline_ref.knitType}</strong>
                  </div>
                ) : null}
                {data.baseline_ref.machineType ? (
                  <div className="meta-item">
                    <span className="eyebrow">Machine</span>
                    <strong>{data.baseline_ref.machineType}</strong>
                  </div>
                ) : null}
                {data.baseline_ref.construction ? (
                  <div className="meta-item">
                    <span className="eyebrow">Construction</span>
                    <strong>{data.baseline_ref.construction}</strong>
                  </div>
                ) : null}
                {data.baseline_ref.productCategory ? (
                  <div className="meta-item">
                    <span className="eyebrow">Category</span>
                    <strong>{data.baseline_ref.productCategory}</strong>
                  </div>
                ) : null}
                {data.baseline_ref.averageConsumption != null ? (
                  <div className="meta-item">
                    <span className="eyebrow">Avg Consumption</span>
                    <strong>{data.baseline_ref.averageConsumption.toFixed(2)} kg</strong>
                  </div>
                ) : null}
                {data.baseline_ref.knittingTime != null ? (
                  <div className="meta-item">
                    <span className="eyebrow">Knitting Time</span>
                    <strong>{data.baseline_ref.knittingTime.toFixed(2)} min</strong>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          <h2>NextGen BOM Lines</h2>
          {bomLines.length > 0 && status === "draft" && canRunPbdAction(role) ? (
            <div className="bom-ready-cta">
              <p className="eyebrow">BOM loaded with {bomLines.length} line(s). Ready to send to factory.</p>
            </div>
          ) : null}
          <div className="table-wrapper bom-table-wrapper">
            <table className="table bom-lines-table">
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Material</th>
                  <th>Consumption</th>
                  <th>UOM/Size</th>
                  <th>Supplier / Placement</th>
                  <th>Quote</th>
                  <th>Compliance / Colorway</th>
                </tr>
              </thead>
              <tbody>
                {bomLines.length
                  ? bomLines.map((line) => (
                      <tr key={line.id}>
                        <td>{line.category ?? "Uncategorized"}</td>
                        <td>{line.material_name ?? "Unnamed material"}</td>
                        <td>{line.consumption ?? "—"}</td>
                        <td>{line.uom ?? "—"}</td>
                        <td>{[line.supplier_name, line.placement].filter(Boolean).join(" · ") || line.nextgen_line_id || "—"}</td>
                        <td>{role === "factory" ? <span className="eyebrow">Internal reference</span> : line.quote_price != null ? `${line.quote_currency ?? "USD"} ${line.quote_price}` : "—"}</td>
                        <td>{[line.compliance_status, line.colorway].filter(Boolean).join(" · ") || "—"}</td>
                      </tr>
                    ))
                  : (
                      <tr>
                        <td colSpan={7}>
                          <div className="empty-state compact">
                            <strong>No cached NextGen BOM details</strong>
                            <span>Sync the product BOM before relying on supplier, quote, compliance, or colorway data.</span>
                          </div>
                        </td>
                      </tr>
                    )}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: 24 }}>
            <h2>Factory Photos</h2>
            <FactoryPhotosGallery photos={factoryPhotos.data ?? []} />
          </div>
        </section>

        <aside className="grid">
          <Tabs
            tabs={[
              {
                id: "overview",
                label: "Overview",
                count: checklist.filter((c) => !c.is_checked && c.is_required).length,
                content: (
                  <div className="grid">
                    {/* Smart Cost Review is an internal decision aid (risk flags, benchmarks,
                        PBD suggestions) — never rendered for the factory. */}
                    {role !== "factory" && (
                      <SmartReviewPanel
                        review={smartReview}
                        requestId={data?.id}
                        canAcknowledge={canRunCostingAction(role)}
                        lastAcknowledgement={lastAcknowledgement.data}
                        cbdSubmittedAt={latestCbd?.submitted_at ?? null}
                      />
                    )}
                    {status === "approved" ? (
                      <CostSheetReadinessToggle
                        requestId={params.id}
                        isReady={data?.cost_sheet_ready ?? false}
                        readyAt={data?.cost_sheet_ready_at ?? null}
                        readyBy={data?.cost_sheet_ready_by ?? null}
                        canToggle={canRunCostingAction(role)}
                      />
                    ) : null}
                    {role !== "factory" ? (
                      <ValidationChecklist requestId={params.id} items={checklist} canEdit={canRunCostingAction(role)} />
                    ) : null}
                    {role === "factory" ? (
                      <section className="panel">
                        <h2>Costing Summary</h2>
                        <p className="eyebrow">Factory cost shown — internal validation and landed-cost waterfall are hidden for factory accounts.</p>
                        <CostingSummary totals={totals} cbdData={cbdData} baselineRef={data?.baseline_ref ?? null} role={role} />
                      </section>
                    ) : (
                      <CostingSummary totals={totals} cbdData={cbdData} baselineRef={data?.baseline_ref ?? null} role={role} />
                    )}
                    <ValidationFindingsPanel requestId={params.id} issues={validation} canOpenCbd={status === "sent_to_factory" || status === "needs_clarification" || status === "draft"} />
                    <RequestCommentsPanel requestId={params.id} initialComments={requestComments} role={role} />
                  </div>
                )
              },
              {
                id: "factory-cbd",
                label: "Factory CBD",
                count: data?.factory_cbds?.length ?? 0,
                content: (
                  <div className="grid">
                    <MdReviewPanel requestId={params.id} status={status} canEdit={canRunMdAction(role)} lastReview={latestMdReview} />
                    {/* Master material benchmark — MD semi-automation. Internal only. */}
                    {role !== "factory" && (
                      <MasterBenchmarkPanel flags={masterBenchmark.flags} benchmark={masterBenchmark.benchmark} error={masterBenchmark.error} />
                    )}
                    <section className="panel">
                      <div className="section-heading">
                        <div>
                          <p className="eyebrow">Factory submission</p>
                          <h2>CBD Workspace</h2>
                        </div>
                        <Link className="button secondary btn-sm" href={`/factory/${params.id}`}>Open CBD Form <IconArrowRight size={14} /></Link>
                      </div>
                      <p className="eyebrow">Complete the structured Cost Breakdown Details form using the NextGen BOM as your starting point.</p>
                      <div className="customer-meta-grid">
                        <span><strong>BOM lines:</strong> {bomLines.length}</span>
                        <span><strong>CBD submissions:</strong> {data?.factory_cbds?.length ?? 0}</span>
                        <span><strong>Current status:</strong> {formatStatus(status)}</span>
                      </div>
                    </section>
                    <FactoryPhotosGallery photos={factoryPhotos.data ?? []} />
                  </div>
                )
              },
              {
                id: "customer-review",
                label: "Customer Review",
                content: (
                  <CustomerStatusPanel
                    requestId={params.id}
                    status={data?.customer_status ?? "not_submitted"}
                    notes={data?.customer_notes}
                    customerSubmittedAt={data?.customer_submitted_at}
                    customerDecisionAt={data?.customer_decision_at}
                    revisionDueAt={data?.customer_revision_due_at}
                    revisionNumber={data?.customer_revision_number ?? 0}
                    // External review actions only open after internal approval —
                    // mirrors the server gate in the customer-status route.
                    canEdit={canRunPbdAction(role) && status === "approved"}
                  />
                )
              },
              {
                id: "analysis",
                label: "Costing Review",
                content: (
                  <div className="grid">
                    {/* Comparable costs, rival quotes, benchmarks, and costing
                        notes are other-factories' money and internal pricing
                        talk — never rendered for the factory. */}
                    {role !== "factory" ? (
                      <LikeStylesPanel
                        rows={likeStyles}
                        requestId={params.id}
                        requestNumber={requestNumber}
                        attributes={likeStylesParams}
                        benchmark={attributeBenchmark.data}
                        savedSets={savedComparisonSets.data}
                        canRecordComparison={canRunCostingAction(role)}
                      />
                    ) : null}
                    {role !== "factory" ? (
                      <section className="panel">
                        <VendorComparisonPanel requestId={params.id} canEdit={canRunPbdAction(role)} />
                      </section>
                    ) : null}
                    {/* What-If Analyzer shows landed cost + markups — internal only. */}
                    {role !== "factory" && totals && status !== "draft" ? (
                      <section className="panel">
                        <WhatIfAnalyzer
                          baseline={{
                            materialTotal: totals.materialTotal,
                            laborCost: totals.laborCost,
                            overheadCost: totals.overheadCost,
                            packagingCost: totals.packagingCost,
                            testingCost: totals.testingCost,
                            profitMargin: totals.profitMarginPercent,
                            freightCost: totals.freightCost,
                            dutyRate: totals.dutyRatePercent,
                            insuranceCost: totals.insuranceCost,
                            customsClearanceCost: totals.customsClearanceCost,
                            inlandTransportCost: totals.inlandTransportCost,
                            wholesaleMarkup: totals.wholesaleMarkup,
                            retailMarkup: totals.retailMarkup,
                            moq: totals.moq,
                            currency: totals.currency
                          }}
                        />
                      </section>
                    ) : null}
                    {/* Should-Cost estimate includes internal landed-cost assumptions — internal only. */}
                    {role !== "factory" && totals ? (
                      <section className="panel">
                        <ShouldCostPanel
                          yarnType={yarnType}
                          knitType={knitType}
                          machineType={machineType}
                          construction={readText(latestCbd?.raw_payload, "construction")}
                          productCategory={readText(latestCbd?.raw_payload, "productCategory")}
                          factoryName={data?.factory_name ?? null}
                          actualQuoteTotal={totals.grandTotal}
                          currency={totals.currency}
                          canEdit={canRunCostingAction(role)}
                        />
                      </section>
                    ) : null}
                    {role !== "factory" ? (
                      <BenchmarkPanel
                        benchmark={benchmark.data}
                        attributeBenchmark={attributeBenchmark.data}
                        currentConsumption={currentConsumption}
                        currentKnittingTime={currentKnittingTime}
                        error={benchmark.error}
                        warningVariancePercent={workflowSettings.warningVariancePercent}
                        reviewVariancePercent={workflowSettings.reviewVariancePercent}
                      />
                    ) : null}
                    {role !== "factory" ? (
                      <CostingNotesPanel notes={costingNotes.data} error={costingNotes.error} />
                    ) : null}
                  </div>
                )
              },
              {
                id: "approval",
                label: "Approval",
                content: (
                  <div className="grid">
                    {/* Keep the PBD-owned selling-price review beside the final decision.
                        Factory users never receive this tab, so customer-facing pricing
                        remains internal. */}
                    {role !== "factory" && (
                      <PbdPricingPanel
                        requestId={params.id}
                        status={status}
                        pricing={data?.pbd_pricing as Record<string, unknown> | null | undefined}
                        pricingStatus={data?.pbd_pricing_status}
                        canEdit={canRunPbdAction(role)}
                        nextgenSellingPrice={nextGenPricing.sellingPrice}
                        nextgenLandedCost={nextGenPricing.landedCost}
                        nextgenMargin={nextGenPricing.margin}
                        nextgenPurchasePrice={nextGenPricing.purchasePrice}
                        nextgenCurrency={nextGenPricing.currency}
                      />
                    )}
                    {/* Low-margin soft flag, front and center for PBD's manual
                        discussion with Costing. Internal data — never factory. */}
                    {role !== "factory" && marginInfo.lowMargin && marginInfo.marginUsd !== null ? (
                      <section
                        className="panel"
                        style={{ borderColor: "#d97706", background: "rgba(217, 119, 6, 0.06)" }}
                      >
                        <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                          <IconAlert size={20} style={{ color: "#d97706", marginTop: 2, flexShrink: 0 }} />
                          <div>
                            <strong>Low gross margin — Costing ↔ PBD discussion required</strong>
                            <p style={{ margin: "4px 0 0" }}>
                              Profit per unit is{" "}
                              <strong>
                                {marginInfo.currency} {marginInfo.marginUsd.toFixed(2)}
                              </strong>{" "}
                              vs the {marginInfo.currency} {marginInfo.thresholdUsd.toFixed(2)}/unit guideline.
                              Soft flag only — it does not block approval, but confirm the margin with
                              Costing before finalizing.
                            </p>
                          </div>
                        </div>
                      </section>
                    ) : null}
                    <section className="panel">
                      <p className="eyebrow">Internal decision</p>
                      <h2>{status === "for_pbd_review" ? "Awaiting PBD internal approval" : formatStatus(status)}</h2>
                      <p className="eyebrow">Use the action bar above to approve, reject, or request clarification. Approval actions are recorded with the authenticated user and timestamp.</p>
                    </section>
                    <section className="panel">
                      <h2>Decision history</h2>
                      <ul className="list">
                        {actions.filter((item) => ["approve", "reject", "costing_complete", "md_review", "outlier_acknowledged"].includes(item.action)).map((item) => (
                          <li key={item.id}><strong>{formatAction(item.action)}</strong><br /><span className="eyebrow">{item.actor_role ?? "System"} · {formatDate(item.created_at)}</span>{item.comment ? <><br />{item.comment}</> : null}</li>
                        ))}
                        {!actions.some((item) => ["approve", "reject", "costing_complete", "md_review"].includes(item.action)) ? <li className="eyebrow">No approval decision recorded yet.</li> : null}
                      </ul>
                    </section>
                  </div>
                )
              },
              // Audit History exposes the full internal review trail — factory never sees it.
              ...(role === "factory"
                ? []
                : [
                    {
                id: "tracking",
                label: "Audit History",
                count: actions.length,
                content: (
                  <div className="grid">
                    <section className="panel">
                      <CompliancePanel requestId={params.id} canEdit={canRunCostingAction(role)} />
                    </section>
                    <section className="panel">
                      {/* Samples are PBD-owned (the samples route refuses every other
                          role), so the panel is editable for PBD — not Costing. */}
                      <SampleTrackingPanel requestId={params.id} canEdit={canRunPbdAction(role)} />
                    </section>
                    {(data?.factory_cbds?.length ?? 0) > 1 ? (
                      <div className="form-actions" style={{ flexDirection: "column", alignItems: "flex-start", gap: 8 }}>
                        <Link className="button secondary small-btn" href={`/requests/${params.id}/cbd-diff`}>
                          View CBD Revision Diff <IconArrowRight size={14} />
                        </Link>
                        {latestDiff && latestDiffChangedCount > 0 ? (
                          <div
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 12,
                              padding: "6px 12px",
                              borderRadius: 6,
                              background: "rgba(245, 158, 11, 0.08)",
                              border: "1px solid rgba(245, 158, 11, 0.2)",
                              fontSize: "0.85rem"
                            }}
                          >
                            <strong className="text-amber">{latestDiffChangedCount} field(s) changed</strong>
                            {latestDiffImpact ? (
                              <span style={{ color: "#6b7280" }}>
                                FOB: {latestDiffImpact.currency} {latestDiffImpact.fobBefore.toFixed(2)} →{" "}
                                <strong
                                  style={{
                                    color: latestDiffImpact.fobDelta > 0 ? "#b91c1c" : latestDiffImpact.fobDelta < 0 ? "#15803d" : "#6b7280"
                                  }}
                                >
                                  {latestDiffImpact.currency} {latestDiffImpact.fobAfter.toFixed(2)}
                                </strong>
                                <span
                                  style={{
                                    marginLeft: 6,
                                    fontWeight: 600,
                                    color: latestDiffImpact.fobDelta > 0 ? "#b91c1c" : latestDiffImpact.fobDelta < 0 ? "#15803d" : "#6b7280"
                                  }}
                                >
                                  ({latestDiffImpact.fobDelta > 0 ? "+" : ""}
                                  {latestDiffImpact.fobDeltaPercent.toFixed(1)}%)
                                </span>
                              </span>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    {(data?.factory_cbds?.length ?? 0) > 0 && canDownloadRequestExports(role) ? (
                      <div className="form-actions">
                        <Link
                          className="button secondary small-btn"
                          href={`/api/export/cbd-detail.csv?requestId=${params.id}`}
                        >
                          <IconDownload size={14} /> Export CBD Detail (CSV)
                        </Link>
                      </div>
                    ) : null}
                    <section className="panel">
                      <h2>Activity</h2>
                      <ul className="list">
                        {actions.length
                          ? actions.map((item) => (
                              <li key={item.id}>
                                <strong>{formatAction(item.action)}</strong>
                                {item.actor_role ? <span className="activity-role">{item.actor_role.toUpperCase()}</span> : null}
                                {item.from_status || item.to_status ? (
                                  <>
                                    <br />
                                    <span className="eyebrow">
                                      {formatStatus(item.from_status)} → {formatStatus(item.to_status)}
                                    </span>
                                  </>
                                ) : null}
                                {item.comment ? (
                                  <>
                                    <br />
                                    {item.comment}
                                  </>
                                ) : null}
                                <br />
                                <span className="eyebrow">{formatDate(item.created_at)}</span>
                              </li>
                            ))
                          : data ? (
                            <li>
                              <strong>Created</strong>
                              <br />
                              <span className="eyebrow">{formatDate(data.created_at)}</span>
                              <br />
                              Request loaded from database
                            </li>
                          ) : null}
                      </ul>
                    </section>
                  </div>
                )
              }
                  ])
            ]}
          />
        </aside>
      </div>
    </AppShell>
  );
}

function formatAction(action: string) {
  return action
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatStatus(status?: string | null) {
  if (!status) return "N/A";

  return statusLabels[status as CostingStatus] ?? formatAction(status);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function timeAgo(value: string) {
  const then = new Date(value).getTime();
  if (!Number.isFinite(then)) return "—";
  const minutes = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

function readText(rawPayload: unknown, key: string) {
  if (!rawPayload || typeof rawPayload !== "object") return null;
  const value = (rawPayload as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function extractOperationsLines(rawPayload: unknown): Array<{ operation: string | null; operationCost: number | null }> {
  if (!rawPayload || typeof rawPayload !== "object") return [];
  const lines = (rawPayload as Record<string, unknown>).operationsLines;
  if (!Array.isArray(lines)) return [];
  return (lines as Array<Record<string, unknown>>).map((line) => ({
    operation: typeof line.operation === "string" ? line.operation : null,
    operationCost: typeof line.operationCost === "number" ? line.operationCost : null
  }));
}

function extractKnittingLines(rawPayload: unknown): Array<{ machineType: string | null; knittingTime: number | null }> {
  if (!rawPayload || typeof rawPayload !== "object") return [];
  const lines = (rawPayload as Record<string, unknown>).knittingLines;
  if (!Array.isArray(lines)) return [];
  return (lines as Array<Record<string, unknown>>).map((line) => ({
    machineType: typeof line.machineType === "string" ? line.machineType : null,
    knittingTime: typeof line.knittingTime === "number" ? line.knittingTime : null
  }));
}

function readNumber(rawPayload: unknown, key: string) {
  if (!rawPayload || typeof rawPayload !== "object") return null;
  const value = (rawPayload as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function computeAverageConsumption(lines: Array<{ consumption: number | null; section?: string | null; uom?: string | null }>) {
  const materialLines = lines.filter((line) => {
    const section = String((line as { section?: unknown }).section ?? "").toLowerCase();
    const uom = String((line as { uom?: unknown }).uom ?? "").toLowerCase();
    if (["yarn", "fabric", "trim"].includes(section)) return true;
    if (["g", "yards", "piece"].includes(uom)) return true;
    if (section === "knitting" || section === "operations") return false;
    return true;
  });
  const values = materialLines.map((line) => line.consumption).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}
