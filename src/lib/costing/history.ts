import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { pgrestLike } from "@/lib/supabase/filters";
import { convertCurrency, getRate } from "@/lib/currency/rates";

export type HistoricalCostingRow = {
  id: string;
  costing_request_id: string | null;
  style_number: string | null;
  factory_name: string | null;
  total_cost: number | null;
  /** Landed cost per unit (FOB total when no freight/duty were entered). */
  landed_cost?: number | null;
  /** Real selling price (PBD-entered, else NextGen-ported) — null when unknown. */
  selling_price?: number | null;
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

/** Columns every historical-costing read shares — one owner for the list. */
const HISTORICAL_COSTING_COLUMNS = [
  "id",
  "costing_request_id",
  "style_number",
  "factory_name",
  "total_cost",
  "currency",
  "approved_at",
  "searchable_text",
  "yarn_type",
  "knit_type",
  "machine_type",
  "construction",
  "product_category",
  "average_consumption",
  "knitting_time",
  "source",
  "brand",
  "customer",
  "season",
  "benchmark_excluded",
  "benchmark_exclusion_reason"
] as const;

/**
 * The columns the history screens build their filter dropdowns from. Each one
 * must be a column the shared select list already reads, so renaming a column
 * here is a compile error rather than a silently empty dropdown.
 */
export const HISTORICAL_FACET_COLUMNS = [
  "yarn_type",
  "knit_type",
  "machine_type",
  "construction",
  "product_category",
  "factory_name",
  "brand",
  "customer",
  "season"
] as const satisfies readonly (typeof HISTORICAL_COSTING_COLUMNS)[number][];

/**
 * Cost/margin columns added by migration 018. Selected separately so a database
 * that has not had the migration applied yet still serves the historical pool
 * (without machine cost/margin) instead of failing the read outright.
 */
const HISTORICAL_COST_COLUMNS = ["landed_cost", "selling_price"] as const;

/**
 * Safety ceiling for a single register read. PostgREST already pages at 1000
 * rows, so this only guards against an unbounded request: the export asks for
 * the register's exact count and refuses loudly above this ceiling instead of
 * silently shipping a prefix.
 */
export const HISTORICAL_READ_MAX_ROWS = 50_000;

/** The shared select list, with the migration-018 cost columns when asked for. */
function historicalCostingSelect({ withCost = true }: { withCost?: boolean } = {}) {
  return [...HISTORICAL_COSTING_COLUMNS, ...(withCost ? HISTORICAL_COST_COLUMNS : [])].join(", ");
}

/** True when PostgREST rejected a read because the cost columns are not there yet. */
function missingCostColumns(error: { message?: string } | null | undefined) {
  const message = error?.message ?? "";
  return /does not exist/.test(message) && HISTORICAL_COST_COLUMNS.some((column) => message.includes(column));
}

/** Fetch one approved historical costing row by id (like-style baseline). */
export async function getHistoricalCostingById(id: string): Promise<HistoricalCostingRow | null> {
  const supabase = createSupabaseServiceClient();
  const read = (columns: string) =>
    supabase.from("historical_costings").select(columns).eq("id", id).maybeSingle();

  let { data, error } = await read(historicalCostingSelect());
  if (missingCostColumns(error)) ({ data, error } = await read(historicalCostingSelect({ withCost: false })));

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
  /** How many rows to read from `offset`. Defaults to the first 500. */
  maxRows?: number;
  /** Where in the (filtered) register to start — the register pages with this. */
  offset?: number;
}) {
  const filters = typeof input === "string" ? { query: input } : input ?? {};
  const supabase = createSupabaseServiceClient();
  const maxRows = Math.min(Math.max(filters.maxRows ?? 500, 1), HISTORICAL_READ_MAX_ROWS);
  const start = Math.max(0, filters.offset ?? 0);
  const end = start + maxRows;
  const rows: HistoricalCostingRow[] = [];
  // PostgREST returns at most 1000 rows per request, so 1000 is the largest
  // page that still fits in one round trip — half the round trips the old
  // 500-row pages needed for the same read.
  const pageSize = 1000;
  const readPage = (columns: string, offset: number) => {
    let request = supabase
      .from("historical_costings")
      .select(columns)
      // Benchmark-excluded rows are dropped in the query, not after the page was
      // sliced: the register's offsets and its `countHistoricalCostings` total
      // then describe the same rows, so "Showing X–Y of N" and the page count
      // stay true instead of drifting by the excluded rows inside the window.
      .not("benchmark_excluded", "is", true)
      .order("approved_at", { ascending: false })
      .order("id", { ascending: false })
      .range(offset, Math.min(offset + pageSize, end) - 1);

    if (filters.query?.trim()) request = request.ilike("searchable_text", pgrestLike(filters.query.trim()));
    if (filters.factory?.trim()) request = request.ilike("factory_name", pgrestLike(filters.factory.trim()));
    if (filters.brand?.trim()) request = request.ilike("brand", pgrestLike(filters.brand.trim()));
    if (filters.customer?.trim()) request = request.ilike("customer", pgrestLike(filters.customer.trim()));
    if (filters.season?.trim()) request = request.ilike("season", pgrestLike(filters.season.trim()));
    return request;
  };

  for (let offset = start; offset < end; offset += pageSize) {
  const columns = historicalCostingSelect();
  let { data, error } = await readPage(columns, offset);
  // Migration 018 not applied yet: the pool still loads, minus machine cost.
  if (missingCostColumns(error)) ({ data, error } = await readPage(historicalCostingSelect({ withCost: false }), offset));
  if (error) throw error;
  rows.push(...((data ?? []) as unknown as HistoricalCostingRow[]));
  if (!data || data.length < Math.min(pageSize, end - offset)) break;
  }
  return rows;
}

