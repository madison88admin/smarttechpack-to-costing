import { createSupabaseServiceClient } from "@/lib/supabase/server";

export type ShouldCostEstimate = {
  estimatedFOB: number;
  estimatedLanded: number;
  confidence: "low" | "medium" | "high";
  breakdown: {
    materials: number;
    labor: number;
    overhead: number;
    profit: number;
  } | null;
  benchmarkSource: string;
  sampleSize: number;
  varianceFromQuote: number | null; // % difference from actual CBD quote
  recommendation: string;
};

// Estimate what a product SHOULD cost based on historical data and attributes
export async function estimateShouldCost(input: {
  yarnType?: string | null;
  knitType?: string | null;
  machineType?: string | null;
  construction?: string | null;
  productCategory?: string | null;
  factoryName?: string | null;
  actualQuoteTotal?: number | null;
  currency?: string;
}): Promise<ShouldCostEstimate | null> {
  const supabase = createSupabaseServiceClient();
  const currency = input.currency ?? "USD";

  // Load the approved history pool, then score it in one place. Chaining
  // ilike filters here previously turned the intended "match on any" search
  // into an overly strict AND query and silently ignored older good matches.
  const query = supabase
    .from("historical_costings")
    .select("total_cost, currency, yarn_type, knit_type, machine_type, construction, product_category, factory_name, average_consumption, knitting_time, raw_payload")
    .limit(5000);

  const { data: historical, error } = await query;

  if (error || !historical || historical.length === 0) return null;

  const records = historical as Array<{
    total_cost: number | null;
    currency: string | null;
    yarn_type: string | null;
    knit_type: string | null;
    machine_type: string | null;
    construction: string | null;
    product_category: string | null;
    factory_name: string | null;
    average_consumption: number | null;
    knitting_time: number | null;
    raw_payload: Record<string, unknown> | null;
  }>;

  // Filter to same currency
  const sameCurrency = records.filter((r) => r.currency === currency && r.total_cost != null && r.total_cost > 0);

  if (sameCurrency.length === 0) return null;

  // Score each record by attribute similarity
  const scored = sameCurrency.map((r) => {
    let score = 0;
    if (input.yarnType && r.yarn_type && r.yarn_type.toLowerCase().includes(input.yarnType.toLowerCase())) score += 3;
    if (input.knitType && r.knit_type && r.knit_type.toLowerCase().includes(input.knitType.toLowerCase())) score += 3;
    if (input.machineType && r.machine_type && r.machine_type.toLowerCase().includes(input.machineType.toLowerCase())) score += 2;
    if (input.construction && r.construction && r.construction.toLowerCase().includes(input.construction.toLowerCase())) score += 2;
    if (input.productCategory && r.product_category && r.product_category.toLowerCase().includes(input.productCategory.toLowerCase())) score += 1;
    if (input.factoryName && r.factory_name && r.factory_name.toLowerCase().includes(input.factoryName.toLowerCase())) score += 2;
    return { record: r, score };
  });

  // Sort by score (highest first) and take top matches
  scored.sort((a, b) => b.score - a.score);
  const topMatches = scored.slice(0, Math.min(10, scored.length));
  const bestScore = topMatches[0]?.score ?? 0;

  // Calculate weighted average (higher score = more weight)
  const totalWeight = topMatches.reduce((sum, s) => sum + (s.score + 1), 0);
  const weightedSum = topMatches.reduce((sum, s) => sum + (s.record.total_cost ?? 0) * (s.score + 1), 0);
  const estimatedFOB = weightedSum / totalWeight;

  // Use observed component ratios only. The previous fixed 55/20/10/15 split
  // looked precise even when the historical rows did not support it.
  const observed = topMatches
    .map(({ record }) => observedCostComponents(record.raw_payload, record.total_cost ?? 0))
    .filter((item): item is NonNullable<typeof item> => item !== null);
  const ratioTotals = observed.reduce(
    (sum, item) => ({
      materials: sum.materials + item.materials,
      labor: sum.labor + item.labor,
      overhead: sum.overhead + item.overhead,
      profit: sum.profit + item.profit,
      landedRatio: sum.landedRatio + item.landedRatio
    }),
    { materials: 0, labor: 0, overhead: 0, profit: 0, landedRatio: 0 }
  );
  const breakdown = observed.length > 0
    ? {
        materials: estimatedFOB * ratioTotals.materials / observed.length,
        labor: estimatedFOB * ratioTotals.labor / observed.length,
        overhead: estimatedFOB * ratioTotals.overhead / observed.length,
        profit: estimatedFOB * ratioTotals.profit / observed.length
      }
    : null;
  const estimatedLanded = observed.length > 0
    ? estimatedFOB * ratioTotals.landedRatio / observed.length
    : estimatedFOB;

  // Confidence based on sample size and best match score
  const confidence: "low" | "medium" | "high" =
    topMatches.length >= 5 && bestScore >= 8 ? "high" :
    topMatches.length >= 3 && bestScore >= 5 ? "medium" : "low";

  // Variance from actual quote
  const varianceFromQuote = input.actualQuoteTotal && input.actualQuoteTotal > 0
    ? ((input.actualQuoteTotal - estimatedFOB) / estimatedFOB) * 100
    : null;

  // Recommendation
  let recommendation = "";
  if (varianceFromQuote !== null) {
    if (varianceFromQuote > 15) {
      recommendation = `Factory quote is ${varianceFromQuote.toFixed(1)}% above should-cost estimate. Consider negotiating or seeking alternative suppliers.`;
    } else if (varianceFromQuote > 5) {
      recommendation = `Factory quote is ${varianceFromQuote.toFixed(1)}% above should-cost. Within acceptable range but worth reviewing cost drivers.`;
    } else if (varianceFromQuote < -10) {
      recommendation = `Factory quote is ${Math.abs(varianceFromQuote).toFixed(1)}% below should-cost. Verify quality and material specifications.`;
    } else {
      recommendation = `Factory quote is close to should-cost estimate (${varianceFromQuote.toFixed(1)}% variance). Quote appears reasonable.`;
    }
  } else {
    recommendation = "No actual quote provided for comparison. Use this estimate as a baseline for negotiation.";
  }

  return {
    estimatedFOB,
    estimatedLanded,
    confidence,
    breakdown,
    benchmarkSource: `Historical data (${topMatches.length} matching records; ${observed.length} with component breakdown)`,
    sampleSize: topMatches.length,
    varianceFromQuote,
    recommendation
  };
}

