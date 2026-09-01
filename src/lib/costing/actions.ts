import { createSupabaseServiceClient } from "@/lib/supabase/server";
import type { CostingStatus } from "@/lib/workflow/status";
import { recordWorkflowEvent } from "@/lib/workflow/events";
import { calculateCostingTotals } from "./totals";
import { canRunCostingAction, canRunPbdAction } from "@/lib/auth/roles";
import type { UserRole } from "@/lib/auth/roles";
import { getChecklistResults } from "./checklist";
import { enqueueRoleChangeAlert } from "@/lib/notifications/workflow-alerts";
import { getOutlierReview, hasValidOutlierAcknowledgement, isHighRisk } from "./outlier-review";

const allowedActions: Record<string, CostingStatus> = {
  send_to_factory: "sent_to_factory",
  // Factory submits CBD -> MD technical review first, then Costing validates.
  submit: "for_md_review",
  costing_complete: "for_pbd_review",
  costing_clarify: "needs_clarification",
  clarify: "needs_clarification",
  approve: "approved",
  reject: "rejected"
};

const validTransitions: Record<string, string[]> = {
  send_to_factory: ["draft"],
  // Factory submits CBD → MD technical review (workflow order: MD before Costing)
  submit: ["sent_to_factory", "needs_clarification"],
  // Costing Team completes validation → goes to PBD for approval
  costing_complete: ["for_costing_review"],
  // Costing Team can request clarification from factory
  costing_clarify: ["for_costing_review"],
  // PBD can clarify (send back to factory for correction/revision)
  clarify: ["for_pbd_review", "needs_clarification"],
  // PBD owns the single final internal decision.
  approve: ["for_pbd_review"],
  reject: ["for_pbd_review"]
};

// --- Pure transition engine (no I/O) ----------------------------------------
// These two functions are the unit-testable core of the workflow. They are
// deliberately side-effect free: runCostingAction applies their verdicts and
// then performs the database work (optimistic lock, checklist/compliance
// gates, threshold routing, historical save).

/**
 * Validates that `action` is a known action and that `actorRole` is permitted
 * to perform it. Returns an error message, or null when allowed.
 *
 * Precedence matches runCostingAction: unknown action > role gate > from-status
 * gate (assertTransitionAllowed is only consulted after this passes).
 * `send_to_factory`, `submit`, and `clarify` have no role gate here because
 * they are gated upstream in the route layer (PBD/Admin in actions/route.ts,
 * Factory/Admin in cbd/route.ts).
 */
export function assertActionAllowed(action: string, actorRole?: string | null): string | null {
  if (!allowedActions[action]) {
    return "Invalid action";
  }

  // Role enforcement: costing_complete and costing_clarify require Costing Team or Admin tier
  const costingActions = ["costing_complete", "costing_clarify"];
  if (costingActions.includes(action) && !canRunCostingAction(actorRole as UserRole)) {
    return `Action "${action}" requires Costing Team or Admin role`;
  }

  // Normal approval/rejection is owned by PBD.
  const approvalActions = ["approve", "reject"];
  if (approvalActions.includes(action) && !canRunPbdAction(actorRole as UserRole)) {
    return `Action "${action}" requires PBD or Admin role`;
  }

  return null;
}

/**
 * Validates that `action` may be executed from `fromStatus`. Returns an error
 * message, or null when the transition is permitted. Only meaningful for known
 * actions — unknown actions are rejected by assertActionAllowed first.
 */
export function assertTransitionAllowed(action: string, fromStatus: string): string | null {
  const allowedFrom = validTransitions[action];
  if (allowedFrom && !allowedFrom.includes(fromStatus)) {
    return `Action "${action}" is not allowed from status "${fromStatus}". Allowed from: ${allowedFrom.join(", ")}`;
  }
  return null;
}

