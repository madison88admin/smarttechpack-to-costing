import { NextResponse } from "next/server";
import { saveChecklistResults } from "@/lib/costing/checklist";
import { validateRequestId } from "@/lib/api/validate";
import { canRunCostingAction, getCurrentRole } from "@/lib/auth/roles";

export async function POST(request: Request, context: { params: { id: string } }) {
  const idError = validateRequestId(context.params.id);
  if (idError) return idError;

  const role = getCurrentRole();
  // The checklist IS the Costing validation step, so it carries the same
  // separation of duties as the rest of the lane: Costing team or admin tier
  // only. Gating on "not viewer" let PBD and MD write costing verdicts.
  if (!canRunCostingAction(role)) {
    return NextResponse.json(
      { ok: false, error: "Costing Team or Admin role required to save the costing checklist" },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => null);

  if (!Array.isArray(body?.items)) {
    return NextResponse.json({ ok: false, error: "items are required" }, { status: 400 });
  }

  try {
    const data = await saveChecklistResults(context.params.id, body.items, role);
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unable to save checklist" },
      { status: 500 }
    );
  }
}
