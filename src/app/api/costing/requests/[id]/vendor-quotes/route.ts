import { NextResponse } from "next/server";
import { canRunPbdAction, getCurrentRole } from "@/lib/auth/roles";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { validateRequestId } from "@/lib/api/validate";

// GET /api/costing/requests/[id]/vendor-quotes — list all vendor quotes for a request
export async function GET(_request: Request, context: { params: { id: string } }) {
  const idError = validateRequestId(context.params.id);
  if (idError) return idError;

  const role = getCurrentRole();
  if (role === "viewer") {
    return NextResponse.json({ ok: false, error: "Authentication required" }, { status: 401 });
  }

  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("vendor_quotes")
    .select("id, factory_name, status, quote_total, currency, moq, lead_time_days, submitted_at, notes, created_at")
    .eq("costing_request_id", context.params.id)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, data });
}

// POST /api/costing/requests/[id]/vendor-quotes — add a vendor/factory to RFQ
export async function POST(request: Request, context: { params: { id: string } }) {
  const idError = validateRequestId(context.params.id);
  if (idError) return idError;

  const role = getCurrentRole();
  if (!canRunPbdAction(role)) {
    return NextResponse.json({ ok: false, error: "Only PBD or admin can add vendor quotes" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!body?.factoryName) {
    return NextResponse.json({ ok: false, error: "factoryName is required" }, { status: 400 });
  }

  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("vendor_quotes")
    .insert({
      costing_request_id: context.params.id,
      factory_name: String(body.factoryName).trim(),
      status: body.status ?? "pending",
      quote_total: body.quoteTotal ?? null,
      currency: body.currency ?? "USD",
      moq: body.moq ?? null,
      lead_time_days: body.leadTimeDays ?? null,
      notes: body.notes ?? null
    })
    .select("id, factory_name, status, quote_total, currency, moq, lead_time_days, created_at")
    .single();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, data }, { status: 201 });
}

// PUT /api/costing/requests/[id]/vendor-quotes — update a quote (e.g., submit quote amount)
export async function PUT(request: Request, context: { params: { id: string } }) {
  const idError = validateRequestId(context.params.id);
  if (idError) return idError;

  const body = await request.json().catch(() => null);
  if (!body?.quoteId) {
    return NextResponse.json({ ok: false, error: "quoteId is required" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (typeof body.quoteTotal === "number" || typeof body.quoteTotal === "string") updates.quote_total = body.quoteTotal;
  if (body.currency) updates.currency = String(body.currency);
  if (typeof body.moq === "number" || typeof body.moq === "string") updates.moq = body.moq;
  if (typeof body.leadTimeDays === "number" || typeof body.leadTimeDays === "string") updates.lead_time_days = body.leadTimeDays;
  if (typeof body.notes === "string") updates.notes = body.notes;
  if (body.status) {
    updates.status = String(body.status);
    if (body.status === "submitted") updates.submitted_at = new Date().toISOString();
  }

  const supabase = createSupabaseServiceClient();
  const { error } = await supabase
    .from("vendor_quotes")
    .update(updates)
    .eq("id", String(body.quoteId))
    .eq("costing_request_id", context.params.id);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

// DELETE /api/costing/requests/[id]/vendor-quotes?id=xxx — remove a vendor quote
export async function DELETE(request: Request, context: { params: { id: string } }) {
  const idError = validateRequestId(context.params.id);
  if (idError) return idError;

  const role = getCurrentRole();
  if (!canRunPbdAction(role)) {
    return NextResponse.json({ ok: false, error: "Only PBD or admin can delete vendor quotes" }, { status: 403 });
  }

  const url = new URL(request.url);
  const quoteId = url.searchParams.get("id");
  if (!quoteId) {
    return NextResponse.json({ ok: false, error: "Quote id is required" }, { status: 400 });
  }

  const supabase = createSupabaseServiceClient();
  const { error } = await supabase
    .from("vendor_quotes")
    .delete()
    .eq("id", quoteId)
    .eq("costing_request_id", context.params.id);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
