import { nextGenPost, legacyKendoSearchPayload } from "./client";
import { normalizeProductSearch } from "./normalize";

export type NextGenFilterOptions = {
  brands: string[];
  customers: string[];
  seasons: string[];
};

let cache: { data: NextGenFilterOptions; expiresAt: number } | null = null;
const CACHE_MS = 5 * 60 * 1000;

export async function getNextGenFilterOptions(): Promise<NextGenFilterOptions> {
  if (cache && Date.now() < cache.expiresAt) return cache.data;

  try {
    // Fetch a sample of products to extract distinct filter values
    // Use a broad search (single char) to get diverse results, take 100
    const result = await nextGenPost("productSearch", legacyKendoSearchPayload("a", "Name"));
    if (!result.ok) throw new Error(`NextGen ${result.status}`);

    const products = normalizeProductSearch(result.body);

    // Also try to get more by searching for common season prefix if needed
    // For now, 20-100 products is enough for distinct values

    const brandSet = new Set<string>();
    const customerSet = new Set<string>();
    const seasonSet = new Set<string>();

    for (const p of products) {
      const raw = p.raw as Record<string, unknown> | undefined;
      // Brand candidates: DivisionName, GroupName, DepartmentName, CommodityType splits
      const brandCandidates = [
        (raw?.["DivisionName"] as string) || "",
        (raw?.["GroupName"] as string) || "",
        (raw?.["DepartmentName"] as string) || "",
        p.customerName || "",
      ];
      for (const b of brandCandidates) {
        const v = b.trim();
        if (v && v !== "Unassigned" && v.length >= 2) brandSet.add(v);
      }
      if (p.customerName) customerSet.add(p.customerName.trim());
      if (p.rangeName) seasonSet.add(p.rangeName.trim());
      // Also raw RangeName, SeasonName
      const rawRange = (raw?.["RangeName"] as string) || (raw?.["SeasonName"] as string) || "";
      if (rawRange.trim()) seasonSet.add(rawRange.trim());
    }


    // Fallback: if brand still empty, use customer as brand (often brand = customer in this system)
    const brands = [...brandSet].sort().slice(0, 50);
    const customers = [...customerSet].sort().slice(0, 50);
    const seasons = [...seasonSet].sort().slice(0, 50);

    const data: NextGenFilterOptions = { brands, customers, seasons };
    cache = { data, expiresAt: Date.now() + CACHE_MS };
    return data;
  } catch (e) {
    // On failure, return empty so caller falls back to pipeline
    console.warn("[nextgen] filter options failed", e);
    return { brands: [], customers: [], seasons: [] };
  }
}

export async function tryGetNextGenFilterOptions(): Promise<NextGenFilterOptions> {
  try {
    return await getNextGenFilterOptions();
  } catch {
    return { brands: [], customers: [], seasons: [] };
  }
}
