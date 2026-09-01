import type { AttributeBenchmark, BaselineRef, BenchmarkSummary } from "@/lib/costing/history";
import type { CostingTotals } from "@/lib/costing/totals";
import { askLlm, isLlmConfigured } from "@/lib/ai/llm-client";

export type SmartReviewInput = {
  status: string;
  totals: CostingTotals | null;
  benchmark?: BenchmarkSummary | null;
  attributeBenchmark?: AttributeBenchmark | null;
  currentConsumption?: number | null;
  currentKnittingTime?: number | null;
  validation: {
    severity: string;
    rule_code: string;
    message: string;
  }[];
  materialLines: {
    material_name: string | null;
    unit_cost: number | null;
    total_cost: number | null;
  }[];
  /**
   * The approved costing this request was copied from ("Copy baseline"). When
   * present, the submitted CBD is compared against it automatically and the
   * variance is flagged in Smart Review.
   */
  baselineRef?: BaselineRef | null;
};

export type SmartReview = {
  riskLevel: "low" | "medium" | "high";
  summary: string;
  suggestedAction: string;
  highlights: string[];
  suggestedComment: string;
};

// Configurable variance thresholds (mirror workflow_settings). Defaults match
// the original hardcoded values (warning 15, review 8). Attribute-level
// comparisons (consumption / knitting) use looser tolerances derived from
// these (+5 / +2), preserving the original 20 / 10 relationship.
export type SmartReviewThresholds = {
  warningVariancePercent?: number;
  reviewVariancePercent?: number;
  /**
   * Minimum gross margin per unit (USD): wholesale price − landed cost (or
   * FOB when no landed cost). Below this is flagged as a SOFT warning for the
   * manual Costing ↔ PBD discussion — it never blocks approval.
   */
  marginThresholdUsd?: number;
};

/** Structured gross-margin info so UIs (Approval tab, banners) can show the
 * exact margin number and guideline without re-deriving the formula. */
export type MarginInfo = {
  /** Profit per unit: wholesale price − landed cost (FOB when no landed cost). */
  marginUsd: number | null;
  /** Configured minimum-margin guideline (per unit). */
  thresholdUsd: number;
  currency: string;
  /** True when a margin is computable and below the guideline (soft flag). */
  lowMargin: boolean;
};

export function computeGrossMarginInfo(totals: CostingTotals | null, marginThresholdUsd: number = 1): MarginInfo {
  // Gross margin per unit = wholesale − landed cost (fall back to FOB when no landed cost).
  const marginUsd =
    totals && totals.wholesalePrice > 0
      ? totals.wholesalePrice - (totals.landedCost > 0 ? totals.landedCost : totals.grandTotal)
      : null;
  return {
    marginUsd,
    thresholdUsd: marginThresholdUsd,
    currency: totals?.currency ?? "USD",
    lowMargin: marginUsd !== null && marginUsd < marginThresholdUsd
  };
}

export async function generateSmartReview(
  input: SmartReviewInput,
  thresholds?: SmartReviewThresholds
): Promise<SmartReview> {
  const ruleBased = generateRuleBasedReview(input, thresholds);

  // If LLM is configured, try to enhance with AI (with short timeout to avoid blocking page render)
  if (isLlmConfigured() && input.totals) {
    const llmReview = await enhanceWithLlm(input, ruleBased);
    if (llmReview) return llmReview;
  }

  return ruleBased;
}

// Synchronous version that returns rule-based review immediately (for server-side rendering)
// LLM enhancement can be done client-side via /api/ai/smart-review-enhance
export function generateSmartReviewSync(
  input: SmartReviewInput,
  thresholds?: SmartReviewThresholds
): SmartReview {
  return generateRuleBasedReview(input, thresholds);
}

// LLM-enhanced review — uses Qwen3 to generate a more insightful summary and comment
async function enhanceWithLlm(input: SmartReviewInput, base: SmartReview): Promise<SmartReview | null> {
  const systemPrompt = `You are a senior apparel costing analyst reviewing a factory Cost Breakdown Data (CBD) submission. Analyze the costing data and provide:
1. A concise summary (2-3 sentences) of the risk level and key findings
2. A recommended action for the PBD (Product Buyer/Developer)
3. A suggested approval comment that the PBD can use

Be professional, specific, and actionable. Reference actual numbers from the data. Keep the summary under 3 sentences and the comment under 2 sentences.`;

  const dataContext = buildDataContext(input);
  const userPrompt = `Review this costing submission and provide your analysis.\n\n${dataContext}\n\nRule-based analysis already identified:\n- Risk level: ${base.riskLevel}\n- Key highlights: ${base.highlights.join("; ")}\n\nProvide an enhanced summary, suggested action, and suggested comment. Format your response as:\nSUMMARY: <your summary>\nACTION: <your action>\nCOMMENT: <your comment>`;

  const response = await askLlm(systemPrompt, userPrompt, { maxTokens: 500, temperature: 0.3 });

  if (!response.ok || !response.content) return null;

  const parsed = parseLlmResponse(response.content);
  return {
    riskLevel: base.riskLevel,
    summary: parsed.summary || base.summary,
    suggestedAction: parsed.action || base.suggestedAction,
    highlights: base.highlights,
    suggestedComment: parsed.comment || base.suggestedComment
  };
}

