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
});
