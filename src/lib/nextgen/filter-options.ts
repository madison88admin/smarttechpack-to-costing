import { createStaleWhileRevalidateCache } from "@/lib/cache/stale-while-revalidate";
import { safeNextGenPostOnce } from "./client";
import { normalizeProductSearch } from "./normalize";
import { fetchPurchaseOrderLines } from "./po-lines";
import { loadFilterOptionsSnapshot, saveFilterOptionsSnapshot } from "./filter-options-snapshot";

export type NextGenFilterOptions = {
  yarnTypes: string[];
  knitTypes: string[];
  machineTypes: string[];
  constructions: string[];
  categories: string[];
  factories: string[];
  brands: string[];
  customers: string[];
  seasons: string[];
  refreshedAt?: string;
  partial?: boolean;
};

const TTL_MS = 5 * 60 * 1000;

const cache = createStaleWhileRevalidateCache<NextGenFilterOptions>({
  ttlMs: TTL_MS,
  build: buildFilterOptions,
  snapshot: { load: loadFilterOptionsSnapshot, save: saveFilterOptionsSnapshot }
});

/**
 * Filter options for the list screens.
 *
 * Building them is the slowest read in the app — up to 20 sequential ERP pages
 * behind a 15s deadline, then the PO-line directory (~17-20s). The cache serves
 * an expired entry while refreshing behind it, so the recurring five-minute
 * stall is gone; the snapshot covers the remaining case, a process that has
 * never built them (a restart or deploy), which otherwise made the first user
 * after every deploy wait for the whole scan.
 *
 * A scan cut short by the ERP deadline is still cached: it carries `partial`
 * for the UI to show, and it is exactly what a caller gets either way.
 */
export function getNextGenFilterOptions(): Promise<NextGenFilterOptions> {
  return cache.get();
}

export async function tryGetNextGenFilterOptions(): Promise<NextGenFilterOptions> {
  try {
    return await getNextGenFilterOptions();
  } catch (error) {
    // The one place the failure is swallowed, so it is the one place that logs.
    console.warn("[nextgen] filter options failed", error);
    return emptyNextGenFilterOptions();
  }
}

function emptyNextGenFilterOptions(): NextGenFilterOptions {
  return { yarnTypes: [], knitTypes: [], machineTypes: [], constructions: [], categories: [], factories: [], brands: [], customers: [], seasons: [] };
}

async function buildFilterOptions(): Promise<NextGenFilterOptions> {
  // Fetch a live product sample and the PO-line directory. The Product record
  // carries composition/construction attributes; PO lines carry the active
  // factory/customer/season relationship for the same styles.
  const products: ReturnType<typeof normalizeProductSearch> = [];
  const seen = new Set<string>();
  let partial = true;
  const deadline = Date.now() + 15000;
  // Bounded directory scan with stable ordering; never filter names by a letter.
  for (let page = 1; page <= 20; page++) {
    if (Date.now() >= deadline) break;
    const result = await safeNextGenPostOnce("productSearch", { filter: "", sort: "Id-asc", page, pageSize: 500, take: 500, skip: (page - 1) * 500 }, Math.max(1000, Math.min(8000, deadline - Date.now())));
    if (!result.ok) {
      if (products.length) break;
      throw new Error(`NextGen ${result.status}`);
    }
    const batch = normalizeProductSearch(result.body);
    const signature = JSON.stringify(batch.map(product => product.raw));
    if (seen.has(signature)) break; // Upstream may ignore pagination.
    seen.add(signature);
    products.push(...batch);
    if (batch.length < 500) { partial = false; break; }
  }

  const yarnSet = new Set<string>();
  const knitSet = new Set<string>();
  const machineSet = new Set<string>();
  const constructionSet = new Set<string>();
  const categorySet = new Set<string>();
  const factorySet = new Set<string>();
  const brandSet = new Set<string>();
  const customerSet = new Set<string>();
  const seasonSet = new Set<string>();

  const add = (set: Set<string>, value: unknown) => {
    if (typeof value !== "string") return;
    const trimmed = value.trim();
    if (trimmed && trimmed !== "Unassigned" && trimmed !== "#N/A") set.add(trimmed);
  };
  const first = (raw: Record<string, unknown> | undefined, keys: string[]) => {
    for (const key of keys) {
      const value = raw?.[key];
      if (typeof value === "string" && value.trim()) return value;
    }
    return "";
  };

  for (const p of products) {
    const raw = p.raw as Record<string, unknown> | undefined;
    add(yarnSet, first(raw, ["CompositionConcatenated", "Composition", "MainMaterialDescription", "YarnTypeName", "YarnType"]));
    add(knitSet, first(raw, ["KnitTypeName", "KnitType", "KnittingTypeName", "KnittingType"]));
    add(machineSet, first(raw, ["MachineTypeName", "MachineType", "KnittingMachineName", "MachineName"]));
    add(constructionSet, first(raw, ["ConstructionName", "Construction", "ProductConstruction"]));
    add(categorySet, p.commodityType || first(raw, ["CommodityTypeName", "ProductCategoryName"]));
    add(factorySet, p.supplierName || first(raw, ["DefaultProductCostingCostingProductSupplierName", "FactoryName"]));
    // Brand candidates: DivisionName, GroupName, DepartmentName, CommodityType splits
    const brandCandidates = [
      (raw?.["DivisionName"] as string) || "",
      (raw?.["GroupName"] as string) || "",
      (raw?.["DepartmentName"] as string) || "",
      p.customerName || "",
    ];
    for (const b of brandCandidates) add(brandSet, b);
    add(customerSet, p.customerName);
    add(seasonSet, p.rangeName);
    // Also raw RangeName, SeasonName
    const rawRange = (raw?.["RangeName"] as string) || (raw?.["SeasonName"] as string) || "";
    add(seasonSet, rawRange);
  }

  const poLines = await fetchPurchaseOrderLines();
  if (poLines.ok) {
    for (const line of poLines.lines) {
      add(factorySet, line.supplier);
      add(customerSet, line.customer);
      add(seasonSet, line.season);
    }
  }

  const sort = (set: Set<string>) => [...set].sort((a, b) => a.localeCompare(b));

  return {
    yarnTypes: sort(yarnSet), knitTypes: sort(knitSet), machineTypes: sort(machineSet), constructions: sort(constructionSet),
    categories: sort(categorySet), factories: sort(factorySet), brands: sort(brandSet), customers: sort(customerSet), seasons: sort(seasonSet),
    refreshedAt: new Date().toISOString(), partial: partial || !poLines.ok || poLines.lines.length >= 500
  };
}
