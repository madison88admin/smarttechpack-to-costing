import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { recordWorkflowEvent } from "@/lib/workflow/events";
import { defaultWorkflowSettings, getWorkflowSettings } from "@/lib/admin/settings";
import { getBenchmarkSummary } from "./history";
import { calculateCostingTotals } from "./totals";
import { hasBlockingIssues, validateBenchmarkVariance, validateFactoryCbd, type ValidationIssue } from "./validation";
import { CBD_DIFF_FIELD_LABELS, getCbdDiff } from "./cbd-diff";
import { bomChangedAlertBody, enqueueCostingChangeAlert, enqueueRoleChangeAlert } from "@/lib/notifications/workflow-alerts";
import type { CostingStatus } from "@/lib/workflow/status";

export type CbdLineInput = {
  name?: string;
  consumption?: number | string | null;
  materialPrice?: number | string | null;
  materialCost?: number | string | null;
  machineType?: string | null;
  knittingTime?: number | string | null;
  sah?: number | string | null; // USD per min
  knittingCost?: number | string | null;
  operation?: string | null;
  operationCost?: number | string | null;
  sortOrder?: number;
};

export type CbdMaterialInput = {
  bomLineId?: string;
  materialName: string;
  consumption?: number | string | null;
  uom?: string | null;
  unitCost?: number | string | null;
  currency?: string | null;
};

// --- Pure submit-transition helpers (no I/O) --------------------------------
// Mirrors the transition rules in docs/system-flow-diagram.md §3: a factory
// submit moves the request to for_md_review (MD technical review comes before
// costing validation), or back to needs_clarification when the CBD has
// blocking validation issues.

/**
 * Returns an error message when a factory submit is not allowed from the
 * given request status, else null. Submits are only allowed from
 * sent_to_factory (first submission) and needs_clarification (resubmission).
 */
export function assertSubmitAllowedFrom(status: string): string | null {
  const allowedSubmitFrom = ["sent_to_factory", "needs_clarification"];
  if (!allowedSubmitFrom.includes(status)) {
    return `Factory cannot submit CBD from status "${status}". Allowed from: ${allowedSubmitFrom.join(", ")}`;
  }
  return null;
}

/**
 * Resolves the request status after a factory submit based on validation:
 * blocking (severity = error) issues send the request back to
 * needs_clarification; otherwise it advances to for_md_review for the MD
 * technical review (which precedes costing validation).
 */
export function resolveSubmitNextStatus(
  validationIssues: ValidationIssue[],
  reviewReturnStatus: CostingStatus = "for_md_review"
): CostingStatus {
  return hasBlockingIssues(validationIssues) ? "needs_clarification" : reviewReturnStatus;
}

export function clarificationReturnStatus(action?: string | null): CostingStatus {
  if (action === "clarify") return "for_pbd_review";
  if (action === "costing_clarify") return "for_costing_review";
  return "for_md_review";
}

/**
 * A correction may return directly to the team that requested it, but it must
 * never skip an earlier review that has not actually passed. This matters for
 * legacy/test records whose status was advanced even though the recorded MD
 * decision was still "needs_clarification".
 */
export function clarificationReturnStatusWithPrerequisites(
  action: string | null | undefined,
  mdPassed: boolean,
  costingPassed: boolean
): CostingStatus {
  if (!mdPassed) return "for_md_review";
  if (action === "clarify" && !costingPassed) return "for_costing_review";
  return clarificationReturnStatus(action);
}

