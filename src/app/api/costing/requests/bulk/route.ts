import { NextResponse } from "next/server";
import { canCreateRequest, getCurrentRole } from "@/lib/auth/roles";
import { createCostingRequest, type CreateBomLineInput } from "@/lib/costing/requests";
import { validateBody, bulkCreateSchema } from "@/lib/api/validate";

// POST /api/costing/requests/bulk
// Create multiple costing requests at once from a list of style/product data
// Each item MUST include entityId (from NextGen) and bomLines (from NextGen BOM fetch)
export async function POST(request: Request) {
  if (!canCreateRequest(getCurrentRole())) {
    return NextResponse.json({ ok: false, error: "Current role cannot create costing requests" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const validation = validateBody(bulkCreateSchema, body);
  if (!validation.success) return validation.response;
  const validated = validation.data;

  const factoryName = validated.factoryName;
  const season = validated.season;
  const brand = validated.brand;
  const customer = validated.customer;

  const results: Array<{ styleNumber: string; ok: boolean; requestId?: string; error?: string }> = [];

  for (const item of validated.items) {
    const styleNumber = item.styleNumber;

    const bomLines: CreateBomLineInput[] = item.bomLines.map((line) => ({
      id: line.id,
      category: line.category,
      materialName: line.materialName,
      materialDescription: line.materialDescription,
      materialType: line.materialType,
      usage: line.usage,
      size: line.size
    }));

    try {
      const data = await createCostingRequest({
        styleNumber,
        productName: item.productName ?? styleNumber,
        factoryName,
        season,
        brand,
        customer,
        nextgenEntityId: item.entityId,
        bomLines,
        notes: item.notes
      });

      results.push({ styleNumber, ok: true, requestId: data.id });
    } catch (err) {
      results.push({
        styleNumber,
        ok: false,
        error: err instanceof Error ? err.message : "Unknown error"
      });
    }
  }

  const created = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;

  return NextResponse.json({ ok: true, created, failed, results }, { status: 201 });
}
