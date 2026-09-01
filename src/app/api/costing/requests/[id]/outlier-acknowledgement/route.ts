import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { canRunCostingAction, getCurrentRole, getCurrentUserName } from "@/lib/auth/roles";
import { validateRequestId } from "@/lib/api/validate";
import { getOutlierReview, isHighRisk } from "@/lib/costing/outlier-review";
import { enqueueRoleChangeAlert, outlierAcknowledgedAlertBody } from "@/lib/notifications/workflow-alerts";

// POST /api/costing/requests/[id]/outlier-acknowledgement
// Costing Team records that the high-risk outlier flags (consumption/knitting
// time vs benchmark, cost variance vs history) have been reviewed and are
// accepted with justification. This is what unblocks the PBD approval gate.
// The action lands in approval_actions (audit trail) with a snapshot of the
// flags, and is invalidated automatically when the factory revises the CBD.
export async function POST(request: Request, context: { params: { id: string } }) {
  const idError = validateRequestId(context.params.id);
  if (idError) return idError;

  const role = getCurrentRole();
  if (!canRunCostingAction(role)) {
    return NextResponse.json(
      { ok: false, error: "Costing Team or Admin access required to acknowledge outliers" },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => null);
  const comment = typeof body?.comment === "string" ? body.comment.trim() : "";
  if (comment.length > 2000) {
    return NextResponse.json({ ok: false, error: "Comment must be 2000 characters or fewer" }, { status: 400 });
  }

  const supabase = createSupabaseServiceClient();

  const { review, cbd, flags } = await getOutlierReview(supabase, context.params.id);

  if (!cbd || !isHighRisk(review)) {
    // Nothing blocking right now — acknowledge is a no-op (idempotent).
    return NextResponse.json({ ok: true, acknowledged: false, message: "No active high-risk outliers to acknowledge" });
  }

  const { data: statusRow, error: statusError } = await supabase
    .from("costing_requests")
    .select("status")
    .eq("id", context.params.id)
    .single();

  if (statusError) throw statusError;

  const status = String(statusRow?.status ?? "for_pbd_review");
  const acknowledgedByName = getCurrentUserName();

  const { data: inserted, error: insertError } = await supabase
    .from("approval_actions")
    .insert({
      costing_request_id: context.params.id,
      actor_role: role,
      actor_name: acknowledgedByName === "Guest" ? null : acknowledgedByName,
      action: "outlier_acknowledged",
      from_status: status,
      to_status: status,
      comment: comment || null,
      metadata: {
        flags,
        riskLevel: review.riskLevel,
        acknowledgedAt: new Date().toISOString()
      }
    })
    .select("id, created_at")
    .single();

  if (insertError) throw insertError;

  // Notify PBD in-app (plus email/Teams) that the approval gate was released
  // so the request is ready for their decision. Best-effort — a notification
  // failure must never fail the acknowledgment itself.
  const { subject, body: alertBody } = outlierAcknowledgedAlertBody({
    acknowledgedBy: acknowledgedByName === "Guest" ? null : acknowledgedByName,
    justification: comment || null,
    flags
  });
  await enqueueRoleChangeAlert({
    role: "pbd",
    requestId: context.params.id,
    title: subject,
    bodyLines: alertBody.split("\n"),
    alertType: "outlier_acknowledged"
  }).catch(() => {
    // Best-effort — never block the acknowledgment on notification failures.
  });

  return NextResponse.json({
    ok: true,
    acknowledged: true,
    flags,
    acknowledgment: inserted
  });
}
