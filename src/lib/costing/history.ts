import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { convertCurrency, getRate } from "@/lib/currency/rates";

export type HistoricalCostingRow = {
  id: string;
  costing_request_id: string | null;
  style_number: string | null;
  factory_name: string | null;
  total_cost: number | null;
  currency: string | null;
  approved_at: string | null;
  searchable_text?: string | null;
  yarn_type?: string | null;
  knit_type?: string | null;
  machine_type?: string | null;
  construction?: string | null;
  product_category?: string | null;
  average_consumption?: number | null;
  knitting_time?: number | null;
  /** Row provenance: 'import' (approved costings) | 'nextgen' (NextGen-synced). */
  source?: string | null;
  brand?: string | null;
  customer?: string | null;
  season?: string | null;
  benchmark_excluded?: boolean;
  benchmark_exclusion_reason?: string | null;
};

export const HISTORICAL_COSTING_COLUMNS = `
      id,
      costing_request_id,
      style_number,
      factory_name,
      total_cost,
      currency,
      approved_at,
      searchable_text,
      yarn_type,
      knit_type,
      machine_type,
      construction,
      product_category,
      average_consumption,
      knitting_time,
      brand,
      customer,
      season,
      benchmark_excluded,
      benchmark_exclusion_reason
    ` as const;

/** Fetch one approved historical costing row by id (like-style baseline). */
export async function getHistoricalCostingById(id: string): Promise<HistoricalCostingRow | null> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("historical_costings")
    .select(HISTORICAL_COSTING_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return (data as HistoricalCostingRow | null) ?? null;
}

/**
 * One-line audit reference for a historical baseline, e.g.
 * "[Baseline: M88-100 · request a1b2c3d4 · USD 3.20]". Appended to the new
 * request's notes so the source of the copied cost/attributes is traceable.
 */
export function buildBaselineNote(row: HistoricalCostingRow | null | undefined): string {
  if (!row) return "";
  const parts = [
    `Baseline: ${row.style_number ?? "historical style"}`,
    row.costing_request_id ? `request ${row.costing_request_id.slice(0, 8)}` : null,
    row.total_cost != null && Number.isFinite(row.total_cost)
      ? `${row.currency ?? "USD"} ${row.total_cost.toFixed(2)}`
      : null
  ].filter((part): part is string => Boolean(part));
  return `[${parts.join(" · ")}]`;
}

/**
 * The cost + attribute snapshot persisted on the new request (baseline_ref)
 * when a historical style is copied in. Kept as a plain JSON value so the
 * detail page and the factory CBD form can show it without extra joins.
 */
export type BaselineRef = {
  source: "historical";
  historicalId: string;
  sourceRequestId: string | null;
  styleNumber: string | null;
  factoryName: string | null;
  totalCost: number | null;
  currency: string | null;
  approvedAt: string | null;
  yarnType: string | null;
  knitType: string | null;
  machineType: string | null;
  construction: string | null;
  productCategory: string | null;
  averageConsumption: number | null;
  knittingTime: number | null;
  brand: string | null;
  customer: string | null;
  season: string | null;
};

/** Maps an approved historical row to the persisted baseline_ref snapshot. */
export function buildBaselineRef(row: HistoricalCostingRow | null | undefined): BaselineRef | null {
  if (!row) return null;
  return {
    source: "historical",
    historicalId: row.id,
    sourceRequestId: row.costing_request_id ?? null,
    styleNumber: row.style_number ?? null,
    factoryName: row.factory_name ?? null,
    totalCost: row.total_cost ?? null,
    currency: row.currency ?? null,
    approvedAt: row.approved_at ?? null,
    yarnType: row.yarn_type ?? null,
    knitType: row.knit_type ?? null,
    machineType: row.machine_type ?? null,
    construction: row.construction ?? null,
    productCategory: row.product_category ?? null,
    averageConsumption: row.average_consumption ?? null,
    knittingTime: row.knitting_time ?? null,
    brand: row.brand ?? null,
    customer: row.customer ?? null,
    season: row.season ?? null
  };
}

/**
 * Where a row's knitting-time (SMV) value comes from — or that it is still
 * missing. Approved costings write source='import' with the factory's CBD
 * knittingTime; NextGen-synced rows use source='nextgen' (GsdSMV). Costing
 * uses this to spot styles that still lack a knitting time.
 */
export type SmvSourceStatus = {
  key: "missing" | "nextgen" | "cbd";
  label: string;
  hasValue: boolean;
};

