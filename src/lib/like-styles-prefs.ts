// Persisted Like Styles search filters.
//
// Costing / MD / PBD compare styles repeatedly against the same attributes
// (yarn, knit, machine, notes keywords), so the last used search is kept in
// localStorage and restored on the next visit — the search auto-runs once so
// they never re-type their comparison query. Mirrors the Reports register
// prefs pattern (src/lib/reporting.ts): pure parse/serialize helpers kept out
// of the component so the format is unit-testable and versionable.

export type LikeStylesFilters = {
  yarnType: string;
  knitType: string;
  machineType: string;
  construction: string;
  category: string;
  factory?: string;
  brand?: string;
  customer?: string;
  season?: string;
  notes: string;
  minScore: number;
};

export const DEFAULT_LIKE_STYLES_FILTERS: LikeStylesFilters = {
  yarnType: "",
  knitType: "",
  machineType: "",
  construction: "",
  category: "",
  factory: "",
  brand: "",
  customer: "",
  season: "",
  notes: "",
  minScore: 0
};

export function serializeLikeStylesPrefs(filters: LikeStylesFilters): string {
  return JSON.stringify(filters);
}

/**
 * Parses a saved filters blob. Returns null for absent/garbage input and
 * clamps every field to its valid shape so a hand-edited or older value can
 * never crash the form (extra keys are dropped, minScore is clamped to 0-8).
 */
export function parseLikeStylesPrefs(raw: string | null | undefined): LikeStylesFilters | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

  const source = parsed as Record<string, unknown>;
  const filters: LikeStylesFilters = { ...DEFAULT_LIKE_STYLES_FILTERS };

  for (const key of Object.keys(DEFAULT_LIKE_STYLES_FILTERS) as Array<keyof LikeStylesFilters>) {
    const value = source[key];
    if (key === "minScore") {
      const number = Number(value);
      if (Number.isFinite(number)) {
        filters.minScore = Math.min(8, Math.max(0, Math.floor(number)));
      }
    } else if (typeof value === "string") {
      filters[key] = value;
    }
  }

  return filters;
}

/**
 * True when any filter differs from the defaults — used to decide whether a
 * restored search is worth auto-running on page load.
 */
export function hasLikeStylesCriteria(filters: LikeStylesFilters): boolean {
  return (
    filters.minScore !== 0 ||
    filters.yarnType.trim() !== "" ||
    filters.knitType.trim() !== "" ||
    filters.machineType.trim() !== "" ||
    filters.construction.trim() !== "" ||
    filters.category.trim() !== "" ||
    (filters.factory ?? "").trim() !== "" ||
    (filters.brand ?? "").trim() !== "" ||
    (filters.customer ?? "").trim() !== "" ||
    (filters.season ?? "").trim() !== "" ||
    filters.notes.trim() !== ""
  );
}

/** Builds the API query string for a filters object (matches the form's rules). */
export function likeStylesFiltersToQuery(filters: LikeStylesFilters): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    const trimmed = String(value).trim();
    if (trimmed && trimmed !== "0") params.set(key, trimmed);
  }
  return params.toString();
}