export type SubmitCbdInput = {
  costingRequestId: string;
  /** Auth/profile identity of the Factory user submitting this CBD. */
  submittedBy?: string | null;
  status: "draft" | "submitted";
  currency: string;
  // Header info (matching Excel template)
  customer?: string | null;
  season?: string | null;
  styleNumber?: string | null;
  styleName?: string | null;
  costedQty?: string | null;
  leadTimeDays?: number | string | null;
  finishWeight?: string | null;
  protoVersion?: string | null;
  // Structured line items (matching Excel template)
  yarnLines?: CbdLineInput[];
  fabricLines?: CbdLineInput[];
  trimLines?: CbdLineInput[];
  knittingLines?: CbdLineInput[];
  operationsLines?: CbdLineInput[];
  // Packaging
  standardPackagingCost?: number | string | null;
  specialPackagingCost?: number | string | null;
  // Overhead/Profit
  overheadCost?: number | string | null;
  profitCost?: number | string | null;
  // Legacy fields (kept for backward compatibility)
  laborCost?: number | string | null;
  profitMargin?: number | string | null;
  moq?: number | string | null;
  materialBufferPercent?: number | string | null;
  packagingCost?: number | string | null;
  testingCost?: number | string | null;
  brandNominatedItems?: string | null;
  m88Packaging?: string | null;
  yarnType?: string | null;
  knitType?: string | null;
  machineType?: string | null;
  construction?: string | null;
  knittingTime?: number | string | null;
  productCategory?: string | null;
  costingLearning?: string | null;
  recurringIssueTags?: string | null;
  notes?: string | null;
  yarnNotes?: string | null;
  operationsNotes?: string | null;
  packagingNotes?: string | null;
  overheadNotes?: string | null;
  // Landed cost fields
  freightCost?: number | string | null;
  dutyRate?: number | string | null;
  insuranceCost?: number | string | null;
  customsClearanceCost?: number | string | null;
  inlandTransportCost?: number | string | null;
  // Pricing & margin fields
  wholesaleMarkup?: number | string | null;
  retailMarkup?: number | string | null;
  lines: CbdMaterialInput[];
};