export function smvSourceStatus(row: {
  knitting_time?: number | null;
  source?: string | null;
}): SmvSourceStatus {
  if (row.knitting_time == null) {
    return { key: "missing", label: "Missing", hasValue: false };
  }
  // Rows synced from NextGen get source='nextgen' (GsdSMV / BOM SMV);
  // everything else is an approved factory costing (default 'import').
  return row.source === "nextgen"
    ? { key: "nextgen", label: "NextGen SMV", hasValue: true }
    : { key: "cbd", label: "Factory CBD", hasValue: true };
}

export async function listHistoricalCostings(input?: string | {
  query?: string;
  factory?: string;
  brand?: string;
  customer?: string;
  season?: string;
  maxRows?: number;
}) {
  const filters = typeof input === "string" ? { query: input } : input ?? {};
  const supabase = createSupabaseServiceClient();
  const maxRows = Math.min(Math.max(filters.maxRows ?? 500, 1), 5000);
  let request = supabase
    .from("historical_costings")
    .select(
      `
      id,
      costing_request_id,
      style_number,
      factory_name,
      total_cost,
      currency,
      approved_at,
      searchable_text,
      yarn_type,
      knit_type,
      machine_type,
      construction,
      product_category,
      average_consumption,
      knitting_time,
      source,
      brand,
      customer,
      season,
      benchmark_excluded,
      benchmark_exclusion_reason
    `
    )
    .order("approved_at", { ascending: false })
    .limit(maxRows);

  if (filters.query?.trim()) request = request.ilike("searchable_text", `%${filters.query.trim()}%`);
  if (filters.factory?.trim()) request = request.ilike("factory_name", `%${filters.factory.trim()}%`);
  if (filters.brand?.trim()) request = request.ilike("brand", `%${filters.brand.trim()}%`);
  if (filters.customer?.trim()) request = request.ilike("customer", `%${filters.customer.trim()}%`);
  if (filters.season?.trim()) request = request.ilike("season", `%${filters.season.trim()}%`);

  const { data, error } = await request;
  if (error) throw error;
  return ((data ?? []) as HistoricalCostingRow[]).filter((row) => !row.benchmark_excluded);
}

export type LikeStyleMatch = HistoricalCostingRow & {
  matchScore: number;
  matchReasons: string[];
  /** Costing notes (pricing caveats, smv/labor notes, approval comments) that matched the notes query. */
  matchingNotes: Array<{ note_type: string; note: string; tags: string[] }>;
};

export async function findLikeStyles(input: LikeStyleMatchInput): Promise<LikeStyleMatch[]> {
  // Fetch all historical costings and score in JS (avoids text search false negatives)
  const rows = await listHistoricalCostings({ maxRows: 5000 });

  // Notes are a first-class search dimension: a costing note (smv/labor note,
  // pricing caveat, approval comment) matching the query boosts the style and
  // is surfaced with the result so MD/Costing/PBD see why it matched.
  const notesByRequest = new Map<string | null, Array<{ note_type: string; note: string; tags: string[] }>>();
  const notesQuery = input.notesQuery?.trim();
  if (notesQuery) {
    const needle = notesQuery.toLowerCase();
    const notes = await listCostingNotes({ limit: 1000 });
    for (const note of notes) {
      const text = note.note?.toLowerCase() ?? "";
      const tagHit = (note.tags ?? []).some((tag) => tag.toLowerCase().includes(needle));
      if (!text.includes(needle) && !tagHit) continue;
      const bucket = notesByRequest.get(note.costing_request_id) ?? [];
      bucket.push({ note_type: note.note_type, note: note.note, tags: note.tags });
      notesByRequest.set(note.costing_request_id, bucket);
    }
  }

  return scoreLikeStyles(rows, input, notesByRequest);
}

/**
 * Pure scoring core shared by the like-styles search and the register export,
 * so a request's "comparable styles" sheet always matches what the search page
 * would return for the same attributes.
 */
export function scoreLikeStyles(
  rows: HistoricalCostingRow[],
  input: LikeStyleMatchInput,
  notesByRequest?: Map<string | null, Array<{ note_type: string; note: string; tags: string[] }>>
): LikeStyleMatch[] {
  const minScore = input.minScore ?? 0;
  const limit = input.limit ?? 10;

  return rows
    .filter((row) => row.costing_request_id !== input.excludeRequestId)
    .map((row) => {
      const matches = [
        ["Yarn", row.yarn_type, input.yarnType, 3],
        ["Knit", row.knit_type, input.knitType, 3],
        ["Machine", row.machine_type, input.machineType, 2],
        ["Construction", row.construction, input.construction, 2],
        ["Category", row.product_category, input.productCategory, 1],
        ["Factory", row.factory_name, input.factoryName, 2],
        ["Brand", row.brand, input.brand, 2],
        ["Customer", row.customer, input.customer, 2],
        ["Season", row.season, input.season, 1]
      ] as const;
      const scored = matches.map(([label, current, target, weight]) => ({ label, points: score(current, target, weight) }));
      const matchReasons = scored.filter((match) => match.points > 0).map((match) => `${match.label} +${match.points}`);
      let matchScore = scored.reduce((total, match) => total + match.points, 0);
      const matchingNotes = notesByRequest?.get(row.costing_request_id) ?? [];
      if (matchingNotes.length > 0) {
        matchScore += 2;
        matchReasons.push("Notes +2");
      }
      return { ...row, matchScore, matchReasons, matchingNotes };
    })
    .filter((row) => row.matchScore > 0 && row.matchScore >= minScore)
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, limit);
}

