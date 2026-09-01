import { describe, expect, it } from "vitest";
import { shouldCostSchema } from "../src/lib/api/validate";

// The Should-Cost panel sends null for attributes it does not have (e.g. no
// yarn type recorded in the CBD). Zod's .optional() rejects null, which
// surfaced as the "yarnType: Invalid input" 400 in the UI. The schema must
// tolerate null like the rest of validate.ts (preprocess to undefined).

describe("shouldCostSchema", () => {
  it("accepts null attributes (the panel sends null for missing values)", () => {
    const result = shouldCostSchema.safeParse({
      yarnType: null,
      knitType: null,
      machineType: null,
      construction: null,
      productCategory: null,
      factoryName: null,
      actualQuoteTotal: null,
      currency: null
    });
    expect(result.success).toBe(true);
    const data = result.success ? result.data : null;
    expect(data?.yarnType).toBeUndefined();
    expect(data?.actualQuoteTotal).toBeUndefined();
    expect(data?.currency).toBe("USD"); // null falls through to the default
  });

  it("trims string attributes and keeps valid values", () => {
    const result = shouldCostSchema.safeParse({
      yarnType: "  100% Acrylic  ",
      knitType: "Jacquard",
      actualQuoteTotal: 12.5
    });
    expect(result.success).toBe(true);
    const data = result.success ? result.data : null;
    expect(data?.yarnType).toBe("100% Acrylic");
    expect(data?.actualQuoteTotal).toBe(12.5);
  });

  it("accepts an empty body (everything optional, currency defaults)", () => {
    const result = shouldCostSchema.safeParse({});
    expect(result.success).toBe(true);
    expect(result.success ? result.data.currency : null).toBe("USD");
  });

  it("still rejects a negative actual quote", () => {
    const result = shouldCostSchema.safeParse({ actualQuoteTotal: -1 });
    expect(result.success).toBe(false);
  });

  it("still rejects a non-string attribute when a real value is required", () => {
    // Objects/arrays are not silently coerced - only null/undefined are.
    const result = shouldCostSchema.safeParse({ yarnType: { bad: true } });
    expect(result.success).toBe(false);
  });
});
