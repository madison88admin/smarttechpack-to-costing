import { createSupabaseServiceClient } from "@/lib/supabase/server";

export type AnomalyAlert = {
  id: string;
  type: "cost_increase" | "factory_outlier" | "material_spike" | "margin_below_target";
  severity: "warning" | "critical";
  requestId: string;
  requestNumber: string | null;
  factoryName: string | null;
  styleNumber: string | null;
  message: string;
  currentValue: number;
  historicalAverage: number;
  variancePercent: number;
  detectedAt: string;
};

export async function detectAnomalies(): Promise<{ alerts: AnomalyAlert[]; checked: number }> {
  const supabase = createSupabaseServiceClient();
  const alerts: AnomalyAlert[] = [];

  // 1. Check recent CBDs for cost increases vs historical average
  const { data: recentCbds } = await supabase
    .from("factory_cbds")
    .select(
      `
      id,
      submitted_at,
      raw_payload,
      costing_request_id,
      costing_requests (
        id,
        request_number,
        factory_name,
        status,
        nextgen_products (style_number, name)
      )
    `
    )
    .not("submitted_at", "is", null)
    .order("submitted_at", { ascending: false })
    .limit(50);

  for (const cbd of (recentCbds ?? []) as any[]) {
    const payload = (cbd.raw_payload ?? {}) as Record<string, unknown>;
    const grandTotal = typeof payload.grandTotal === "number" ? payload.grandTotal : 0;
    const currency = typeof payload.currency === "string" ? payload.currency : "USD";
    const styleNumber = cbd.costing_requests?.nextgen_products?.[0]?.style_number
      ?? cbd.costing_requests?.nextgen_products?.style_number
      ?? null;
    const factoryName = cbd.costing_requests?.factory_name ?? null;
    const requestNumber = cbd.costing_requests?.request_number ?? null;

    if (grandTotal <= 0 || !styleNumber) continue;

    // Get historical average for this style
    const { data: historical } = await supabase
      .from("historical_costings")
      .select("total_cost, currency")
      .ilike("style_number", styleNumber)
      .neq("costing_request_id", cbd.costing_request_id)
      .limit(10);

    const historicalRecords = (historical ?? []) as Array<{ total_cost: number | null; currency: string | null }>;
    const sameCurrencyRecords = historicalRecords.filter((r) => r.currency === currency && r.total_cost != null);

    if (sameCurrencyRecords.length < 2) continue;

    const historicalAverage = sameCurrencyRecords.reduce((sum, r) => sum + (r.total_cost ?? 0), 0) / sameCurrencyRecords.length;
    if (historicalAverage <= 0) continue;

    const variancePercent = ((grandTotal - historicalAverage) / historicalAverage) * 100;

    if (variancePercent > 15) {
      alerts.push({
        id: `cost_increase_${cbd.id}`,
        type: "cost_increase",
        severity: variancePercent > 25 ? "critical" : "warning",
        requestId: cbd.costing_request_id,
        requestNumber,
        factoryName,
        styleNumber,
        message: `Cost for ${styleNumber} is ${variancePercent.toFixed(1)}% above historical average (${currency} ${grandTotal.toFixed(2)} vs avg ${currency} ${historicalAverage.toFixed(2)})`,
        currentValue: grandTotal,
        historicalAverage,
        variancePercent,
        detectedAt: cbd.submitted_at
      });
    }

    // 2. Check margin below target
    const landedCost = typeof payload.landedCost === "number" ? payload.landedCost : 0;
    const wholesalePrice = typeof payload.wholesalePrice === "number" ? payload.wholesalePrice : 0;
    if (landedCost > 0 && wholesalePrice > 0) {
      const margin = ((wholesalePrice - landedCost) / wholesalePrice) * 100;
      if (margin < 30) {
        alerts.push({
          id: `margin_low_${cbd.id}`,
          type: "margin_below_target",
          severity: margin < 20 ? "critical" : "warning",
          requestId: cbd.costing_request_id,
          requestNumber,
          factoryName,
          styleNumber,
          message: `Gross margin for ${styleNumber} is ${margin.toFixed(1)}% (below 30% target)`,
          currentValue: margin,
          historicalAverage: 50,
          variancePercent: margin - 50,
          detectedAt: cbd.submitted_at
        });
      }
    }
  }

  // 3. Check for factory outliers — factories consistently above average
  const { data: factoryStats } = await supabase
    .from("historical_costings")
    .select("factory_name, total_cost, currency")
    .not("factory_name", "is", null)
    .limit(200);

  const factoryMap = new Map<string, number[]>();
  for (const row of (factoryStats ?? []) as any[]) {
    if (!row.factory_name || !row.total_cost) continue;
    const list = factoryMap.get(row.factory_name) ?? [];
    list.push(row.total_cost);
    factoryMap.set(row.factory_name, list);
  }

  // Calculate overall average
  const allCosts = Array.from(factoryMap.values()).flat();
  if (allCosts.length > 5) {
    const overallAvg = allCosts.reduce((sum, c) => sum + c, 0) / allCosts.length;

    for (const [factory, costs] of factoryMap.entries()) {
      if (costs.length < 3) continue;
      const factoryAvg = costs.reduce((sum, c) => sum + c, 0) / costs.length;
      const variance = ((factoryAvg - overallAvg) / overallAvg) * 100;

      if (variance > 20) {
        alerts.push({
          id: `factory_outlier_${factory}`,
          type: "factory_outlier",
          severity: variance > 35 ? "critical" : "warning",
          requestId: "",
          requestNumber: null,
          factoryName: factory,
          styleNumber: null,
          message: `Factory "${factory}" averages ${variance.toFixed(1)}% above overall average (${factoryAvg.toFixed(2)} vs avg ${overallAvg.toFixed(2)})`,
          currentValue: factoryAvg,
          historicalAverage: overallAvg,
          variancePercent: variance,
          detectedAt: new Date().toISOString()
        });
      }
    }
  }

  return { alerts, checked: recentCbds?.length ?? 0 };
}
