import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { internalReviewStatuses, terminalStatuses, type CostingStatus } from "@/lib/workflow/status";

// Reporting aggregates for the Reports dashboard (/reports). All queries run
// against tp_costing via the service client, matching the rest of the app.

export type ReportRequestRow = {
  id: string;
  request_number: string | null;
  factory_name: string | null;
  status: string;
  brand: string | null;
  customer: string | null;
  season: string | null;
  product_category: string | null;
  created_at: string;
  updated_at: string;
  style_number: string | null;
  product_name: string | null;
};

export type ReportApprovedRow = {
  costing_request_id: string | null;
  total_cost: number | null;
  currency: string | null;
  approved_at: string | null;
  benchmark_excluded?: boolean;
  yarn_type?: string | null;
  knit_type?: string | null;
  machine_type?: string | null;
  construction?: string | null;
  factory_name?: string | null;
  customer?: string | null;
  season?: string | null;
};

export type ReportCostDimension = { key: string; count: number; avgCost: number | null };

export type ReportTrendRow = { bucket: string; created: number; approved: number; avgCost: number | null };

export type ReportForecast = {
  nextBucket: string | null;
  projectedCreated: number | null;
  projectedApproved: number | null;
  projectedAvgCost: number | null;
  projectedAvgCostLow: number | null;
  projectedAvgCostHigh: number | null;
  forecastWindow: number;
  observedBuckets: number;
  costSampleBuckets: number;
  confidence: "low" | "medium" | "high";
  costDirection: "up" | "down" | "flat" | null;
};

export type ReportBenchmark = {
  targetCost: number | null;
  latestCost: number | null;
  variancePct: number | null;
  band: "above" | "within" | "below" | "no_data";
  tolerancePct: number;
  sampleCount: number;
};

export type ReportHistoryComparison = {
  latest: ReportTrendRow | null;
  previous: ReportTrendRow | null;
  createdChangePct: number | null;
  approvedChangePct: number | null;
  avgCostChangePct: number | null;
};

export type ReportSeasonComparison = {
  current: { season: string; count: number; approved: number; avgCost: number | null } | null;
  previous: { season: string; count: number; approved: number; avgCost: number | null } | null;
};

export type ReportFreshness = {
  status: "fresh" | "stale" | "unknown";
  lastUpdatedAt: string | null;
  ageMinutes: number | null;
  staleAfterMinutes: number;
};

/** Bucket size for the trend chart: calendar day, ISO week, or month. */
export type ReportGranularity = "daily" | "weekly" | "monthly";

export type ReportData = {
  generatedAt: string;
  totalRequests: number;
  totalAvailableRequests: number;
  activeRequests: number;
  approvedCount: number;
  rejectedCount: number;
  inReviewCount: number;
  needsClarificationCount: number;
  approvalRate: number | null;
  averageApprovedCost: number | null;
  byStatus: Array<{ status: string; label: string; count: number }>;
  byFactory: Array<{ key: string; count: number; approved: number }>;
  byBrand: Array<{ key: string; count: number; approved: number }>;
  byCustomer: Array<{ key: string; count: number; approved: number }>;
  bySeason: Array<{ key: string; count: number; approved: number }>;
  trend: ReportTrendRow[];
  forecast: ReportForecast;
  historyComparison: ReportHistoryComparison;
  benchmark: ReportBenchmark;
  seasonComparison: ReportSeasonComparison;
  dataSource: "tp_costing";
  byYarn: ReportCostDimension[];
  byKnit: ReportCostDimension[];
  byMachine: ReportCostDimension[];
  byConstruction: ReportCostDimension[];
  byCustomerCost: ReportCostDimension[];
  byFactoryCost: ReportCostDimension[];
  freshness: ReportFreshness;
  rows: ReportRequestRow[];
};

// Both sets are owned by src/lib/workflow/status.ts.
const TERMINAL_STATUSES = terminalStatuses;
const INTERNAL_REVIEW_STATUSES = internalReviewStatuses;