export async function runCostingAction(
  requestId: string,
  action: string,
  comment?: string | null,
  actorRole?: string | null,
  actorName?: string | null,
  actorUserId?: string | null
) {
  const status = allowedActions[action];

  if (!status) {
    throw new Error("Invalid action");
  }

  // Pure gate: role enforcement (costing_*, approve/reject, manager_*).
  const gateError = assertActionAllowed(action, actorRole);
  if (gateError) throw new Error(gateError);

  const supabase = createSupabaseServiceClient();
  const fromStatus = await getCurrentStatus(supabase, requestId);

  // Pure gate: transition must be allowed from the current status.
  const transitionGateError = assertTransitionAllowed(action, fromStatus);
  if (transitionGateError) throw new Error(transitionGateError);

  // Enforce checklist completion before costing_complete (Costing Team must check all 4 items)
  if (action === "costing_complete") {
    await assertChecklistComplete(supabase, requestId);
  }

  // PBD approval gates run before the combined PBD/Manager decision.
  if (action === "approve") {
    await assertApprovalAllowed(supabase, requestId);
    await assertApprovalOutliersClear(supabase, requestId);
  }

  const updates: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString()
  };

  // PBD send_to_factory should be immediately actionable by a factory user.
  // Auto-assign the first active factory user if none is assigned, so the
  // "Request not assigned to you" gate does not block the very first CBD.
  // Admin can still reassign later via the Factory Assignments panel.
  if (action === "send_to_factory") {
    try {
      const { data: req } = await supabase
        .from("costing_requests")
        .select("factory_name, assigned_factory_user_id")
        .eq("id", requestId)
        .single();
      if (req && !req.assigned_factory_user_id) {
        const { data: factoryUser } = await supabase
          .from("user_profiles")
          .select("id")
          .eq("role", "factory")
          .eq("is_active", true)
          .limit(1)
          .maybeSingle();
        if (factoryUser?.id) updates.assigned_factory_user_id = factoryUser.id;
      }
    } catch {
      // Best-effort — the status transition still succeeds
    }
  }

  // Clarification loops return to the Factory user who submitted the latest
  // CBD. This removes the need for an admin to reassign every correction while
  // preserving the per-user access gate on the Factory workspace.
  if (["clarify", "costing_clarify"].includes(action)) {
    try {
      const { data: latestCbd } = await supabase
        .from("factory_cbds")
        .select("submitted_by")
        .eq("costing_request_id", requestId)
        .not("submitted_by", "is", null)
        .order("submitted_at", { ascending: false, nullsFirst: false })
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle();

      const submitter = latestCbd?.submitted_by ? String(latestCbd.submitted_by) : null;
      if (submitter) {
        // submitted_by may be either the profile id or the auth identity,
        // depending on which login mode created the CBD. Resolve both forms to
        // the canonical user_profiles.id stored by the assignment gate.
        const { data: profile } = await supabase
          .from("user_profiles")
          .select("id")
          .or(`id.eq.${submitter},auth_user_id.eq.${submitter}`)
          .eq("role", "factory")
          .eq("is_active", true)
          .maybeSingle();
        if (profile?.id) updates.assigned_factory_user_id = profile.id;
      }
    } catch {
      // Automatic routing is best-effort for legacy databases/test doubles
      // that do not expose submitted_by yet. The clarification still applies.
    }
  }

  // Auto-advance customer status when approved (process improvement)
  if (action === "approve") {
    updates.customer_status = "pending_customer_submission";
    updates.customer_status_updated_at = new Date().toISOString();
  }

  const { data: updatedRows, error: updateError } = await supabase
    .from("costing_requests")
    .update(updates)
    .eq("id", requestId)
    .eq("status", fromStatus) // Optimistic lock: only update if status hasn't changed
    .select("id");

  if (updateError) throw updateError;

  // Race condition check: if no rows updated, another action changed the status first
  if (!updatedRows || updatedRows.length === 0) {
    const currentStatus = await getCurrentStatus(supabase, requestId);
    throw new Error(
      `Action "${action}" failed — request status changed from "${fromStatus}" to "${currentStatus}" by another user. Please refresh and try again.`
    );
  }

  // Save the historical costing row only after the optimistic lock succeeded:
  // a lost race must never leave history for a request that was never approved.
  if (action === "approve") {
    await saveHistoricalCosting(supabase, requestId);
  }

  const { error: actionError } = await supabase.from("approval_actions").insert({
    costing_request_id: requestId,
    actor_role: actorRole ?? "pbd",
    actor_name: actorName ?? null,
    actor_user_id: actorUserId ?? null,
    action,
    from_status: fromStatus,
    to_status: status,
    comment: comment ?? defaultComment(action)
  });

  if (actionError) throw actionError;

  await recordWorkflowEvent(supabase, {
    costingRequestId: requestId,
    eventType: action,
    actorRole: actorRole ?? "pbd",
    actorUserId: actorUserId ?? null,
    payload: {
      fromStatus,
      toStatus: status,
      comment: comment ?? defaultComment(action)
    }
  });

  // Notify PBD that costing validation finished and the request is ready for review.
  if (action === "costing_complete") {
    await enqueueRoleChangeAlert({
      role: "pbd",
      requestId,
      title: "Costing validation complete — ready for PBD review",
      bodyLines: ["Costing completed the validation checklist and released the request for PBD internal approval."]
    }).catch(() => {
      // Best-effort — never block the action on notification failures.
    });
  }

  // Notify the factory whenever a request lands back in their queue
  // (Costing or PBD clarification) or is rejected — the factory must know it
  // is their turn to revise, or that they need to start over.
  if (action === "costing_clarify" || action === "clarify") {
    const sentBy = action === "costing_clarify" ? "Costing" : "PBD";
    await enqueueRoleChangeAlert({
      role: "factory",
      requestId,
      title: `${sentBy} requested clarification — CBD revision required`,
      bodyLines: [
        comment
          ? `Reason: ${comment}`
          : `The ${sentBy} team sent the request back for correction or revision.`,
        "",
        "Please update the cost breakdown and resubmit."
      ],
      alertType: "role_change"
    }).catch(() => {
      // Best-effort — never block the action on notification failures.
    });
  }

  if (action === "reject") {
    await enqueueRoleChangeAlert({
      role: "factory",
      requestId,
      title: "Request rejected — costing was not approved",
      bodyLines: [
        comment ? `Reason: ${comment}` : "The request was rejected during internal review.",
        "",
        "The costing was not approved. The factory will need to start over with a new request."
      ],
      alertType: "role_change"
    }).catch(() => {
      // Best-effort — never block the action on notification failures.
    });
  }

  return { status };
}

