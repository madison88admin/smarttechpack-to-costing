import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { pgrestValue } from "@/lib/supabase/filters";
import { validateRequestId } from "@/lib/api/validate";
import { csvResponse, toCsv } from "@/lib/export/csv";
import { canDownloadRequestExports, getCurrentRole } from "@/lib/auth/roles";
import { getStatusesForRoles } from "@/lib/costing/requests";

// GET /api/export/cbd-detail.csv?requestId=xxx
// Exports full CBD detail (material lines + costs + construction) for a single request
// If no requestId provided, exports all CBDs with their material lines
export async function GET(request: Request) {
  const role = getCurrentRole();
  if (!canDownloadRequestExports(role)) {
    return new Response("Unauthorized", { status: 401 });
  }
  const supabase = createSupabaseServiceClient();
  const url = new URL(request.url);
  const requestId = url.searchParams.get("requestId");

  let query = supabase
    .from("factory_cbds")
    .select(
      `
      id,
      status,
      submitted_at,
      submitted_by,
      raw_payload,
      costing_request_id,
      cbd_material_lines (
        id,
        material_name,
        consumption,
        uom,
        unit_cost,
        currency
      )
    `
    )
    .order("submitted_at", { ascending: false })
    .limit(200);

  if (requestId) {
    // Reject non-UUID values up front — a hostile requestId would otherwise
    // fail Postgres' uuid cast and surface as a 500 instead of a 400.
    const idError = validateRequestId(requestId);
    if (idError) return idError;
    query = query.eq("costing_request_id", pgrestValue(requestId));
  }

  // Role visibility: CBD detail must never leak requests the caller cannot see
  // in the UI (e.g. a factory dumping every factory's cost breakdowns). Restrict
  // to the caller's visible request statuses; for admin/superadmin this is a
  // no-op since they see every status.
  const visibleStatuses = getStatusesForRoles([role]);
  const { data: visibleRequests, error: visibleError } = await supabase
    .from("costing_requests")
    .select("id")
    .in("status", visibleStatuses);
  if (visibleError) {
    return NextResponse.json({ ok: false, error: visibleError.message }, { status: 500 });
  }
  const visibleIds = (visibleRequests ?? []).map((request) => request.id);
  query = query.in(
    "costing_request_id",
    visibleIds.length ? visibleIds : ["00000000-0000-0000-0000-000000000000"]
  );

  const { data: cbds, error } = await query;

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  // Fetch request + product info for context
  const requestIds = [...new Set((cbds ?? []).map((c: any) => c.costing_request_id).filter(Boolean))];
  const { data: requests } = await supabase
    .from("costing_requests")
    .select("id, request_number, factory_name, status, nextgen_products (style_number, name)")
    .in("id", requestIds as string[]);

  const requestMap = new Map<string, any>();
  for (const req of (requests ?? []) as any[]) {
    const product = Array.isArray(req.nextgen_products) ? req.nextgen_products[0] : req.nextgen_products;
    requestMap.set(req.id, {
      request_number: req.request_number,
      factory_name: req.factory_name,
      status: req.status,
      style_number: product?.style_number ?? null,
      product_name: product?.name ?? null
    });
  }

  // Build flat rows: one row per material line, with CBD header data repeated
  const rows: Record<string, unknown>[] = [];

  for (const cbd of (cbds ?? []) as any[]) {
    const payload = (cbd.raw_payload ?? {}) as Record<string, unknown>;
    const reqInfo = cbd.costing_request_id ? requestMap.get(cbd.costing_request_id) : null;
    const materialLines = (cbd.cbd_material_lines ?? []) as any[];

    const headerData = {
      request_number: reqInfo?.request_number ?? "",
      style_number: reqInfo?.style_number ?? "",
      product_name: reqInfo?.product_name ?? "",
      factory_name: reqInfo?.factory_name ?? "",
      request_status: reqInfo?.status ?? "",
      cbd_status: cbd.status,
      submitted_at: cbd.submitted_at,
      currency: String(payload.currency ?? "USD"),
      moq: payload.moq ?? "",
      lead_time_days: payload.leadTimeDays ?? "",
      labor_cost: payload.laborCost ?? "",
      overhead_cost: payload.overheadCost ?? "",
      profit_margin_pct: payload.profitMargin ?? "",
      material_buffer_pct: payload.materialBufferPercent ?? "",
      packaging_cost: payload.packagingCost ?? "",
      testing_cost: payload.testingCost ?? "",
      knitting_time: payload.knittingTime ?? "",
      yarn_type: payload.yarnType ?? "",
      knit_type: payload.knitType ?? "",
      machine_type: payload.machineType ?? "",
      construction: payload.construction ?? "",
      product_category: payload.productCategory ?? "",
      m88_packaging: payload.m88Packaging ?? "",
      brand_nominated_items: payload.brandNominatedItems ?? "",
      factory_notes: payload.notes ?? "",
      costing_learning: payload.costingLearning ?? "",
      recurring_issue_tags: payload.recurringIssueTags ?? ""
    };

    if (materialLines.length === 0) {
      rows.push({
        ...headerData,
        material_name: "",
        consumption: "",
        uom: "",
        unit_cost: "",
        line_total: ""
      });
    } else {
      for (const line of materialLines) {
        const consumption = typeof line.consumption === "number" ? line.consumption : 0;
        const unitCost = typeof line.unit_cost === "number" ? line.unit_cost : 0;
        rows.push({
          ...headerData,
          material_name: line.material_name ?? "",
          consumption: line.consumption ?? "",
          uom: line.uom ?? "",
          unit_cost: line.unit_cost ?? "",
          line_total: (consumption * unitCost).toFixed(4)
        });
      }
    }
  }

  const headers = [
    "request_number",
    "style_number",
    "product_name",
    "factory_name",
    "request_status",
    "cbd_status",
    "submitted_at",
    "currency",
    "moq",
    "lead_time_days",
    "labor_cost",
    "overhead_cost",
    "profit_margin_pct",
    "material_buffer_pct",
    "packaging_cost",
    "testing_cost",
    "knitting_time",
    "yarn_type",
    "knit_type",
    "machine_type",
    "construction",
    "product_category",
    "m88_packaging",
    "brand_nominated_items",
    "factory_notes",
    "costing_learning",
    "recurring_issue_tags",
    "material_name",
    "consumption",
    "uom",
    "unit_cost",
    "line_total"
  ];

  const csv = toCsv(rows, headers);
  const filename = requestId
    ? `tp-cbd-detail-${requestId}-${dateStamp()}.csv`
    : `tp-cbd-detail-all-${dateStamp()}.csv`;

  return csvResponse(filename, csv);
}

function dateStamp() {
  return new Date().toISOString().slice(0, 10);
}
