import { NextResponse } from "next/server";
import { canManageMaterialLibrary, getCurrentRole } from "@/lib/auth/roles";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { pgrestOrTerms, pgrestValue } from "@/lib/supabase/filters";

// GET /api/material-library?q=xxx&category=xxx — search material library
export async function GET(request: Request) {
  const role = getCurrentRole();
  if (role === "viewer") {
    return NextResponse.json({ ok: false, error: "Authentication required" }, { status: 401 });
  }
  const url = new URL(request.url);
  const q = url.searchParams.get("q") ?? "";
  const category = url.searchParams.get("category") ?? "";

  const supabase = createSupabaseServiceClient();
  let query = supabase
    .from("material_library")
    .select("id, material_name, category, uom, specification, composition, supplier_name, standard_unit_cost, currency, moq, lead_time_days, is_active, nextgen_material_id, nextgen_material_code")
    .eq("is_active", true)
    .order("material_name", { ascending: true })
    .limit(500);

  if (q.trim()) {
    // Search across material_name OR specification OR composition. Quote the
    // term so spaces/commas are literal, not PostgREST filter grammar.
    query = query.or(pgrestOrTerms(["material_name", "specification", "composition", "supplier_name"], q.trim()));
  }
  if (category.trim()) {
    query = query.eq("category", pgrestValue(category.trim()));
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, data });
}

// POST /api/material-library — add or update a material
export async function POST(request: Request) {
  if (!canManageMaterialLibrary(getCurrentRole())) {
    return NextResponse.json({ ok: false, error: "PBD, Costing, or admin access required" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!body?.materialName) {
    return NextResponse.json({ ok: false, error: "materialName is required" }, { status: 400 });
  }

  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("material_library")
    .insert({
      material_name: String(body.materialName).trim(),
      category: body.category ?? null,
      uom: body.uom ?? "kg",
      specification: body.specification ?? null,
      composition: body.composition ?? null,
      supplier_name: body.supplierName ?? null,
      supplier_contact: body.supplierContact ?? null,
      standard_unit_cost: body.standardUnitCost ?? null,
      currency: body.currency ?? "USD",
      moq: body.moq ?? null,
      lead_time_days: body.leadTimeDays ?? null
    })
    .select("id")
    .single();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, data }, { status: 201 });
}
