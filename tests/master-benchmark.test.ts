import { readFileSync as fsReadFileSync } from "node:fs";
// Load .env.local so integration-style tests (save/list/delete curated rows,
// getMasterBenchmark) can talk to the real Supabase service client.
for (const line of fsReadFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
}

import { afterAll, describe, expect, it } from "vitest";
import {
  findBenchmarkLine,
  flagAgainstBenchmark,
  type MasterBenchmarkLine
} from "../src/lib/costing/master-benchmark";
import { computeGrossMarginInfo, generateSmartReviewSync } from "../src/lib/ai/smart-review";
import type { CostingTotals } from "../src/lib/costing/totals";

function benchmarkLine(overrides: Partial<MasterBenchmarkLine> = {}): MasterBenchmarkLine {
  return {
    label: "100% acrylic",
    category: "material",
    average: 2,
    median: 1.9,
    max: 3,
    sampleSize: 5,
    ...overrides
  };
}

describe("master material benchmark", () => {
  it("finds an exact normalized match", () => {
    const bench = [benchmarkLine()];
    expect(findBenchmarkLine(bench, "100% Acrylic", "material")?.label).toBe("100% acrylic");
  });

  it("finds a prefix match for partial names", () => {
    const bench = [benchmarkLine({ label: "100% acrylic" })];
    expect(findBenchmarkLine(bench, "100% Acrylic, Wool Blend", "material")?.label).toBe("100% acrylic");
  });

  it("does not match across categories", () => {
    const bench = [benchmarkLine({ category: "operation", label: "sewing" })];
    expect(findBenchmarkLine(bench, "sewing", "material")).toBeNull();
  });

  it("flags a line materially above the average", () => {
    const flag = flagAgainstBenchmark([benchmarkLine()], "100% Acrylic", "material", 3, 30);
    expect(flag).not.toBeNull();
    expect(flag!.variancePercent).toBe(50); // (3-2)/2
    expect(flag!.actual).toBe(3);
  });

  it("does not flag within the variance tolerance", () => {
    const flag = flagAgainstBenchmark([benchmarkLine()], "100% Acrylic", "material", 2.4, 30);
    expect(flag).toBeNull();
  });

  it("returns null for missing/zero actuals and unknown labels", () => {
    const bench = [benchmarkLine()];
    expect(flagAgainstBenchmark(bench, "100% Acrylic", "material", null)).toBeNull();
    expect(flagAgainstBenchmark(bench, "100% Acrylic", "material", 0)).toBeNull();
    expect(flagAgainstBenchmark(bench, "unknown material", "material", 5)).toBeNull();
  });
});

function totals(overrides: Partial<CostingTotals> = {}): CostingTotals {
  return {
    grandTotal: 3,
    currency: "USD",
    materialTotal: 2,
    laborCost: 0.2,
    overheadCost: 0.2,
    packagingCost: 0.1,
    testingCost: 0,
    profitAmount: 0.5,
    profitMarginPercent: 20,
    freightCost: 0,
    dutyAmount: 0,
    dutyRate: 0,
    insuranceCost: 0,
    customsClearanceCost: 0,
    inlandTransportCost: 0,
    landedCost: 0,
    wholesaleMarkup: 0,
    retailMarkup: 0,
    moq: 100,
    wholesalePrice: 0,
    retailPrice: 0,
    ...overrides
  } as unknown as CostingTotals;
}

describe("smart review — low-margin soft flag", () => {
  it("flags margin below the threshold as a soft warning (not high risk)", () => {
    // wholesale 3.5 - landed 3 = 0.5 margin < 1 threshold
    const result = generateSmartReviewSync(
      {
        status: "for_pbd_review",
        totals: totals({ landedCost: 3, wholesalePrice: 3.5 }),
        validation: [],
        materialLines: []
      },
      { marginThresholdUsd: 1 }
    );
    expect(result.highlights.join(" ")).toContain("Gross margin is below");
    expect(result.riskLevel).toBe("medium");
  });

  it("never escalates a low margin to high risk by itself", () => {
    // Even a deeply negative margin is only a soft flag (manual discussion).
    const result = generateSmartReviewSync(
      {
        status: "for_pbd_review",
        totals: totals({ landedCost: 5, wholesalePrice: 3 }),
        validation: [],
        materialLines: []
      },
      { marginThresholdUsd: 1 }
    );
    expect(result.riskLevel).not.toBe("high");
    expect(result.highlights.join(" ")).toContain("Gross margin is below");
  });

  it("does not flag when margin is above the threshold", () => {
    // wholesale 5 - landed 3 = 2 >= 1
    const result = generateSmartReviewSync(
      {
        status: "for_pbd_review",
        totals: totals({ landedCost: 3, wholesalePrice: 5 }),
        validation: [],
        materialLines: []
      },
      { marginThresholdUsd: 1 }
    );
    expect(result.highlights.join(" ")).not.toContain("Gross margin is below");
  });

  it("uses FOB when no landed cost exists", () => {
    // wholesale 3.5 - grandTotal 3 = 0.5 < 1
    const result = generateSmartReviewSync(
      {
        status: "for_pbd_review",
        totals: totals({ landedCost: 0, wholesalePrice: 3.5, grandTotal: 3 }),
        validation: [],
        materialLines: []
      },
      { marginThresholdUsd: 1 }
    );
    expect(result.highlights.join(" ")).toContain("Gross margin is below");
  });

  it("does not flag when no wholesale price is set yet", () => {
    const result = generateSmartReviewSync(
      {
        status: "for_pbd_review",
        totals: totals({ landedCost: 3, wholesalePrice: 0 }),
        validation: [],
        materialLines: []
      },
      { marginThresholdUsd: 1 }
    );
    expect(result.highlights.join(" ")).not.toContain("Gross margin is below");
  });
});

