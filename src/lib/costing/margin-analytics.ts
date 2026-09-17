import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { calculateCostingTotals } from "@/lib/costing/totals";
import { nextGenPricingFromRaw, resolveSellingPrice } from "@/lib/costing/nextgen-pricing";

/**
 * Portfolio-level gross-margin analytics for the dashboard.
 *
 * Gross margin per unit is computed exactly like the request detail page:
 * wholesale price − landed cost (FOB when no landed cost). The wholesale
 * side prefers manual PBD entry, then the NextGen-ported selling price, then
 * the derived markup estimate. The cost side prefers the factory's submitted
 * CBD landed cost, and falls back to the ERP costing sheet's landed cost for
 * requests the factory has not costed yet. Margin is internal data: the factory
 * never sees this panel.
 */

export type MarginRequestRow = {
  requestId: string;
  requestNumber: string | null;
  status: string;
  brand: string | null;
  customer: string | null;
  factoryName: string | null;
  currency: string;
  /** Selling price per unit — PBD-entered when available, else the derived markup estimate. */
  wholesalePrice: number | null;
  /** Landed cost per unit (FOB when no landed cost components were entered). */
  costBasis: number | null;
  /** "pbd" = manually entered; "nextgen" = ERP-ported; "derived" = landed × markup estimate. */
  pricingSource: "pbd" | "nextgen" | "derived";
  /** Time anchor for the trend (request updated_at, last pricing/approval touch). */
  updatedAt: string | null;
};

/** Profit per unit: wholesale price − cost basis. Null when either side is missing. */
export function marginFor(row: MarginRequestRow): number | null {
  if (row.wholesalePrice == null || row.costBasis == null) return null;
  return row.wholesalePrice - row.costBasis;
}

export type MarginDimensionRow = {
  label: string;
  count: number;
  avgMarginUsd: number | null;
};

export type MarginAnalytics = {
  /** Requests with a computable margin (PBD pricing entered + CBD totals present). */
  totalWithMargin: number;
  /** Average profit per unit across the report currency (default USD). */
  avgMarginUsd: number | null;
  minMarginUsd: number | null;
  maxMarginUsd: number | null;
  /** Requests below the margin guideline, any status (the soft-flag population). */
  belowThresholdCount: number;
  byBrand: MarginDimensionRow[];
  byCustomer: MarginDimensionRow[];
  byFactory: MarginDimensionRow[];
  /** Average margin per month (of last pricing/approval activity). */
  trend: Array<{ label: string; avgMarginUsd: number | null; count: number }>;
  /** Approved requests below the guideline, worst first. */
  atRisk: Array<MarginRequestRow & { marginUsd: number }>;
};

function monthBucket(iso: string | null): string | null {
  if (!iso) return null;
  const match = /^(\d{4})-(\d{2})/.exec(iso);
  return match ? `${match[1]}-${match[2]}` : null;
}

export function computeMarginAnalytics(
  rows: MarginRequestRow[],
  opts: { thresholdUsd?: number; reportCurrency?: string } = {}
): MarginAnalytics {
  const threshold = opts.thresholdUsd ?? 1;
  const currency = opts.reportCurrency ?? "USD";

  const withMargin = rows
    .map((row) => ({ row, marginUsd: marginFor(row) }))
    .filter((item): item is { row: MarginRequestRow; marginUsd: number } => item.marginUsd !== null);
  // Averages are computed over the report currency only (the $ guideline is
  // USD), so a stray non-USD costing never skews the portfolio numbers. It
  // still counts toward totalWithMargin and the at-risk watchlist.
  const inCurrency = withMargin.filter((item) => item.row.currency === currency);

  const dimension = (pick: (row: MarginRequestRow) => string | null): MarginDimensionRow[] => {
    const groups = new Map<string, { count: number; sum: number }>();
    for (const item of inCurrency) {
      const key = pick(item.row)?.trim() || "Unassigned";
      const group = groups.get(key) ?? { count: 0, sum: 0 };
      group.count += 1;
      group.sum += item.marginUsd;
      groups.set(key, group);
    }
    return Array.from(groups.entries())
      .map(([label, group]) => ({ label, count: group.count, avgMarginUsd: group.sum / group.count }))
      .sort((a, b) => b.count - a.count || b.avgMarginUsd! - a.avgMarginUsd!);
  };

  const trendGroups = new Map<string, { count: number; sum: number }>();
  for (const item of inCurrency) {
    const bucket = monthBucket(item.row.updatedAt);
    if (!bucket) continue;
    const group = trendGroups.get(bucket) ?? { count: 0, sum: 0 };
    group.count += 1;
    group.sum += item.marginUsd;
    trendGroups.set(bucket, group);
  }
  const trend = Array.from(trendGroups.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, group]) => ({ label, count: group.count, avgMarginUsd: group.sum / group.count }));

  const atRisk = withMargin
    .filter((item) => item.row.status === "approved" && item.marginUsd < threshold)
    .map((item) => ({ ...item.row, marginUsd: item.marginUsd }))
    .sort((a, b) => a.marginUsd - b.marginUsd);

  return {
    totalWithMargin: withMargin.length,
    avgMarginUsd: inCurrency.length
      ? inCurrency.reduce((sum, item) => sum + item.marginUsd, 0) / inCurrency.length
      : null,
    minMarginUsd: inCurrency.length ? Math.min(...inCurrency.map((item) => item.marginUsd)) : null,
    maxMarginUsd: inCurrency.length ? Math.max(...inCurrency.map((item) => item.marginUsd)) : null,
    belowThresholdCount: withMargin.filter((item) => item.marginUsd < threshold).length,
    byBrand: dimension((row) => row.brand),
    byCustomer: dimension((row) => row.customer),
    byFactory: dimension((row) => row.factoryName),
    trend,
    atRisk
  };
}