/**
 * How many rows the same filters match, so the register can page instead of
 * silently showing a prefix of the pool. `benchmark_excluded` rows are left out
 * the same way listHistoricalCostings drops them (null counts as kept).
 */
export async function countHistoricalCostings(input?: {
  query?: string;
  factory?: string;
  brand?: string;
  customer?: string;
  season?: string;
}) {
  const filters = input ?? {};
  const supabase = createSupabaseServiceClient();
  let request = supabase
    .from("historical_costings")
    .select("id", { count: "exact", head: true })
    .not("benchmark_excluded", "is", true);

  if (filters.query?.trim()) request = request.ilike("searchable_text", pgrestLike(filters.query.trim()));
  if (filters.factory?.trim()) request = request.ilike("factory_name", pgrestLike(filters.factory.trim()));
  if (filters.brand?.trim()) request = request.ilike("brand", pgrestLike(filters.brand.trim()));
  if (filters.customer?.trim()) request = request.ilike("customer", pgrestLike(filters.customer.trim()));
  if (filters.season?.trim()) request = request.ilike("season", pgrestLike(filters.season.trim()));

  const { count, error } = await request;
  if (error) throw error;
  return count ?? 0;
}

/**
 * How a historical import -- the Data Bank/ERP export and the NextGen product
 * sync -- recognises a record the pool already holds: the ERP record it came
 * from. Both exports ship that record as `id` (the NextGen product grid spells
 * it `Id`), so the spellings live here once, in the same list the lookup query
 * filters on. Keying on anything else (style + factory + import date) let a
 * re-run of the same export insert a second set of rows: the date is restamped
 * when the file omits it, so every key looked new.
 */
const HISTORICAL_RECORD_ID_KEYS = ["id", "Id"] as const;

/** Where the NextGen product id lives when the payload did not carry it. */
const HISTORICAL_ENTITY_ID_COLUMN = "nextgen_entity_id";

/** The fields an import identity is computed from -- a pending row or a stored one. */
export type HistoricalImportIdentity = {
  style_number?: string | null;
  factory_name?: string | null;
  total_cost?: number | null;
  currency?: string | null;
  raw_payload?: Record<string, unknown> | null;
  nextgen_entity_id?: string | null;
};

/**
 * Reads the ERP record id from the payload keys an export can spell it with, and
 * says which one it came from so the lookup can filter on that same path.
 */
