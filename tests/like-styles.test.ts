import { afterEach, describe, expect, it, vi } from "vitest";
import { findLikeStyles } from "../src/lib/costing/history";

// Tyler's ask: a searchable database of comparative historical styles across
// yarn/knit/machine + notes for MD, Costing, and PBD. These tests cover the
// scoring engine: attribute weighting, notes matching (+2 boost and surfaced
// snippets), min-score filtering, limit, and exclusion of the current request.

const { mocks } = vi.hoisted(() => ({ mocks: { client: null as unknown } }));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: () => mocks.client
}));

import { createMockSupabase, type Responder } from "./helpers/supabase-mock";

type HistRow = Record<string, unknown>;

const rows: HistRow[] = [
  {
    id: "h1",
    costing_request_id: "req-1",
    style_number: "M88-100",
    factory_name: "Cebu Factory",
    total_cost: 3.2,
    currency: "USD",
    approved_at: "2025-01-10T00:00:00Z",
    yarn_type: "100% Acrylic",
    knit_type: "Jacquard",
    machine_type: "7G",
    construction: "Directional Rib Cuff",
    product_category: "Hats",
    average_consumption: 0.21,
    knitting_time: 0.45,
    benchmark_excluded: false
  },
  {
    id: "h2",
    costing_request_id: "req-2",
    style_number: "M88-200",
    factory_name: "Hangzhou U-Jump",
    total_cost: 2.85,
    currency: "USD",
    approved_at: "2025-02-10T00:00:00Z",
    yarn_type: "100% Acrylic",
    knit_type: "Jacquard",
    machine_type: "7G",
    construction: "Rib",
    product_category: "Hats",
    average_consumption: 0.19,
    knitting_time: 0.4,
    benchmark_excluded: false
  },
  {
    id: "h3",
    costing_request_id: "req-3",
    style_number: "M88-300",
    factory_name: "Cebu Factory",
    total_cost: 1.1,
    currency: "USD",
    approved_at: "2025-03-10T00:00:00Z",
    yarn_type: "Cotton",
    knit_type: "Jersey",
    machine_type: "16G",
    construction: "Tubular",
    product_category: "T-Shirts",
    average_consumption: null,
    knitting_time: null,
    benchmark_excluded: false
  }
];

const notes = [
  {
    id: "n1",
    costing_request_id: "req-1",
    note_type: "smv_note",
    note: "SMV re-checked; drop stitch issue on 7G machine.",
    tags: ["smv", "7g"],
    created_by_role: "costing",
    created_at: "2025-01-11T00:00:00Z",
    historical_costings: { style_number: "M88-100", yarn_type: "100% Acrylic", knit_type: "Jacquard", machine_type: "7G" }
  },
  {
    id: "n2",
    costing_request_id: "req-2",
    note_type: "pricing_note",
    note: "Yarn dyed — confirm wash fastness before bulk.",
    tags: ["wash"],
    created_by_role: "pbd",
    created_at: "2025-02-11T00:00:00Z",
    historical_costings: { style_number: "M88-200", yarn_type: "100% Acrylic", knit_type: "Jacquard", machine_type: "7G" }
  }
];

function responder(overrides: Partial<Responder> = {}): Responder {
  return {
    historical_costings: {
      select: () => ({ data: rows, error: null })
    },
    costing_notes: {
      select: () => ({ data: notes, error: null })
    },
    ...overrides
  };
}

afterEach(() => {
  mocks.client = null;
});

