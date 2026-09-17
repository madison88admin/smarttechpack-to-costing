import { NextResponse } from "next/server";
import { canRunMdAction, getCurrentRole, getCurrentUserId, getCurrentUserName } from "@/lib/auth/roles";
import { validateRequestId } from "@/lib/api/validate";
import { applyMdReviewDecision, assertMdReviewDecision, type MdReviewDecision } from "@/lib/costing/md-review";

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
  const changeRequest = body?.changeRequest && typeof body.changeRequest === "object" ? body.changeRequest : null;
  const decisionError = assertMdReviewDecision(decision, notes);
  if (decisionError) {
    return NextResponse.json({ ok: false, error: decisionError }, { status: 400 });
  }
  const validDecision = decision as MdReviewDecision;

  try {
    const { targetStatus } = await applyMdReviewDecision({
      requestId: context.params.id,
      decision: validDecision,
      notes,
      role,
      userId: getCurrentUserId(),
      userName: getCurrentUserName(),
      changeRequest: changeRequest as Record<string, unknown> | null
    });
    return NextResponse.json({ ok: true, decision: validDecision, status: targetStatus });
  } catch (error) {
    const message = error instanceof Error ? error.message : "MD review failed";
    // PGRST116: well-formed id that does not exist → 404, never a 500.
    const status =
      message.includes("JSON object requested") || message.includes("single JSON object")
        ? 404
        : message.includes("only available after factory CBD submission") ||
            message.includes("changed while MD review")
          ? 409
          : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
