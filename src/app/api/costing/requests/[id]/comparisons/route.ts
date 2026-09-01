import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { canReviewCbd, getCurrentRole } from "@/lib/auth/roles";
import { validateRequestId } from "@/lib/api/validate";

const VALID_DECISIONS = new Set(["reviewed", "acceptable", "variance_noted", "rejected_comparison"]);

export async function GET(_request: Request, context: { params: { id: string } }) {
  const idError = validateRequestId(context.params.id);
  if (idError) return idError;

  const supabase = createSupabaseServiceClient();

  const { data, error } = await supabase
    .from("style_comparisons")
    .select(
      `
      id,
      compared_style_number,
      decision,
      notes,
      recorded_by_role,
      created_at,
      compared_historical_id
    `
    )
    .eq("costing_request_id", context.params.id)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, data });
}

export async function POST(request: Request, context: { params: { id: string } }) {
  const idError = validateRequestId(context.params.id);
  if (idError) return idError;

  const role = getCurrentRole();

  if (!canReviewCbd(role)) {
    return NextResponse.json(
      { ok: false, error: "Current role cannot record style comparisons" },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => null);
  const decision = String(body?.decision ?? "reviewed");
  const notes = typeof body?.notes === "string" ? body.notes.trim() : null;
  const comparedStyleNumber = typeof body?.comparedStyleNumber === "string" ? body.comparedStyleNumber : null;
  const comparedHistoricalId = typeof body?.comparedHistoricalId === "string" ? body.comparedHistoricalId : null;

  if (!VALID_DECISIONS.has(decision)) {
    return NextResponse.json({ ok: false, error: "Invalid decision value" }, { status: 400 });
  }

  const supabase = createSupabaseServiceClient();

  const { data, error } = await supabase
    .from("style_comparisons")
    .insert({
      costing_request_id: context.params.id,
      compared_historical_id: comparedHistoricalId,
      compared_style_number: comparedStyleNumber,
      decision,
      notes,
      recorded_by_role: role
    })
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id: data.id });
}