function historicalRecordId(
  row: HistoricalImportIdentity
): { source: string; id: string } | null {
  for (const key of HISTORICAL_RECORD_ID_KEYS) {
    const value = row.raw_payload?.[key];
    if (typeof value === "string" && value.trim()) return { source: key, id: value.trim() };
    if (typeof value === "number" && Number.isFinite(value)) return { source: key, id: String(value) };
  }
  const entityId = row.nextgen_entity_id?.trim();
  return entityId ? { source: HISTORICAL_ENTITY_ID_COLUMN, id: entityId } : null;
}

/** The key an import de-duplicates on. Id-carrying rows -- every real export --
 * key on the ERP record alone, so a later export of the same record is the same
 * row even when its cost, revision or style moved. Rows whose export carried no
 * id fall back to their own content (no timestamp: a repeat import of the same
 * file would restamp it and look new).
 */
export function historicalImportKey(row: HistoricalImportIdentity): string {
  const recordId = historicalRecordId(row);
  if (recordId) return `erp:${recordId.id.toLowerCase()}`;
  return [
    "content",
    (row.style_number ?? "").trim().toLowerCase(),
    (row.factory_name ?? "").trim().toLowerCase(),
    row.total_cost ?? "",
    (row.currency ?? "").trim().toLowerCase()
  ].join("|");
}

/** Each id spelling selected as `payload_<key>`, so both sides build the same key. */
const HISTORICAL_IMPORT_KEY_COLUMNS = [
  "style_number",
  "factory_name",
  "total_cost",
  "currency",
  "nextgen_entity_id",
  ...HISTORICAL_RECORD_ID_KEYS.map((key) => `payload_${key}:raw_payload->>${key}`)
].join(", ");

/** Ids per lookup request -- keeps the `in.(...)` URL well short of a header limit. */
const HISTORICAL_IMPORT_LOOKUP_CHUNK = 150;
/** PostgREST caps a response at 1000 rows (`db-max-rows`), whatever `limit` asks. */
const HISTORICAL_IMPORT_LOOKUP_PAGE = 1000;

function chunkValues<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < values.length; i += size) chunks.push(values.slice(i, i + size));
  return chunks;
}

function existingImportKey(row: Record<string, unknown>): string {
  const rawPayload: Record<string, unknown> = {};
  for (const key of HISTORICAL_RECORD_ID_KEYS) rawPayload[key] = row[`payload_${key}`];
  return historicalImportKey({
    style_number: row.style_number as string | null,
    factory_name: row.factory_name as string | null,
    total_cost: row.total_cost as number | null,
    currency: row.currency as string | null,
    nextgen_entity_id: row.nextgen_entity_id as string | null,
    raw_payload: rawPayload
  });
}

/**
 * Which of a batch's records the pool already holds — the single idempotency
 * check every import path shares, so a repeat sync can only ever add records it
 * has never seen. Reads nothing it was not asked about: the batch's ERP ids by
 * JSON path (exact, and independent of a style being renamed between exports),
 * plus the batch's styles for rows whose export carried no id.
 */
