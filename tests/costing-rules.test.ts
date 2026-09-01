import { describe, expect, it } from "vitest";
import { calculateCostingTotals } from "../src/lib/costing/totals";
import { hasBlockingIssues, validateBenchmarkVariance, validateFactoryCbd } from "../src/lib/costing/validation";

describe("costing totals", () => {
  it("calculates FOB, CIF duty, and landed cost", () => {
    const result = calculateCostingTotals({
      lines: [{ total_cost: 5, currency: "USD" }],
      rawPayload: { laborCost: 1, overheadCost: 1, packagingCost: 0.5, testingCost: 0.5, profitMargin: 10, freightCost: 1, insuranceCost: 0.2, dutyRate: 5 }
    });
    expect(result.grandTotal).toBeCloseTo(8.8);
    expect(result.dutyAmount).toBeCloseTo(0.5);
    expect(result.landedCost).toBeCloseTo(10.5);
  });

  it("uses the submitted structured CBD total instead of double-counting section rows", () => {
    const result = calculateCostingTotals({
      // Structured persistence contains material, knitting and operation rows.
      // Only 1.13 is material cost; summing every row would incorrectly report 1.48.
      lines: [
        { total_cost: 1.13, currency: "USD" },
        { total_cost: 0.2, currency: "USD" },
        { total_cost: 0.15, currency: "USD" }
      ],
      rawPayload: {
        materialTotal: 1.13,
        laborCost: 0.35,
        packagingCost: 0.12,
        overheadCost: 0.2,
        profitCost: 0.25,
        factoryCostTotal: 2.05,
        grandTotal: 2.05
      }
    });

    expect(result.materialTotal).toBeCloseTo(1.13);
    expect(result.profitAmount).toBeCloseTo(0.25);
    expect(result.grandTotal).toBeCloseTo(2.05);
  });
});

describe("costing validation", () => {
  it("blocks missing currency and invalid material price", () => {
    const issues = validateFactoryCbd({
      currency: "",
      laborCost: "1",
      overheadCost: "1",
      moq: "100",
      leadTimeDays: "30",
      materialBufferPercent: "5",
      packagingCost: "0.1",
      testingCost: "0.1",
      brandNominatedItems: "None",
      m88Packaging: "Standard",
      yarnType: "Cotton",
      knitType: "Jersey",
      machineType: "Flat knit",
      lines: [{ materialName: "Yarn", unitCost: "0", consumption: "1" }]
    } as Parameters<typeof validateFactoryCbd>[0]);
    expect(hasBlockingIssues(issues)).toBe(true);
    expect(issues.map((issue) => issue.ruleCode)).toContain("missing_currency");
    expect(issues.map((issue) => issue.ruleCode)).toContain("invalid_unit_cost");
  });

  it("flags historical variance beyond the configured threshold", () => {
    expect(validateBenchmarkVariance({ currentTotal: 12, historicalAverage: 10, sampleSize: 3, variancePercent: 20, thresholdPercent: 15 })[0]?.ruleCode)
      .toBe("high_historical_variance");
  });
});
