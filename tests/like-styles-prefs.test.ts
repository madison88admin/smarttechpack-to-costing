import { describe, expect, it } from "vitest";
import {
  DEFAULT_LIKE_STYLES_FILTERS,
  hasLikeStylesCriteria,
  likeStylesFiltersToQuery,
  parseLikeStylesPrefs,
  serializeLikeStylesPrefs
} from "../src/lib/like-styles-prefs";

// Persistence helpers for the Like Styles comparison search: the saved blob is
// restored on the next visit and auto-run, so Costing/MD/PBD never re-type
// their filters (same pattern as the Reports register prefs).

describe("serialize/parse round trip", () => {
  it("round-trips a full filter set", () => {
    const filters = {
      yarnType: "100% Acrylic",
      knitType: "Jacquard",
      machineType: "7G",
      construction: "Rib",
      category: "Hats",
      factory: "Factory A",
      brand: "Madison88",
      customer: "Customer A",
      season: "F27",
      notes: "smv 0.45",
      minScore: 4
    };
    expect(parseLikeStylesPrefs(serializeLikeStylesPrefs(filters))).toEqual(filters);
  });

  it("returns null for absent or garbage input", () => {
    expect(parseLikeStylesPrefs(null)).toBeNull();
    expect(parseLikeStylesPrefs(undefined)).toBeNull();
    expect(parseLikeStylesPrefs("")).toBeNull();
    expect(parseLikeStylesPrefs("not-json")).toBeNull();
    expect(parseLikeStylesPrefs('{"yarnType":')).toBeNull();
    expect(parseLikeStylesPrefs("[]")).toBeNull();
    expect(parseLikeStylesPrefs("42")).toBeNull();
  });

  it("defaults missing keys and drops non-string values", () => {
    const parsed = parseLikeStylesPrefs(JSON.stringify({ yarnType: "Acrylic", minScore: 6, bogusKey: "x" }));
    expect(parsed).toEqual({ ...DEFAULT_LIKE_STYLES_FILTERS, yarnType: "Acrylic", minScore: 6 });
  });

  it("clamps minScore to 0-8 and coerces to integers", () => {
    expect(parseLikeStylesPrefs('{"minScore":99}')!.minScore).toBe(8);
    expect(parseLikeStylesPrefs('{"minScore":-3}')!.minScore).toBe(0);
    expect(parseLikeStylesPrefs('{"minScore":6.7}')!.minScore).toBe(6);
    expect(parseLikeStylesPrefs('{"minScore":"2"}')!.minScore).toBe(2);
    expect(parseLikeStylesPrefs('{"minScore":"oops"}')!.minScore).toBe(0);
  });
});

describe("hasLikeStylesCriteria", () => {
  it("is false for the defaults", () => {
    expect(hasLikeStylesCriteria(DEFAULT_LIKE_STYLES_FILTERS)).toBe(false);
  });

  it("is true when any field or minScore is set", () => {
    expect(hasLikeStylesCriteria({ ...DEFAULT_LIKE_STYLES_FILTERS, yarnType: "Acrylic" })).toBe(true);
    expect(hasLikeStylesCriteria({ ...DEFAULT_LIKE_STYLES_FILTERS, minScore: 4 })).toBe(true);
    expect(hasLikeStylesCriteria({ ...DEFAULT_LIKE_STYLES_FILTERS, notes: "  " })).toBe(false);
  });
});

describe("likeStylesFiltersToQuery", () => {
  it("skips empty fields and the default minScore", () => {
    expect(likeStylesFiltersToQuery(DEFAULT_LIKE_STYLES_FILTERS)).toBe("");
    expect(
      likeStylesFiltersToQuery({
        ...DEFAULT_LIKE_STYLES_FILTERS,
        yarnType: "100% Acrylic",
        minScore: 4
      })
    ).toBe("yarnType=100%25+Acrylic&minScore=4");
  });
});
