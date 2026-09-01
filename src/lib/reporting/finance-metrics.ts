import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { calculateCostingTotals } from "@/lib/costing/totals";

export type FinanceMetrics = {
  totalRequests: number;
  approvedCount: number;
  rejectedCount: number;
  pendingCount: number;
  approvalRate: number | null;
  rejectionRate: number | null;
  averageCycleTimeDays: number | null;
  averageCostVariancePercent: number | null;
  totalApprovedValue: number | null;
  currency: string;
  factoryPerformance: FactoryPerformanceRow[];
  monthlyTrend: MonthlyTrendRow[];
  statusBreakdown: { status: string; count: number }[];
  costVarianceDistribution: { range: string; count: number }[];
};

export type FactoryPerformanceRow = {
  factoryName: string;
  totalRequests: number;
  approvedCount: number;
  averageCost: number | null;
  averageVariancePercent: number | null;
  averageCycleTimeDays: number | null;
};

export type MonthlyTrendRow = {
  month: string;
  requestCount: number;
  approvedCount: number;
  averageCost: number | null;
};

export async function getFinanceMetrics(): Promise<FinanceMetrics> {
  const supabase = createSupabaseServiceClient();

  // Fetch all requests with product info
  const { data: requests, error } = await supabase
    .from("costing_requests")
    .select(
      `
      id,
      request_number,
      status,
      factory_name,
      created_at,
      updated_at,
      nextgen_products (style_number, name)
    `
    )
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) throw error;

  const typedRequests = (requests ?? []) as Array<{
    id: string;
    request_number: string | null;
    status: string;
    factory_name: string | null;
    created_at: string;
    updated_at: string;
    nextgen_products: unknown;
  }>;

  const approved = typedRequests.filter((r) => r.status === "approved");
  const rejected = typedRequests.filter((r) => r.status === "rejected");
  const pending = typedRequests.filter((r) =>
    ["draft", "sent_to_factory", "for_costing_review", "for_pbd_review", "needs_clarification"].includes(r.status)
  );

  const approvalRate = typedRequests.length > 0 ? (approved.length / typedRequests.length) * 100 : null;
  const rejectionRate = typedRequests.length > 0 ? (rejected.length / typedRequests.length) * 100 : null;

  // Cycle time: average days from created_at to updated_at for approved requests
  const cycleTimes = approved.map((r) => daysBetween(r.created_at, r.updated_at));
  const averageCycleTimeDays = cycleTimes.length
    ? cycleTimes.reduce((s, d) => s + d, 0) / cycleTimes.length
    : null;

  // Fetch CBD data for cost calculations
  const approvedIds = approved.map((r) => r.id);
  let totalApprovedValue = 0;
  let varianceSum = 0;
  let varianceCount = 0;
  let currency = "USD";

  if (approvedIds.length > 0) {
    const { data: cbds } = await supabase
      .from("factory_cbds")
      .select("costing_request_id, raw_payload, cbd_material_lines (unit_cost, total_cost, currency)")
      .in("costing_request_id", approvedIds);

    const typedCbds = (cbds ?? []) as Array<{
      costing_request_id: string;
      raw_payload: unknown;
      cbd_material_lines: Array<{ unit_cost: number | null; total_cost: number | null; currency: string | null }>;
    }>;

    for (const cbd of typedCbds) {
      const payload = (cbd.raw_payload ?? {}) as Record<string, unknown>;
      const totals = calculateCostingTotals({
        rawPayload: payload,
        lines: (cbd.cbd_material_lines ?? []).map((line) => ({
          total_cost: line.total_cost,
          currency: line.currency
        }))
      });
      totalApprovedValue += totals.grandTotal;
      currency = totals.currency;

      // Variance vs historical
      if (typeof payload.warningVariancePercent === "number") {
        varianceSum += Math.abs(payload.warningVariancePercent);
        varianceCount++;
      }
    }
  }

  // Also check validation_results for variance data
  if (varianceCount === 0 && approvedIds.length > 0) {
    const { data: validations } = await supabase
      .from("validation_results")
      .select("costing_request_id, rule_code, message")
      .in("costing_request_id", approvedIds)
      .ilike("rule_code", "%variance%");

    for (const v of (validations ?? []) as Array<{ message: string }>) {
      const match = v.message.match(/(\d+\.?\d*)%/);
      if (match) {
        varianceSum += parseFloat(match[1]);
        varianceCount++;
      }
    }
  }

  const averageCostVariancePercent = varianceCount > 0 ? varianceSum / varianceCount : null;

  // Factory performance
  const factoryMap = new Map<string, { total: number; approved: number; costs: number[]; variances: number[]; cycleTimes: number[] }>();
  for (const req of typedRequests) {
    const factory = req.factory_name ?? "Unassigned";
    if (!factoryMap.has(factory)) {
      factoryMap.set(factory, { total: 0, approved: 0, costs: [], variances: [], cycleTimes: [] });
    }
    const entry = factoryMap.get(factory)!;
    entry.total++;
    if (req.status === "approved") {
      entry.approved++;
      entry.cycleTimes.push(daysBetween(req.created_at, req.updated_at));
    }
  }

  const factoryPerformance: FactoryPerformanceRow[] = Array.from(factoryMap.entries())
    .map(([factoryName, data]) => ({
      factoryName,
      totalRequests: data.total,
      approvedCount: data.approved,
      averageCost: data.costs.length ? data.costs.reduce((s, c) => s + c, 0) / data.costs.length : null,
      averageVariancePercent: data.variances.length ? data.variances.reduce((s, v) => s + v, 0) / data.variances.length : null,
      averageCycleTimeDays: data.cycleTimes.length ? data.cycleTimes.reduce((s, d) => s + d, 0) / data.cycleTimes.length : null
    }))
    .sort((a, b) => b.totalRequests - a.totalRequests)
    .slice(0, 10);

  // Monthly trend
  const monthMap = new Map<string, { requests: number; approved: number; costs: number[] }>();
  for (const req of typedRequests) {
    const month = req.created_at.slice(0, 7); // YYYY-MM
    if (!monthMap.has(month)) {
      monthMap.set(month, { requests: 0, approved: 0, costs: [] });
    }
    const entry = monthMap.get(month)!;
    entry.requests++;
    if (req.status === "approved") entry.approved++;
  }

  const monthlyTrend: MonthlyTrendRow[] = Array.from(monthMap.entries())
    .map(([month, data]) => ({
      month,
      requestCount: data.requests,
      approvedCount: data.approved,
      averageCost: data.costs.length ? data.costs.reduce((s, c) => s + c, 0) / data.costs.length : null
    }))
    .sort((a, b) => a.month.localeCompare(b.month))
    .slice(-12);

  // Status breakdown
  const statusMap = new Map<string, number>();
  for (const req of typedRequests) {
    statusMap.set(req.status, (statusMap.get(req.status) ?? 0) + 1);
  }
  const statusBreakdown = Array.from(statusMap.entries()).map(([status, count]) => ({ status, count }));

  // Cost variance distribution
  const costVarianceDistribution = [
    { range: "0-5%", count: 0 },
    { range: "5-10%", count: 0 },
    { range: "10-15%", count: 0 },
    { range: "15%+", count: 0 }
  ];

  return {
    totalRequests: typedRequests.length,
    approvedCount: approved.length,
    rejectedCount: rejected.length,
    pendingCount: pending.length,
    approvalRate,
    rejectionRate,
    averageCycleTimeDays,
    averageCostVariancePercent,
    totalApprovedValue: approved.length > 0 ? totalApprovedValue : null,
    currency,
    factoryPerformance,
    monthlyTrend,
    statusBreakdown,
    costVarianceDistribution
  };
}

export async function tryGetFinanceMetrics() {
  try {
    const metrics = await getFinanceMetrics();
    return { metrics, error: null };
  } catch (error) {
    return {
      metrics: null,
      error: error instanceof Error ? error.message : "Unable to load finance metrics"
    };
  }
}

function daysBetween(from: string, to: string): number {
  try {
    const ms = new Date(to).getTime() - new Date(from).getTime();
    return Math.max(0, Math.round(ms / 86_400_000));
  } catch {
    return 0;
  }
}