async function getCurrentStatus(supabase: ReturnType<typeof createSupabaseServiceClient>, requestId: string) {
  const { data, error } = await supabase
    .from("costing_requests")
    .select("status")
    .eq("id", requestId)
    .single();

  if (error) throw error;

  return data.status as string;
}

async function assertApprovalAllowed(supabase: ReturnType<typeof createSupabaseServiceClient>, requestId: string) {
  const { data, error } = await supabase
    .from("validation_results")
    .select("id, message")
    .eq("costing_request_id", requestId)
    .eq("severity", "error")
    .is("resolved_at", null)
    .limit(1);

  if (error) throw error;

  if (data.length) {
    throw new Error(`Cannot approve while blocking validation issue exists: ${data[0].message}`);
  }

  // RSL and REACH are hard compliance gates. A check that is pending or has
  // failed must be resolved before an internal approval can be recorded.
  const { data: complianceChecks, error: complianceError } = await supabase
    .from("compliance_checks")
    .select("check_type, status, notes")
    .eq("costing_request_id", requestId);

  if (complianceError) throw complianceError;

  const blockingCompliance = (complianceChecks ?? []).find((check) => {
    const type = String(check.check_type ?? "").trim().toLowerCase();
    const status = String(check.status ?? "").trim().toLowerCase();
    if (type !== "rsl" && type !== "reach") return false;
    return ["pending", "failed", "fail", "rejected", "non_compliant", "not_compliant"].includes(status);
  });

  if (blockingCompliance) {
    throw new Error(
      `Cannot approve while ${String(blockingCompliance.check_type).toUpperCase()} compliance is ${blockingCompliance.status}. Resolve the compliance check first.`
    );
  }

  const { data: request, error: pricingError } = await supabase
    .from("costing_requests")
    .select("pbd_pricing_status")
    .eq("id", requestId)
    .single();

  if (pricingError) {
    if (pricingError.message.includes("pbd_pricing_status")) {
      throw new Error("Database migration 002_approval_workflow_alignment.sql is required before approval.");
    }
    throw pricingError;
  }
  if (request?.pbd_pricing_status !== "entered") {
    throw new Error("Cannot approve before PBD selling price review is entered.");
  }

  const { data: mdReview, error: mdError } = await supabase
    .from("approval_actions")
    .select("metadata")
    .eq("costing_request_id", requestId)
    .eq("action", "md_review")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const mdDecision = mdReview?.metadata && typeof mdReview.metadata === "object"
    ? String((mdReview.metadata as Record<string, unknown>).decision ?? "")
    : "";
  if (mdError) throw mdError;
  if (mdDecision !== "pass") {
    throw new Error("Cannot approve before MD technical review is passed.");
  }
}

