import { NextResponse } from "next/server";
import { createCostingRequest, listCostingRequests } from "@/lib/costing/requests";
import { badRequest } from "@/lib/api/response";
import { canCreateRequest, getCurrentRole } from "@/lib/auth/roles";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { validateBody, createRequestSchema } from "@/lib/api/validate";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const checkDup = url.searchParams.get("checkDuplicate");

  // Duplicate check mode: GET /api/costing/requests?checkDuplicate=1&styleNumber=xxx&factoryName=yyy
  if (checkDup === "1") {
    const styleNumber = url.searchParams.get("styleNumber")?.trim();
    const factoryName = url.searchParams.get("factoryName")?.trim();

    if (!styleNumber) return NextResponse.json({ ok: false, error: "styleNumber required" }, { status: 400 });

    const supabase = createSupabaseServiceClient();
    const { data, error } = await supabase
      .from("costing_requests")
      .select("id, request_number, status, factory_name, created_at, nextgen_products (style_number)")
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

    const duplicates = (data ?? []).filter((row: any) => {
      const product = Array.isArray(row.nextgen_products) ? row.nextgen_products[0] : row.nextgen_products;
      const styleMatch = product?.style_number?.toLowerCase() === styleNumber.toLowerCase();
      if (!styleMatch) return false;
      if (!factoryName) return true;
      return row.factory_name?.toLowerCase() === factoryName.toLowerCase();
    });

    return NextResponse.json({ ok: true, duplicates, count: duplicates.length });
  }

  try {
    const query = url.searchParams.get("q")?.trim() || undefined;
    const status = url.searchParams.get("status") || undefined;
    const limit = parseInt(url.searchParams.get("limit") ?? "1000", 10) || 1000;
    const offset = parseInt(url.searchParams.get("offset") ?? "0", 10) || 0;
    const role = getCurrentRole();

    const result = await listCostingRequests({
      query,
      status: status && status !== "all" ? status : undefined,
      limit,
      offset,
      roles: [role]
    });
    return NextResponse.json({ ok: true, data: result.data, total: result.total });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unable to list requests" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  if (!canCreateRequest(getCurrentRole())) {
    return NextResponse.json({ ok: false, error: "Current role cannot create costing requests" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const validation = validateBody(createRequestSchema, body);
  if (!validation.success) return validation.response;
  const validated = validation.data;

  // Duplicate detection: check if there's already an active request for this style + factory
  const supabase = createSupabaseServiceClient();
  const { data: existing } = await supabase
    .from("costing_requests")
    .select("id, request_number, status, factory_name")
    .eq("nextgen_products.style_number", validated.styleNumber)
    .not("status", "in", '("approved","rejected")')
    .order("created_at", { ascending: false })
    .limit(5);

  const activeDuplicates = (existing ?? []).filter((row: any) => {
    if (!validated.factoryName) return true;
    return row.factory_name?.toLowerCase() === validated.factoryName.toLowerCase();
  });

  if (activeDuplicates.length > 0 && !validated.forceCreate) {
    return NextResponse.json({
      ok: false,
      error: "Duplicate request detected",
      duplicates: activeDuplicates,
      hint: "Set forceCreate=true to override and create anyway"
    }, { status: 409 });
  }

  try {
    const data = await createCostingRequest({
      nextgenEntityId: validated.nextgenEntityId,
      styleNumber: validated.styleNumber,
      productName: validated.productName,
      factoryName: validated.factoryName,
      season: validated.season,
      brand: validated.brand,
      customer: validated.customer,
      poNumber: validated.poNumber,
      mpoNumber: validated.mpoNumber,
      productCategory: validated.productCategory,
      buyerStyleNumber: validated.buyerStyleNumber,
      notes: validated.notes,
      nextgenRaw: validated.nextgenRaw,
      bomLines: Array.isArray(validated.bomLines) ? validated.bomLines : [],
      forceCreate: validated.forceCreate === true,
      baselineRef: validated.baselineRef as import("@/lib/costing/history").BaselineRef | null | undefined
    });

    return NextResponse.json({ ok: true, data }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : (error as any)?.message ?? "Unable to create request";
    // Duplicate detection error → 409 Conflict
    if (message.includes("Duplicate active request")) {
      return NextResponse.json({ ok: false, error: message }, { status: 409 });
    }
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