export type LikeStyleMatchInput = {
  yarnType?: string | null;
  knitType?: string | null;
  machineType?: string | null;
  construction?: string | null;
  productCategory?: string | null;
  factoryName?: string | null;
  brand?: string | null;
  customer?: string | null;
  season?: string | null;
  notesQuery?: string | null;
  excludeRequestId?: string | null;
  minScore?: number;
  limit?: number;
};

function score(a?: string | null, b?: string | null, weight = 1) {
  if (!a || !b) return 0;
  const left = a.trim().toLowerCase();
  const right = b.trim().toLowerCase();
  if (left === right) return weight;
  return left.includes(right) || right.includes(left) ? Math.max(1, weight - 1) : 0;
}

export async function tryListHistoricalCostings(input?: Parameters<typeof listHistoricalCostings>[0]) {
  try {
    return {
      data: await listHistoricalCostings(input),
      error: null
    };
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : "Unable to load historical costings"
    };
  }
}

export type BenchmarkSummary = {
  currentTotal: number | null;
  historicalAverage: number | null;
  sampleSize: number;
  variancePercent: number | null;
  currency: string;
  matches: HistoricalCostingRow[];
  // Cross-currency conversion indicator: true when any historical record was
  // converted to the CBD's currency before comparison.
  currencyConverted: boolean;
  convertedCount: number;
  convertedFrom: string[];
  reliability: "insufficient" | "directional" | "reliable";
};

export async function getBenchmarkSummary(input: {
  styleNumber?: string | null;
  factoryName?: string | null;
  currentTotal?: number | null;
  currency?: string | null;
  excludeRequestId?: string | null;
}) {
  const query = input.styleNumber || input.factoryName || "";
  const rows = await listHistoricalCostings(query);
  const filtered = rows.filter((row) => row.costing_request_id !== input.excludeRequestId);
  const targetCurrency = input.currency?.trim() || null;

  // Include cross-currency records by converting them to the CBD's currency
  // (via convertCurrency) instead of filtering them out. Records whose currency
  // has no configured rate are skipped — never compared unconverted.
  const costs: number[] = [];
  const matches: HistoricalCostingRow[] = [];
  const convertedFromSet = new Set<string>();
  let convertedCount = 0;

  for (const row of filtered) {
    const cost = row.total_cost;
    if (typeof cost !== "number" || !Number.isFinite(cost)) continue;

    const rowCurrency = row.currency?.trim() || null;

    if (targetCurrency && rowCurrency && rowCurrency !== targetCurrency) {
      const rate = await getRate(rowCurrency, targetCurrency);
      if (rate == null) continue; // no rate available — exclude rather than compare unconverted

      const convertedCost = await convertCurrency(cost, rowCurrency, targetCurrency);
      costs.push(convertedCost);
      convertedCount++;
      convertedFromSet.add(rowCurrency);
      if (matches.length < 5) {
        matches.push({ ...row, total_cost: convertedCost, currency: targetCurrency });
      }
      continue;
    }

    costs.push(cost);
    if (matches.length < 5) matches.push(row);
  }

  const historicalAverage = costs.length
    ? costs.reduce((sum, value) => sum + value, 0) / costs.length
    : null;
  const currentTotal =
    typeof input.currentTotal === "number" && Number.isFinite(input.currentTotal)
      ? input.currentTotal
      : null;

  return {
    currentTotal,
    historicalAverage,
    sampleSize: costs.length,
    variancePercent:
      currentTotal !== null && historicalAverage && historicalAverage > 0
        ? ((currentTotal - historicalAverage) / historicalAverage) * 100
        : null,
    currency: targetCurrency ?? filtered.find((row) => row.currency)?.currency ?? "USD",
    matches,
    currencyConverted: convertedCount > 0,
    convertedCount,
    convertedFrom: [...convertedFromSet]
    ,reliability: costs.length >= 5 ? "reliable" : costs.length >= 3 ? "directional" : "insufficient"
  } satisfies BenchmarkSummary;
}