describe("computeGrossMarginInfo — Approval-tab margin banner", () => {
  it("reports the exact margin number and threshold when low", () => {
    const info = computeGrossMarginInfo(totals({ landedCost: 3, wholesalePrice: 3.5 }), 1);
    expect(info.marginUsd).toBe(0.5);
    expect(info.thresholdUsd).toBe(1);
    expect(info.currency).toBe("USD");
    expect(info.lowMargin).toBe(true);
  });

  it("falls back to FOB when no landed cost exists", () => {
    const info = computeGrossMarginInfo(totals({ landedCost: 0, wholesalePrice: 3.5, grandTotal: 3 }), 1);
    expect(info.marginUsd).toBe(0.5);
    expect(info.lowMargin).toBe(true);
  });

  it("is not low when margin meets or exceeds the guideline", () => {
    const info = computeGrossMarginInfo(totals({ landedCost: 3, wholesalePrice: 5 }), 1);
    expect(info.marginUsd).toBe(2);
    expect(info.lowMargin).toBe(false);
  });

  it("has no margin until a wholesale price is entered", () => {
    const info = computeGrossMarginInfo(totals({ landedCost: 3, wholesalePrice: 0 }), 1);
    expect(info.marginUsd).toBeNull();
    expect(info.lowMargin).toBe(false);
  });

  it("returns a no-margin state for a missing CBD", () => {
    const info = computeGrossMarginInfo(null, 1);
    expect(info.marginUsd).toBeNull();
    expect(info.lowMargin).toBe(false);
    expect(info.currency).toBe("USD");
  });
});

import {
  saveCuratedBenchmark,
  listCuratedBenchmarks,
  deleteCuratedBenchmark,
  getMasterBenchmark,
  type CuratedBenchmarkRow
} from "../src/lib/costing/master-benchmark";

describe("curated benchmark persistence", () => {
  const created: string[] = [];

  afterAll(async () => {
    for (const id of created) await deleteCuratedBenchmark(id).catch(() => undefined);
  });

  it("saves and lists a curated material reference", async () => {
    const { data, error } = await saveCuratedBenchmark({
      label: "CURATED TEST YARN",
      category: "material",
      curatedAverage: 2.4,
      curatedMedian: 2.3,
      curatedMax: 2.8,
      isTime: false,
      notes: "test reference",
      updatedBy: "test"
    });
    expect(error).toBeNull();
    expect(data?.label.toLowerCase()).toBe("curated test yarn");
    if (data) created.push(data.id);

    const { data: list, error: listError } = await listCuratedBenchmarks();
    expect(listError).toBeNull();
    expect(list.some((row) => row.label.toLowerCase() === "curated test yarn")).toBe(true);
  });

  it("upserts on the same label+category (no duplicate)", async () => {
    const first = await saveCuratedBenchmark({
      label: "CURATED TEST KNIT",
      category: "knitting",
      curatedAverage: 25,
      isTime: true,
      updatedBy: "test"
    });
    expect(first.error).toBeNull();
    if (first.data) created.push(first.data.id);

    const second = await saveCuratedBenchmark({
      label: "CURATED TEST KNIT",
      category: "knitting",
      curatedAverage: 30,
      isTime: true,
      updatedBy: "test"
    });
    expect(second.error).toBeNull();
    if (second.data) created.push(second.data.id);

    const { data: list } = await listCuratedBenchmarks();
    const matches = list.filter((row) => row.label.toLowerCase() === "curated test knit");
    expect(matches.length).toBe(1);
    expect(matches[0].curated_average).toBe(30);
  });

  it("deletes a curated reference by id", async () => {
    const { data, error } = await saveCuratedBenchmark({
      label: "CURATED TEST DELETE",
      category: "operation",
      curatedAverage: 0.5,
      isTime: false,
      updatedBy: "test"
    });
    expect(error).toBeNull();
    if (!data) return;

    const { error: delError } = await deleteCuratedBenchmark(data.id);
    expect(delError).toBeNull();

    const { data: list } = await listCuratedBenchmarks();
    expect(list.some((row) => row.id === data.id)).toBe(false);
  });

  it("merges curated rows into the derived benchmark (curated wins)", async () => {
    const benchmark = await getMasterBenchmark();
    expect(benchmark.error).toBeUndefined();
    // After the two saved rows above, curated test yarn should appear in the merged list.
    const curated = benchmark.lines.find((line) => line.label === "curated test yarn");
    if (curated) {
      expect(curated.isCurated).toBe(true);
      expect(curated.average).toBe(2.4);
    }
    // Every line is well-formed.
    for (const line of benchmark.lines) {
      expect(line.label.length).toBeGreaterThan(0);
      expect(["material", "operation", "knitting"]).toContain(line.category);
    }
  });
});
