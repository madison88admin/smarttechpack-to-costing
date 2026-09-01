import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildSetShareUrl,
  buildShareToken,
  createSavedComparisonSet,
  getSavedComparisonSetByToken,
  listSavedComparisonSetsForRequest,
  tryListSavedComparisonSetsForRequest
} from "../src/lib/comparison-sets";
import { createMockSupabase, type Responder } from "./helpers/supabase-mock";

// Named, shareable Like Styles comparison sets: saved under a name with the
// exact results + filters snapshotted, retrievable by share token, listed per
// request.

const { mocks } = vi.hoisted(() => ({ mocks: { client: null as unknown } }));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: () => mocks.client
}));

afterEach(() => {
  mocks.client = null;
  delete process.env.NEXT_PUBLIC_APP_URL;
});

const row = {
  id: "set-1",
  name: "Acrylic beanies — SS27 review",
  request_id: "req-1",
  filters: { yarnType: "Acrylic", minScore: 4 },
  results: [{ id: "h1", style_number: "M88-100", matchScore: 6 }],
  benchmark: { averageConsumption: 0.8, sampleSize: 2 },
  share_token: "a".repeat(32),
  created_by: "Costing Team",
  created_by_role: "costing",
  created_at: "2026-08-11T00:00:00Z"
};

function responder(overrides: Partial<Responder> = {}): Responder {
  return {
    saved_comparison_sets: {
      single: () => ({ data: row, error: null }),
      maybeSingle: () => ({ data: row, error: null }),
      select: () => ({ data: [row], error: null }),
      insert: () => ({ data: [], error: null })
    },
    ...overrides
  };
}

describe("buildShareToken", () => {
  it("returns a 32-char hex token and is unguessable", () => {
    const token = buildShareToken();
    expect(token).toMatch(/^[a-f0-9]{32}$/);
    expect(buildShareToken()).not.toBe(token);
  });
});

describe("buildSetShareUrl", () => {
  it("uses NEXT_PUBLIC_APP_URL when set", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://tp.example.com";
    expect(buildSetShareUrl("abc")).toBe("https://tp.example.com/comparison-sets/abc");
  });

  it("degrades to a relative path when no base URL is configured", () => {
    expect(buildSetShareUrl("abc")).toBe("/comparison-sets/abc");
  });
});

describe("createSavedComparisonSet", () => {
  it("inserts the snapshot with a fresh token and returns the saved set", async () => {
    const { client, calls } = createMockSupabase(responder());
    mocks.client = client;

    const set = await createSavedComparisonSet({
      name: "  Acrylic beanies — SS27 review  ",
      requestId: "req-1",
      filters: { yarnType: "Acrylic" },
      results: [{ id: "h1" }],
      benchmark: { sampleSize: 1 },
      createdBy: "Costing Team",
      createdByRole: "costing"
    });

    expect(set.id).toBe("set-1");
    expect(set.shareToken).toBe(row.share_token);

    const insert = calls.find((c) => c.table === "saved_comparison_sets" && c.chain.payload);
    const payload = insert!.chain.payload as Record<string, unknown>;
    expect(payload.name).toBe("Acrylic beanies — SS27 review"); // trimmed
    expect(payload.request_id).toBe("req-1");
    expect(payload.filters).toEqual({ yarnType: "Acrylic" });
    expect(payload.results).toEqual([{ id: "h1" }]);
    expect(payload.created_by_role).toBe("costing");
    expect(String(payload.share_token)).toMatch(/^[a-f0-9]{32}$/);
  });
});

describe("getSavedComparisonSetByToken", () => {
  it("queries by share token and maps the row", async () => {
    const { client, calls } = createMockSupabase(responder());
    mocks.client = client;

    const set = await getSavedComparisonSetByToken(row.share_token);
    expect(set).toMatchObject({
      id: "set-1",
      name: "Acrylic beanies — SS27 review",
      requestId: "req-1",
      shareToken: row.share_token,
      createdBy: "Costing Team",
      createdByRole: "costing"
    });

    const query = calls.find((c) => c.table === "saved_comparison_sets" && c.terminal === "maybeSingle");
    expect(query?.chain.eq).toEqual([["share_token", row.share_token]]);
  });

  it("returns null when the token does not exist", async () => {
    const { client } = createMockSupabase({
      saved_comparison_sets: { maybeSingle: () => ({ data: null, error: null }) }
    });
    mocks.client = client;
    expect(await getSavedComparisonSetByToken("nope")).toBeNull();
  });
});

describe("listSavedComparisonSetsForRequest", () => {
  it("lists sets for a request newest-first", async () => {
    const { client, calls } = createMockSupabase(responder());
    mocks.client = client;

    const sets = await listSavedComparisonSetsForRequest("req-1");
    expect(sets).toHaveLength(1);
    expect(sets[0].name).toContain("SS27");

    const query = calls.find((c) => c.table === "saved_comparison_sets" && c.terminal === "select");
    expect(query?.chain.eq).toEqual([["request_id", "req-1"]]);
    expect(query?.chain.order).toEqual([["created_at", { ascending: false }]]);
  });

  it("try wrapper never throws", async () => {
    const { client } = createMockSupabase({
      saved_comparison_sets: {
        select: () => {
          throw new Error("db down");
        }
      }
    });
    mocks.client = client;

    const { data, error } = await tryListSavedComparisonSetsForRequest("req-1");
    expect(data).toEqual([]);
    expect(error).toContain("db down");
  });
});