export type ReportFilters = {
  factory?: string | null;
  brand?: string | null;
  customer?: string | null;
  season?: string | null;
  status?: string | null; // raw costing status key, exact match
  granularity?: ReportGranularity | null; // trend bucket size (defaults monthly)
  from?: string | null; // YYYY-MM-DD (created_at >= from)
  to?: string | null; // YYYY-MM-DD (created_at <= to)
};

export function hasActiveReportFilters(filters: ReportFilters): boolean {
  return Boolean(
    filters.factory || filters.brand || filters.customer || filters.season || filters.status || filters.from || filters.to
  );
}

export async function getReportData(filters: ReportFilters = {}): Promise<ReportData> {
  const supabase = createSupabaseServiceClient();

  const { data: requests, error: requestsError } = await supabase
    .from("costing_requests")
    .select(
      `
      id,
      request_number,
      factory_name,
      status,
      brand,
      customer,
      season,
      product_category,
      created_at,
      updated_at,
      nextgen_products (
        style_number,
        name
      )
    `
    )
    .order("created_at", { ascending: false })
    .limit(2000);

  if (requestsError) throw requestsError;

  const { data: approved, error: approvedError } = await supabase
    .from("historical_costings")
    .select("costing_request_id,total_cost,currency,approved_at,benchmark_excluded,yarn_type,knit_type,machine_type,construction,factory_name,customer,season");

  if (approvedError) throw approvedError;

  const allRows: ReportRequestRow[] = ((requests ?? []) as Array<Record<string, unknown>>).map((row) => {
    const product = Array.isArray(row.nextgen_products)
      ? (row.nextgen_products as Record<string, unknown>[])[0]
      : (row.nextgen_products as Record<string, unknown> | null);
    return {
      id: String(row.id),
      request_number: (row.request_number as string | null) ?? null,
      factory_name: (row.factory_name as string | null) ?? null,
      status: String(row.status ?? "draft"),
      brand: (row.brand as string | null) ?? null,
      customer: (row.customer as string | null) ?? null,
      season: (row.season as string | null) ?? null,
      product_category: (row.product_category as string | null) ?? null,
      created_at: String(row.created_at ?? ""),
      updated_at: String(row.updated_at ?? ""),
      style_number: (product?.style_number as string | null) ?? null,
      product_name: (product?.name as string | null) ?? null
    };
  });

  let filteredRows: ReportRequestRow[] = allRows;
  if (filters.factory) {
    if (["unassigned", "unassigned factory"].includes(filters.factory.toLowerCase())) {
      filteredRows = filteredRows.filter((row) => !(row.factory_name ?? "").trim());
    } else {
      const needle = filters.factory.toLowerCase();
      filteredRows = filteredRows.filter((row) => (row.factory_name ?? "").toLowerCase().includes(needle));
    }
  }
  if (filters.brand) {
    if (["no brand", "unknown brand"].includes(filters.brand.toLowerCase())) {
      filteredRows = filteredRows.filter((row) => !(row.brand ?? "").trim());
    } else {
      const needle = filters.brand.toLowerCase();
      filteredRows = filteredRows.filter((row) => (row.brand ?? "").toLowerCase().includes(needle));
    }
  }
  if (filters.customer) {
    if (["no customer", "unknown customer"].includes(filters.customer.toLowerCase())) {
      filteredRows = filteredRows.filter((row) => !(row.customer ?? "").trim());
    } else {
      const needle = filters.customer.toLowerCase();
      filteredRows = filteredRows.filter((row) => (row.customer ?? "").toLowerCase().includes(needle));
    }
  }
  if (filters.season) {
    if (["no season", "unknown season"].includes(filters.season.toLowerCase())) {
      filteredRows = filteredRows.filter((row) => !(row.season ?? "").trim());
    } else {
      const needle = filters.season.toLowerCase();
      filteredRows = filteredRows.filter((row) => (row.season ?? "").toLowerCase().includes(needle));
    }
  }
  if (filters.status) {
    filteredRows = filteredRows.filter((row) => row.status === filters.status);
  }
  if (filters.from) {
    filteredRows = filteredRows.filter((row) => row.created_at.slice(0, 10) >= filters.from!);
  }
  if (filters.to) {
    filteredRows = filteredRows.filter((row) => row.created_at.slice(0, 10) <= filters.to!);
  }
  const rows = filteredRows;
  const filteredIds = new Set(rows.map((row) => row.id));
  const filterActive = hasActiveReportFilters(filters);

  const approvedRows: ReportApprovedRow[] = ((approved ?? []) as Array<Record<string, unknown>>).map((row) => ({
    costing_request_id: (row.costing_request_id as string | null) ?? null,
    total_cost: typeof row.total_cost === "number" ? row.total_cost : null,
    currency: (row.currency as string | null) ?? null,
    approved_at: (row.approved_at as string | null) ?? null,
    benchmark_excluded: row.benchmark_excluded === true,
    yarn_type: (row.yarn_type as string | null) ?? null,
    knit_type: (row.knit_type as string | null) ?? null,
    machine_type: (row.machine_type as string | null) ?? null,
    construction: (row.construction as string | null) ?? null,
    factory_name: (row.factory_name as string | null) ?? null,
    customer: (row.customer as string | null) ?? null,
    season: (row.season as string | null) ?? null
  }));

  const scopedApprovedRows = approvedRows
    .filter((row) => !row.benchmark_excluded)
    .filter((row) => !filterActive || filteredIds.has(row.costing_request_id ?? ""));
  const approvedCosts = scopedApprovedRows
    .map((row) => row.total_cost)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0);

  const approvedCount = rows.filter((row) => row.status === "approved").length;
  const rejectedCount = rows.filter((row) => row.status === "rejected").length;
  const inReviewCount = rows.filter((row) => (INTERNAL_REVIEW_STATUSES as string[]).includes(row.status)).length;
  const needsClarificationCount = rows.filter((row) => row.status === "needs_clarification").length;
  const activeRequests = rows.filter((row) => !TERMINAL_STATUSES.includes(row.status as CostingStatus)).length;
  const decided = approvedCount + rejectedCount;
  const approvalRate = decided > 0 ? (approvedCount / decided) * 100 : null;
  const averageApprovedCost = approvedCosts.length
    ? approvedCosts.reduce((sum, value) => sum + value, 0) / approvedCosts.length
    : null;

  const statusCounts = new Map<string, number>();
  for (const row of rows) {
    statusCounts.set(row.status, (statusCounts.get(row.status) ?? 0) + 1);
  }
  const byStatus = Array.from(statusCounts.entries())
    .map(([status, count]) => ({ status, label: labelForStatus(status), count }))
    .sort((a, b) => b.count - a.count);

  const byFactory = groupBy(rows, "factory_name", "Unassigned");
  const byBrand = groupBy(rows, "brand", "No brand");
  const byCustomer = groupBy(rows, "customer", "No customer");
  const bySeason = groupBy(rows, "season", "No season");

  // Trend: submissions (created_at), approvals (approved_at) and the average
  // total cost of the approved costings, bucketed by the requested granularity
  // (daily / weekly / monthly).
  const granularity = filters.granularity ?? "monthly";
  const trendLimit = granularity === "daily" ? 60 : granularity === "weekly" ? 26 : 12;
  const bucketMap = new Map<string, { created: number; approved: number; costSum: number; costCount: number }>();
  const bump = (iso: string | null, kind: "created" | "approved", totalCost: number | null) => {
    const bucket = bucketKey(iso, granularity);
    if (!bucket) return;
    const entry = bucketMap.get(bucket) ?? { created: 0, approved: 0, costSum: 0, costCount: 0 };
    entry[kind] += 1;
    if (kind === "approved" && typeof totalCost === "number" && Number.isFinite(totalCost) && totalCost > 0) {
      entry.costSum += totalCost;
      entry.costCount += 1;
    }
    bucketMap.set(bucket, entry);
  };
  for (const row of rows) bump(row.created_at, "created", null);
  for (const approvedRow of scopedApprovedRows) {
    bump(approvedRow.approved_at ?? null, "approved", approvedRow.total_cost);
  }
  const trend = Array.from(bucketMap.entries())
    .map(([bucket, counts]) => ({
      bucket,
      created: counts.created,
      approved: counts.approved,
      avgCost: counts.costCount > 0 ? Math.round((counts.costSum / counts.costCount) * 100) / 100 : null
    }))
    .sort((a, b) => (a.bucket < b.bucket ? -1 : a.bucket > b.bucket ? 1 : 0))
    .slice(-trendLimit);

  const forecast = buildReportForecast(trend, granularity);
  const historyComparison = compareLatestTrendPeriods(trend);
  const benchmark = buildReportBenchmark(approvedCosts, trend);
  const seasonComparison = compareLatestSeasons(rows, scopedApprovedRows);
  const dimensionRows = scopedApprovedRows;
  const freshness = buildReportFreshness(allRows, approvedRows);

  return {
    generatedAt: new Date().toISOString(),
    totalRequests: rows.length,
    totalAvailableRequests: allRows.length,
    activeRequests,
    approvedCount,
    rejectedCount,
    inReviewCount,
    needsClarificationCount,
    approvalRate,
    averageApprovedCost,
    byStatus,
    byFactory,
    byBrand,
    byCustomer,
    bySeason,
    trend,
    forecast,
    historyComparison,
    benchmark,
    seasonComparison,
    dataSource: "tp_costing",
    byYarn: groupCostDimension(dimensionRows, "yarn_type", "No yarn"),
    byKnit: groupCostDimension(dimensionRows, "knit_type", "No knit type"),
    byMachine: groupCostDimension(dimensionRows, "machine_type", "No machine"),
    byConstruction: groupCostDimension(dimensionRows, "construction", "No construction"),
    byCustomerCost: groupCostDimension(dimensionRows, "customer", "No customer"),
    byFactoryCost: groupCostDimension(dimensionRows, "factory_name", "Unassigned"),
    freshness,
    rows
  };
}

