import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { findBenchmarkLine, getMasterBenchmark } from "@/lib/costing/master-benchmark";
import type { MasterBenchmarkLine } from "@/lib/costing/master-benchmark";
import type { CostingStatus } from "@/lib/workflow/status";

/**
 * Factory scorecard — internal analytics comparing factories on:
 *
 * 1. Quote accuracy — % of benchmark-matched material lines within tolerance
 *    of the master material benchmark (the same reference MD review uses).
 * 2. Avg cycle time per stage — hours spent in sent_to_factory (CBD response),
 *    for_costing_review, for_pbd_review, and end-to-end (created → approved),
 *    derived from consecutive approval_actions timestamps.
 * 3. Clarification / rework rate — times a request was returned to
 *    needs_clarification per submitted request.
 *
 * Internal data: the factory never sees its own (or anyone's) scorecard.
 */

/** How far above the benchmark average a line must be to count as over-quoted. */
const OVER_BENCHMARK_PERCENT = 30;

/** Stages tracked for cycle-time averages (completed segments only). */
const TRACKED_STAGES: CostingStatus[] = ["sent_to_factory", "for_costing_review", "for_pbd_review"];

export type ScorecardAction = {
  action: string;
  from_status: string | null;
  to_status: string | null;
  created_at: string | null;
};

export type ScorecardMaterialLine = {
  material_name: string | null;
  unit_cost: number | null;
};

export type ScorecardRequestInput = {
  id: string;
  factoryName: string | null;
  status: string;
  created_at: string | null;
  approval_actions: ScorecardAction[];
  /** True when the request has a submitted CBD (material lines may still be empty). */
  hasCbd: boolean;
  /** Material lines of the latest submitted CBD (quote-accuracy input). */
  cbd_material_lines: ScorecardMaterialLine[];
};

export type StageCycle = {
  /** Stage key: sent_to_factory / for_costing_review / for_pbd_review / end_to_end. */
  key: string;
  label: string;
  avgHours: number | null;
  samples: number;
};

export type FactoryScorecardRow = {
  factoryName: string;
  requests: number;
  submitted: number;
  approved: number;
  clarifications: number;
  /** Clarifications ÷ submitted requests. Null when nothing was submitted. */
  clarificationRate: number | null;
  matchedLines: number;
  overBenchmarkLines: number;
  /** 100 − % of matched lines flagged over-benchmark. Null with no matches. */
  quoteAccuracyPct: number | null;
  /** Mean variance % of matched lines (positive = above benchmark on average). */
  avgVariancePct: number | null;
  stages: StageCycle[];
};

export type FactoryScorecard = {
  rows: FactoryScorecardRow[];
  benchmarkLines: number;
  builtAt: string;
};

function hoursBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const ta = new Date(a).getTime();
  const tb = new Date(b).getTime();
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return null;
  return (tb - ta) / 3_600_000;
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

