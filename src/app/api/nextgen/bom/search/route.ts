import { badRequest, upstreamJson } from "@/lib/api/response";
import { fetchBom, type BomQueryInput } from "@/lib/nextgen/bom";
import { getCurrentRole } from "@/lib/auth/roles";

export async function GET(request: Request) {
  const role = getCurrentRole();
  if (role === "viewer") {
    return badRequest("Authentication required");
  }

  const url = new URL(request.url);
  const params = url.searchParams;

  const entityId = params.get("entityId") ?? undefined;
  const styleNumber = params.get("styleNumber") ?? params.get("style") ?? undefined;
  const materialName = params.get("materialName") ?? params.get("material") ?? undefined;
  const category = params.get("category") ?? undefined;
  const commodity = params.get("commodity") ?? undefined;
  const materialId = params.get("materialId") ?? undefined;
  const customFilter = params.get("filter") ?? undefined;
  const pageSizeParam = params.get("pageSize");
  const skipParam = params.get("skip");

  if (
    !entityId &&
    !styleNumber &&
    !materialName &&
    !category &&
    !commodity &&
    !materialId &&
    !customFilter
  ) {
    return badRequest(
      "Provide at least one of: entityId, styleNumber (or style), materialName (or material), category, commodity, materialId, filter"
    );
  }

  const input: BomQueryInput = {
    entityId,
    styleNumber,
    materialName,
    category,
    commodity,
    materialId,
    customFilter
  };

  if (pageSizeParam) {
    const parsed = Number(pageSizeParam);

    if (Number.isFinite(parsed) && parsed > 0) {
      input.pageSize = Math.min(parsed, 500);
    }
  }

  if (skipParam) {
    const parsed = Number(skipParam);

    if (Number.isFinite(parsed) && parsed >= 0) {
      input.skip = parsed;
    }
  }

  const result = await fetchBom(input);

  if (!result.ok) {
    return upstreamJson({
      ok: false,
      status: result.status,
      upstreamContentType: result.upstreamContentType,
      body: result.rawBody,
      filter: {
        entityId,
        styleNumber,
        materialName,
        category,
        commodity,
        materialId,
        customFilter
      }
    });
  }

  return upstreamJson({
    ok: true,
    status: result.status,
    upstreamContentType: result.upstreamContentType,
    data: result.data,
    total: result.total,
    warning: result.warning,
    filter: {
      entityId,
      styleNumber,
      materialName,
      category,
      commodity,
      materialId,
      customFilter
    }
  });
}