function observedCostComponents(raw: Record<string, unknown> | null, total: number) {
  if (!raw || total <= 0) return null;
  const materials = firstNumber(raw, ["materialTotal", "totalMaterialCost", "total_material_cost", "mainMaterialCost", "main_material_cost"]);
  const labor = firstNumber(raw, ["laborTotal", "laborCost", "directLaborCosts", "direct_labor_costs", "knittingOpsCost", "knitting_ops_cost"]);
  const overhead = firstNumber(raw, ["overheadTotal", "overheadCost", "oh"]);
  const landed = firstNumber(raw, ["landedCost", "landed_cost"]);
  if (materials === null && labor === null && overhead === null) return null;

  const known = Math.max(0, materials ?? 0) + Math.max(0, labor ?? 0) + Math.max(0, overhead ?? 0);
  const profit = Math.max(0, total - known);
  return {
    materials: Math.max(0, materials ?? 0) / total,
    labor: Math.max(0, labor ?? 0) / total,
    overhead: Math.max(0, overhead ?? 0) / total,
    profit: profit / total,
    landedRatio: landed !== null && landed > 0 ? landed / total : 1
  };
}

function firstNumber(raw: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = raw[key];
    const cleaned = String(value ?? "").replace(/[$,%\s]/g, "");
    if (value === null || value === undefined || cleaned === "") continue;
    const number = typeof value === "number" ? value : Number(cleaned);
    if (Number.isFinite(number)) return number;
  }
  return null;
}
