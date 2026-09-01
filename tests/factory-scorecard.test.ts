import { describe, expect, it } from "vitest";
import { computeFactoryScorecard, type ScorecardRequestInput } from "../src/lib/costing/factory-scorecard";
import type { MasterBenchmarkLine } from "../src/lib/costing/master-benchmark";

const BENCH: MasterBenchmarkLine[] = [
  { label: "acrylic yarn", category: "material", average: 2, median: 2, max: 2.4, sampleSize: 5 },
  { label: "cotton fabric", category: "material", average: 4, median: 4, max: 4.8, sampleSize: 5 }
];

function request(overrides: Partial<ScorecardRequestInput> = {}): ScorecardRequestInput {
  return {
    id: "req-1",
    factoryName: "Factory A",
    status: "approved",
    created_at: "2026-08-01T00:00:00Z",
    approval_actions: [],
    hasCbd: true,
    cbd_material_lines: [],
    ...overrides
  };
}

function action(action: string, from: string, to: string, at: string) {
  return { action, from_status: from, to_status: to, created_at: at };
}

describe("computeFactoryScorecard", () => {
  it("quote accuracy: lines within tolerance score 100%, over-benchmark lines lower it", () => {
    const scorecard = computeFactoryScorecard(
      [
        request({
          id: "a",
          cbd_material_lines: [
            { material_name: "Acrylic Yarn", unit_cost: 2.2 }, // +10% — ok
            { material_name: "Cotton Fabric", unit_cost: 4.0 } // 0% — ok
          ]
        }),
        request({
          id: "b",
          cbd_material_lines: [
            { material_name: "Acrylic Yarn", unit_cost: 3.0 } // +50% — over
          ]
        })
      ],
      BENCH
    );
    const row = scorecard.rows[0];
    expect(row.matchedLines).toBe(3);
    expect(row.overBenchmarkLines).toBe(1);
    expect(row.quoteAccuracyPct).toBeCloseTo(66.7, 1);
    expect(row.avgVariancePct).toBeCloseTo(20, 1);
  });

  it("cycle time: avg hours per completed stage from consecutive actions", () => {
    const scorecard = computeFactoryScorecard(
      [
        request({
          id: "a",
          status: "approved",
          created_at: "2026-08-01T00:00:00Z",
          approval_actions: [
            action("send_to_factory", "draft", "sent_to_factory", "2026-08-01T06:00:00Z"),
            action("submit", "sent_to_factory", "for_costing_review", "2026-08-02T06:00:00Z"), // 24h in sent_to_factory
            action("costing_complete", "for_costing_review", "for_pbd_review", "2026-08-03T06:00:00Z"), // 24h in costing
            action("approve", "for_pbd_review", "approved", "2026-08-04T06:00:00Z") // 24h in pbd
          ]
        })
      ],
      BENCH
    );
    const row = scorecard.rows[0];
    const byKey = Object.fromEntries(row.stages.map((s) => [s.key, s]));
    expect(byKey.sent_to_factory.avgHours).toBe(24);
    expect(byKey.for_costing_review.avgHours).toBe(24);
    expect(byKey.for_pbd_review.avgHours).toBe(24);
    expect(byKey.end_to_end.avgHours).toBe(78); // created Aug 1 00:00 → approve Aug 4 06:00
  });

  it("cycle time: excludes in-progress stages and averages across requests", () => {
    const scorecard = computeFactoryScorecard(
      [
        request({
          id: "a",
          status: "approved",
          created_at: "2026-08-01T00:00:00Z",
          approval_actions: [
            action("send_to_factory", "draft", "sent_to_factory", "2026-08-01T04:00:00Z"),
            action("submit", "sent_to_factory", "for_costing_review", "2026-08-01T06:00:00Z") // 2h
          ]
        }),
        request({
          id: "b",
          status: "for_costing_review", // still in costing — no exit, excluded
          created_at: "2026-08-02T00:00:00Z",
          approval_actions: [
            action("send_to_factory", "draft", "sent_to_factory", "2026-08-02T04:00:00Z"),
            action("submit", "sent_to_factory", "for_costing_review", "2026-08-02T10:00:00Z") // 6h, but costing never completes
          ]
        })
      ],
      BENCH
    );
    const row = scorecard.rows[0];
    const byKey = Object.fromEntries(row.stages.map((s) => [s.key, s]));
    expect(byKey.sent_to_factory.avgHours).toBe(4); // (2 + 6) / 2
    expect(byKey.for_costing_review.avgHours).toBeNull(); // no completed segment
    expect(byKey.for_costing_review.samples).toBe(0);
  });

  it("clarification rate counts returns to needs_clarification per submitted request", () => {
    const scorecard = computeFactoryScorecard(
      [
        request({
          id: "a",
          status: "approved",
          hasCbd: true,
          approval_actions: [
            action("clarify", "for_pbd_review", "needs_clarification", "2026-08-03T00:00:00Z"),
            action("submit", "needs_clarification", "for_costing_review", "2026-08-04T00:00:00Z")
          ]
        }),
        request({ id: "b", status: "approved", hasCbd: true, approval_actions: [] }),
        request({ id: "c", status: "draft", hasCbd: false, approval_actions: [] })
      ],
      BENCH
    );
    const row = scorecard.rows[0];
    expect(row.clarifications).toBe(1);
    expect(row.submitted).toBe(2);
    expect(row.clarificationRate).toBe(0.5);
  });

  it("groups by factory and sorts by request volume", () => {
    const scorecard = computeFactoryScorecard(
      [
        request({ id: "a", factoryName: "Small Co", hasCbd: true }),
        request({ id: "b", factoryName: "Big Co", hasCbd: true }),
        request({ id: "c", factoryName: "Big Co", hasCbd: true })
      ],
      BENCH
    );
    expect(scorecard.rows.map((r) => r.factoryName)).toEqual(["Big Co", "Small Co"]);
    expect(scorecard.rows[0].requests).toBe(2);
  });

  it("handles factories with no benchmark matches and empty input", () => {
    const scorecard = computeFactoryScorecard(
      [request({ id: "a", cbd_material_lines: [{ material_name: "exotic fiber", unit_cost: 9 }] })],
      BENCH
    );
    expect(scorecard.rows[0].quoteAccuracyPct).toBeNull();
    expect(scorecard.rows[0].matchedLines).toBe(0);

    const empty = computeFactoryScorecard([], BENCH);
    expect(empty.rows).toEqual([]);
  });

  it("end-to-end cycle only for approved requests", () => {
    const scorecard = computeFactoryScorecard(
      [
        request({
          id: "a",
          status: "approved",
          created_at: "2026-08-01T00:00:00Z",
          approval_actions: [action("approve", "for_pbd_review", "approved", "2026-08-05T00:00:00Z")]
        }),
        request({
          id: "b",
          status: "for_costing_review",
          created_at: "2026-08-01T00:00:00Z",
          approval_actions: [action("submit", "sent_to_factory", "for_costing_review", "2026-08-02T00:00:00Z")]
        })
      ],
      BENCH
    );
    const row = scorecard.rows[0];
    const byKey = Object.fromEntries(row.stages.map((s) => [s.key, s]));
    expect(byKey.end_to_end.avgHours).toBe(96); // only the approved one
    expect(byKey.end_to_end.samples).toBe(1);
  });
});