export async function tryGetBenchmarkSummary(input: {
  styleNumber?: string | null;
  factoryName?: string | null;
  currentTotal?: number | null;
  currency?: string | null;
  excludeRequestId?: string | null;
}) {
  try {
    return {
      data: await getBenchmarkSummary(input),
      error: null
    };
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : "Unable to load benchmark"
    };
  }
}

// ---- Attribute-grouped benchmark engine (BR-014, BR-015, FR-012) ----

export type AttributeBenchmark = {
  averageConsumption: number | null;
  averageKnittingTime: number | null;
  sampleSize: number;
  matchedRows: HistoricalCostingRow[];
};

export async function getBenchmarkByAttributes(input: {
  yarnType?: string | null;
  knitType?: string | null;
  machineType?: string | null;
  excludeRequestId?: string | null;
}) {
  // Fetch all historical costings (no text search filter) and filter by attributes in JS
  const rows = await listHistoricalCostings();

  const filtered = rows.filter((row) => row.costing_request_id !== input.excludeRequestId);

  const matched = filtered.filter(
    (row) =>
      sameAttribute(row.yarn_type, input.yarnType) &&
      sameAttribute(row.knit_type, input.knitType) &&
      sameAttribute(row.machine_type, input.machineType)
  );

  const consumptions = matched
    .map((row) => row.average_consumption)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  const knittingTimes = matched
    .map((row) => row.knitting_time)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  return {
    averageConsumption: consumptions.length
      ? consumptions.reduce((sum, value) => sum + value, 0) / consumptions.length
      : null,
    averageKnittingTime: knittingTimes.length
      ? knittingTimes.reduce((sum, value) => sum + value, 0) / knittingTimes.length
      : null,
    sampleSize: matched.length,
    matchedRows: matched.slice(0, 5)
  } satisfies AttributeBenchmark;
}

function sameAttribute(a: string | null | undefined, b: string | null | undefined) {
  if (!a || !b) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export async function tryGetBenchmarkByAttributes(input: {
  yarnType?: string | null;
  knitType?: string | null;
  machineType?: string | null;
  excludeRequestId?: string | null;
}) {
  try {
    return {
      data: await getBenchmarkByAttributes(input),
      error: null
    };
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : "Unable to load attribute benchmark"
    };
  }
}

// ---- Historical costing notes (BR-018, FR-015) ----

export type CostingNote = {
  id: string;
  costing_request_id: string | null;
  note_type: string;
  note: string;
  tags: string[];
  created_by_role: string | null;
  created_at: string;
  historical_costings: {
    style_number: string | null;
    yarn_type: string | null;
    knit_type: string | null;
    machine_type: string | null;
  } | null;
};

export async function listCostingNotes(input?: {
  yarnType?: string | null;
  knitType?: string | null;
  machineType?: string | null;
  tags?: string[];
  excludeRequestId?: string | null;
  limit?: number;
}) {
  const supabase = createSupabaseServiceClient();

  let request = supabase
    .from("costing_notes")
    .select(
      `
      id,
      costing_request_id,
      note_type,
      note,
      tags,
      created_by_role,
      created_at,
      historical_costings (
        style_number,
        yarn_type,
        knit_type,
        machine_type
      )
    `
    )
    .order("created_at", { ascending: false })
    .limit(input?.limit ?? 50);

  const { data, error } = await request;

  if (error) throw error;

  const notes = (data ?? []) as unknown as CostingNote[];

  return notes.filter((note) => {
    if (note.costing_request_id === input?.excludeRequestId) return false;

    if (input?.yarnType || input?.knitType || input?.machineType) {
      const hist = note.historical_costings;
      if (hist) {
        if (input.yarnType && !sameAttribute(hist.yarn_type, input.yarnType)) return false;
        if (input.knitType && !sameAttribute(hist.knit_type, input.knitType)) return false;
        if (input.machineType && !sameAttribute(hist.machine_type, input.machineType)) return false;
      }
    }

    if (input?.tags?.length) {
      const noteTags = note.tags ?? [];
      const hasMatch = input.tags.some((tag) => noteTags.includes(tag));
      if (!hasMatch) return false;
    }

    return true;
  });
}

export async function tryListCostingNotes(input?: {
  yarnType?: string | null;
  knitType?: string | null;
  machineType?: string | null;
  tags?: string[];
  excludeRequestId?: string | null;
}) {
  try {
    return {
      data: await listCostingNotes(input),
      error: null
    };
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : "Unable to load costing notes"
    };
  }
}