export async function listExistingHistoricalImportKeys(
  records: HistoricalImportIdentity[]
): Promise<Set<string>> {
  const keys = new Set<string>();
  // One bucket per id source, so a Data Bank export never pays for a NextGen
  // lookup and vice versa -- only sources the batch actually uses are queried.
  const idsBySource = new Map<string, Set<string>>();
  const styleNumbers = new Set<string>();
  for (const record of records) {
    const recordId = historicalRecordId(record);
    if (recordId) {
      const bucket = idsBySource.get(recordId.source) ?? new Set<string>();
      bucket.add(recordId.id);
      idsBySource.set(recordId.source, bucket);
    } else {
      const style = (record.style_number ?? "").trim();
      if (style) styleNumbers.add(style);
    }
  }

  const supabase = createSupabaseServiceClient();
  const collect = (data: unknown[] | null) => {
    for (const row of data ?? []) keys.add(existingImportKey(row as Record<string, unknown>));
  };
  // Pages rather than asking for a big limit: a style chunk can match more rows
  // than the server will return in one response, and a truncated read would
  // report records the pool already holds as new -- the duplicate this check
  // exists to prevent.
  const read = async (column: string, values: string[]) => {
    for (let from = 0; ; from += HISTORICAL_IMPORT_LOOKUP_PAGE) {
      const { data, error } = await supabase
        .from("historical_costings")
        .select(HISTORICAL_IMPORT_KEY_COLUMNS)
        .in(column, values)
        .order("id", { ascending: true })
        .range(from, from + HISTORICAL_IMPORT_LOOKUP_PAGE - 1);
      if (error) throw error;
      collect(data);
      if (!data || data.length < HISTORICAL_IMPORT_LOOKUP_PAGE) return;
    }
  };

  for (const [source, ids] of idsBySource) {
    const column = source === HISTORICAL_ENTITY_ID_COLUMN ? source : `raw_payload->>${source}`;
    for (const chunk of chunkValues([...ids], HISTORICAL_IMPORT_LOOKUP_CHUNK)) await read(column, chunk);
  }

  for (const styles of chunkValues([...styleNumbers], HISTORICAL_IMPORT_LOOKUP_CHUNK)) {
    await read("style_number", styles);
  }

  return keys;
}

/**
 * The batch's own repeats dropped before insert (a file may list a record
 * twice), keeping the first occurrence's data.
 */
