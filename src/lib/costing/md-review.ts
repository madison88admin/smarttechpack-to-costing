import type { CostingStatus } from "@/lib/workflow/status";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { recordWorkflowEvent } from "@/lib/workflow/events";
import { enqueueRoleChangeAlert } from "@/lib/notifications/workflow-alerts";

// Pure MD technical review verdicts live below; applyMdReviewDecision performs
// the database work (optimistic lock, approval_actions insert, workflow
// event, next-step alert). Both the md-review route and the structured
// change-requests route apply decisions through it so the audit trail can
// never drift between the two callers.
//
// Workflow order (changed per business requirement): the MD technical review
// runs right after the factory CBD submission and BEFORE costing validation.
//   sent_to_factory -> submit -> for_md_review -> md_review pass ->
//   for_costing_review -> costing_complete -> for_pbd_review -> approve

export type MdReviewDecision = "pass" | "needs_clarification";

/**
 * Validates the MD review request body. Returns an error message, or null when
 * the decision is well-formed. Matches the route's exact-match semantics:
 * `decision` must be exactly "pass" or "needs_clarification" (no trimming),
 * and "needs_clarification" requires non-empty notes.
 */
export function assertMdReviewDecision(decision: string | null | undefined, notes: string): string | null {
  if (decision !== "pass" && decision !== "needs_clarification") {
    return "decision must be pass or needs_clarification";
  }
  if (decision === "needs_clarification" && !notes) {
    return "Notes are required when MD requests clarification";
  }
  return null;
}

/**
 * Maps an MD decision to the resulting request status:
 * - pass → for_costing_review (MD approved the tech check, costing validates next)
 * - needs_clarification → needs_clarification (back to the factory queue)
 */
export function mdReviewTargetStatus(decision: MdReviewDecision): CostingStatus {
  return decision === "needs_clarification" ? "needs_clarification" : "for_costing_review";
}

/**
 * MD review is only available right after the factory CBD submission, before
 * costing validation. Returns an error message, or null when the status is
 * valid.
 */
export function assertMdReviewFromStatus(fromStatus: string): string | null {
  if (fromStatus !== "for_md_review") {
    return `MD review is only available after factory CBD submission (current status: ${fromStatus})`;
  }
  return null;
}

/** Default comment recorded for the MD review action. */
export function mdReviewComment(decision: MdReviewDecision, notes: string): string {
  return notes || "MD review passed";
}

/**
 * Applies an MD decision to a request: validates the from-status, advances it
 * with an optimistic lock, records the approval action + workflow event, and
 * notifies whoever owns the next step. Throws on any failure; callers map the
 * message to an HTTP status (409 for a stale status, 500 otherwise).
 */
export async function applyMdReviewDecision(input: {
  requestId: string;
  decision: MdReviewDecision;
  notes: string;
  role: string;
  userId: string | null;
  userName: string;
  /** Legacy inline change-request blob, kept in the audit trail verbatim. */
  changeRequest?: Record<string, unknown> | null;
}): Promise<{ targetStatus: CostingStatus }> {
  const supabase = createSupabaseServiceClient();
  const now = new Date().toISOString();
  const { data: current, error: currentError } = await supabase
    .from("costing_requests")
    .select("status")
    .eq("id", input.requestId)
    .single();
  if (currentError) throw currentError;
  const statusError = assertMdReviewFromStatus(current.status);
  if (statusError) throw new Error(statusError);

  const targetStatus = mdReviewTargetStatus(input.decision);
  const { data: updatedRows, error: updateError } = await supabase
    .from("costing_requests")
    .update({ status: targetStatus, updated_at: now })
    .eq("id", input.requestId)
    .eq("status", "for_md_review")
    .select("id");
  if (updateError) throw updateError;
  if (!updatedRows?.length) {
    throw new Error("Request changed while MD review was being saved");
  }

  const { error: actionError } = await supabase.from("approval_actions").insert({
    costing_request_id: input.requestId,
    actor_role: input.role,
    actor_name: input.userName,
    actor_user_id: input.userId,
    action: "md_review",
    from_status: "for_md_review",
    to_status: targetStatus,
    comment: mdReviewComment(input.decision, input.notes),
    metadata: {
      decision: input.decision,
      reviewed_by: input.userName,
      ...(input.changeRequest ? { changeRequest: input.changeRequest } : {})
    }
  });
  if (actionError) throw actionError;

  await recordWorkflowEvent(supabase, {
    costingRequestId: input.requestId,
    eventType: "md_review",
    actorRole: input.role,
    actorUserId: input.userId,
    payload: {
      decision: input.decision,
      fromStatus: "for_md_review",
      toStatus: targetStatus,
      notes: input.notes,
      changeRequest: input.changeRequest ?? null
    }
  });

  // Notify the role that owns the NEXT step. Best-effort — a notification
  // failure must never fail the review itself.
  if (input.decision === "pass") {
    // MD passed → costing must validate next.
    await enqueueRoleChangeAlert({
      role: "costing",
      requestId: input.requestId,
      title: "MD technical review passed — costing validation required",
      bodyLines: [
        input.notes ? `Notes: ${input.notes}` : "The technical check passed.",
        "",
        "The factory CBD passed the MD technical review. Complete the costing validation to release it to PBD."
      ],
      alertType: "role_change"
    }).catch(() => {
      // Best-effort — never block the review on notification failures.
    });
  } else {
    // MD requested clarification → back to the factory queue for revision.
    await enqueueRoleChangeAlert({
      role: "factory",
      requestId: input.requestId,
      title: "MD requested clarification — CBD revision required",
      bodyLines: [
        "The MD technical review sent your CBD submission back for correction or revision.",
        input.notes ? `Reason: ${input.notes}` : "Please revise the CBD and resubmit.",
        "",
        "Please update the cost breakdown and resubmit."
      ],
      alertType: "role_change"
    }).catch(() => {
      // Best-effort — never block the review on notification failures.
    });
  }

  return { targetStatus };
}
