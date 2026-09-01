import { NextResponse } from "next/server";
import { canManageMaterialLibrary, getCurrentRole } from "@/lib/auth/roles";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { fetchBom } from "@/lib/nextgen/bom";
import { normalizeProductSearch } from "@/lib/nextgen/normalize";
import { legacyKendoSearchPayload, nextGenPost } from "@/lib/nextgen/client";

// POST /api/admin/sync-materials
// Fetches all BOM materials from NextGen and upserts them into material_library
export async function POST() {
  const role = getCurrentRole();
  if (!canManageMaterialLibrary(role)) {
    return NextResponse.json({ ok: false, error: "PBD, Costing, or admin access required" }, { status: 403 });
  }

  const supabase = createSupabaseServiceClient();

  try {
    // Step 1: Fetch products from NextGen using multiple broad search terms
    // This covers products whose names start with different characters
    const searchTerms = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o", "p", "q", "r", "s", "t", "u", "v", "w", "x", "y", "z", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "M", " "];
    const allProducts = new Map<string, { entityId: string; styleNumber: string; name: string }>();

    for (const term of searchTerms) {
      try {
        const payload = legacyKendoSearchPayload(term, "Name");
        payload.take = 200;
        payload.pageSize = 200;
        const result = await nextGenPost("productSearch", payload);
        if (result.ok) {
          const products = normalizeProductSearch(result.body);
          for (const p of products) {
            if (p.entityId) allProducts.set(p.entityId, p);
          }
        }
      } catch {
        // Skip failed search terms
      }
    }

    const products = Array.from(allProducts.values());
    if (!products.length) {
      return NextResponse.json({ ok: false, error: "No products found in NextGen" }, { status: 404 });
    }

    // Step 2: Fetch BOM for all products IN PARALLEL (batch of 5)
    const materialMap = new Map<
      string,
      {
        materialName: string;
        category?: string;
        materialType?: string;
        uom?: string;
        materialCode?: string;
        nextgenMaterialId?: string;
      }
    >();

    let productsProcessed = 0;
    let bomLinesFound = 0;

    const batchSize = 5;
    for (let i = 0; i < products.length; i += batchSize) {
      const batch = products.slice(i, i + batchSize);
      const bomResults = await Promise.allSettled(
        batch.map((product) => fetchBom({ entityId: product.entityId, pageSize: 500 }))
      );

      for (const result of bomResults) {
        productsProcessed++;
        if (result.status === "fulfilled" && result.value.ok && result.value.data.length > 0) {
          bomLinesFound += result.value.data.length;
          for (const line of result.value.data) {
            const key = `${line.category}|${line.materialName}`.toLowerCase();
            if (!materialMap.has(key) && line.materialName) {
              materialMap.set(key, {
                materialName: line.materialName,
                category: line.category || undefined,
                materialType: line.materialType || undefined,
                uom: line.size && line.size !== "No Size" ? line.size : undefined,
                // Prefer the real NextGen MaterialId; fall back to the BOM line id
                // so existing rows keep a stable reference.
                materialCode: line.materialId || line.id || undefined,
                nextgenMaterialId: line.materialId || line.id || undefined
              });
            }
          }
        }
      }
    }

    // Step 3: Upsert materials into material_library
    const materials = Array.from(materialMap.values());
    let inserted = 0;
    let updated = 0;
    let skipped = 0;

    for (const mat of materials) {
      // Try insert first, if duplicate → update
      const { error: insertError } = await supabase.from("material_library").insert({
        material_name: mat.materialName,
        category: mat.category ?? null,
        uom: mat.uom ?? "kg",
        specification: mat.materialType ?? null,
        currency: "USD",
        is_active: true,
        nextgen_material_id: mat.nextgenMaterialId ?? null,
        nextgen_material_code: mat.materialCode ?? null
      }).select("id").single();

      if (insertError) {
        // Likely duplicate — try update instead
        let query = supabase
          .from("material_library")
          .update({
            category: mat.category ?? null,
            uom: mat.uom ?? "kg",
            specification: mat.materialType ?? null,
            nextgen_material_id: mat.nextgenMaterialId ?? null,
            nextgen_material_code: mat.materialCode ?? null,
            updated_at: new Date().toISOString()
          })
          .ilike("material_name", mat.materialName);

        if (mat.category) {
          query = query.ilike("category", mat.category);
        } else {
          query = query.is("category", null);
        }

        const { error: updateError } = await query;
        if (updateError) {
          skipped++;
        } else {
          updated++;
        }
      } else {
        inserted++;
      }
    }

    return NextResponse.json({
      ok: true,
      data: {
        productsFound: products.length,
        productsProcessed,
        bomLinesFound,
        uniqueMaterials: materials.length,
        inserted,
        updated,
        skipped
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sync failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

