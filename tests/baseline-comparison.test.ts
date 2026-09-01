import { describe, expect, it } from "vitest";
import { baselineComparison } from "../src/lib/costing/totals";

// baselineComparison powers the "Baseline reference" strip in the Costing
// Summary: reviewers see what the new costing was copied from and how the
// actual factory cost compares.

describe("baselineComparison", () => {
  it("computes delta and percent when current is above baseline", () => {
    const result = baselineComparison(6.5, 6.09);
    expect(result).toEqual({
      delta: expect.closeTo(0.41, 10),
      deltaPercent: expect.closeTo(6.73, 2),
      direction: "above"
    });
  });

  it("computes delta and percent when current is below baseline", () => {
    const result = baselineComparison(5.5, 6.09);
    expect(result).toEqual({
      delta: expect.closeTo(-0.59, 10),
      deltaPercent: expect.closeTo(-9.69, 2),
      direction: "below"
    });
  });

  it("reports equal when the costs match", () => {
    expect(baselineComparison(6.09, 6.09)?.direction).toBe("equal");
    expect(baselineComparison(6.09, 6.09)?.delta).toBe(0);
  });

  it("returns null when either side is missing", () => {
    expect(baselineComparison(null, 6.09)).toBeNull();
    expect(baselineComparison(6.09, null)).toBeNull();
    expect(baselineComparison(undefined, undefined)).toBeNull();
  });
});
