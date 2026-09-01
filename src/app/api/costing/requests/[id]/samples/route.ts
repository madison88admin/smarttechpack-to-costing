import { NextResponse } from "next/server";
import { canRunPbdAction, getCurrentRole } from "@/lib/auth/roles";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { validateRequestId } from "@/lib/api/validate";

// GET /api/costing/requests/[id]/samples — list samples
export async function GET(_request: Request, context: { params: { id: string } }) {
  const idError = validateRequestId(context.params.id);
  if (idError) return idError;

  const role = getCurrentRole();
  if (role === "viewer") {
    return NextResponse.json({ ok: false, error: "Authentication required" }, { status: 401 });
  }

  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("sample_tracking")
    .select("id, sample_type, status, size, color, quantity, sent_date, received_date, factory_notes, pbd_notes, created_at")
    .eq("costing_request_id", context.params.id)
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, data });
}

// POST /api/costing/requests/[id]/samples — add a sample
export async function POST(request: Request, context: { params: { id: string } }) {
  const idError = validateRequestId(context.params.id);
  if (idError) return idError;

  if (!canRunPbdAction(getCurrentRole())) {
    return NextResponse.json({ ok: false, error: "PBD or admin access required" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!body?.sampleType) {
    return NextResponse.json({ ok: false, error: "sampleType is required" }, { status: 400 });
  }

  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("sample_tracking")
    .insert({
      costing_request_id: context.params.id,
      sample_type: String(body.sampleType),
      status: body.status ?? "requested",
      size: body.size ?? null,
      color: body.color ?? null,
      quantity: body.quantity ?? 1,
      sent_date: body.sentDate ?? null,
      received_date: body.receivedDate ?? null,
      factory_notes: body.factoryNotes ?? null,
      pbd_notes: body.pbdNotes ?? null
    })
    .select("id, sample_type, status, size, color, quantity, sent_date, received_date, factory_notes, pbd_notes")
    .single();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, data }, { status: 201 });
}

// PUT /api/costing/requests/[id]/samples — update a sample
export async function PUT(request: Request, context: { params: { id: string } }) {
  const idError = validateRequestId(context.params.id);
  if (idError) return idError;

  const body = await request.json().catch(() => null);
  if (!body?.sampleId) {
    return NextResponse.json({ ok: false, error: "sampleId is required" }, { status: 400 });
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.status) updates.status = String(body.status);
  if (body.size !== undefined) updates.size = body.size;
  if (body.color !== undefined) updates.color = body.color;
  if (body.quantity !== undefined) updates.quantity = body.quantity;
  if (body.sentDate !== undefined) updates.sent_date = body.sentDate;
  if (body.receivedDate !== undefined) updates.received_date = body.receivedDate;
  if (body.factoryNotes !== undefined) updates.factory_notes = body.factoryNotes;
  if (body.pbdNotes !== undefined) updates.pbd_notes = body.pbdNotes;

  const supabase = createSupabaseServiceClient();
  const { error } = await supabase
    .from("sample_tracking")
    .update(updates)
    .eq("id", String(body.sampleId))
    .eq("costing_request_id", context.params.id);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
