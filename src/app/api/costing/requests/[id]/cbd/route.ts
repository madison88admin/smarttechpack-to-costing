import { NextResponse } from "next/server";
import { canSubmitFactoryCbd, getCurrentRole, getCurrentUserId } from "@/lib/auth/roles";
import { submitFactoryCbd } from "@/lib/costing/cbd";
import { badRequest } from "@/lib/api/response";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { validateBody, cbdSubmitSchema, validateRequestId } from "@/lib/api/validate";
import { factoryOwnsRequest } from "@/lib/admin/assignments";

async function factoryAccessDenied(role: ReturnType<typeof getCurrentRole>, requestId: string) {
  return role === "factory" && !(await factoryOwnsRequest(getCurrentUserId(), requestId));
}

export async function GET(_: Request, context: { params: { id: string } }) {
  const idError = validateRequestId(context.params.id);
  if (idError) return idError;

  const role = getCurrentRole();
  if (await factoryAccessDenied(role, context.params.id)) {
    return NextResponse.json({ ok: false, error: "Request is not assigned to this Factory user" }, { status: 403 });
  }

  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("factory_cbds")
    .select("id, status, submitted_at, raw_payload, cbd_material_lines (id, bom_line_id, material_name, consumption, uom, unit_cost, total_cost, currency)")
    .eq("costing_request_id", context.params.id)
    .order("submitted_at", { ascending: false, nullsFirst: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ ok: false, error: "No CBD found" }, { status: 404 });
  return NextResponse.json({ ok: true, data });
}

export async function POST(request: Request, context: { params: { id: string } }) {
  const idError = validateRequestId(context.params.id);
  if (idError) return idError;

  const role = getCurrentRole();

  if (!canSubmitFactoryCbd(role)) {
    return NextResponse.json({ ok: false, error: "Current role cannot save factory CBD" }, { status: 403 });
  }
  if (await factoryAccessDenied(role, context.params.id)) {
    return NextResponse.json({ ok: false, error: "Request is not assigned to this Factory user" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const validation = validateBody(cbdSubmitSchema, body);
  if (!validation.success) return validation.response;
  const v = validation.data;

  try {
    const data = await submitFactoryCbd({
      costingRequestId: context.params.id,
      submittedBy: getCurrentUserId(),
      status: v.status === "submitted" ? "submitted" : "draft",
      currency: v.currency,
      // Header info (Excel template)
      customer: v.customer,
      season: v.season,
      styleNumber: v.styleNumber,
      styleName: v.styleName,
      costedQty: v.costedQty,
      leadTimeDays: v.leadTimeDays,
      finishWeight: v.finishWeight,
      protoVersion: v.protoVersion,
      // Structured line items (Excel template)
      yarnLines: v.yarnLines,
      fabricLines: v.fabricLines,
      trimLines: v.trimLines,
      knittingLines: v.knittingLines,
      operationsLines: v.operationsLines,
      standardPackagingCost: v.standardPackagingCost,
      specialPackagingCost: v.specialPackagingCost,
      profitCost: v.profitCost,
      yarnNotes: v.yarnNotes,
      operationsNotes: v.operationsNotes,
      packagingNotes: v.packagingNotes,
      overheadNotes: v.overheadNotes,
      // Legacy fields
      laborCost: v.laborCost,
      overheadCost: v.overheadCost,
      profitMargin: v.profitMargin,
      moq: v.moq,
      materialBufferPercent: v.materialBufferPercent,
      packagingCost: v.packagingCost,
      testingCost: v.testingCost,
      brandNominatedItems: v.brandNominatedItems,
      m88Packaging: v.m88Packaging,
      yarnType: v.yarnType,
      knitType: v.knitType,
      machineType: v.machineType,
      construction: v.construction,
      knittingTime: v.knittingTime,
      productCategory: v.productCategory,
      costingLearning: v.costingLearning,
      recurringIssueTags: v.recurringIssueTags,
      notes: v.notes,
      freightCost: v.freightCost,
      dutyRate: v.dutyRate,
      insuranceCost: v.insuranceCost,
      customsClearanceCost: v.customsClearanceCost,
      inlandTransportCost: v.inlandTransportCost,
      // Selling-price markups are PBD-owned and must be entered through the
      // pricing review endpoint, not through a factory CBD submission.
      lines: v.lines
    });

    return NextResponse.json({ ok: true, data }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save CBD";
    // 409 = the request is not in a submittable status (transition gate) or a
    // concurrent submit won the optimistic lock — the client should refresh.
    const status =
      message.includes("not allowed from status") ||
      message.includes("cannot submit CBD from status") ||
      message.includes("request status changed")
        ? 409
        : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
