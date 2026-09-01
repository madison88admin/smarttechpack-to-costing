import { describe, expect, it } from "vitest";
import { generateSmartReviewSync } from "../src/lib/ai/smart-review";
import type { CostingTotals } from "../src/lib/costing/totals";
import type { BaselineRef } from "../src/lib/costing/history";

// The submitted CBD is compared automatically against the request's copied
// baseline cost and the variance is flagged in Smart Review (which feeds the
// PBD outlier gate too).

function totals(grandTotal: number): CostingTotals {
  return {
    grandTotal,
    currency: "USD",
    materialTotal: grandTotal,
    laborCost: 0,
    overheadCost: 0,
    packagingCost: 0,
    testingCost: 0,
    profitAmount: 0,
    profitMarginPercent: 0,
    freightCost: 0,
    dutyAmount: 0,
    dutyRate: 0,
    insuranceCost: 0,
    customsClearanceCost: 0,
    inlandTransportCost: 0,
    landedCost: 0,
    wholesaleMarkup: 0,
    retailMarkup: 0,
    moq: 0,
    wholesalePrice: 0,
    retailPrice: 0
  } as unknown as CostingTotals;
}

const baseline: BaselineRef = {
  source: "historical",
  historicalId: "h1",
  sourceRequestId: null,
  styleNumber: "M88-OLD",
  factoryName: "Cebu Factory",
  totalCost: 5,
  currency: "USD",
  approvedAt: "2026-01-01T00:00:00Z",
  yarnType: "Acrylic",
  knitType: "Flat",
  machineType: "7G",
  construction: "Rib",
  productCategory: "Hats",
  averageConsumption: 0.2,
  knittingTime: 0.4,
  brand: null,
  customer: null,
  season: null
};

function review(total: number, baselineRef: BaselineRef | null = baseline) {
  return generateSmartReviewSync({
    status: "for_pbd_review",
    totals: totals(total),
    validation: [],
    materialLines: [],
    baselineRef
  });
}

describe("Smart Review — baseline variance", () => {
  it("flags high risk when the CBD is far above the copied baseline", () => {
    // 6.5 vs baseline 5 → +30% (> default warning 15) → high risk
    const result = review(6.5);
    expect(result.riskLevel).toBe("high");
    expect(result.highlights.join(" ")).toContain("30.0% above the copied baseline");
    expect(result.highlights.join(" ")).toContain("USD 5.00");
    expect(result.highlights.join(" ")).toContain("M88-OLD");
    expect(result.suggestedAction).toContain("copied baseline");
  });

  it("flags when below the baseline too", () => {
    // 4 vs baseline 5 → -20% (< -warning) → high risk
    const result = review(4);
    expect(result.riskLevel).toBe("high");
    expect(result.highlights.join(" ")).toContain("20.0% below the copied baseline");
  });

  it("stays low when within the baseline variance", () => {
    const result = review(5.3); // +6%
    expect(result.riskLevel).toBe("low");
    expect(result.highlights.join(" ")).toContain("within the copied baseline variance (6.0%");
  });

  it("adds no baseline flag when there is no baseline", () => {
    const result = review(6.5, null);
    expect(result.highlights.join(" ")).not.toContain("copied baseline");
    expect(result.highlights.join(" ")).toContain("No historical cost benchmark is available");
    expect(result.riskLevel).toBe("low");
  });

  it("keeps the historical-benchmark flags independent of the baseline", () => {
    const result = generateSmartReviewSync({
      status: "for_pbd_review",
      totals: totals(6.5),
      benchmark: {
        currentTotal: 6.5,
        historicalAverage: 5,
        variancePercent: 30,
        sampleSize: 3,
        currency: "USD",
        matches: [],
        currencyConverted: false,
        convertedCount: 0,
        convertedFrom: [],
        reliability: "reliable"
      },
      validation: [],
      materialLines: [],
      baselineRef: baseline
    });
    expect(result.highlights.join(" ")).toContain("30.0% above historical average");
    expect(result.highlights.join(" ")).toContain("30.0% above the copied baseline");
  });
});
