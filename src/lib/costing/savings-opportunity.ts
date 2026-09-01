import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { findBenchmarkLine, getMasterBenchmark } from "@/lib/costing/master-benchmark";
import type { MasterBenchmarkLine } from "@/lib/costing/master-benchmark";

/**
 * Savings-opportunity analytics — the cost-saving potential hidden in the
 * current pipeline. Every submitted CBD material line is compared against the
 * master material benchmark (the same reference MD review uses); lines priced
 * more than 30% above the benchmark average are flagged, and the gap is
 * quantified per garment (gap × consumption) and per MOQ order (× order
 * quantity). Internal data: the factory never sees benchmark references.
 */

/** How far above the benchmark average a line must be to count as a saving. */
const OVER_BENCHMARK_PERCENT = 30;

export type SavingsLineInput = {
  materialName: string | null;
  unitCost: number | null;
  consumption: number | null;
  totalCost: number | null;
};

export type SavingsRequestInput = {
  id: string;
  requestNumber: string | null;
  factoryName: string | null;
  /** Order quantity from the CBD (MOQ). Null when not entered. */
  moq: number | null;
  /** Material lines of the latest submitted CBD. */
  cbd_material_lines: SavingsLineInput[];
};

export type SavingsFlagLine = {
  requestId: string;
  requestNumber: string | null;
  factoryName: string | null;
  materialName: string | null;
  benchmarkAvg: number;
  unitCost: number;
  variancePercent: number;
  consumption: number | null;
  moq: number | null;
  /** Gap × consumption — the saving per garment if priced at benchmark. */
  perGarmentSavingsUsd: number;
  /** Per-garment × MOQ — the saving on one order. Null when MOQ is missing. */
  orderSavingsUsd: number | null;
};

export type SavingsOpportunity = {
  totalPerGarmentUsd: number;
  /** Sum of order-level savings for lines with a known MOQ. */
  totalPerOrderUsd: number;
  /** Requests whose lines contribute to the order-level total. */
  orderRequests: number;
  flaggedLines: number;
  flaggedRequests: number;
  /** Sorted by order saving (worst first; MOQ-less lines last). */
  lines: SavingsFlagLine[];
};

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

export function computeSavingsOpportunity(
  requests: SavingsRequestInput[],
  benchmark: MasterBenchmarkLine[],
  variancePercent: number = OVER_BENCHMARK_PERCENT
): SavingsOpportunity {
  const lines: SavingsFlagLine[] = [];

  for (const request of requests) {
    for (const line of request.cbd_material_lines) {
      if (typeof line.unitCost !== "number" || !Number.isFinite(line.unitCost) || line.unitCost <= 0) continue;
      const benchmarkLine = findBenchmarkLine(benchmark, line.materialName, "material");
      if (!benchmarkLine || benchmarkLine.average === null || benchmarkLine.average <= 0) continue;
      const pct = ((line.unitCost - benchmarkLine.average) / benchmarkLine.average) * 100;
      if (pct <= variancePercent) continue;

      // Effective per-garment consumption: direct, or derived from total_cost
      // (total = unit × consumption) when the raw field is missing/zero.
      let consumption: number | null = null;
      if (typeof line.consumption === "number" && Number.isFinite(line.consumption) && line.consumption > 0) {
        consumption = line.consumption;
      } else if (
        typeof line.totalCost === "number" &&
        Number.isFinite(line.totalCost) &&
        line.totalCost > 0 &&
        line.unitCost > 0
      ) {
        consumption = line.totalCost / line.unitCost;
      }
      if (consumption === null) continue; // cannot quantify — skip

      const perGarment = (line.unitCost - benchmarkLine.average) * consumption;
      const orderSavings = request.moq !== null && request.moq > 0 ? perGarment * request.moq : null;

      lines.push({
        requestId: request.id,
        requestNumber: request.requestNumber,
        factoryName: request.factoryName,
        materialName: line.materialName,
        benchmarkAvg: round2(benchmarkLine.average),
        unitCost: round2(line.unitCost),
        variancePercent: round2(pct),
        consumption: round2(consumption),
        moq: request.moq,
        perGarmentSavingsUsd: round2(perGarment),
        orderSavingsUsd: orderSavings !== null ? round2(orderSavings) : null
      });
    }
  }

  lines.sort((a, b) => {
    if (a.orderSavingsUsd !== null && b.orderSavingsUsd !== null) return b.orderSavingsUsd - a.orderSavingsUsd;
    if (a.orderSavingsUsd !== null) return -1;
    if (b.orderSavingsUsd !== null) return 1;
    return b.perGarmentSavingsUsd - a.perGarmentSavingsUsd;
  });

  const totalPerGarmentUsd = lines.reduce((sum, line) => sum + line.perGarmentSavingsUsd, 0);
  const orderLines = lines.filter((line) => line.orderSavingsUsd !== null);
  const totalPerOrderUsd = orderLines.reduce((sum, line) => sum + (line.orderSavingsUsd ?? 0), 0);
  const orderRequests = new Set(orderLines.map((line) => line.requestId)).size;

  return {
    totalPerGarmentUsd: round2(totalPerGarmentUsd),
    totalPerOrderUsd: round2(totalPerOrderUsd),
    orderRequests,
    flaggedLines: lines.length,
    flaggedRequests: new Set(lines.map((line) => line.requestId)).size,
    lines
  };
}

export async function getSavingsOpportunity() {
  try {
    const supabase = createSupabaseServiceClient();
    const [requestsResult, benchmarkResult] = await Promise.all([
      supabase
        .from("costing_requests")
        .select(
          `
          id,
          request_number,
          factory_name,
          factory_cbds (
            status,
            submitted_at,
            raw_payload,
            cbd_material_lines (
              material_name,
              unit_cost,
              consumption,
              total_cost
            )
          )
        `
        )
        .limit(1000),
      getMasterBenchmark()
    ]);

    if (requestsResult.error) {
      return { data: null as SavingsOpportunity | null, error: requestsResult.error.message };
    }

    const inputs: SavingsRequestInput[] = (requestsResult.data ?? []).map((item: Record<string, unknown>) => {
      const cbds = Array.isArray(item.factory_cbds) ? (item.factory_cbds as Array<Record<string, unknown>>) : [];
      const latest = [...cbds].sort((a, b) =>
        String(b.submitted_at ?? "").localeCompare(String(a.submitted_at ?? ""))
      )[0];
      const payload = (latest?.raw_payload ?? {}) as Record<string, unknown>;
      const moq = typeof payload.moq === "number" && payload.moq > 0 ? payload.moq : null;
      const lines = (latest?.cbd_material_lines as Array<Record<string, unknown>> | null) ?? [];
      return {
        id: String(item.id),
        requestNumber: typeof item.request_number === "string" ? item.request_number : null,
        factoryName: typeof item.factory_name === "string" ? item.factory_name : null,
        moq,
        cbd_material_lines: lines.map((line) => ({
          materialName: typeof line.material_name === "string" ? line.material_name : null,
          unitCost: typeof line.unit_cost === "number" ? line.unit_cost : null,
          consumption: typeof line.consumption === "number" ? line.consumption : null,
          totalCost: typeof line.total_cost === "number" ? line.total_cost : null
        }))
      };
    });

    return {
      data: computeSavingsOpportunity(inputs, benchmarkResult.lines),
      error: benchmarkResult.error ?? null
    };
  } catch (error) {
    return {
      data: null as SavingsOpportunity | null,
      error: error instanceof Error ? error.message : "Unable to load savings opportunity"
    };
  }
}