export async function submitFactoryCbd(input: SubmitCbdInput) {
  const supabase = createSupabaseServiceClient();
  const status = input.status === "submitted" ? "submitted" : "draft";

  // Always verify the request exists BEFORE inserting anything. The .single()
  // lookup throws PostgREST PGRST116 when the id does not exist, which the
  // route maps to a clean 404 instead of a foreign-key-violation 500. Draft
  // saves are still allowed from any status — only submissions are gated.
  const context = await getRequestContext(supabase, input.costingRequestId);

  // Pre-check: if submitting, verify the request is in an allowed status BEFORE inserting
  if (status === "submitted") {
    const submitError = assertSubmitAllowedFrom(context.status);
    if (submitError) throw new Error(submitError);
  }

  const materialPayload = buildMaterialPayload(input, "");

  // Calculate totals from new structured data
  const yarnTotal = sumLineCosts(input.yarnLines, "materialCost");
  const fabricTotal = sumLineCosts(input.fabricLines, "materialCost");
  const trimTotal = sumLineCosts(input.trimLines, "materialCost");
  const knittingTotal = sumLineCosts(input.knittingLines, "knittingCost");
  const operationsTotal = sumLineCosts(input.operationsLines, "operationCost");
  const packagingTotal = (parseNumber(input.standardPackagingCost) ?? 0) + (parseNumber(input.specialPackagingCost) ?? 0);
  const overheadProfitTotal = (parseNumber(input.overheadCost) ?? 0) + (parseNumber(input.profitCost) ?? 0);

  const structuredMaterialTotal = yarnTotal + fabricTotal + trimTotal;
  const factoryCostTotal = structuredMaterialTotal + knittingTotal + operationsTotal + packagingTotal + overheadProfitTotal;

  const costingTotals = calculateCostingTotals({
    rawPayload: {
      currency: input.currency,
      // Use structured totals if available, fall back to legacy fields
      materialTotal: structuredMaterialTotal > 0 ? structuredMaterialTotal : undefined,
      laborCost: knittingTotal + operationsTotal > 0 ? knittingTotal + operationsTotal : input.laborCost,
      overheadCost: input.overheadCost,
      profitCost: input.profitCost,
      profitMargin: input.profitMargin,
      packagingCost: packagingTotal > 0 ? packagingTotal : input.packagingCost,
      testingCost: input.testingCost,
      factoryCostTotal: factoryCostTotal > 0 ? factoryCostTotal : undefined,
      grandTotal: factoryCostTotal > 0 ? factoryCostTotal : undefined,
      moq: input.moq,
      freightCost: input.freightCost,
      dutyRate: input.dutyRate,
      insuranceCost: input.insuranceCost,
      customsClearanceCost: input.customsClearanceCost,
      inlandTransportCost: input.inlandTransportCost,
      wholesaleMarkup: input.wholesaleMarkup,
      retailMarkup: input.retailMarkup
    },
    lines: materialPayload,
    fallbackCurrency: input.currency
  });
  // The wizard submits template sections instead of the old flat `lines`
  // array. Normalize those values before validation so real labor, packaging,
  // and material rows are not incorrectly reported as missing.
  const validationIssues = validateFactoryCbd({
    ...input,
    laborCost: knittingTotal + operationsTotal > 0 ? knittingTotal + operationsTotal : input.laborCost,
    packagingCost: packagingTotal > 0 ? packagingTotal : input.packagingCost,
    lines: input.lines.length ? input.lines : buildStructuredValidationLines(input)
  });

  const { data: cbd, error: cbdError } = await supabase
    .from("factory_cbds")
    .insert({
      costing_request_id: input.costingRequestId,
      submitted_by: input.submittedBy ?? null,
      // submitted_at is stamped by the database (DEFAULT now(), migration
      // 015) so the outlier-acknowledgement freshness check compares DB-clock
      // values on both sides. Never send an app-clock timestamp here — client
      // clocks can run ahead of the database and make a fresh ack look stale.
      // Drafts stay explicitly null (nothing submitted yet).
      ...(status === "submitted" ? {} : { submitted_at: null }),
      status,
      raw_payload: {
        currency: input.currency,
        // Header info (Excel template)
        header: {
          customer: input.customer ?? null,
          season: input.season ?? null,
          styleNumber: input.styleNumber ?? null,
          styleName: input.styleName ?? null,
          costedQty: input.costedQty ?? null,
          leadTimeDays: parseNumber(input.leadTimeDays),
          finishWeight: input.finishWeight ?? null,
          protoVersion: input.protoVersion ?? null
        },
        // Structured line items (Excel template)
        yarnLines: input.yarnLines ?? [],
        fabricLines: input.fabricLines ?? [],
        trimLines: input.trimLines ?? [],
        knittingLines: input.knittingLines ?? [],
        operationsLines: input.operationsLines ?? [],
        standardPackagingCost: parseNumber(input.standardPackagingCost),
        specialPackagingCost: parseNumber(input.specialPackagingCost),
        profitCost: parseNumber(input.profitCost),
        yarnNotes: input.yarnNotes ?? null,
        operationsNotes: input.operationsNotes ?? null,
        packagingNotes: input.packagingNotes ?? null,
        overheadNotes: input.overheadNotes ?? null,
        // Computed totals
        yarnTotal,
        fabricTotal,
        trimTotal,
        materialTotal: structuredMaterialTotal || costingTotals.materialTotal,
        knittingTotal,
        operationsTotal,
        packagingTotal,
        overheadProfitTotal,
        factoryCostTotal,
        // Legacy fields (backward compatibility)
        laborCost: knittingTotal + operationsTotal > 0 ? knittingTotal + operationsTotal : parseNumber(input.laborCost),
        overheadCost: parseNumber(input.overheadCost),
        profitMargin: parseNumber(input.profitMargin),
        moq: parseNumber(input.moq),
        leadTimeDays: parseNumber(input.leadTimeDays),
        materialBufferPercent: parseNumber(input.materialBufferPercent),
        packagingCost: packagingTotal > 0 ? packagingTotal : parseNumber(input.packagingCost),
        testingCost: parseNumber(input.testingCost),
        brandNominatedItems: input.brandNominatedItems ?? null,
        m88Packaging: input.m88Packaging ?? null,
        yarnType: input.yarnType ?? null,
        knitType: input.knitType ?? null,
        machineType: input.machineType ?? null,
        construction: input.construction ?? null,
        knittingTime: parseNumber(input.knittingTime),
        productCategory: input.productCategory ?? null,
        costingLearning: input.costingLearning ?? null,
        recurringIssueTags: parseTags(input.recurringIssueTags),
        profitAmount: costingTotals.profitAmount,
        grandTotal: factoryCostTotal > 0 ? factoryCostTotal : costingTotals.grandTotal,
        // Landed cost
        freightCost: parseNumber(input.freightCost),
        dutyRate: parseNumber(input.dutyRate),
        dutyAmount: costingTotals.dutyAmount,
        insuranceCost: parseNumber(input.insuranceCost),
        customsClearanceCost: parseNumber(input.customsClearanceCost),
        inlandTransportCost: parseNumber(input.inlandTransportCost),
        landedCost: costingTotals.landedCost,
        // Pricing & margin
        wholesaleMarkup: parseNumber(input.wholesaleMarkup),
        retailMarkup: parseNumber(input.retailMarkup),
        wholesalePrice: costingTotals.wholesalePrice,
        retailPrice: costingTotals.retailPrice,
        grossMarginPercent: costingTotals.grossMarginPercent,
        breakEvenQuantity: costingTotals.breakEvenQuantity,
        notes: input.notes ?? null
      }
    })
    .select("id")
    .single();

  if (cbdError) throw cbdError;

  // Insert structured line items into cbd_material_lines with section tags
  const structuredLines = buildStructuredLinePayloads(input, cbd.id);
  if (structuredLines.length) {
    const { error: linesError } = await supabase
      .from("cbd_material_lines")
      .insert(structuredLines);

    if (linesError) throw linesError;
  }

  // Also insert legacy BOM lines if any
  if (input.lines.length) {
    const { error: linesError } = await supabase
      .from("cbd_material_lines")
      .insert(buildMaterialPayload(input, cbd.id));

    if (linesError) throw linesError;
  }

  if (status === "submitted") {
    const benchmark = await getBenchmarkSummary({
      styleNumber: context.styleNumber,
      factoryName: context.factoryName,
      currentTotal: costingTotals.grandTotal,
      currency: input.currency,
      excludeRequestId: input.costingRequestId
    });
    // Use the configurable warning threshold from workflow_settings (falls back to 15)
    const settings = await getWorkflowSettings().catch(() => defaultWorkflowSettings);
    validationIssues.push(
      ...validateBenchmarkVariance({
        currentTotal: benchmark.currentTotal,
        historicalAverage: benchmark.historicalAverage,
        sampleSize: benchmark.sampleSize,
        variancePercent: benchmark.variancePercent,
        thresholdPercent: settings.warningVariancePercent,
        convertedCount: benchmark.convertedCount,
        convertedFrom: benchmark.convertedFrom
      })
    );

    await supabase.from("validation_results").delete().eq("costing_request_id", input.costingRequestId);

    if (validationIssues.length) {
      const { error: validationError } = await supabase.from("validation_results").insert(
        validationIssues.map((issue) => ({
          costing_request_id: input.costingRequestId,
          severity: issue.severity,
          rule_code: issue.ruleCode,
          message: issue.message,
          field_path: issue.fieldPath ?? null
        }))
      );

      if (validationError) throw validationError;
    }

    const fromStatus = context.status;
    const reviewReturnStatus = fromStatus === "needs_clarification"
      ? await getClarificationReturnStatus(supabase, input.costingRequestId)
      : "for_md_review";
    const nextStatus = resolveSubmitNextStatus(validationIssues, reviewReturnStatus);

    // Optimistic lock: only transition the request if it is still in the
    // status we validated against. Two concurrent submits can both pass the
    // pre-check, but only one wins the update — the loser gets 0 rows and
    // returns a 409 race error instead of silently double-submitting.
    const { data: updatedRows, error: requestError } = await supabase
      .from("costing_requests")
      .update({
        status: nextStatus,
        updated_at: new Date().toISOString()
      })
      .eq("id", input.costingRequestId)
      .eq("status", fromStatus)
      .select("id");

    if (requestError) throw requestError;

    // Lost race: another user/action moved the request first. Roll back the
    // CBD rows we just inserted (material lines cascade on delete) so a failed
    // submit never leaves phantom "submitted" revisions in the trail.
    if (!updatedRows || updatedRows.length === 0) {
      try {
        await supabase.from("factory_cbds").delete().eq("id", cbd.id);
      } catch {
        // Best-effort rollback — never mask the race error.
      }
      throw new Error(
        `CBD submit failed — request status changed from "${fromStatus}" by another user. Please refresh and try again.`
      );
    }

    if (input.costingLearning?.trim()) {
      await supabase.from("costing_notes").insert({
        costing_request_id: input.costingRequestId,
        note_type: "learning",
        note: input.costingLearning.trim(),
        tags: parseTags(input.recurringIssueTags),
        created_by_role: "factory"
      });
    }

    await supabase.from("approval_actions").insert({
      costing_request_id: input.costingRequestId,
      actor_role: "factory",
      action: "submit",
      from_status: fromStatus,
      to_status: nextStatus,
      comment:
        nextStatus === "needs_clarification"
          ? "Factory submitted CBD with validation issues"
          : "Factory submitted CBD",
      metadata: {
        validationIssueCount: validationIssues.length,
        totals: costingTotals
      }
    });

    await recordWorkflowEvent(supabase, {
      costingRequestId: input.costingRequestId,
      eventType: "factory_submit",
      actorRole: "factory",
      payload: {
        fromStatus,
        toStatus: nextStatus,
        validationIssueCount: validationIssues.length,
        totals: costingTotals
      }
    });

    // Notify costing whenever a resubmission changes the BOM / material lines.
    await enqueueBomChangeAlertIfChanged(
      input.costingRequestId,
      context.factoryName
    ).catch(() => {
      // Best-effort — never block the submit on notification failures.
    });

    const nextReview = nextStatus === "for_pbd_review"
      ? {
          role: "pbd",
          title: "Factory clarification resubmitted — PBD review required",
          instruction: "The factory corrected and resubmitted the CBD requested by PBD. Review the revision and continue the approval decision."
        }
      : nextStatus === "for_costing_review"
        ? {
            role: "costing",
            title: "Factory clarification resubmitted — Costing review required",
            instruction: "The factory corrected and resubmitted the CBD requested by Costing. Revalidate the revised costs."
          }
        : {
            role: "md",
            title: "Factory CBD submitted — MD technical review required",
            instruction: "The factory submitted the CBD. Complete the MD technical review to release it to Costing validation."
          };

    // Notify the team that requested the correction (or MD for a first submit).
    await enqueueRoleChangeAlert({
      role: nextReview.role,
      requestId: input.costingRequestId,
      title: nextReview.title,
      bodyLines: [
        `Factory: ${context.factoryName ?? "Unassigned"}`,
        `Style: ${context.styleNumber ?? "Unknown"}`,
        "",
        nextReview.instruction
      ]
    }).catch(() => {
      // Best-effort — never block the submit on notification failures.
    });
  }

  return {
    ...cbd,
    validationIssues
  };
}