describe("findLikeStyles", () => {
  it("scores attribute matches by weight (yarn 3, knit 3, machine 2, construction 2, category 1)", async () => {
    const { client } = createMockSupabase(responder());
    mocks.client = client;

    const results = await findLikeStyles({
      yarnType: "100% Acrylic",
      knitType: "Jacquard",
      machineType: "7G"
    });

    expect(results.length).toBe(2);
    expect(results[0].style_number).toBe("M88-100");
    expect(results[0].matchScore).toBe(8);
    expect(results[0].matchReasons).toContain("Yarn +3");
    expect(results[0].matchReasons).toContain("Machine +2");
  });

  it("boosts +2 and surfaces matching notes when a notes query matches", async () => {
    const { client } = createMockSupabase(responder());
    mocks.client = client;

    const results = await findLikeStyles({
      yarnType: "100% Acrylic",
      knitType: "Jacquard",
      machineType: "7G",
      notesQuery: "smv"
    });

    const top = results[0];
    expect(top.style_number).toBe("M88-100");
    expect(top.matchScore).toBe(8 + 2);
    expect(top.matchReasons).toContain("Notes +2");
    expect(top.matchingNotes.length).toBe(1);
    expect(top.matchingNotes[0].note).toContain("SMV re-checked");
  });

  it("only returns styles whose notes match when searching by notes alone", async () => {
    const { client } = createMockSupabase(responder());
    mocks.client = client;

    const results = await findLikeStyles({ notesQuery: "wash fastness" });

    expect(results.length).toBe(1);
    expect(results[0].style_number).toBe("M88-200");
    expect(results[0].matchingNotes[0].note_type).toBe("pricing_note");
  });

  it("applies minScore and limit filters", async () => {
    const { client } = createMockSupabase(responder());
    mocks.client = client;

    const all = await findLikeStyles({ yarnType: "100% Acrylic", minScore: 0, limit: 10 });
    expect(all.length).toBe(2);

    const strict = await findLikeStyles({ yarnType: "100% Acrylic", minScore: 9 });
    expect(strict.length).toBe(0);

    const limited = await findLikeStyles({ yarnType: "100% Acrylic", limit: 1 });
    expect(limited.length).toBe(1);
  });

  it("excludes the current request from results", async () => {
    const { client } = createMockSupabase(responder());
    mocks.client = client;

    const results = await findLikeStyles({
      yarnType: "100% Acrylic",
      knitType: "Jacquard",
      excludeRequestId: "req-1"
    });

    expect(results.length).toBe(1);
    expect(results[0].costing_request_id).toBe("req-2");
  });

  it("returns no matches when nothing shares attributes or notes", async () => {
    const { client } = createMockSupabase(responder());
    mocks.client = client;

    const results = await findLikeStyles({ machineType: "32G" });
    expect(results.length).toBe(0);
  });

  it("tokenizes attributes so formatting noise does not hide a match (100% Acrylic vs 100%ACRYLIC)", async () => {
    const { client } = createMockSupabase(responder({
      historical_costings: {
        select: () => ({
          data: [{ ...rows[0], id: "h-token", yarn_type: "100%ACRYLIC" }],
          error: null
        })
      }
    }));
    mocks.client = client;

    // Old substring matching gave 0 here ("100%acrylic" does not contain
    // "100% acrylic"); token normalization gives the full weight.
    const results = await findLikeStyles({ yarnType: "100% Acrylic" });
    expect(results).toHaveLength(1);
    expect(results[0].matchScore).toBe(3);
    expect(results[0].matchReasons).toContain("Yarn +3");
  });

  it("awards proportional credit for partial token overlap instead of binary substring", async () => {
    const { client } = createMockSupabase(responder({
      historical_costings: {
        select: () => ({
          data: [{ ...rows[0], id: "h-partial", yarn_type: "Reguler Acrylic - 1/34s 100% Acrylic" }],
          error: null
        })
      }
    }));
    mocks.client = client;

    // Row unique tokens: {reguler, acrylic, 1, 34s, 100, percent} — query
    // covers {acrylic, 100, percent} (3/6), so yarn credit is 3 × 0.5 = 1.5.
    // The reason surfaces the fractional points so reviewers see WHY.
    const results = await findLikeStyles({ yarnType: "100% Acrylic" });
    expect(results).toHaveLength(1);
    expect(results[0].matchScore).toBeCloseTo(1.5, 2);
    expect(results[0].matchReasons).toContain("Yarn +1.5");
  });

  it("surfaces a prefix term like Acry as an Acrylic row with proportional credit", async () => {
    const { client } = createMockSupabase(responder({
      historical_costings: {
        select: () => ({ data: [{ ...rows[0], id: "h-prefix", yarn_type: "Acrylic" }], error: null })
      }
    }));
    mocks.client = client;

    // No exact token shared ("acry" ≠ "acrylic"), so the prefix path kicks in:
    // ratio 4/7 ÷ max(1,1) × yarn weight 3 = 1.71 — real signal, below full.
    const results = await findLikeStyles({ yarnType: "Acry" });
    expect(results).toHaveLength(1);
    expect(results[0].matchScore).toBeCloseTo(1.714, 2);
    expect(results[0].matchReasons).toContain("Yarn +1.7");
    expect(results[0].scorePercent).toBeLessThan(100);
  });

  it("never lets a prefix term outrank the exact term on the same row", async () => {
    const { client } = createMockSupabase(responder({
      historical_costings: {
        select: () => ({ data: [{ ...rows[0], id: "h-prefix", yarn_type: "Acrylic" }], error: null })
      }
    }));
    mocks.client = client;

    const exact = await findLikeStyles({ yarnType: "Acrylic" });
    const prefix = await findLikeStyles({ yarnType: "Acry" });
    expect(exact[0].matchScore).toBe(3); // full weight
    expect(prefix[0].matchScore).toBeLessThan(exact[0].matchScore);

    // Multi-token row: "Acrylic/Wool" — exact "Acrylic" (1/2 overlap → 1.5)
    // still beats the prefix "Acry" (0.571/2 × 3 → floored to 1.0).
    const { client: c2 } = createMockSupabase(responder({
      historical_costings: {
        select: () => ({ data: [{ ...rows[0], id: "h-prefix2", yarn_type: "Acrylic/Wool" }], error: null })
      }
    }));
    mocks.client = c2;
    const exact2 = await findLikeStyles({ yarnType: "Acrylic" });
    const prefix2 = await findLikeStyles({ yarnType: "Acry" });
    expect(exact2[0].matchScore).toBeCloseTo(1.5, 2);
    expect(prefix2[0].matchScore).toBeLessThan(exact2[0].matchScore);
  });

  it("gives no prefix credit to single-character terms", async () => {
    const { client } = createMockSupabase(responder({
      historical_costings: {
        select: () => ({ data: [{ ...rows[0], id: "h-prefix", yarn_type: "Acrylic" }], error: null })
      }
    }));
    mocks.client = client;

    const results = await findLikeStyles({ yarnType: "A" });
    expect(results).toHaveLength(0);
  });

  it("surfaces score percent, evaluated sample size, and confidence on every match", async () => {
    const { client } = createMockSupabase(responder());
    mocks.client = client;

    const results = await findLikeStyles({ yarnType: "100% Acrylic", knitType: "Jacquard", machineType: "7G" });
    const top = results[0];
    // 8 of 8 attainable points, 3 historical rows evaluated → medium confidence
    // (full match but fewer than 5 comparables).
    expect(top.scorePercent).toBe(100);
    expect(top.sampleSize).toBe(3);
    expect(top.confidence).toBe("medium");
  });

  it("rates confidence low on a thin library and high on a rich one", async () => {
    // Thin library: only 1 comparable row → even a perfect match is low confidence.
    {
      const { client } = createMockSupabase(responder({
        historical_costings: {
          select: () => ({ data: [rows[0]], error: null })
        }
      }));
      mocks.client = client;
      const thin = await findLikeStyles({ yarnType: "100% Acrylic" });
      expect(thin[0].sampleSize).toBe(1);
      expect(thin[0].confidence).toBe("low");
    }

    // Rich library: 5+ comparables, full match → high confidence.
    {
      const fiveRows = [rows[0], rows[1], rows[2], { ...rows[1], id: "h4" }, { ...rows[1], id: "h5" }];
      const { client } = createMockSupabase(responder({
        historical_costings: {
          select: () => ({ data: fiveRows, error: null })
        }
      }));
      mocks.client = client;
      const rich = await findLikeStyles({ yarnType: "100% Acrylic", knitType: "Jacquard", machineType: "7G" });
      expect(rich[0].sampleSize).toBe(5);
      expect(rich[0].confidence).toBe("high");
    }
  });

  it("factors factory, brand, customer, and season into the visible breakdown", async () => {
    const enriched = [
      { ...rows[0], id: "h-dim", factory_name: "Cebu Factory", brand: "Madison88", customer: "Arc'teryx", season: "SS27" }
    ];
    const { client } = createMockSupabase(responder({
      historical_costings: {
        select: () => ({ data: enriched, error: null })
      }
    }));
    mocks.client = client;

    const results = await findLikeStyles({
      yarnType: "100% Acrylic",
      factoryName: "Cebu Factory",
      brand: "Madison88",
      customer: "Arc'teryx",
      season: "SS27"
    });
    expect(results[0].matchScore).toBe(3 + 2 + 2 + 2 + 1); // yarn + factory + brand + customer + season
    for (const reason of ["Yarn +3", "Factory +2", "Brand +2", "Customer +2", "Season +1"]) {
      expect(results[0].matchReasons).toContain(reason);
    }
  });
});
