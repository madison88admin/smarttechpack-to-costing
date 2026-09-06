import { NextResponse } from "next/server";
import { canRunMdAction, getCurrentRole, getCurrentUserId, getCurrentUserName } from "@/lib/auth/roles";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { recordWorkflowEvent } from "@/lib/workflow/events";
import { validateRequestId } from "@/lib/api/validate";
import { assertMdReviewDecision, assertMdReviewFromStatus, mdReviewComment, mdReviewTargetStatus, type MdReviewDecision } from "@/lib/costing/md-review";
import { enqueueRoleChangeAlert } from "@/lib/notifications/workflow-alerts";

export async function POST(request: Request, context: { params: { id: string } }) {
  const idError = validateRequestId(context.params.id);
  if (idError) return idError;

  const role = getCurrentRole();
  if (!canRunMdAction(role)) {
    return NextResponse.json({ ok: false, error: "MD or admin access required" }, { status: 403 });
  }

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const decision = typeof body?.decision === "string" ? body.decision : null;
  const notes = typeof body?.notes === "string" ? body.notes.trim().slice(0, 2000) : "";
  const decisionError = assertMdReviewDecision(decision, notes);
  if (decisionError) {
    return NextResponse.json({ ok: false, error: decisionError }, { status: 400 });
  }
  const validDecision = decision as MdReviewDecision;

  const supabase = createSupabaseServiceClient();
  const userId = getCurrentUserId();
  const userName = getCurrentUserName();
  const now = new Date().toISOString();
  const { data: current, error: currentError } = await supabase
    .from("costing_requests")
    .select("status")
    .eq("id", context.params.id)
    .single();
  if (currentError) {
    // PGRST116: well-formed id that does not exist → 404, never a 500.
    const status =
      currentError.message.includes("JSON object requested") ||
      currentError.message.includes("single JSON object")
        ? 404
        : 500;
    return NextResponse.json({ ok: false, error: currentError.message }, { status });
  }
  const statusError = assertMdReviewFromStatus(current.status);
  if (statusError) {
    return NextResponse.json({ ok: false, error: statusError }, { status: 409 });
  }

  const targetStatus = mdReviewTargetStatus(validDecision);
  const { data: updatedRows, error: updateError } = await supabase
    .from("costing_requests")
    .update({ status: targetStatus, updated_at: now })
    .eq("id", context.params.id)
    .eq("status", "for_md_review")
    .select("id");
  if (updateError) return NextResponse.json({ ok: false, error: updateError.message }, { status: 500 });
  if (!updatedRows?.length) return NextResponse.json({ ok: false, error: "Request changed while MD review was being saved" }, { status: 409 });

  const { error: actionError } = await supabase.from("approval_actions").insert({
    costing_request_id: context.params.id,
    actor_role: role,
    actor_name: userName,
    actor_user_id: userId,
    action: "md_review",
    from_status: "for_md_review",
    to_status: targetStatus,
    comment: mdReviewComment(validDecision, notes),
    metadata: { decision: validDecision, reviewed_by: userName }
  });
  if (actionError) return NextResponse.json({ ok: false, error: actionError.message }, { status: 500 });

  await recordWorkflowEvent(supabase, {
    costingRequestId: context.params.id,
    eventType: "md_review",
    actorRole: role,
    actorUserId: userId,
    payload: { decision: validDecision, fromStatus: "for_md_review", toStatus: targetStatus, notes }
  });

  // Notify the role that owns the NEXT step. Best-effort — a notification
  // failure must never fail the review itself.
  if (validDecision === "pass") {
    // MD passed → costing must validate next.
    await enqueueRoleChangeAlert({
      role: "costing",
      requestId: context.params.id,
      title: "MD technical review passed — costing validation required",
      bodyLines: [
        notes ? `Notes: ${notes}` : "The technical check passed.",
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
      requestId: context.params.id,
      title: "MD requested clarification — CBD revision required",
      bodyLines: [
        "The MD technical review sent your CBD submission back for correction or revision.",
        notes ? `Reason: ${notes}` : "Please revise the CBD and resubmit.",
        "",
        "Please update the cost breakdown and resubmit."
      ],
      alertType: "role_change"
    }).catch(() => {
      // Best-effort — never block the review on notification failures.
    });
  }

  return NextResponse.json({ ok: true, decision: validDecision, status: targetStatus });
}