function buildDataContext(input: SmartReviewInput): string {
  const t = input.totals!;
  const parts: string[] = [];

  parts.push(`Cost Data:`);
  parts.push(`- Currency: ${t.currency}`);
  parts.push(`- Material Total: ${t.materialTotal.toFixed(2)}`);
  parts.push(`- Labor: ${t.laborCost.toFixed(2)}`);
  parts.push(`- Overhead: ${t.overheadCost.toFixed(2)}`);
  parts.push(`- Packaging: ${t.packagingCost.toFixed(2)}`);
  parts.push(`- Testing: ${t.testingCost.toFixed(2)}`);
  parts.push(`- Profit Margin: ${t.profitMarginPercent}% (${t.profitAmount.toFixed(2)})`);
  parts.push(`- FOB Grand Total: ${t.grandTotal.toFixed(2)}`);
  if (t.landedCost > 0) {
    parts.push(`- Landed Cost: ${t.landedCost.toFixed(2)}`);
    parts.push(`- Wholesale Price: ${t.wholesalePrice.toFixed(2)} (${t.wholesaleMarkup}x markup)`);
    parts.push(`- Gross Margin: ${t.grossMarginPercent.toFixed(1)}%`);
  }

  if (input.benchmark?.variancePercent != null) {
    parts.push(`\nHistorical Benchmark:`);
    parts.push(`- Historical Average: ${input.benchmark.historicalAverage?.toFixed(2) ?? "N/A"}`);
    parts.push(`- Variance: ${input.benchmark.variancePercent.toFixed(1)}%`);
    parts.push(`- Sample Size: ${input.benchmark.sampleSize}`);
  }

  if (input.validation.length > 0) {
    parts.push(`\nValidation Issues:`);
    for (const v of input.validation) {
      parts.push(`- [${v.severity}] ${v.rule_code}: ${v.message}`);
    }
  }

  const topMaterials = [...input.materialLines]
    .filter((line) => typeof line.total_cost === "number")
    .sort((a, b) => Number(b.total_cost) - Number(a.total_cost))
    .slice(0, 5);
  if (topMaterials.length > 0) {
    parts.push(`\nTop Materials by Cost:`);
    for (const m of topMaterials) {
      parts.push(`- ${m.material_name}: ${Number(m.total_cost).toFixed(2)} (unit: ${m.unit_cost?.toFixed(2) ?? "N/A"})`);
    }
  }

  return parts.join("\n");
}

function parseLlmResponse(content: string): { summary?: string; action?: string; comment?: string } {
  const result: { summary?: string; action?: string; comment?: string } = {};
  const lines = content.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.toUpperCase().startsWith("SUMMARY:")) {
      result.summary = trimmed.substring(8).trim();
    } else if (trimmed.toUpperCase().startsWith("ACTION:")) {
      result.action = trimmed.substring(7).trim();
    } else if (trimmed.toUpperCase().startsWith("COMMENT:")) {
      result.comment = trimmed.substring(8).trim();
    }
  }
  return result;
}

