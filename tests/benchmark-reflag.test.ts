import { readFileSync as fsReadFileSync } from "node:fs";
// Load .env.local for the history integration check (real Supabase).
for (const line of fsReadFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
}

import { describe, expect, it } from "vitest";
import {
  findAffectedLines,
  type AffectedRequest
} from "../src/lib/costing/benchmark-reflag";
import {
  deleteCuratedBenchmark,
  listBenchmarkHistory,
  recordBenchmarkHistory,
  saveCuratedBenchmark
} from "../src/lib/costing/master-benchmark";

function request(overrides: Partial<AffectedRequest> = {}): AffectedRequest {
  return {
    requestId: "req-1",
    requestNumber: "CR-1001",
    factoryName: "Factory A",
    status: "for_costing_review",
    lines: [],
    ...overrides
  };
}

describe("findAffectedLines", () => {
  it("flags lines above the updated benchmark with 30% tolerance", () => {
    const hits = findAffectedLines(
      [request({ lines: [{ materialName: "Acrylic Yarn", unitCost: 3 }] })],
      { label: "Acrylic Yarn", newAverage: 2 }
    );
    expect(hits).toHaveLength(1);
    expect(hits[0].unitCost).toBe(3);
    expect(hits[0].variancePercent).toBe(50);
  });

  it("matches exact normalized and prefix names", () => {
    const hits = findAffectedLines(
      [
        request({ requestId: "a", lines: [{ materialName: "100% Acrylic", unitCost: 3 }] }),
        request({ requestId: "b", lines: [{ materialName: "100% Acrylic, Wool Blend", unitCost: 3 }] }),
        request({ requestId: "c", lines: [{ materialName: "Cotton Fabric", unitCost: 3 }] })
      ],
      { label: "100% Acrylic", newAverage: 2 }
    );
    expect(hits.map((hit) => hit.request.requestId)).toEqual(["a", "b"]);
  });

  it("does not flag lines within the tolerance of the new average", () => {
    const hits = findAffectedLines(
      [request({ lines: [{ materialName: "Acrylic Yarn", unitCost: 2.5 }] })],
      { label: "Acrylic Yarn", newAverage: 2 }
    );
    expect(hits).toHaveLength(0); // 2.5 is +25% — within 30%
  });

  it("returns empty for a zero/missing new average or unknown labels", () => {
    expect(findAffectedLines([request({ lines: [{ materialName: "Acrylic Yarn", unitCost: 9 }] })], { label: "Acrylic Yarn", newAverage: 0 })).toEqual([]);
    expect(findAffectedLines([request({ lines: [{ materialName: "Mystery", unitCost: 9 }] })], { label: "Acrylic Yarn", newAverage: 2 })).toEqual([]);
    expect(findAffectedLines([], { label: "Acrylic Yarn", newAverage: 2 })).toEqual([]);
  });

  it("skips lines without a usable unit cost", () => {
    const hits = findAffectedLines(
      [request({ lines: [{ materialName: "Acrylic Yarn", unitCost: null }] })],
      { label: "Acrylic Yarn", newAverage: 2 }
    );
    expect(hits).toHaveLength(0);
  });
});

// Integration: price history recording + previous-values return. The history
// table ships in migration 008; until it is applied, recording degrades
// gracefully (save still succeeds, history is skipped).
describe("benchmark price history (integration)", () => {
  const createdBenchmarks: string[] = [];

  async function cleanup() {
    for (const id of createdBenchmarks) await deleteCuratedBenchmark(id).catch(() => undefined);
  }

  it("returns previous values and archives changes when the history table exists", async () => {
    const probe = await listBenchmarkHistory();
    const tableExists = probe.error === null;

    const first = await saveCuratedBenchmark({
      label: "HISTORY TEST MATERIAL",
      category: "material",
      curatedAverage: 2,
      isTime: false,
      updatedBy: "test"
    });
    expect(first.error).toBeNull();
    expect(first.previous).toBeNull(); // created fresh
    if (first.data) createdBenchmarks.push(first.data.id);

    const second = await saveCuratedBenchmark({
      label: "HISTORY TEST MATERIAL",
      category: "material",
      curatedAverage: 3,
      isTime: false,
      updatedBy: "test"
    });
    expect(second.error).toBeNull();
    expect(second.previous?.curated_average).toBe(2); // old value exposed for reflag
    if (second.data) createdBenchmarks.push(second.data.id);

    if (tableExists) {
      const history = await listBenchmarkHistory({ label: "HISTORY TEST MATERIAL" });
      expect(history.error).toBeNull();
      const entries = history.data.filter((row) => row.label === "history test material");
      expect(entries.length).toBeGreaterThanOrEqual(2); // creation + update
      const update = entries.find((row) => row.prev_average === 2 && row.new_average === 3);
      expect(update).toBeDefined();
    } else {
      // Graceful degradation: recording reports false but the save worked.
      const recorded = await recordBenchmarkHistory({
        label: "history test material",
        category: "material",
        prev_average: 2,
        new_average: 3,
        is_time: false
      });
      expect(recorded).toBe(false);
    }

    await cleanup();
  });
});
