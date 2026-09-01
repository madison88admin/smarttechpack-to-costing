import { describe, expect, it } from "vitest";
import { computeMarginAnalytics, marginFor, type MarginRequestRow } from "../src/lib/costing/margin-analytics";

function row(overrides: Partial<MarginRequestRow> = {}): MarginRequestRow {
  return {
    requestId: "req-1",
    requestNumber: "CR-1001",
    status: "approved",
    brand: "M88",
    customer: "Customer A",
    factoryName: "Factory 1",
    currency: "USD",
    wholesalePrice: 4,
    costBasis: 3,
    pricingSource: "pbd",
    updatedAt: "2026-07-15T10:00:00Z",
    ...overrides
  };
}

describe("marginFor", () => {
  it("computes wholesale − cost basis", () => {
    expect(marginFor(row({ wholesalePrice: 4, costBasis: 3 }))).toBe(1);
  });
  it("is null when either side is missing", () => {
    expect(marginFor(row({ wholesalePrice: null }))).toBeNull();
    expect(marginFor(row({ costBasis: null }))).toBeNull();
  });
});

describe("computeMarginAnalytics", () => {
  it("skips rows without pricing or cost basis", () => {
    const analytics = computeMarginAnalytics([
      row({ requestId: "a", wholesalePrice: 4, costBasis: 3 }),
      row({ requestId: "b", wholesalePrice: null, costBasis: 3 }),
      row({ requestId: "c", wholesalePrice: 4, costBasis: null })
    ]);
    expect(analytics.totalWithMargin).toBe(1);
    expect(analytics.avgMarginUsd).toBe(1);
    expect(analytics.byBrand).toHaveLength(1);
  });

  it("computes avg / min / max across the portfolio", () => {
    const analytics = computeMarginAnalytics([
      row({ requestId: "a", wholesalePrice: 5, costBasis: 3 }), // +2
      row({ requestId: "b", wholesalePrice: 4, costBasis: 3 }), // +1
      row({ requestId: "c", wholesalePrice: 3.5, costBasis: 3 }) // +0.5
    ]);
    expect(analytics.totalWithMargin).toBe(3);
    expect(analytics.avgMarginUsd).toBeCloseTo(1.1667, 3);
    expect(analytics.minMarginUsd).toBe(0.5);
    expect(analytics.maxMarginUsd).toBe(2);
  });

  it("counts below-threshold across every status (soft-flag population)", () => {
    const analytics = computeMarginAnalytics([
      row({ requestId: "a", status: "approved", wholesalePrice: 3.5, costBasis: 3 }), // 0.5 below
      row({ requestId: "b", status: "for_pbd_review", wholesalePrice: 3.4, costBasis: 3 }), // 0.4 below
      row({ requestId: "c", status: "approved", wholesalePrice: 5, costBasis: 3 }) // above
    ], { thresholdUsd: 1 });
    expect(analytics.belowThresholdCount).toBe(2);
    expect(analytics.avgMarginUsd).toBeCloseTo(0.9667, 3);
  });

  it("aggregates by brand / customer / factory sorted by volume", () => {
    const analytics = computeMarginAnalytics([
      row({ requestId: "a", brand: "M88", customer: "Cust A", factoryName: "F1", wholesalePrice: 4, costBasis: 3 }),
      row({ requestId: "b", brand: "M88", customer: "Cust A", factoryName: "F1", wholesalePrice: 5, costBasis: 3 }),
      row({ requestId: "c", brand: "Kids", customer: "Cust B", factoryName: "F2", wholesalePrice: 6, costBasis: 3 })
    ]);
    expect(analytics.byBrand.map((row) => row.label)).toEqual(["M88", "Kids"]);
    expect(analytics.byBrand[0].avgMarginUsd).toBe(1.5);
    expect(analytics.byCustomer.map((row) => row.label)).toEqual(["Cust A", "Cust B"]);
    expect(analytics.byFactory.map((row) => row.label)).toEqual(["F1", "F2"]);
    expect(analytics.byFactory[0].count).toBe(2);
  });

  it("groups the trend by month, sorted chronologically", () => {
    const analytics = computeMarginAnalytics([
      row({ requestId: "a", wholesalePrice: 4, costBasis: 3, updatedAt: "2026-05-01T00:00:00Z" }),
      row({ requestId: "b", wholesalePrice: 6, costBasis: 3, updatedAt: "2026-06-10T00:00:00Z" }),
      row({ requestId: "c", wholesalePrice: 4, costBasis: 3, updatedAt: "2026-06-20T00:00:00Z" })
    ]);
    expect(analytics.trend.map((point) => point.label)).toEqual(["2026-05", "2026-06"]);
    expect(analytics.trend[1].count).toBe(2);
    expect(analytics.trend[1].avgMarginUsd).toBe(2);
  });

  it("watchlist keeps only approved below threshold, worst first", () => {
    const analytics = computeMarginAnalytics([
      row({ requestId: "a", status: "approved", wholesalePrice: 3.5, costBasis: 3 }), // 0.5
      row({ requestId: "b", status: "for_pbd_review", wholesalePrice: 3.2, costBasis: 3 }), // 0.8 — NOT approved
      row({ requestId: "c", status: "approved", wholesalePrice: 3.8, costBasis: 3 }), // 0.8
      row({ requestId: "d", status: "approved", wholesalePrice: 5, costBasis: 3 }) // above
    ], { thresholdUsd: 1 });
    expect(analytics.atRisk.map((row) => row.requestId)).toEqual(["a", "c"]);
    expect(analytics.atRisk[0].marginUsd).toBe(0.5);
  });

  it("excludes non-USD rows from averages but keeps them in totals and watchlist", () => {
    const analytics = computeMarginAnalytics([
      row({ requestId: "a", currency: "USD", wholesalePrice: 4, costBasis: 3 }), // 1
      row({ requestId: "b", currency: "PHP", status: "approved", wholesalePrice: 200, costBasis: 199.5 }) // 0.5 PHP — below the USD $1 guideline
    ], { thresholdUsd: 1 });
    expect(analytics.totalWithMargin).toBe(2);
    expect(analytics.avgMarginUsd).toBe(1); // USD only
    expect(analytics.atRisk.map((row) => row.requestId)).toEqual(["b"]);
  });

  it("accepts derived-estimate rows (PBD pricing pending) alongside real ones", () => {
    const analytics = computeMarginAnalytics([
      row({ requestId: "a", wholesalePrice: 4, costBasis: 3, pricingSource: "pbd" }), // 1
      row({ requestId: "b", wholesalePrice: 6.6, costBasis: 3, pricingSource: "derived" }) // 3.6 est.
    ]);
    expect(analytics.totalWithMargin).toBe(2);
    expect(analytics.avgMarginUsd).toBe(2.3);
    expect(analytics.atRisk).toHaveLength(0);
  });

  it("handles an empty portfolio", () => {
    const analytics = computeMarginAnalytics([]);
    expect(analytics.totalWithMargin).toBe(0);
    expect(analytics.avgMarginUsd).toBeNull();
    expect(analytics.atRisk).toEqual([]);
    expect(analytics.trend).toEqual([]);
    expect(analytics.byBrand).toEqual([]);
  });
});