// Original rule-based review (used as fallback and for base highlights)
function generateRuleBasedReview(input: SmartReviewInput, thresholds?: SmartReviewThresholds): SmartReview {
  const warning = thresholds?.warningVariancePercent ?? 15;
  const review = thresholds?.reviewVariancePercent ?? 8;
  const highAttribute = warning + 5; // attribute-level "high" tolerance (20 at default)
  const mediumAttribute = review + 2; // attribute-level "medium" tolerance (10 at default)
  const errors = input.validation.filter((issue) => issue.severity === "error");
  const warnings = input.validation.filter((issue) => issue.severity === "warning");
  const variance = input.benchmark?.variancePercent ?? null;
  const baselineVariance = computeVariance(input.totals?.grandTotal, input.baselineRef?.totalCost);
  const consumptionVariance = computeVariance(input.currentConsumption, input.attributeBenchmark?.averageConsumption ?? null);
  const knittingVariance = computeVariance(input.currentKnittingTime, input.attributeBenchmark?.averageKnittingTime ?? null);
  const marginThresholdUsd = thresholds?.marginThresholdUsd ?? 1;
  const marginInfo = computeGrossMarginInfo(input.totals, marginThresholdUsd);
  const lowMargin = marginInfo.lowMargin;
  const topMaterials = [...input.materialLines]
    .filter((line) => typeof line.total_cost === "number")
    .sort((a, b) => Number(b.total_cost) - Number(a.total_cost))
    .slice(0, 3);
  const highlights: string[] = [];

  if (!input.totals) {
    return {
      riskLevel: "medium",
      summary: "No factory CBD has been submitted yet, so the request is not ready for costing approval.",
      suggestedAction: "Send or follow up with factory for CBD completion.",
      highlights: ["CBD is still missing."],
      suggestedComment: "Please complete and submit the factory CBD for PBD review."
    };
  }

  if (errors.length) {
    highlights.push(`${errors.length} blocking validation issue(s) need correction before approval.`);
  }

  if (warnings.length) {
    highlights.push(`${warnings.length} warning(s) should be reviewed before final approval.`);
  }

  if (variance !== null) {
    if (variance > warning) {
      highlights.push(`Grand total is ${variance.toFixed(1)}% above historical average.`);
    } else if (variance < -warning) {
      highlights.push(`Grand total is ${Math.abs(variance).toFixed(1)}% below historical average.`);
    } else {
      highlights.push(`Grand total is within normal historical variance (${variance.toFixed(1)}%).`);
    }
  } else {
    highlights.push("No historical cost benchmark is available yet for this costing.");
  }

  if (baselineVariance !== null) {
    const baselineLabel = input.baselineRef?.styleNumber ?? "the copied baseline";
    const baselineTotal = input.baselineRef?.totalCost ?? 0;
    const currency = input.baselineRef?.currency ?? input.totals!.currency;
    if (baselineVariance > warning) {
      highlights.push(
        `Grand total is ${baselineVariance.toFixed(1)}% above the copied baseline (${currency} ${baselineTotal.toFixed(2)}) from ${baselineLabel}.`
      );
    } else if (baselineVariance < -warning) {
      highlights.push(
        `Grand total is ${Math.abs(baselineVariance).toFixed(1)}% below the copied baseline (${currency} ${baselineTotal.toFixed(2)}) from ${baselineLabel}.`
      );
    } else {
      highlights.push(
        `Grand total is within the copied baseline variance (${baselineVariance.toFixed(1)}% vs ${currency} ${baselineTotal.toFixed(2)} from ${baselineLabel}).`
      );
    }
  }

  if (consumptionVariance !== null) {
    if (Math.abs(consumptionVariance) >= warning) {
      highlights.push(`Consumption is ${consumptionVariance > 0 ? "above" : "below"} attribute benchmark by ${Math.abs(consumptionVariance).toFixed(1)}%.`);
    } else {
      highlights.push(`Consumption is within attribute benchmark range (${consumptionVariance.toFixed(1)}% variance).`);
    }
  }

  if (knittingVariance !== null) {
    if (Math.abs(knittingVariance) >= warning) {
      highlights.push(`Knitting time is ${knittingVariance > 0 ? "above" : "below"} attribute benchmark by ${Math.abs(knittingVariance).toFixed(1)}%.`);
    } else {
      highlights.push(`Knitting time is within attribute benchmark range (${knittingVariance.toFixed(1)}% variance).`);
    }
  }

  if (lowMargin) {
    highlights.push(
      `Gross margin is below the ${formatMoney(marginThresholdUsd, input.totals!.currency)}/unit guideline (${formatMoney(marginInfo.marginUsd!, input.totals!.currency)}) — soft flag for the Costing ↔ PBD discussion, not a blocker.`
    );
  }

  if (topMaterials.length) {
    highlights.push(
      `Top cost driver(s): ${topMaterials
        .map((line) => `${line.material_name ?? "Unnamed material"} (${formatMoney(Number(line.total_cost), input.totals!.currency)})`)
        .join(", ")}.`
    );
  }

  const riskLevel = getRiskLevel(
    {
      errors: errors.length,
      warnings: warnings.length,
      variance,
      baselineVariance,
      consumptionVariance,
      knittingVariance,
      lowMargin
    },
    { warning, review, highAttribute, mediumAttribute }
  );
  const suggestedAction = getSuggestedAction(
    riskLevel,
    errors.length,
    warnings.length,
    variance,
    baselineVariance,
    consumptionVariance,
    knittingVariance,
    { warning, highAttribute }
  );
  const summary = getSummary(riskLevel, input.totals, variance, baselineVariance);

  return {
    riskLevel,
    summary,
    suggestedAction,
    highlights,
    suggestedComment: getSuggestedComment(riskLevel, errors.length, variance, baselineVariance, consumptionVariance, { warning, highAttribute })
  };
}

