import { NextResponse } from "next/server";
import { canRunPbdAction, getCurrentRole, getCurrentUserId, getCurrentUserName } from "@/lib/auth/roles";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { recordWorkflowEvent } from "@/lib/workflow/events";
import { validateRequestId } from "@/lib/api/validate";
import { enqueueChangeAlert, pbdPricingAlertBody } from "@/lib/notifications/workflow-alerts";

function optionalNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

export async function GET(_request: Request, context: { params: { id: string } }) {
  const idError = validateRequestId(context.params.id);
  if (idError) return idError;

  const role = getCurrentRole();
  if (role === "viewer") {
    return NextResponse.json({ ok: false, error: "Authentication required" }, { status: 401 });
  }
  // Selling-price is PBD-owned internal data — the factory supplies the cost
  // basis but never sees the customer-facing pricing.
  if (role === "factory") {
    return NextResponse.json({ ok: false, error: "Factory cannot view PBD pricing" }, { status: 403 });
  }

  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("costing_requests")
    .select("pbd_pricing,pbd_pricing_status,pbd_pricing_updated_at,pbd_pricing_updated_by")
    .eq("id", context.params.id)
    .single();

  if (error) {
    const status = error.message.includes("pbd_pricing") ? 503 : 500;
    return NextResponse.json({ ok: false, error: status === 503 ? "Database migration 002_approval_workflow_alignment.sql is required" : error.message }, { status });
  }
  return NextResponse.json({ ok: true, data });
}

export async function POST(request: Request, context: { params: { id: string } }) {
  const idError = validateRequestId(context.params.id);
  if (idError) return idError;

  const role = getCurrentRole();
  if (!canRunPbdAction(role)) {
    return NextResponse.json({ ok: false, error: "PBD or admin access required" }, { status: 403 });
  }

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const wholesalePrice = optionalNumber(body?.wholesalePrice);
  const retailPrice = optionalNumber(body?.retailPrice);
  const wholesaleMarkup = optionalNumber(body?.wholesaleMarkup);
  const retailMarkup = optionalNumber(body?.retailMarkup);

  if ([wholesalePrice, retailPrice, wholesaleMarkup, retailMarkup].some((value) => value === undefined)) {
    return NextResponse.json({ ok: false, error: "Pricing values must be non-negative numbers" }, { status: 400 });
  }

  const now = new Date().toISOString();
  const userId = getCurrentUserId();
  const pricing = {
    currency: typeof body?.currency === "string" && body.currency.trim() ? body.currency.trim().slice(0, 10) : "USD",
    wholesalePrice,
    retailPrice,
    wholesaleMarkup,
    retailMarkup,
    notes: typeof body?.notes === "string" ? body.notes.trim().slice(0, 2000) : null
  };

  const supabase = createSupabaseServiceClient();
  // Read the previous pricing first so the change alert can show old → new
  // instead of only the new figures. Best-effort: a missed read degrades to
  // the original single-value lines.
  const { data: previous } = await supabase
    .from("costing_requests")
    .select("pbd_pricing")
    .eq("id", context.params.id)
    .maybeSingle();
  const prevPricing = (previous?.pbd_pricing ?? {}) as Record<string, unknown>;
  const prevNumber = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) ? value : null;
  const { data: updated, error } = await supabase
    .from("costing_requests")
    .update({
      pbd_pricing: pricing,
      pbd_pricing_status: "entered",
      pbd_pricing_updated_at: now,
      pbd_pricing_updated_by: userId,
      updated_at: now
    })
    .eq("id", context.params.id)
    .in("status", ["for_pbd_review"])
    .select("id,request_number,factory_name,pbd_pricing,pbd_pricing_status,pbd_pricing_updated_at")
    .maybeSingle();

  if (error) {
    const status = error.message.includes("pbd_pricing") ? 503 : 500;
    return NextResponse.json({ ok: false, error: status === 503 ? "Database migration 002_approval_workflow_alignment.sql is required" : error.message }, { status });
  }
  if (!updated) {
    return NextResponse.json({ ok: false, error: "Pricing can only be entered during PBD or Manager review" }, { status: 409 });
  }

  await recordWorkflowEvent(supabase, {
    costingRequestId: context.params.id,
    eventType: "pbd_pricing_updated",
    actorRole: role,
    actorUserId: userId,
    payload: { pricing, actorName: getCurrentUserName() }
  });

  // Notify costing whenever PBD changes anything in the costing review.
  const requestNumber = typeof updated.request_number === "string" ? updated.request_number : null;
  const factoryName = typeof updated.factory_name === "string" ? updated.factory_name : null;
  const alert = pbdPricingAlertBody({
    requestNumber,
    factoryName,
    wholesalePrice: wholesalePrice ?? null,
    retailPrice: retailPrice ?? null,
    currency: pricing.currency,
    changedBy: getCurrentUserName(),
    wholesaleBefore: prevNumber(prevPricing.wholesalePrice),
    retailBefore: prevNumber(prevPricing.retailPrice)
  });
  await enqueueChangeAlert({
    recipientRole: "costing",
    requestId: context.params.id,
    requestNumber,
    factoryName,
    subject: alert.subject,
    body: alert.body,
    kind: "pbd_pricing_updated"
  }).catch(() => {
    // Best-effort — never block the pricing save on notification failures.
  });

  return NextResponse.json({ ok: true, data: updated });
}
