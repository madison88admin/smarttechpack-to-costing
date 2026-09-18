import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { generateSmartReviewSync, type SmartReview } from "@/lib/ai/smart-review";
import { tryGetBenchmarkByAttributes, tryGetBenchmarkSummary } from "@/lib/costing/history";
import { calculateCostingTotals } from "./totals";

/**
 * Shared outlier-review engine for the PBD approval gate and the Costing
 * acknowledgment route. Both must evaluate the exact same flags against the
 * same CBD revision, so the recompute lives here in one place.
 */

export type OutlierReviewResult = {
  review: SmartReview;
  /** Latest factory CBD the review was computed against (null when none). */
  cbd: { id: string; submitted_at: string | null; raw_payload: unknown } | null;
  /** The statistical-outlier flags that are active (empty when not high risk). */
  flags: string[];
};

const FLAG_PATTERN = /(average|benchmark|variance|Consumption|Knitting time|Grand total)/;

export function extractOutlierFlags(review: SmartReview): string[] {
  return review.highlights.filter((highlight) => FLAG_PATTERN.test(highlight));
}

export function isHighRisk(review: SmartReview): boolean {
  return review.riskLevel === "high";
}

export async function getOutlierReview(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  requestId: string
): Promise<OutlierReviewResult> {
  const { data: request, error: requestError } = await supabase
    .from("costing_requests")
    .select("id, factory_name, baseline_ref")
    .eq("id", requestId)
    .single();

  if (requestError) throw requestError;

  const { data: cbd, error: cbdError } = await supabase
    .from("factory_cbds")
    .select("id, submitted_at, raw_payload, cbd_material_lines (consumption, total_cost, currency, material_name, section, uom)")
    .eq("costing_request_id", requestId)
    .order("submitted_at", { ascending: false, nullsFirst: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (cbdError) throw cbdError;

  const result: OutlierReviewResult = {
    review: {
      riskLevel: "low",
      summary: "",
      suggestedAction: "",
      highlights: [],
      suggestedComment: ""
    },
    cbd: cbd
      ? { id: String(cbd.id ?? ""), submitted_at: (cbd.submitted_at as string | null) ?? null, raw_payload: cbd.raw_payload }
      : null,
    flags: []
  };

  if (!cbd?.raw_payload) return result;

  const lines = (cbd.cbd_material_lines ?? []) as Array<{
    consumption: number | null;
    total_cost: number | null;
    currency: string | null;
    material_name: string | null;
    section?: string | null;
    uom?: string | null;
  }>;
  const totals = calculateCostingTotals({ rawPayload: cbd.raw_payload, lines });

  const [benchmark, attributeBenchmark, validation] = await Promise.all([
    tryGetBenchmarkSummary({
      factoryName: request?.factory_name ?? null,
      currentTotal: totals.grandTotal,
      currency: totals.currency,
      excludeRequestId: requestId
    }),
    tryGetBenchmarkByAttributes({
      yarnType: readText(cbd.raw_payload, "yarnType"),
      knitType: readText(cbd.raw_payload, "knitType"),
      machineType: readText(cbd.raw_payload, "machineType"),
      excludeRequestId: requestId
    }),
    supabase
      .from("validation_results")
      .select("severity, rule_code, message")
      .eq("costing_request_id", requestId)
      .is("resolved_at", null)
  ]);

  const materialLinesForAvg = lines.filter((line) => {
    const section = String(line.section ?? "").toLowerCase();
    const uom = String(line.uom ?? "").toLowerCase();
    if (["yarn", "fabric", "trim"].includes(section)) return true;
    if (["g", "yards", "piece"].includes(uom)) return true;
    if (section === "knitting" || section === "operations") return false;
    return true;
  });

  const review = generateSmartReviewSync({
    status: "for_pbd_review",
    totals,
    benchmark: benchmark.data,
    attributeBenchmark: attributeBenchmark.data,
    currentConsumption: averageConsumption(materialLinesForAvg),
    currentKnittingTime: readNumber(cbd.raw_payload, "knittingTime"),
    validation: (validation.data ?? []) as Array<{ severity: string; rule_code: string; message: string }>,
    materialLines: lines.map((line) => ({ material_name: line.material_name, unit_cost: null, total_cost: line.total_cost })),
    baselineRef: (request?.baseline_ref as import("./history").BaselineRef | null) ?? null
  });

  result.review = review;
  result.flags = extractOutlierFlags(review);
  return result;
}

/**
 * True when Costing has acknowledged the outliers of the CURRENT CBD revision:
 * the latest "outlier_acknowledged" action must be recorded after the latest
 * CBD submission, so a revised CBD invalidates the previous acknowledgment.
 */
export type OutlierAcknowledgement = {
  id: string;
  actorName: string | null;
  actorRole: string | null;
  justification: string | null;
  flags: string[];
  riskLevel: string | null;
  acknowledgedAt: string;
};

/**
 * Fetches the most recent outlier acknowledgment for a request (who, when,
 * justification, flag snapshot). Null when Costing has never acknowledged.
 * The gate, the acknowledgment route, and the SmartReviewPanel all share this
 * so they always agree on what was acknowledged.
 */
export async function getLastOutlierAcknowledgement(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  requestId: string
): Promise<OutlierAcknowledgement | null> {
  const { data, error } = await supabase
    .from("approval_actions")
    .select("id, actor_name, actor_role, comment, metadata, created_at")
    .eq("costing_request_id", requestId)
    .eq("action", "outlier_acknowledged")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const metadata = (data.metadata && typeof data.metadata === "object"
    ? (data.metadata as Record<string, unknown>)
    : {}) as Record<string, unknown>;

  return {
    id: String(data.id ?? ""),
    actorName: (data.actor_name as string | null) ?? null,
    actorRole: (data.actor_role as string | null) ?? null,
    justification: (data.comment as string | null) ?? null,
    flags: Array.isArray(metadata.flags) ? metadata.flags.map(String) : [],
    riskLevel: (metadata.riskLevel as string | null) ?? null,
    acknowledgedAt: String(data.created_at ?? "")
  };
}

/** Best-effort wrapper for the detail page (never throws). */
export async function tryGetOutlierReview(requestId: string) {
  try {
    const supabase = createSupabaseServiceClient();
    return { data: await getOutlierReview(supabase, requestId), error: null };
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : "Unable to load outlier review"
    };
  }
}

export async function tryGetLastOutlierAcknowledgement(requestId: string) {
  try {
    const supabase = createSupabaseServiceClient();
    return { data: await getLastOutlierAcknowledgement(supabase, requestId), error: null };
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : "Unable to load outlier acknowledgment"
    };
  }
}