async function getClarificationReturnStatus(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  requestId: string
): Promise<CostingStatus> {
  try {
    const { data, error } = await supabase
      .from("approval_actions")
      .select("action, to_status, metadata, created_at")
      .eq("costing_request_id", requestId)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) throw error;

    const rows = (data ?? []) as Array<{
      action?: string | null;
      to_status?: string | null;
      metadata?: Record<string, unknown> | null;
      created_at?: string | null;
    }>;
    const clarification = rows.find((row) => row.to_status === "needs_clarification");
    const latestMdReview = rows.find((row) => row.action === "md_review");
    const mdPassed = String(latestMdReview?.metadata?.decision ?? "") === "pass";
    const costingPassed = rows.some((row) => row.action === "costing_complete");

    return clarificationReturnStatusWithPrerequisites(
      clarification?.action ?? null,
      mdPassed,
      costingPassed
    );
  } catch {
    // Legacy/test data without a clarification action repeats MD review.
    return "for_md_review";
  }
}

async function enqueueBomChangeAlertIfChanged(requestId: string, factoryName: string | null) {
  const diff = await getCbdDiff(requestId);
  if (!diff || diff.diffs.length === 0) return;

  const latestDiff = diff.diffs[diff.diffs.length - 1];
  const changedCount = latestDiff.filter((entry) => entry.changed).length;
  if (changedCount === 0) return;

  // Record the change as a workflow event so the daily digest can pick it up.
  const supabase = createSupabaseServiceClient();
  await recordWorkflowEvent(supabase, {
    costingRequestId: requestId,
    eventType: "bom_changed",
    actorRole: "factory",
    payload: {
      changedCount,
      factoryName
    }
  }).catch(() => {
    // Best-effort — never block the submit on event-recording failures.
  });

  const impact = diff.costImpacts[diff.costImpacts.length - 1];
  // Per-field old → new lines so the alert shows exactly what the factory
  // changed, not just the count. Entries already carry formatted values.
  const changes = latestDiff
    .filter((entry) => entry.changed)
    .map((entry) => ({
      field: CBD_DIFF_FIELD_LABELS[entry.field] ?? entry.field,
      oldValue: entry.oldValue || "—",
      newValue: entry.newValue || "—"
    }));
  const { subject, body } = bomChangedAlertBody({
    requestNumber: diff.requestNumber,
    factoryName,
    changedCount,
    fobBefore: impact?.fobBefore ?? 0,
    fobAfter: impact?.fobAfter ?? 0,
    currency: impact?.currency ?? "USD",
    changes
  });

  await enqueueCostingChangeAlert({
    requestId,
    requestNumber: diff.requestNumber,
    factoryName,
    subject,
    body,
    kind: "bom_changed",
    changes: changes.map((change) => `${change.field}: ${change.oldValue} → ${change.newValue}`)
  });
}