export async function getMarginAnalytics(thresholdUsd: number) {
  try {
    const supabase = createSupabaseServiceClient();
    const { data, error } = await supabase
      .from("costing_requests")
      .select(
        `
        id,
        request_number,
        status,
        brand,
        customer,
        factory_name,
        pbd_pricing,
        updated_at,
        nextgen_products (raw_payload),
        factory_cbds (
          raw_payload,
          submitted_at,
          cbd_material_lines (
            total_cost,
            currency
          )
        )
      `
      )
      .limit(1000);

    if (error) {
      return { data: null as MarginAnalytics | null, error: error.message };
    }

    const rows: MarginRequestRow[] = (data ?? []).map((item: Record<string, unknown>) => {
      const cbds = Array.isArray(item.factory_cbds) ? (item.factory_cbds as Array<Record<string, unknown>>) : [];
      const latest = [...cbds].sort((a, b) =>
        String(b.submitted_at ?? "").localeCompare(String(a.submitted_at ?? ""))
      )[0];
      const totals = latest
        ? calculateCostingTotals({
            rawPayload: latest.raw_payload,
            lines: (latest.cbd_material_lines as Array<{ total_cost: number | null; currency: string | null }> | null) ?? []
          })
        : null;
      const product = Array.isArray(item.nextgen_products) ? item.nextgen_products[0] : item.nextgen_products;
      const nextGenRaw = product && typeof product === "object" ? (product as Record<string, unknown>).raw_payload : null;
      // Manual PBD price wins, then the NextGen-ported selling price (one owner:
      // resolveSellingPrice); then the derived markup estimate (landed ×
      // wholesaleMarkup) so costed requests still appear in the portfolio.
      const realSelling = resolveSellingPrice({ pbdPricing: item.pbd_pricing, nextGenRaw });
      const derivedWholesale = totals && totals.wholesalePrice > 0 ? totals.wholesalePrice : null;
      const wholesalePrice = realSelling.price ?? derivedWholesale;
      // The factory's own submission is the internal truth once it exists;
      // before that the ERP costing sheet's landed cost stands in, so a request
      // created a minute ago already shows the margin its style was costed at.
      const costBasis = totals
        ? totals.landedCost > 0
          ? totals.landedCost
          : totals.grandTotal
        : nextGenPricingFromRaw(nextGenRaw).landedCost;
      return {
        requestId: String(item.id),
        requestNumber: typeof item.request_number === "string" ? item.request_number : null,
        status: String(item.status ?? "draft"),
        brand: typeof item.brand === "string" ? item.brand : null,
        customer: typeof item.customer === "string" ? item.customer : null,
        factoryName: typeof item.factory_name === "string" ? item.factory_name : null,
        currency: totals?.currency ?? "USD",
        wholesalePrice,
        costBasis,
        pricingSource: realSelling.source ?? "derived",
        updatedAt: typeof item.updated_at === "string" ? item.updated_at : null
      };
    });

    return { data: computeMarginAnalytics(rows, { thresholdUsd }), error: null };
  } catch (error) {
    return {
      data: null as MarginAnalytics | null,
      error: error instanceof Error ? error.message : "Unable to load margin analytics"
    };
  }
}