async function assertApprovalOutliersClear(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  requestId: string
) {
  const { review, cbd, flags } = await getOutlierReview(supabase, requestId);
  if (!cbd) return; // nothing to compare against
  if (!isHighRisk(review)) return;

  // Validation-error cases are already blocked by assertApprovalAllowed, so a
  // "high" verdict here means statistical outliers: cost variance versus
  // history or consumption/knitting time versus the attribute benchmark.
  // Costing can clear the gate by acknowledging the flags (audit trail), but a
  // revised CBD invalidates the acknowledgment until Costing re-acknowledges.
  const acknowledged = await hasValidOutlierAcknowledgement(supabase, requestId, cbd.submitted_at);
  if (acknowledged) return;

  const flagText = flags.length ? flags.join(" ") : review.highlights.join(" ");
  throw new Error(
    `Cannot approve while high-risk outlier flags are active and not acknowledged by Costing. ${flagText} Costing must acknowledge the outliers (with justification) before PBD approval.`
  );
}

async function assertChecklistComplete(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  requestId: string
) {
  const checklist = await getChecklistResults(requestId);
  const incompleteRequired = checklist.filter(
    (item) => item.is_required && item.is_active && !item.is_checked
  );

  if (incompleteRequired.length > 0) {
    const labels = incompleteRequired.map((item) => item.label).join(", ");
    throw new Error(
      `Cannot proceed — ${incompleteRequired.length} required checklist item(s) not checked: ${labels}`
    );
  }
}

