import { nextGenPost } from "./client";
import { fetchBom } from "./bom";

/**
 * NextGen products are archived in NextGen with lifecycle statuses instead of
 * being deleted. "Dropped" is the real historical archive (5,590 live);
 * the others are kept for completeness and only count when data exists.
 */
export const NEXTGEN_HISTORICAL_STATUSES = ["Dropped", "Archived", "Closed", "Cancelled", "Completed"];

export const NEXTGEN_HISTORICAL_SOURCE = "nextgen";
export const NEXTGEN_HISTORICAL_EXCLUSION_REASON = "nextgen_synced_dropped_product";

export type NextGenHistoricalRecord = {
  style_number: string | null;
  factory_name: string | null;
  currency: string | null;
  total_cost: number | null;
  average_consumption?: number | null;
  knitting_time?: number | null;
  product_category: string | null;
  yarn_type: string | null;
  customer: string | null;
  brand: string | null;
  season: string | null;
  approved_at: string | null;
  searchable_text: string;
  raw_payload: Record<string, unknown>;
  source: "nextgen";
  benchmark_excluded: true;
  benchmark_exclusion_reason: string;
  nextgen_entity_id: string;
};

function str(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number") return String(value);
  return null;
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = parseFloat(value.replace(/,/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/**
 * Map a raw NextGen product-grid row (ProductManagerProductsGrid/Read) into a
 * historical_costings insert shape. The grid already carries the default
 * costing (purchase price, currency, supplier), composition, lifecycle dates
 * and derivation chain, so no per-product fetch is needed for the core data.
 */
export function mapNextGenProductToHistorical(row: Record<string, unknown>): NextGenHistoricalRecord {
  const styleNumber = str(row.Name) || str(row.CustomerReference) || str(row.Id);
  const factoryName = str(row.DefaultProductCostingCostingProductSupplierName);
  const totalCost = num(row.DefaultProductCostingCostingPurchasePrice) ?? num(row.TargetMinimumPurchasePrice);
  const composition = str(row.CompositionConcatenated) || str(row.Composition) || str(row.MainMaterialDescription);
  const externalReference = str(row.ExternalReference);
  const originalName = str(row.OriginalName);
  const customer = str(row.CustomerName);
  const range = str(row.RangeName);
  const division = str(row.DivisionName);
  const commodity = str(row.CommodityTypeName);
  // Prefer the lifecycle's closed date; fall back to last edit / creation so
  // the row always has a sortable timestamp (stable across re-runs).
  const approvedAt = str(row.ClosedDate) || str(row.LastEditedDateTime) || str(row.CreatedDateTime) || new Date().toISOString();

  const searchableText = [styleNumber, factoryName, commodity, customer, range, externalReference, originalName, composition]
    .filter(Boolean)
    .join(" ");

  return {
    style_number: styleNumber,
    factory_name: factoryName,
    currency: str(row.DefaultProductCostingCostingPurchaseCurrencyName) || "USD",
    total_cost: totalCost,
    product_category: commodity,
    yarn_type: composition,
    customer,
    brand: division,
    season: range,
    // Knitting/standard-minute values straight off the product grid. NextGen
    // ships GsdSMV/SMV/FactoryTime/AllowedTime as separate keys; all four are
    // currently null for the account we have access to, but the mapping keeps
    // the benchmark engine fed the moment real values exist.
    knitting_time: num(row.GsdSMV) ?? num(row.SMV) ?? num(row.FactoryTime) ?? num(row.AllowedTime),
    approved_at: approvedAt,
    searchable_text: searchableText,
    raw_payload: row,
    source: NEXTGEN_HISTORICAL_SOURCE,
    benchmark_excluded: true,
    benchmark_exclusion_reason: NEXTGEN_HISTORICAL_EXCLUSION_REASON,
    nextgen_entity_id: str(row.Id) || str(row.DomainEntityId) || ""
  };
}

/** Stable dedup key: style + factory (case-insensitive). */
export function historicalDedupKey(styleNumber: string | null, factoryName: string | null): string {
  return `${(styleNumber ?? "").trim().toLowerCase()}|${(factoryName ?? "").trim().toLowerCase()}`;
}

/** Build a Kendo simple-filter string for a single lifecycle status. */
export function statusFilter(status: string): string {
  return `StatusName~eq~'${status.replace(/'/g, "''")}'`;
}

export type NextGenHistoricalFetchResult = {
  rows: Record<string, unknown>[];
  scanned: number;
  perStatus: Array<{ status: string; total: number }>;
};

/**
 * Page through the NextGen product grid for each lifecycle status and return
 * the raw rows (deduped by entity id). limit caps the number of rows returned
 * across all statuses; undefined means sync everything.
 */
export async function fetchNextGenHistoricalProducts(
  statuses: string[],
  limit?: number
): Promise<NextGenHistoricalFetchResult> {
  const rows: Record<string, unknown>[] = [];
  const perStatus: Array<{ status: string; total: number }> = [];
  const seen = new Set<string>();
  const take = 200;

  for (const status of statuses) {
    let skip = 0;
    let pageTotal = 0;
    let done = false;

    while (!done) {
      const result = await nextGenPost("productSearch", {
        take,
        skip,
        page: Math.floor(skip / take) + 1,
        pageSize: take,
        filter: statusFilter(status)
      });

      if (!result.ok) {
        throw new Error(`NextGen product search failed for status '${status}' (HTTP ${result.status})`);
      }

      const body = result.body as { Data?: unknown[]; Total?: number } | unknown[] | null;
      const data = Array.isArray(body) ? body : (body as { Data?: unknown[] })?.Data ?? [];
      pageTotal = (body && !Array.isArray(body) && typeof body === "object" && "Total" in body
        ? Number((body as { Total?: unknown }).Total)
        : data.length) || data.length;

      for (const row of data) {
        if (!row || typeof row !== "object") continue;
        const record = row as Record<string, unknown>;
        const id = String(record.Id ?? record.DomainEntityId ?? "");
        if (id && seen.has(id)) continue;
        if (id) seen.add(id);
        rows.push(record);
      }

      const reachedEnd = data.length < take || skip + data.length >= pageTotal;
      skip += take;
      if (reachedEnd || (limit !== undefined && rows.length >= limit)) done = true;
    }

    perStatus.push({ status, total: pageTotal });
  }

  const capped = limit !== undefined ? rows.slice(0, limit) : rows;
  return { rows: capped, scanned: rows.length, perStatus };
}

/**
 * Optionally enrich records with BOM consumption (sum of DefaultRating across
 * BOM lines) for the first `cap` products. Expensive (one NextGen call per
 * product), so it is opt-in and capped.
 */
export async function enrichWithBomConsumption(
  records: NextGenHistoricalRecord[],
  cap = 100
): Promise<void> {
  const targets = records.slice(0, cap).filter((r) => r.nextgen_entity_id);
  await Promise.all(
    targets.map(async (record) => {
      try {
        const bom = await fetchBom({ entityId: record.nextgen_entity_id, pageSize: 200 });
        if (!bom.ok) return;
        const total = bom.data.reduce((sum, line) => {
          const value = typeof line.usage === "number" ? line.usage : parseFloat(String(line.usage ?? ""));
          return Number.isFinite(value) ? sum + value : sum;
        }, 0);
        record.average_consumption = total > 0 ? total : null;
      } catch {
        // Best-effort — a BOM failure must not abort the whole sync.
      }
    })
  );
}
