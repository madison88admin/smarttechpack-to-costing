import { NextResponse } from "next/server";
import { canAccessAdmin, getCurrentRole } from "@/lib/auth/roles";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import {
  dedupeHistoricalImports,
  listExistingHistoricalImportKeys
} from "@/lib/costing/history";

// POST /api/admin/import-historical
// Accepts a JSON array of historical costing records and imports them into historical_costings
// Data Bank 7.25.25.xlsx fields are supported: season/customer/brand/style_name + material_price/
// knitting_cpm/knitting_cost/ops_cost/packaging/profit are preserved in raw_payload for
// benchmark / like-styles / machine-time reference.
// Expected format per record:
// {
//   style_number: string,
//   factory_name?: string,
//   currency?: string,
//   yarn_type?: string,
//   knit_type?: string,
//   machine_type?: string,
//   construction?: string,
//   product_category?: string,
//   average_consumption?: number,
//   knitting_time?: number,
//   labor_cost?: number,
//   overhead_cost?: number,
//   total_cost?: number,
//   approved_at?: string (ISO date),
//   brand?: string, customer?: string, season?: string, style_name?: string,
//   material_price?: number, knitting_cpm?: number, knitting_cost?: number, ops_cost?: number,
//   packaging_cost?: number, profit?: number, raw_payload?: object
// }
export async function POST(request: Request) {
  const role = getCurrentRole();
  if (!canAccessAdmin(role)) {
    return NextResponse.json(
      { ok: false, error: "Only admins can import historical data" },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => null);
  if (!body || !Array.isArray(body.records)) {
    return NextResponse.json(
      { ok: false, error: "Expected { records: [...] } in request body" },
      { status: 400 }
    );
  }

  const records = body.records as Record<string, unknown>[];
  if (records.length === 0) {
    return NextResponse.json({ ok: false, error: "No records provided" }, { status: 400 });
  }

  if (records.length > 500) {
    return NextResponse.json(
      { ok: false, error: "Maximum 500 records per import. Please batch your data." },
      { status: 400 }
    );
  }

  const supabase = createSupabaseServiceClient();

  const rows = records.map((record) => {
    const styleNumber = String(record.style_number ?? "").trim();
    if (!styleNumber) throw new Error("Missing style_number");
    const factoryName = record.factory_name ? String(record.factory_name).trim() : null;
    const yarnType = record.yarn_type ? String(record.yarn_type).trim() : null;
    const knitType = record.knit_type ? String(record.knit_type).trim() : null;
    const machineType = record.machine_type ? String(record.machine_type).trim() : null;
    const construction = record.construction ? String(record.construction).trim() : null;
    const productCategory = record.product_category ? String(record.product_category).trim() : null;
    const currency = record.currency ? String(record.currency).trim() : "USD";
    const averageConsumption = toNum(record.average_consumption);
    const knittingTime = toNum(record.knitting_time);
    const laborCost = toNum(record.labor_cost);
    const overheadCost = toNum(record.overhead_cost);
    const totalCost = toNum(record.total_cost);
    // Data Bank extended fields
    const brand = record.brand ? String(record.brand).trim() : null;
    const customer = record.customer ? String(record.customer).trim() : null;
    const season = record.season ? String(record.season).trim() : null;
    let approvedAt: string;
    const rawApproved = record.approved_at ? String(record.approved_at).trim() : "";
    if (rawApproved) {
      const parsed = Date.parse(rawApproved);
      approvedAt = Number.isFinite(parsed) ? new Date(parsed).toISOString() : rawApproved;
      // If it's just a season like "SS25", keep as-is but wrap to ISO for sorting (use season as fallback)
      if (Number.isNaN(parsed) && season) approvedAt = new Date().toISOString();
    } else {
      approvedAt = new Date().toISOString();
    }
    // Preserve Data Bank extra costs in raw_payload so like-styles / reports can surface them
    const extraPayload: Record<string, unknown> =
      record.raw_payload && typeof record.raw_payload === "object" ? { ...(record.raw_payload as Record<string, unknown>) } : {};
    // Also stash the explicit top-level extras if not already in raw_payload
    for (const key of ["material_price", "knitting_cpm", "knitting_cost", "ops_cost", "packaging_cost", "profit", "style_name", "brand", "customer", "season"] as const) {
      if (record[key] != null && extraPayload[key] == null) extraPayload[key] = record[key];
    }
    if (record.style_name) extraPayload["style_name"] = record.style_name;

    // Build searchable text: include customer/season/brand/material so free-text search works
    const searchableText = [
      styleNumber,
      record.style_name ? String(record.style_name) : null,
      factoryName,
      yarnType,
      knitType,
      machineType,
      construction,
      productCategory,
      brand,
      customer,
      season
    ]
      .filter(Boolean)
      .join(" ");

    return {
      style_number: styleNumber,
      factory_name: factoryName,
      currency,
      yarn_type: yarnType,
      knit_type: knitType,
      machine_type: machineType,
      construction,
      product_category: productCategory,
      average_consumption: averageConsumption,
      knitting_time: knittingTime,
      labor_cost: laborCost,
      overhead_cost: overheadCost,
      total_cost: totalCost,
      approved_at: approvedAt,
      searchable_text: searchableText,
      costing_request_id: null, // Imported records are not linked to a request
      brand,
      customer,
      season,
      source: "import",
      raw_payload: Object.keys(extraPayload).length > 0 ? extraPayload : {}
    };
  });

  // Re-uploading the same export must not add a second set of rows for records
  // the pool already holds, so the batch is keyed on the ERP record it came
  // from -- the same identity the NextGen sync uses. Duplicates inside the file
  // are dropped too, and a record is never re-added from a later export that
  // moved its cost or its revision (that revision update lands on the same key).
  const existingKeys = await listExistingHistoricalImportKeys(rows);
  const { rows: uniqueRows, skipped: skippedDuplicates } = dedupeHistoricalImports(rows, existingKeys);

  // Insert in batches of 50
  let inserted = 0;
  let errors: string[] = [];

  for (let i = 0; i < uniqueRows.length; i += 50) {
    const batch = uniqueRows.slice(i, i + 50);
    const { error } = await supabase.from("historical_costings").insert(batch);
    if (error) {
      errors.push(`Batch ${Math.floor(i / 50) + 1}: ${error.message}`);
    } else {
      inserted += batch.length;
    }
  }

  return NextResponse.json({
    ok: true,
    imported: inserted,
    skippedDuplicates,
    failed: uniqueRows.length - inserted,
    errors: errors.length > 0 ? errors : undefined
  });
}

function toNum(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = parseFloat(value.replace(/,/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}