async function checkApprovalThreshold(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  requestId: string
): Promise<{ requiresManagerApproval: boolean; totalCost: number; threshold: number; currency: string }> {
  // Get threshold from workflow_settings
  const { data: settings } = await supabase
    .from("workflow_settings")
    .select("key, value")
    .eq("key", "manager_approval_threshold")
    .single();

  const threshold = settings?.value ? parseFloat(String(settings.value)) : 0;

  if (threshold <= 0) {
    return { requiresManagerApproval: false, totalCost: 0, threshold: 0, currency: "USD" };
  }

  // Get the latest CBD total
  const { data: cbd } = await supabase
    .from("factory_cbds")
    .select("raw_payload")
    .eq("costing_request_id", requestId)
    .order("submitted_at", { ascending: false, nullsFirst: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!cbd?.raw_payload) {
    return { requiresManagerApproval: false, totalCost: 0, threshold, currency: "USD" };
  }

  const payload = cbd.raw_payload as Record<string, unknown>;
  const grandTotal = typeof payload.grandTotal === "number" ? payload.grandTotal : 0;
  const landedCost = typeof payload.landedCost === "number" ? payload.landedCost : 0;
  const totalCost = landedCost > 0 ? landedCost : grandTotal;
  const currency = typeof payload.currency === "string" ? payload.currency : "USD";

  return {
    requiresManagerApproval: totalCost > threshold,
    totalCost,
    threshold,
    currency
  };
}

async function saveHistoricalCosting(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  requestId: string
) {
  const { data: request, error: requestError } = await supabase
    .from("costing_requests")
    .select(
      `
      id,
      factory_name,
      nextgen_products (
        style_number,
        name
      )
    `
    )
    .eq("id", requestId)
    .single();

  if (requestError) throw requestError;

  const { data: cbd, error: cbdError } = await supabase
    .from("factory_cbds")
    .select(
      `
      id,
      raw_payload,
      cbd_material_lines (
        consumption,
        total_cost,
        currency,
        material_name,
        section,
        uom
      )
    `
    )
    .eq("costing_request_id", requestId)
    .order("submitted_at", { ascending: false, nullsFirst: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (cbdError) throw cbdError;

  const lines = (cbd?.cbd_material_lines ?? []) as Array<{
    consumption: number | null;
    total_cost: number | null;
    currency: string | null;
    material_name: string | null;
    section?: string | null;
    uom?: string | null;
  }>;
  const totals = calculateCostingTotals({
    rawPayload: cbd?.raw_payload,
    lines
  });
  const product = Array.isArray(request.nextgen_products)
    ? request.nextgen_products[0]
    : request.nextgen_products;
  const styleNumber = product?.style_number ?? product?.name ?? null;

  const { error: deleteError } = await supabase
    .from("historical_costings")
    .delete()
    .eq("costing_request_id", requestId);

  if (deleteError) throw deleteError;

  const materialNames = lines
    .filter((line) => !line.section || ["yarn", "fabric", "trim"].includes(String(line.section)))
    .map((line) => line.material_name)
    .filter(Boolean);

  const materialLinesForAvg = lines.filter((line) => {
    const section = String(line.section ?? "").toLowerCase();
    const uom = String(line.uom ?? "").toLowerCase();
    if (["yarn", "fabric", "trim"].includes(section)) return true;
    if (["g", "yards", "piece"].includes(uom)) return true;
    // Fallback for legacy rows without section/uom: exclude knitting/operations by material_name heuristics
    if (section === "knitting" || section === "operations") return false;
    return true;
  });

  const { error: insertError } = await supabase.from("historical_costings").insert({
    costing_request_id: requestId,
    style_number: styleNumber,
    factory_name: request.factory_name,
    total_cost: totals.grandTotal || null,
    currency: totals.currency,
    yarn_type: readText(cbd?.raw_payload, "yarnType"),
    knit_type: readText(cbd?.raw_payload, "knitType"),
    machine_type: readText(cbd?.raw_payload, "machineType"),
    construction: readText(cbd?.raw_payload, "construction"),
    product_category: readText(cbd?.raw_payload, "productCategory"),
    average_consumption: averageConsumption(materialLinesForAvg),
    knitting_time: readNumber(cbd?.raw_payload, "knittingTime"),
    approved_at: new Date().toISOString(),
    searchable_text: [styleNumber, request.factory_name, product?.name, totals.currency, ...materialNames]
      .filter(Boolean)
      .join(" "),
    raw_payload: {
      request,
      latestCbd: cbd,
      totals
    }
  });

  if (insertError) throw insertError;
}

function readText(rawPayload: unknown, key: string) {
  if (!rawPayload || typeof rawPayload !== "object") return null;
  const value = (rawPayload as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNumber(rawPayload: unknown, key: string) {
  if (!rawPayload || typeof rawPayload !== "object") return null;
  const value = (rawPayload as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function averageConsumption(lines: { consumption: number | null }[]) {
  const values = lines.map((line) => line.consumption).filter((value): value is number => typeof value === "number");
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function defaultComment(action: string) {
  switch (action) {
    case "approve":
      return "PBD approved the internal costing";
    case "reject":
      return "PBD rejected costing";
    case "clarify":
      return "PBD requested clarification";
    case "send_to_factory":
      return "Request sent to factory";
    default:
      return null;
  }
}
