import { getBomConfig, type BomConfig } from "./config";
import { nextGenPost, nextGenRawGet } from "./client";
import { normalizeBomLines, summarizeBomShape, type BomLineResult } from "./normalize";
import { readBomCache, writeBomCache } from "./bom-cache";

export type BomFilterField =
  | "ProductId"
  | "ProductName"
  | "MaterialName"
  | "BoMItemCategoryName"
  | "CommodityTypeName"
  | "MaterialId";

export type BomQueryInput = {
  entityId?: string;
  styleNumber?: string;
  materialName?: string;
  category?: string;
  commodity?: string;
  materialId?: string;
  customFilter?: string;
  pageSize?: number;
  skip?: number;
};

export type BomFetchResult = {
  ok: boolean;
  status: number;
  upstreamContentType: string;
  data: BomLineResult[];
  total: number;
  warning?: string;
  rawBody: unknown;
};

const supportedFilterFields: Record<keyof Omit<BomQueryInput, "customFilter" | "pageSize" | "skip">, BomFilterField> = {
  entityId: "ProductId",
  styleNumber: "ProductName",
  materialName: "MaterialName",
  category: "BoMItemCategoryName",
  commodity: "CommodityTypeName",
  materialId: "MaterialId"
};

const containsFields: BomFilterField[] = ["ProductName", "MaterialName", "BoMItemCategoryName", "CommodityTypeName"];

export function buildBomFilter(input: BomQueryInput, config: BomConfig = getBomConfig()): string | null {
  if (input.customFilter?.trim()) {
    return input.customFilter.trim();
  }

  const entries = Object.entries(supportedFilterFields) as [
    keyof typeof supportedFilterFields,
    BomFilterField
  ][];

  for (const [inputKey, field] of entries) {
    const value = input[inputKey]?.trim();

    if (!value) continue;

    if (field === config.filterField) {
      return `${field}~${config.filterOperator}~${escapeValue(value)}`;
    }

    const operator = containsFields.includes(field) ? "contains" : config.filterOperator;
    const formatted = operator === "contains" ? `'${value.replace(/'/g, "''")}'` : escapeValue(value);

    return `${field}~${operator}~${formatted}`;
  }

  return null;
}

function escapeValue(value: string) {
  return value.replace(/'/g, "''");
}

export async function fetchBom(input: BomQueryInput, config: BomConfig = getBomConfig()): Promise<BomFetchResult> {
  const filter = buildBomFilter(input, config);
  const pageSize = input.pageSize ?? config.pageSize;
  const skip = input.skip ?? 0;
  const page = Math.floor(skip / pageSize) + 1;

  const payload: Record<string, string | number | boolean | undefined> = {
    take: pageSize,
    skip,
    page,
    pageSize,
    UserAreaClaim: config.userAreaClaim,
    ShowTabs: config.showTabs,
    EntityType: config.entityType
  };

  if (filter) {
    payload.filter = filter;
  }

  const result = await nextGenPost("productBom", payload);

  if (!result.ok) {
    const cacheKey = input.styleNumber ? `style-${input.styleNumber}` : input.entityId ? `entity-${input.entityId}` : null;
    const cached = cacheKey ? readBomCache(cacheKey) : null;
    if (cached?.length) {
      return {
        ok: true,
        status: 200,
        upstreamContentType: "application/json",
        data: cached,
        total: cached.length,
        warning: "NextGen is unavailable. Showing cached reference BOM data; refresh when the upstream session is available.",
        rawBody: { Data: cached, Total: cached.length, source: "local-cache" }
      };
    }
    if (input.entityId) {
      const view = await nextGenRawGet(config.viewCachePath, {
        UserAreaClaim: config.userAreaClaim,
        ShowTabs: config.showTabs,
        productId: input.entityId
      });

      if (view.ok && view.body.includes("No items to display")) {
        return {
          ok: true,
          status: 200,
          upstreamContentType: view.upstreamContentType,
          data: [],
          total: 0,
          warning:
            "NextGen BOM endpoint returned an error and ViewCache shows no items. Note: ViewCache can report false negatives — if this product should have a BOM, retry or check NextGen directly.",
          rawBody: { Data: [], Total: 0 }
        };
      }
    }

    return {
      ok: false,
      status: result.status,
      upstreamContentType: result.upstreamContentType,
      data: [],
      total: 0,
      rawBody: result.body
    };
  }

  const body = result.body as { Data?: unknown[]; Total?: number } | null;
  const rows = body?.Data ?? [];
  const total = body?.Total ?? rows.length;

  const normalized = normalizeBomLines(body);
  const cacheKey = input.styleNumber ? `style-${input.styleNumber}` : input.entityId ? `entity-${input.entityId}` : null;
  if (cacheKey && normalized.length) writeBomCache(cacheKey, normalized);
  return {
    ok: true,
    status: result.status,
    upstreamContentType: result.upstreamContentType,
    data: normalized,
    total,
    rawBody: body
  };
}

export async function fetchBomDiagnostics(input: BomQueryInput, config: BomConfig = getBomConfig()) {
  const result = await fetchBom(input, config);

  return {
    ok: result.ok,
    status: result.status,
    upstreamContentType: result.upstreamContentType,
    diagnostics: summarizeBomShape(result.rawBody),
    total: result.total,
    warning: result.warning
  };
}