export function computeFactoryScorecard(
  requests: ScorecardRequestInput[],
  benchmark: MasterBenchmarkLine[]
): FactoryScorecard {
  const byFactory = new Map<string, ScorecardRequestInput[]>();
  for (const request of requests) {
    const key = (request.factoryName ?? "").trim() || "Unassigned";
    const list = byFactory.get(key) ?? [];
    list.push(request);
    byFactory.set(key, list);
  }

  const rows: FactoryScorecardRow[] = [];
  for (const [factoryName, reqs] of byFactory) {
    // --- Quote accuracy: latest CBD material lines vs master benchmark ---
    let matched = 0;
    let over = 0;
    let varianceSum = 0;
    for (const request of reqs) {
      for (const line of request.cbd_material_lines) {
        if (typeof line.unit_cost !== "number" || !Number.isFinite(line.unit_cost) || line.unit_cost <= 0) continue;
        const benchmarkLine = findBenchmarkLine(benchmark, line.material_name, "material");
        if (!benchmarkLine || benchmarkLine.average === null || benchmarkLine.average <= 0) continue;
        const pct = ((line.unit_cost - benchmarkLine.average) / benchmarkLine.average) * 100;
        matched += 1;
        varianceSum += pct;
        if (pct > OVER_BENCHMARK_PERCENT) over += 1;
      }
    }

    // --- Clarification / rework: any transition back to needs_clarification ---
    let clarifications = 0;
    for (const request of reqs) {
      for (const action of request.approval_actions) {
        if (action.to_status === "needs_clarification") clarifications += 1;
      }
    }

    const submitted = reqs.filter((request) => request.hasCbd).length;
    const approved = reqs.filter((request) => request.status === "approved").length;

    // --- Cycle time: consecutive action pairs bound the time in each stage ---
    const stageHours = new Map<string, number[]>();
    const totalHours: number[] = [];
    for (const request of reqs) {
      const actions = [...request.approval_actions].sort((a, b) =>
        String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""))
      );
      for (let i = 0; i < actions.length; i++) {
        const entered = actions[i].to_status;
        if (!entered || !TRACKED_STAGES.includes(entered as CostingStatus)) continue;
        const duration = hoursBetween(actions[i].created_at, actions[i + 1]?.created_at ?? null);
        if (duration !== null && duration >= 0) {
          const list = stageHours.get(entered) ?? [];
          list.push(duration);
          stageHours.set(entered, list);
        }
      }
      if (request.status === "approved" && actions.length) {
        const duration = hoursBetween(request.created_at, actions[actions.length - 1].created_at);
        if (duration !== null && duration >= 0) totalHours.push(duration);
      }
    }

    const stages: StageCycle[] = [
      { key: "sent_to_factory", label: "CBD response", avgHours: avgOf(stageHours.get("sent_to_factory")), samples: stageHours.get("sent_to_factory")?.length ?? 0 },
      { key: "for_costing_review", label: "Costing review", avgHours: avgOf(stageHours.get("for_costing_review")), samples: stageHours.get("for_costing_review")?.length ?? 0 },
      { key: "for_pbd_review", label: "PBD review", avgHours: avgOf(stageHours.get("for_pbd_review")), samples: stageHours.get("for_pbd_review")?.length ?? 0 },
      { key: "end_to_end", label: "End-to-end", avgHours: avgOf(totalHours), samples: totalHours.length }
    ];

    rows.push({
      factoryName,
      requests: reqs.length,
      submitted,
      approved,
      clarifications,
      clarificationRate: submitted > 0 ? clarifications / submitted : null,
      matchedLines: matched,
      overBenchmarkLines: over,
      quoteAccuracyPct: matched > 0 ? round1((100 * (matched - over)) / matched) : null,
      avgVariancePct: matched > 0 ? round1(varianceSum / matched) : null,
      stages
    });
  }

  rows.sort((a, b) => b.requests - a.requests || a.factoryName.localeCompare(b.factoryName));
  return { rows, benchmarkLines: benchmark.length, builtAt: new Date().toISOString() };
}

function avgOf(values: number[] | undefined): number | null {
  if (!values?.length) return null;
  return round1(values.reduce((sum, value) => sum + value, 0) / values.length);
}

export async function getFactoryScorecard() {
  try {
    const supabase = createSupabaseServiceClient();
    const [requestsResult, benchmarkResult] = await Promise.all([
      supabase
        .from("costing_requests")
        .select(
          `
          id,
          factory_name,
          status,
          created_at,
          approval_actions (
            action,
            from_status,
            to_status,
            created_at
          ),
          factory_cbds (
            status,
            submitted_at,
            cbd_material_lines (
              material_name,
              unit_cost
            )
          )
        `
        )
        .limit(1000),
      getMasterBenchmark()
    ]);

    if (requestsResult.error) {
      return { data: null as FactoryScorecard | null, error: requestsResult.error.message };
    }

    const inputs: ScorecardRequestInput[] = (requestsResult.data ?? []).map((item: Record<string, unknown>) => {
      const cbds = Array.isArray(item.factory_cbds) ? (item.factory_cbds as Array<Record<string, unknown>>) : [];
      const latest = [...cbds].sort((a, b) =>
        String(b.submitted_at ?? "").localeCompare(String(a.submitted_at ?? ""))
      )[0];
      return {
        id: String(item.id),
        factoryName: typeof item.factory_name === "string" ? item.factory_name : null,
        status: String(item.status ?? "draft"),
        created_at: typeof item.created_at === "string" ? item.created_at : null,
        approval_actions: (item.approval_actions as ScorecardAction[] | null) ?? [],
        hasCbd: Boolean(latest && latest.status === "submitted"),
        cbd_material_lines: (latest?.cbd_material_lines as ScorecardMaterialLine[] | null) ?? []
      };
    });

    return {
      data: computeFactoryScorecard(inputs, benchmarkResult.lines),
      error: benchmarkResult.error ?? null
    };
  } catch (error) {
    return {
      data: null as FactoryScorecard | null,
      error: error instanceof Error ? error.message : "Unable to load factory scorecard"
    };
  }
}