function buildMaterialPayload(input: SubmitCbdInput, cbdId: string) {
  return input.lines.map((line) => {
    const consumption = parseNumber(line.consumption);
    const unitCost = parseNumber(line.unitCost);

    return {
      factory_cbd_id: cbdId,
      bom_line_id: line.bomLineId ?? null,
      material_name: line.materialName,
      consumption,
      uom: line.uom ?? null,
      unit_cost: unitCost,
      total_cost: consumption !== null && unitCost !== null ? consumption * unitCost : null,
      currency: line.currency ?? input.currency,
      raw_payload: line
    };
  });
}

async function getRequestContext(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  requestId: string
) {
  const { data, error } = await supabase
    .from("costing_requests")
    .select(
      `
      status,
      factory_name,
      nextgen_products (
        style_number,
        name
      )
    `
    )
    .eq("id", requestId)
    .single();

  if (error) throw error;

  const product = Array.isArray(data.nextgen_products)
    ? data.nextgen_products[0]
    : data.nextgen_products;

  return {
    status: data.status,
    factoryName: data.factory_name,
    styleNumber: product?.style_number ?? product?.name ?? null
  };
}

function parseNumber(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;

  const parsed = Number(value.replace(/,/g, ""));

  return Number.isFinite(parsed) ? parsed : null;
}

