import type { CostingStatus } from "@/lib/workflow/status";

// Pure MD technical review logic (no I/O). The route in
// src/app/api/costing/requests/[id]/md-review/route.ts applies these verdicts
// and then performs the database work (optimistic lock, approval_actions
// insert, workflow event).
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
