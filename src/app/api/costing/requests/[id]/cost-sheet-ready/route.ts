import { NextResponse } from "next/server";
import { canRunCostingAction, getCurrentRole } from "@/lib/auth/roles";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { validateRequestId } from "@/lib/api/validate";
import { assertCostSheetReadyGate, resolveCostSheetReadyUpdates } from "@/lib/costing/cost-sheet";

// POST /api/costing/requests/[id]/cost-sheet-ready
// Marks an approved costing as "ready for NextGen cost sheet preparation"
// Post-approval step — owned by Costing Team (not PBD)
export async function POST(request: Request, context: { params: { id: string } }) {
  const idError = validateRequestId(context.params.id);
  if (idError) return idError;

  const role = getCurrentRole();

  if (!canRunCostingAction(role)) {
    return NextResponse.json(
      { ok: false, error: "Only Costing Team or admin can mark cost sheet as ready" },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const ready = body.ready !== false;

  const supabase = createSupabaseServiceClient();

  // Verify the request is approved
  const { data: req, error: reqError } = await supabase
    .from("costing_requests")
    .select("id, status")
    .eq("id", context.params.id)
    .single();

  if (reqError || !req) {
    return NextResponse.json({ ok: false, error: "Request not found" }, { status: 404 });
  }

  const gateError = assertCostSheetReadyGate(req.status, ready);
  if (gateError) {
    return NextResponse.json(
      { ok: false, error: gateError },
      { status: 400 }
    );
  }

  const updates = resolveCostSheetReadyUpdates(ready, new Date().toISOString(), role);

  const { error: updateError } = await supabase
    .from("costing_requests")
    .update(updates)
    .eq("id", context.params.id);

  if (updateError) {
    return NextResponse.json({ ok: false, error: updateError.message }, { status: 500 });
  }

  // Log as workflow event
  await supabase.from("workflow_events").insert({
    costing_request_id: context.params.id,
    event_type: ready ? "cost_sheet_ready" : "cost_sheet_not_ready",
    actor_role: role,
    payload: { ready },
    notification_status: "queued"
  });

  return NextResponse.json({ ok: true, ready });
}