export function dedupeHistoricalImports<T extends HistoricalImportIdentity>(
  records: T[],
  existingKeys: Set<string>
): { rows: T[]; skipped: number } {
  const seen = new Set<string>();
  const rows = records.filter((record) => {
    const key = historicalImportKey(record);
    if (existingKeys.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { rows, skipped: records.length - rows.length };
}

export type HistoricalFacetOptions = {
  yarnTypes: string[];
  knitTypes: string[];
  machineTypes: string[];
  constructions: string[];
  categories: string[];
  factories: string[];
  brands: string[];
  customers: string[];
  seasons: string[];
};

/** PostgREST returns at most 1000 rows per request (db-max-rows). */
const FACET_PAGE_SIZE = 1000;
const FACET_MAX_ROWS = 20_000;
/** How many values each dropdown keeps after sorting. */
const FACET_MAX_VALUES = 120;

/**
 * Distinct values for the historical search dropdowns.
 *
 * One paginated read of every facet column at once replaces the previous nine
 * single-column reads: those pulled ~9x the rows over the wire (a ~70s cold
 * scan) and, because each asked for `limit(5000)` against the 1000-row server
 * cap, only ever saw the first 1000 of ~2,800 rows — so values appearing later
 * in the pool never reached the dropdowns.
 */
export async function listHistoricalFacetValues(): Promise<HistoricalFacetOptions> {
  const supabase = createSupabaseServiceClient();
  const sets = new Map<string, Set<string>>(HISTORICAL_FACET_COLUMNS.map((col) => [col, new Set<string>()]));
  const columns = HISTORICAL_FACET_COLUMNS.join(", ");

  for (let offset = 0; offset < FACET_MAX_ROWS; offset += FACET_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("historical_costings")
      .select(columns)
      .range(offset, offset + FACET_PAGE_SIZE - 1);
    if (error) throw error;
    const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
    for (const row of rows) {
      for (const col of HISTORICAL_FACET_COLUMNS) {
        const value = String(row[col] ?? "").trim();
        // "#N/A" and "null" are spreadsheet artifacts in the imported history.
        if (value && value !== "#N/A" && value !== "null") sets.get(col)?.add(value);
      }
    }
    if (rows.length < FACET_PAGE_SIZE) break;
  }

  const sorted = (col: (typeof HISTORICAL_FACET_COLUMNS)[number]) =>
    [...(sets.get(col) ?? [])].sort((a, b) => a.localeCompare(b)).slice(0, FACET_MAX_VALUES);

  return {
    yarnTypes: sorted("yarn_type"),
    knitTypes: sorted("knit_type"),
    machineTypes: sorted("machine_type"),
    constructions: sorted("construction"),
    categories: sorted("product_category"),
    factories: sorted("factory_name"),
    brands: sorted("brand"),
    customers: sorted("customer"),
    seasons: sorted("season")
  };
}

export type LikeStyleMatch = HistoricalCostingRow & {
  matchScore: number;
  matchReasons: string[];
  /** Costing notes (pricing caveats, smv/labor notes, approval comments) that matched the notes query. */
  matchingNotes: Array<{ note_type: string; note: string; tags: string[] }>;
  /** Fraction of the maximum attainable score for this query (0–100). */
  scorePercent: number;
  /** How many distinct styles were evaluated (excludes the current request). */
  sampleSize: number;
  /** low / medium / high — driven by the score ratio and the sample size. */
  confidence: MatchConfidence;
};

export type MatchConfidence = "low" | "medium" | "high";

/**
 * Maximum points per like-style dimension. Kept here so the search page, the
 * register exports, and the confidence label all agree on the attainable max.
 */
export const LIKE_STYLE_WEIGHTS = {
  yarn: 3,
  knit: 3,
  machine: 2,
  construction: 2,
  category: 1,
  factory: 2,
  brand: 2,
  customer: 2,
  season: 1
} as const;

/**
 * Confidence in a like-style match, driven by how much of the maximum
 * attainable score the row earned and how many historical costings were
 * evaluated. Fewer than 3 comparables is never more than "low".
 */
export function matchConfidence(matchScore: number, maxScore: number, sampleSize: number): MatchConfidence {
  const ratio = maxScore > 0 ? matchScore / maxScore : 0;
  if (sampleSize < 3) return "low";
  if (ratio >= 0.75) return sampleSize >= 5 ? "high" : "medium";
  if (ratio >= 0.5) return "medium";
  return "low";
}

/**
 * The maximum score a row could earn for this query: the weights of every
 * attribute criterion set, plus the +2 notes bonus when a notes query is given.
 */
export function likeStylesMaxScore(input: LikeStyleMatchInput): number {
  let total = 0;
  if (input.yarnType?.trim()) total += LIKE_STYLE_WEIGHTS.yarn;
  if (input.knitType?.trim()) total += LIKE_STYLE_WEIGHTS.knit;
  if (input.machineType?.trim()) total += LIKE_STYLE_WEIGHTS.machine;
  if (input.construction?.trim()) total += LIKE_STYLE_WEIGHTS.construction;
  if (input.productCategory?.trim()) total += LIKE_STYLE_WEIGHTS.category;
  if (input.factoryName?.trim()) total += LIKE_STYLE_WEIGHTS.factory;
  if (input.brand?.trim()) total += LIKE_STYLE_WEIGHTS.brand;
  if (input.customer?.trim()) total += LIKE_STYLE_WEIGHTS.customer;
  if (input.season?.trim()) total += LIKE_STYLE_WEIGHTS.season;
  if (input.notesQuery?.trim()) total += 2;
  return total;
}

// Tokens that carry no matching signal for garment attributes.
const TOKEN_STOPWORDS = new Set(["a", "an", "the", "of", "for", "with", "and", "or", "in", "on"]);

/**
 * Normalizes a garment-attribute string into matching tokens: lowercase,
 * punctuation stripped, percentages expanded ("100%" → "100 percent"), so
 * "100% Acrylic" and "100%ACRYLIC" and "100 % Acrylic" all match.
 */
export function tokenizeAttribute(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/%/g, " percent ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0 && !TOKEN_STOPWORDS.has(token));
}

/**
 * Best prefix-overlap ratio between one query token and any row token: 1.0 for
 * an exact match, else len(shorter) / len(longer) when one token is a prefix of
 * the other, else 0. Only tokens of at least 2 characters qualify, so
 * single-character noise ("x", "1") never earns credit.
 */
function bestPrefixCredit(queryToken: string, rowTokens: string[]): number {
  if (queryToken.length < 2) return 0;
  let best = 0;
  for (const rowToken of rowTokens) {
    if (rowToken.length < 2) continue;
    if (rowToken === queryToken) return 1;
    const shorter = queryToken.length < rowToken.length ? queryToken : rowToken;
    const longer = queryToken.length < rowToken.length ? rowToken : queryToken;
    if (longer.startsWith(shorter)) {
      const ratio = shorter.length / longer.length;
      if (ratio > best) best = ratio;
    }
  }
  return best;
}

/**
 * Normalized token-overlap scorer (replaces raw substring matching).
 * - exact normalized match → full weight
 * - partial token overlap → proportional credit, minimum 1 point, so a row
 *   sharing "acrylic" with a longer query still earns a real signal instead of
 *   a binary substring yes/no
 * - prefix token overlap → proportional credit (only when no exact token is
 *   shared), so a partial term like "Acry" still surfaces "Acrylic" rows. The
 *   credit mirrors the overlap formula and can never reach full weight, so a
 *   partial term never outranks the exact term on the same row
 * - no shared or prefix tokens → 0
 */
export function scoreAttribute(a?: string | null, b?: string | null, weight = 1): number {
  if (!a || !b) return 0;
  const left = a.trim().toLowerCase();
  const right = b.trim().toLowerCase();
  if (left === right) return weight;

  // Unique tokens only — counting duplicates (e.g. "acrylic" twice in a yarn
  // description) would double-credit the same concept and skew the overlap.
  const uniqueLeft = [...new Set(tokenizeAttribute(left))];
  const uniqueRight = [...new Set(tokenizeAttribute(right))];
  if (!uniqueLeft.length || !uniqueRight.length) return 0;

  const rightSet = new Set(uniqueRight);
  const shared = uniqueLeft.filter((token) => rightSet.has(token)).length;
  if (shared > 0) {
    const overlap = shared / Math.max(uniqueLeft.length, uniqueRight.length);
    return Math.max(1, weight * overlap);
  }

  // Prefix path — no exact token is shared, but a query token that is a prefix
  // of a row token (or vice versa) still earns proportional credit. Aggregated
  // like the overlap path (sum of best ratios ÷ the larger token count) and
  // floored at the same minimum 1 point, so the semantics stay consistent.
  const prefixTotal = uniqueLeft.reduce((sum, token) => sum + bestPrefixCredit(token, uniqueRight), 0);
  if (prefixTotal > 0) {
    const credit = (prefixTotal / Math.max(uniqueLeft.length, uniqueRight.length)) * weight;
    return Math.max(1, credit);
  }
  return 0;
}

/** Renders "Yarn +3" for whole points and "Yarn +1.3" for fractional credit. */
export function formatPoints(points: number): string {
  return Number.isInteger(points) ? String(points) : points.toFixed(1);
}

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
  // One comparable = one style. The register holds every ERP costing record of
  // a style (a single import run brought 2.49 records per style), so counting
  // rows here filled the requested slots with the same style at four different
  // prices and let one style carry the machine-speed averages several times.
  const evaluated = rows.filter((row) => row.costing_request_id !== input.excludeRequestId);
  // Every match shares the same context: how many distinct comparables were
  // evaluated and the maximum score the query could possibly award. Confidence
  // is derived from those, so a 5/8 row on a thin library reads "low" but the
  // same 5/8 row on a rich library reads "medium".
  const sampleSize = countDistinctStyles(evaluated);
  const maxScore = likeStylesMaxScore(input);

  const scored = evaluated
    .map((row) => {
      const matches = [
        ["Yarn", row.yarn_type, input.yarnType, LIKE_STYLE_WEIGHTS.yarn],
        ["Knit", row.knit_type, input.knitType, LIKE_STYLE_WEIGHTS.knit],
        ["Machine", row.machine_type, input.machineType, LIKE_STYLE_WEIGHTS.machine],
        ["Construction", row.construction, input.construction, LIKE_STYLE_WEIGHTS.construction],
        ["Category", row.product_category, input.productCategory, LIKE_STYLE_WEIGHTS.category],
        ["Factory", row.factory_name, input.factoryName, LIKE_STYLE_WEIGHTS.factory],
        ["Brand", row.brand, input.brand, LIKE_STYLE_WEIGHTS.brand],
        ["Customer", row.customer, input.customer, LIKE_STYLE_WEIGHTS.customer],
        ["Season", row.season, input.season, LIKE_STYLE_WEIGHTS.season]
      ] as const;
      const attributeScores = matches.map(([label, current, target, weight]) => ({
        label,
        points: scoreAttribute(current, target, weight)
      }));
      const matchReasons = attributeScores
        .filter((match) => match.points > 0)
        .map((match) => `${match.label} +${formatPoints(match.points)}`);
      let matchScore = round2(attributeScores.reduce((total, match) => total + match.points, 0));
      const matchingNotes = notesByRequest?.get(row.costing_request_id) ?? [];
      if (matchingNotes.length > 0) {
        matchScore += 2;
        matchReasons.push("Notes +2");
      }
      return {
        ...row,
        matchScore,
        matchReasons,
        matchingNotes,
        scorePercent: maxScore > 0 ? Math.min(100, Math.round((matchScore / maxScore) * 100)) : 0,
        sampleSize,
        confidence: matchConfidence(matchScore, maxScore, sampleSize)
      };
    })
    .filter((row) => row.matchScore > 0 && row.matchScore >= minScore)
    .sort((a, b) => b.matchScore - a.matchScore);

  // For each style keep the record that best answers this query — the pool is
  // newest-first and sort() is stable, so equal scores keep the newest ERP
  // record instead of an arbitrary one. Ties across styles keep score order, so
  // the requested slots go to distinct styles rather than to one style's
  // costing revisions.
  const bestPerStyle = new Map<string, LikeStyleMatch>();
  for (const match of scored) {
    const key = likeStyleKey(match);
    if (!bestPerStyle.has(key)) bestPerStyle.set(key, match);
  }
  return [...bestPerStyle.values()].slice(0, limit);
}

/**
 * Identity a comparable is counted under: the style, whatever its ERP casing.
 * Rows with no style number never collapse into each other, so an unlabelled
 * record can still be its own comparable.
 */
function likeStyleKey(row: { id: string; style_number: string | null }): string {
  const style = (row.style_number ?? "").trim().toUpperCase();
  return style ? `style:${style}` : `row:${row.id}`;
}

/** How many distinct styles a pool of historical rows describes. */
export function countDistinctStyles(rows: Array<{ id: string; style_number: string | null }>): number {
  return new Set(rows.map(likeStyleKey)).size;
}

/** Rounds to 2 decimals so token-overlap scores stay tidy (1.2857… → 1.29). */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
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

export type MachineSpeed = {
  machineType: string;
  /** Null when no matched style recorded a knitting time for this machine. */
  avgKnittingTime: number | null;
  /** How many matched styles carried a knitting time. */
  sampleSize: number;
  /** Currency the cost and margin averages are expressed in (dominant one). */
  currency: string;
  /** Average cost basis per unit (landed when known, else the FOB total). */
  avgLandedCost: number | null;
  /** How many matched styles carried a cost — the average is over these only. */
  costSampleSize: number;
  /**
   * Average profit per unit (selling price − cost basis). Null unless at least
   * one matched style carries a real selling price: imported history has none,
   * and a markup estimate would not be a margin.
   */
  avgMargin: number | null;
  /** How many matched styles carried a real selling price. */
  marginSampleSize: number;
};

/**
 * Reference card for a match set: the averages plus how many matched styles
 * actually carry the figure being averaged. Imported history often has no
 * consumption / knitting time, so the sample sizes travel with the averages —
 * a mean over 3 of 10 styles must never be presented as covering all 10.
 */
export type LikeStylesSummary = {
  averageConsumption: number | null;
  consumptionSampleSize: number;
  averageKnittingTime: number | null;
  knittingSampleSize: number;
  sampleSize: number;
  machineSpeeds: MachineSpeed[];
};

const finiteNumbers = (values: Array<number | null | undefined>) =>
  values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));