export async function tryGetReportData(filters?: ReportFilters) {
  try {
    return { data: await getReportData(filters), error: null };
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : "Unable to load report data"
    };
  }
}

function groupBy(
  rows: ReportRequestRow[],
  field: "factory_name" | "brand" | "customer" | "season",
  fallback: string
): Array<{ key: string; count: number; approved: number }> {
  const map = new Map<string, { count: number; approved: number }>();
  for (const row of rows) {
    const key = (row[field] ?? "").trim() || fallback;
    const entry = map.get(key) ?? { count: 0, approved: 0 };
    entry.count += 1;
    if (row.status === "approved") entry.approved += 1;
    map.set(key, entry);
  }
  return Array.from(map.entries())
    .map(([key, counts]) => ({ key, ...counts }))
    .sort((a, b) => b.count - a.count);
}

function groupCostDimension(
  rows: ReportApprovedRow[],
  field: "yarn_type" | "knit_type" | "machine_type" | "construction" | "customer" | "factory_name",
  fallback: string
): ReportCostDimension[] {
  const map = new Map<string, { count: number; sum: number; costCount: number }>();
  for (const row of rows) {
    const key = (row[field] ?? "").trim() || fallback;
    const entry = map.get(key) ?? { count: 0, sum: 0, costCount: 0 };
    entry.count += 1;
    if (typeof row.total_cost === "number" && Number.isFinite(row.total_cost) && row.total_cost > 0) {
      entry.sum += row.total_cost;
      entry.costCount += 1;
    }
    map.set(key, entry);
  }
  return Array.from(map.entries())
    .map(([key, value]) => ({ key, count: value.count, avgCost: value.costCount ? Math.round((value.sum / value.costCount) * 100) / 100 : null }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

export function buildReportForecast(trend: ReportTrendRow[], granularity: ReportGranularity): ReportForecast {
  // Use up to a year of monthly history (or six-plus weekly/daily buckets)
  // so the projection is not dominated by a single recent spike.
  const forecastWindow = 12;
  const recent = trend.slice(-forecastWindow);
  const costRows = recent.filter((row) => typeof row.avgCost === "number" && row.avgCost > 0);
  const enoughPeriods = trend.length >= 1;
  const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  const projectedCreated = enoughPeriods ? average(recent.map((row) => row.created)) : null;
  const projectedApproved = enoughPeriods ? average(recent.map((row) => row.approved)) : null;
  const projectedAvgCost = enoughPeriods && costRows.length >= 1
    ? average(costRows.map((row) => row.avgCost!))
    : null;
  const costValues = costRows.map((row) => row.avgCost!);
  const costMean = projectedAvgCost;
  const costStdDev = costMean !== null && costValues.length >= 2
    ? Math.sqrt(costValues.reduce((sum, value) => sum + Math.pow(value - costMean, 2), 0) / costValues.length)
    : 0;
  const costDirection = costRows.length >= 2
    ? directionBetween(costRows[0].avgCost!, costRows[costRows.length - 1].avgCost!)
    : null;
  const sample = Math.max(trend.length, costRows.length);
  const confidence: ReportForecast["confidence"] = sample >= 12 ? "high" : sample >= 6 ? "medium" : "low";

  return {
    nextBucket: trend.length ? nextBucketKey(trend[trend.length - 1].bucket, granularity) : null,
    projectedCreated: projectedCreated === null ? null : Math.round(projectedCreated),
    projectedApproved: projectedApproved === null ? null : Math.round(projectedApproved),
    projectedAvgCost: projectedAvgCost === null ? null : Math.round(projectedAvgCost * 100) / 100,
    projectedAvgCostLow: projectedAvgCost === null ? null : Math.max(0, Math.round((projectedAvgCost - costStdDev) * 100) / 100),
    projectedAvgCostHigh: projectedAvgCost === null ? null : Math.round((projectedAvgCost + costStdDev) * 100) / 100,
    forecastWindow,
    observedBuckets: trend.length,
    costSampleBuckets: costRows.length,
    confidence,
    costDirection
  };
}

export function buildReportBenchmark(costs: number[], trend: ReportTrendRow[], tolerancePct = 10): ReportBenchmark {
  const targetCost = costs.length ? Math.round((costs.reduce((sum, value) => sum + value, 0) / costs.length) * 100) / 100 : null;
  const latestCost = trend.at(-1)?.avgCost ?? null;
  const variancePct = targetCost !== null && latestCost !== null ? percentChange(latestCost, targetCost) : null;
  const band: ReportBenchmark["band"] = variancePct === null
    ? "no_data"
    : variancePct > tolerancePct
      ? "above"
      : variancePct < -tolerancePct
        ? "below"
        : "within";
  return { targetCost, latestCost, variancePct, band, tolerancePct, sampleCount: costs.length };
}

export function compareLatestTrendPeriods(trend: ReportTrendRow[]): ReportHistoryComparison {
  const latest = trend.at(-1) ?? null;
  const previous = trend.at(-2) ?? null;
  return {
    latest,
    previous,
    createdChangePct: latest && previous ? percentChange(latest.created, previous.created) : null,
    approvedChangePct: latest && previous ? percentChange(latest.approved, previous.approved) : null,
    avgCostChangePct: latest && previous && latest.avgCost !== null && previous.avgCost !== null
      ? percentChange(latest.avgCost, previous.avgCost)
      : null
  };
}

export function compareLatestSeasons(rows: ReportRequestRow[], approvedRows: ReportApprovedRow[] = []): ReportSeasonComparison {
  const seasonByRequest = new Map(rows.map((row) => [row.id, row.season?.trim() || "No season"]));
  const seasons = new Map<string, { count: number; approved: number; costSum: number; costCount: number; firstCreated: string }>();
  for (const row of rows) {
    const season = row.season?.trim() || "No season";
    const entry = seasons.get(season) ?? { count: 0, approved: 0, costSum: 0, costCount: 0, firstCreated: row.created_at };
    entry.count += 1;
    if (row.status === "approved") entry.approved += 1;
    if (row.created_at && row.created_at < entry.firstCreated) entry.firstCreated = row.created_at;
    seasons.set(season, entry);
  }
  for (const row of approvedRows) {
    const season = (row.season?.trim() || seasonByRequest.get(row.costing_request_id ?? "") || "No season");
    const entry = seasons.get(season) ?? { count: 0, approved: 0, costSum: 0, costCount: 0, firstCreated: "" };
    if (typeof row.total_cost === "number" && Number.isFinite(row.total_cost) && row.total_cost > 0) {
      entry.costSum += row.total_cost;
      entry.costCount += 1;
    }
    seasons.set(season, entry);
  }
  const ordered = Array.from(seasons.entries())
    .sort((a, b) => b[1].firstCreated.localeCompare(a[1].firstCreated))
    .map(([season, value]) => ({ season, count: value.count, approved: value.approved, avgCost: value.costCount ? Math.round((value.costSum / value.costCount) * 100) / 100 : null }));
  return { current: ordered[0] ?? null, previous: ordered[1] ?? null };
}

export function buildReportFreshness(rows: ReportRequestRow[], approvedRows: ReportApprovedRow[], staleAfterMinutes = 24 * 60): ReportFreshness {
  const timestamps = [
    ...rows.flatMap((row) => [row.created_at, row.updated_at]),
    ...approvedRows.map((row) => row.approved_at ?? "")
  ].filter((value) => value && !Number.isNaN(new Date(value).getTime()));
  const lastUpdatedAt = timestamps.length
    ? timestamps.reduce((latest, value) => value > latest ? value : latest, timestamps[0])
    : null;
  if (!lastUpdatedAt) return { status: "unknown", lastUpdatedAt: null, ageMinutes: null, staleAfterMinutes };
  const ageMinutes = Math.max(0, Math.round((Date.now() - new Date(lastUpdatedAt).getTime()) / 60000));
  return { status: ageMinutes <= staleAfterMinutes ? "fresh" : "stale", lastUpdatedAt, ageMinutes, staleAfterMinutes };
}

export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

function directionBetween(first: number, last: number): ReportForecast["costDirection"] {
  const change = percentChange(last, first);
  if (change === null || Math.abs(change) < 2) return "flat";
  return change > 0 ? "up" : "down";
}

function nextBucketKey(bucket: string, granularity: ReportGranularity): string | null {
  if (granularity === "monthly") {
    const match = /^(\d{4})-(\d{2})$/.exec(bucket);
    if (!match) return null;
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
    date.setUTCMonth(date.getUTCMonth() + 1);
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  }
  if (granularity === "daily") {
    const date = new Date(`${bucket}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) return null;
    date.setUTCDate(date.getUTCDate() + 1);
    return date.toISOString().slice(0, 10);
  }
  const match = /^(\d{4})-W(\d{2})$/.exec(bucket);
  if (!match) return null;
  const year = Number(match[1]);
  const week = Number(match[2]);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - (jan4.getUTCDay() || 7) + 1 + (week - 1) * 7 + 7);
  return bucketKey(monday.toISOString(), "weekly");
}

function labelForStatus(status: string): string {
  const labels: Record<string, string> = {
    draft: "Draft",
    sent_to_factory: "Sent to Factory",
    needs_clarification: "Needs Clarification",
    for_md_review: "For MD Review",
    for_costing_review: "For Costing Review",
    for_pbd_review: "For PBD Review",
    approved: "Approved",
    rejected: "Rejected"
  };
  return labels[status] ?? status.replace(/_/g, " ");
}

/**
 * Bucket key for a timestamp: YYYY-MM-DD (daily), ISO YYYY-Www (weekly,
 * Monday-based), or YYYY-MM (monthly). All formats sort lexicographically.
 */
export function bucketKey(iso: string | null | undefined, granularity: ReportGranularity): string | null {
  if (!iso) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return null;
  if (granularity === "daily") return `${match[1]}-${match[2]}-${match[3]}`;
  if (granularity === "monthly") return `${match[1]}-${match[2]}`;

  const date = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  const dayNum = date.getUTCDay() || 7; // Mon=1 ... Sun=7
  date.setUTCDate(date.getUTCDate() + 4 - dayNum); // move to the week's Thursday
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/**
 * Per-bucket counts of the rows matching a predicate, bucketed by each row's
 * created_at using the same key as the trend chart. Used for the metric-card
 * sparklines of point-in-time states (active / in review / needs
 * clarification / rejected) where no event history exists: the shape shows
 * which creation periods the current backlog came from.
 */
export function countByBucket(
  rows: ReportRequestRow[],
  granularity: ReportGranularity,
  predicate: (row: ReportRequestRow) => boolean = () => true
): number[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!predicate(row)) continue;
    const bucket = bucketKey(row.created_at, granularity);
    if (!bucket) continue;
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([, count]) => count);
}

// --- Request register sorting (concurrent page edit referenced these) ---

const REGISTER_SORT_KEYS = [
  "request_number",
  "style_number",
  "product_name",
  "factory_name",
  "brand",
  "customer",
  "season",
  "status",
  "created_at"
] as const;

export type RegisterSortKey = (typeof REGISTER_SORT_KEYS)[number];

/** Normalizes a raw ?sort= param into a valid register sort key (defaults to created_at). */
export function normalizeRegisterSort(sort: string | null | undefined): RegisterSortKey {
  const value = sort?.trim();
  if (value && (REGISTER_SORT_KEYS as readonly string[]).includes(value)) {
    return value as RegisterSortKey;
  }
  return "created_at";
}

/** Sorts request-register rows by the given key and direction (nulls always last). */
export function sortReportRows(rows: ReportRequestRow[], sort: RegisterSortKey, dir: "asc" | "desc"): ReportRequestRow[] {
  const factor = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = a[sort] ?? "";
    const bv = b[sort] ?? "";
    const aNull = av === "" || av === null || av === undefined;
    const bNull = bv === "" || bv === null || bv === undefined;
    if (aNull && bNull) return 0;
    if (aNull) return 1; // nulls last in both directions
    if (bNull) return -1;
    return av < bv ? -factor : av > bv ? factor : 0;
  });
}

// --- Register preferences (persisted across visits) ---

export type RegisterPrefs = {
  sort: RegisterSortKey;
  dir: "asc" | "desc";
  page: number;
};

/** Serializes register prefs into a localStorage-safe JSON string. */
export function serializeRegisterPrefs(prefs: RegisterPrefs): string {
  return JSON.stringify({ sort: prefs.sort, dir: prefs.dir, page: prefs.page });
}

/** Parses a stored prefs string; returns null when missing or malformed. */
export function parseRegisterPrefs(raw: string | null | undefined): RegisterPrefs | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<RegisterPrefs>;
    if (typeof value !== "object" || value === null) return null;
    return {
      sort: normalizeRegisterSort(value.sort ?? null),
      dir: value.dir === "asc" ? "asc" : "desc",
      page: Math.max(1, Math.floor(Number(value.page)) || 1)
    };
  } catch {
    return null;
  }
}

/**
 * Merges saved prefs into a query string, dropping defaults so the URL only
 * carries non-default state. Returns null when the merge changes nothing.
 */
export function mergeRegisterPrefsIntoQuery(
  query: string,
  prefs: RegisterPrefs,
  defaults: { sort?: RegisterSortKey; dir?: "asc" | "desc"; page?: number } = {}
): string | null {
  const params = new URLSearchParams(query);
  params.delete("sort");
  params.delete("dir");
  params.delete("page");
  const defaultSort = defaults.sort ?? "created_at";
  const defaultDir = defaults.dir ?? "desc";
  const defaultPage = defaults.page ?? 1;
  let changed = false;
  if (prefs.sort !== defaultSort) {
    params.set("sort", prefs.sort);
    changed = true;
  }
  if (prefs.dir !== defaultDir) {
    params.set("dir", prefs.dir);
    changed = true;
  }
  if (prefs.page !== defaultPage) {
    params.set("page", String(prefs.page));
    changed = true;
  }
  return changed ? params.toString() : null;
}