function parseTags(value: unknown) {
  if (typeof value !== "string") return [];

  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function sumLineCosts(lines: CbdLineInput[] | undefined, costField: keyof CbdLineInput): number {
  if (!lines || !Array.isArray(lines)) return 0;
  return lines.reduce((sum, line) => sum + (parseNumber(line[costField]) ?? 0), 0);
}

function buildStructuredValidationLines(input: SubmitCbdInput): CbdMaterialInput[] {
  const toMaterial = (line: CbdLineInput, uom: string): CbdMaterialInput => ({
    materialName: String(line.name ?? ""),
    consumption: line.consumption,
    uom,
    unitCost: line.materialPrice,
    currency: input.currency
  });

  return [
    ...(input.yarnLines ?? []).map((line) => toMaterial(line, "g")),
    ...(input.fabricLines ?? []).map((line) => toMaterial(line, "yards")),
    ...(input.trimLines ?? []).map((line) => toMaterial(line, "piece"))
  ].filter((line) =>
    Boolean(line.materialName.trim()) ||
    parseNumber(line.consumption) !== null ||
    parseNumber(line.unitCost) !== null
  );
}

function buildStructuredLinePayloads(input: SubmitCbdInput, cbdId: string) {
  const payloads: Array<Record<string, unknown>> = [];

  // Yarn lines
  (input.yarnLines ?? []).forEach((line, i) => {
    payloads.push({
      factory_cbd_id: cbdId,
      section: "yarn",
      sort_order: i,
      material_name: line.name ?? null,
      consumption: parseNumber(line.consumption),
      uom: "g",
      unit_cost: parseNumber(line.materialPrice),
      total_cost: parseNumber(line.materialCost),
      currency: input.currency,
      raw_payload: line
    });
  });

  // Fabric lines
  (input.fabricLines ?? []).forEach((line, i) => {
    payloads.push({
      factory_cbd_id: cbdId,
      section: "fabric",
      sort_order: i,
      material_name: line.name ?? null,
      consumption: parseNumber(line.consumption),
      uom: "yards",
      unit_cost: parseNumber(line.materialPrice),
      total_cost: parseNumber(line.materialCost),
      currency: input.currency,
      raw_payload: line
    });
  });

  // Trim lines
  (input.trimLines ?? []).forEach((line, i) => {
    payloads.push({
      factory_cbd_id: cbdId,
      section: "trim",
      sort_order: i,
      material_name: line.name ?? null,
      consumption: parseNumber(line.consumption),
      uom: "piece",
      unit_cost: parseNumber(line.materialPrice),
      total_cost: parseNumber(line.materialCost),
      currency: input.currency,
      raw_payload: line
    });
  });

  // Knitting lines
  (input.knittingLines ?? []).forEach((line, i) => {
    payloads.push({
      factory_cbd_id: cbdId,
      section: "knitting",
      sort_order: i,
      material_name: line.machineType ?? null,
      consumption: parseNumber(line.knittingTime),
      uom: "mins",
      unit_cost: parseNumber(line.sah),
      total_cost: parseNumber(line.knittingCost),
      currency: input.currency,
      raw_payload: line
    });
  });

  // Operations lines
  (input.operationsLines ?? []).forEach((line, i) => {
    payloads.push({
      factory_cbd_id: cbdId,
      section: "operations",
      sort_order: i,
      material_name: line.operation ?? null,
      total_cost: parseNumber(line.operationCost),
      currency: input.currency,
      raw_payload: line
    });
  });

  return payloads;
}