function computeVariance(current: number | null | undefined, historical: number | null | undefined) {
  if (typeof current !== "number" || typeof historical !== "number" || historical <= 0) return null;
  return ((current - historical) / historical) * 100;
}

function getRiskLevel(
  input: {
    errors: number;
    warnings: number;
    variance: number | null;
    baselineVariance: number | null;
    consumptionVariance: number | null;
    knittingVariance: number | null;
    lowMargin: boolean;
  },
  thresholds: { warning: number; review: number; highAttribute: number; mediumAttribute: number }
): SmartReview["riskLevel"] {
  if (input.errors > 0) return "high";
  if (input.variance !== null && Math.abs(input.variance) >= thresholds.warning) return "high";
  if (input.baselineVariance !== null && Math.abs(input.baselineVariance) >= thresholds.warning) return "high";
  if (input.consumptionVariance !== null && Math.abs(input.consumptionVariance) >= thresholds.highAttribute) return "high";
  if (input.knittingVariance !== null && Math.abs(input.knittingVariance) >= thresholds.highAttribute) return "high";
  // Low margin is a soft flag (manual discussion) — medium at most, never high/blocking.
  if (input.warnings > 0 || input.lowMargin) return "medium";
  if (input.variance !== null && Math.abs(input.variance) >= thresholds.review) return "medium";
  if (input.baselineVariance !== null && Math.abs(input.baselineVariance) >= thresholds.review) return "medium";
  if (input.consumptionVariance !== null && Math.abs(input.consumptionVariance) >= thresholds.mediumAttribute) return "medium";
  if (input.knittingVariance !== null && Math.abs(input.knittingVariance) >= thresholds.mediumAttribute) return "medium";
  return "low";
}

function getSuggestedAction(
  riskLevel: SmartReview["riskLevel"],
  errorCount: number,
  warningCount: number,
  variance: number | null,
  baselineVariance: number | null,
  consumptionVariance: number | null,
  knittingVariance: number | null,
  thresholds: { warning: number; highAttribute: number }
) {
  if (errorCount > 0) return "Request factory clarification before approval.";
  if (variance !== null && variance > thresholds.warning) return "Review variance and ask factory to justify high cost drivers.";
  if (baselineVariance !== null && baselineVariance > thresholds.warning) return "Review variance versus the copied baseline and ask factory to justify high cost drivers.";
  if (consumptionVariance !== null && consumptionVariance > thresholds.highAttribute) return "Consumption is significantly above benchmark — request factory justification.";
  if (knittingVariance !== null && knittingVariance > thresholds.highAttribute) return "Knitting time is significantly above benchmark — request factory justification.";
  if (warningCount > 0) return "Review warnings, then approve if business context is acceptable.";
  if (riskLevel === "low") return "Ready for PBD approval.";
  return "Review before approval.";
}

function getSummary(riskLevel: SmartReview["riskLevel"], totals: CostingTotals, variance: number | null, baselineVariance: number | null) {
  const parts = [];
  if (variance !== null) parts.push(`${variance.toFixed(1)}% variance vs history`);
  if (baselineVariance !== null) parts.push(`${baselineVariance.toFixed(1)}% variance vs copied baseline`);
  const varianceText = parts.length ? parts.join(", ") : "with no benchmark yet";

  return `This costing is ${riskLevel} risk at ${formatMoney(totals.grandTotal, totals.currency)}, ${varianceText}.`;
}

function getSuggestedComment(
  riskLevel: SmartReview["riskLevel"],
  errorCount: number,
  variance: number | null,
  baselineVariance: number | null,
  consumptionVariance: number | null,
  thresholds: { warning: number; highAttribute: number }
) {
  if (errorCount > 0) {
    return "Please revise the CBD and complete the missing/invalid costing fields before PBD approval.";
  }

  if (variance !== null && variance > thresholds.warning) {
    return "Please provide justification for the high variance versus historical costing, especially top material cost drivers.";
  }

  if (baselineVariance !== null && baselineVariance > thresholds.warning) {
    return "Please provide justification for the variance versus the copied baseline costing.";
  }

  if (consumptionVariance !== null && consumptionVariance > thresholds.highAttribute) {
    return "Please provide justification for the high consumption versus attribute benchmark (yarn/knit/machine).";
  }

  if (riskLevel === "low") {
    return "Costing reviewed. Values are within expected range and may proceed for approval.";
  }

  return "Costing reviewed. Please confirm the highlighted items before final approval.";
}

function formatMoney(value: number, currency: string) {
  return `${currency} ${value.toFixed(2)}`;
}