/**
 * True when the acknowledgment covers the CURRENT CBD revision: it must have
 * been recorded after the latest CBD submission, so a revised CBD invalidates
 * the previous acknowledgment until Costing re-acknowledges.
 */
export function isOutlierAcknowledgementValid(acknowledgement: OutlierAcknowledgement | null, cbdSubmittedAt: string | null): boolean {
  if (!acknowledgement?.acknowledgedAt) return false;
  if (!cbdSubmittedAt) return true; // no revision timestamp: accept it
  return new Date(acknowledgement.acknowledgedAt).getTime() > new Date(cbdSubmittedAt).getTime();
}

export async function hasValidOutlierAcknowledgement(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  requestId: string,
  cbdSubmittedAt: string | null
): Promise<boolean> {
  const acknowledgement = await getLastOutlierAcknowledgement(supabase, requestId);
  return isOutlierAcknowledgementValid(acknowledgement, cbdSubmittedAt);
}

function readText(rawPayload: unknown, key: string) {
  if (!rawPayload || typeof rawPayload !== "object") return null;
  const value = (rawPayload as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNumber(rawPayload: unknown, key: string) {
  if (!rawPayload || typeof rawPayload !== "object") return null;
  const value = (rawPayload as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function averageConsumption(lines: { consumption: number | null }[]) {
  const values = lines.map((line) => line.consumption).filter((value): value is number => typeof value === "number");
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}
