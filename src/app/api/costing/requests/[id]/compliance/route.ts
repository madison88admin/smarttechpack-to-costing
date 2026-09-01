import { NextResponse } from "next/server";
import { canRunCostingAction, getCurrentRole } from "@/lib/auth/roles";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { validateRequestId } from "@/lib/api/validate";

// GET /api/costing/requests/[id]/compliance — list compliance checks
export async function GET(_request: Request, context: { params: { id: string } }) {
  const idError = validateRequestId(context.params.id);
  if (idError) return idError;

  const role = getCurrentRole();
  if (role === "viewer") {
    return NextResponse.json({ ok: false, error: "Authentication required" }, { status: 401 });
  }

  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("compliance_checks")
    .select("id, check_type, status, details, checked_at, checked_by, notes, created_at")
    .eq("costing_request_id", context.params.id)
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, data });
}

// POST /api/costing/requests/[id]/compliance — add or update a compliance check
export async function POST(request: Request, context: { params: { id: string } }) {
  const idError = validateRequestId(context.params.id);
  if (idError) return idError;

  if (!canRunCostingAction(getCurrentRole())) {
    return NextResponse.json({ ok: false, error: "Costing or admin access required" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!body?.checkType) {
    return NextResponse.json({ ok: false, error: "checkType is required" }, { status: 400 });
  }

  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("compliance_checks")
    .insert({
      costing_request_id: context.params.id,
      check_type: String(body.checkType),
      status: body.status ?? "pending",
      details: body.details ?? {},
      checked_at: body.status === "passed" || body.status === "failed" ? new Date().toISOString() : null,
      checked_by: body.checkedBy ?? null,
      notes: body.notes ?? null
    })
    .select("id, check_type, status, details, checked_at, notes")
    .single();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, data }, { status: 201 });
}