const mean = (values: number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

/**
 * Summarizes matched historical styles into the averages + machine speed table
 * (fastest machine first), from the same pool the search already loaded.
 */
/**
 * Cost basis per row, mirroring the margin panel's rule: the landed cost when
 * it is known, otherwise the approved FOB total.
 */
function dominantCurrency(counts: Map<string, number>): string {
  let best = "USD";
  let bestCount = 0;
  for (const [currency, count] of counts) {
    if (count > bestCount) {
      best = currency;
      bestCount = count;
    }
  }
  return best;
}

function costBasisFor(row: LikeStyleMatch): number | null {
  const landed = row.landed_cost;
  if (typeof landed === "number" && Number.isFinite(landed) && landed > 0) return landed;
  const total = row.total_cost;
  return typeof total === "number" && Number.isFinite(total) && total > 0 ? total : null;
}

/**
 * Summarizes matched historical styles into the averages + machine speed table
 * (fastest machine first), from the same pool the search already loaded. Each
 * machine carries its own sample sizes: speed, cost, and margin are averaged
 * over the styles that actually hold that figure, never over the whole bucket.
 */
export function summarizeLikeStyleMatches(matches: LikeStyleMatch[]): LikeStylesSummary {
  // `matches` already holds one row per style (see scoreLikeStyles), so every
  // count here is a distinct-style count and one style can never be averaged in
  // twice for carrying several ERP costing records.
  const consumptions = finiteNumbers(matches.map((row) => row.average_consumption));
  const knittingTimes = finiteNumbers(matches.map((row) => row.knitting_time));

  const byMachine = new Map<
    string,
    {
      time: { total: number; count: number };
      cost: { total: number; count: number; currencies: Map<string, number> };
      margin: { total: number; count: number };
    }
  >();
  for (const row of matches) {
    const machine = row.machine_type?.trim();
    if (!machine) continue;
    const bucket = byMachine.get(machine) ?? {
      time: { total: 0, count: 0 },
      cost: { total: 0, count: 0, currencies: new Map<string, number>() },
      margin: { total: 0, count: 0 }
    };
    const time = row.knitting_time;
    if (typeof time === "number" && Number.isFinite(time)) {
      bucket.time.total += time;
      bucket.time.count += 1;
    }
    const cost = costBasisFor(row);
    const selling = row.selling_price;
    const price = typeof selling === "number" && Number.isFinite(selling) && selling > 0 ? selling : null;
    if (cost !== null) {
      bucket.cost.total += cost;
      bucket.cost.count += 1;
      const currency = row.currency?.trim() || "USD";
      bucket.cost.currencies.set(currency, (bucket.cost.currencies.get(currency) ?? 0) + 1);
      if (price !== null) {
        bucket.margin.total += price - cost;
        bucket.margin.count += 1;
      }
    }
    byMachine.set(machine, bucket);
  }

  return {
    averageConsumption: mean(consumptions),
    consumptionSampleSize: consumptions.length,
    averageKnittingTime: mean(knittingTimes),
    knittingSampleSize: knittingTimes.length,
    sampleSize: matches.length,
    // Machines with no recorded speed still carry cost, so they are listed
    // after the timed ones rather than dropped from the comparison.
    machineSpeeds: [...byMachine.entries()]
      .map(([machineType, bucket]) => ({
        machineType,
        avgKnittingTime: bucket.time.count ? bucket.time.total / bucket.time.count : null,
        sampleSize: bucket.time.count,
        // Averages are never converted: the dominant currency among the styles
        // that carry a cost is stated alongside them.
        currency: dominantCurrency(bucket.cost.currencies),
        avgLandedCost: bucket.cost.count ? bucket.cost.total / bucket.cost.count : null,
        costSampleSize: bucket.cost.count,
        avgMargin: bucket.margin.count ? bucket.margin.total / bucket.margin.count : null,
        marginSampleSize: bucket.margin.count
      }))
      .sort(
        (a, b) =>
          (a.avgKnittingTime ?? Number.POSITIVE_INFINITY) - (b.avgKnittingTime ?? Number.POSITIVE_INFINITY)
      )
  };
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
