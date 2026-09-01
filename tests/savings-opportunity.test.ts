import { describe, expect, it } from "vitest";
import { computeSavingsOpportunity, type SavingsRequestInput } from "../src/lib/costing/savings-opportunity";
import type { MasterBenchmarkLine } from "../src/lib/costing/master-benchmark";

const BENCH: MasterBenchmarkLine[] = [
  { label: "acrylic yarn", category: "material", average: 2, median: 2, max: 2.4, sampleSize: 5 },
  { label: "cotton fabric", category: "material", average: 4, median: 4, max: 4.8, sampleSize: 5 }
];

function request(overrides: Partial<SavingsRequestInput> = {}): SavingsRequestInput {
  return {
    id: "req-1",
    requestNumber: "CR-1001",
    factoryName: "Factory A",
    moq: 1000,
    cbd_material_lines: [],
    ...overrides
  };
}

describe("computeSavingsOpportunity", () => {
  it("flags lines above the 30% tolerance and quantifies per garment and per order", () => {
    const savings = computeSavingsOpportunity(
      [
        request({
          id: "a",
          moq: 1000,
          cbd_material_lines: [
            { materialName: "Acrylic Yarn", unitCost: 3, consumption: 2, totalCost: 6 }, // +50% → gap 1 × 2 = 2/garment, 2000/order
            { materialName: "Cotton Fabric", unitCost: 4.5, consumption: 1, totalCost: 4.5 } // +12.5% → not flagged
          ]
        })
      ],
      BENCH
    );
    expect(savings.flaggedLines).toBe(1);
    expect(savings.lines[0].perGarmentSavingsUsd).toBe(2);
    expect(savings.lines[0].orderSavingsUsd).toBe(2000);
    expect(savings.totalPerGarmentUsd).toBe(2);
    expect(savings.totalPerOrderUsd).toBe(2000);
    expect(savings.orderRequests).toBe(1);
    expect(savings.flaggedRequests).toBe(1);
  });

  it("derives consumption from total_cost when the raw field is missing or zero", () => {
    const savings = computeSavingsOpportunity(
      [
        request({
          cbd_material_lines: [
            { materialName: "Acrylic Yarn", unitCost: 3, consumption: 0, totalCost: 6 } // cons = 6/3 = 2
          ]
        })
      ],
      BENCH
    );
    expect(savings.lines[0].consumption).toBe(2);
    expect(savings.lines[0].perGarmentSavingsUsd).toBe(2);
  });

  it("skips lines that cannot be quantified (no consumption, no total cost)", () => {
    const savings = computeSavingsOpportunity(
      [
        request({
          cbd_material_lines: [{ materialName: "Acrylic Yarn", unitCost: 5, consumption: null, totalCost: null }]
        })
      ],
      BENCH
    );
    expect(savings.flaggedLines).toBe(0);
    expect(savings.totalPerOrderUsd).toBe(0);
  });

  it("keeps order savings null when MOQ is missing and totals only MOQ-backed lines", () => {
    const savings = computeSavingsOpportunity(
      [
        request({
          id: "a",
          moq: null,
          cbd_material_lines: [{ materialName: "Acrylic Yarn", unitCost: 3, consumption: 1, totalCost: 3 }]
        }),
        request({
          id: "b",
          moq: 500,
          cbd_material_lines: [{ materialName: "Acrylic Yarn", unitCost: 4, consumption: 1, totalCost: 4 }]
        })
      ],
      BENCH
    );
    const linesByReq = Object.fromEntries(savings.lines.map((l) => [l.requestId, l]));
    expect(linesByReq.a.orderSavingsUsd).toBeNull();
    expect(linesByReq.b.orderSavingsUsd).toBe(1000); // gap 2 × 1 × 500
    expect(savings.totalPerOrderUsd).toBe(1000); // only the MOQ-backed line
    expect(savings.orderRequests).toBe(1);
    expect(savings.totalPerGarmentUsd).toBe(3); // 1 + 2 across both
  });

  it("sorts by order saving, worst first, with MOQ-less lines last", () => {
    const savings = computeSavingsOpportunity(
      [
        request({ id: "small", moq: 100, cbd_material_lines: [{ materialName: "Acrylic Yarn", unitCost: 3, consumption: 1, totalCost: 3 }] }), // 100
        request({ id: "big", moq: 5000, cbd_material_lines: [{ materialName: "Acrylic Yarn", unitCost: 3, consumption: 1, totalCost: 3 }] }), // 5000
        request({ id: "no-moq", moq: null, cbd_material_lines: [{ materialName: "Acrylic Yarn", unitCost: 3, consumption: 1, totalCost: 3 }] })
      ],
      BENCH
    );
    expect(savings.lines.map((l) => l.requestId)).toEqual(["big", "small", "no-moq"]);
  });

  it("handles lines with no benchmark match and empty input", () => {
    const savings = computeSavingsOpportunity(
      [request({ cbd_material_lines: [{ materialName: "exotic fiber", unitCost: 99, consumption: 1, totalCost: 99 }] })],
      BENCH
    );
    expect(savings.flaggedLines).toBe(0);

    const empty = computeSavingsOpportunity([], BENCH);
    expect(empty.lines).toEqual([]);
    expect(empty.totalPerOrderUsd).toBe(0);
    expect(empty.totalPerGarmentUsd).toBe(0);
  });
});
