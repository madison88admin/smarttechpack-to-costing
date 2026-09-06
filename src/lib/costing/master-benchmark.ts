import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { pgrestValue } from "@/lib/supabase/filters";

/**
 * Master material list benchmark — aggregates cost references from ALL
 * submitted factory CBDs (the closest thing to a "master list" the system
 * has) and lets MD review semi-automatically flag lines that are materially
 * above the norm: material unit cost by description, operation cost by
 * operation description, and knitting time by machine type. These are
 * reference ranges, not gates: they power the MD review panel's "Master
 * benchmark" comparison so MD can decide with data instead of guesswork.
 */

export type MasterBenchmarkLine = {
  /** Normalized material name / operation / machine description. */
  label: string;
  category: "material" | "operation" | "knitting";
  /** Average unit cost (USD) — for knitting this is minutes, see isTime. */
  average: number | null;
  /** Median is more robust than the mean for skewed cost data. */
  median: number | null;
  /** Highest observed value. */
  max: number | null;
  /** Number of historical lines behind this benchmark. */
  sampleSize: number;
  /** True when the value is a time (minutes) rather than a cost. */
  isTime?: boolean;
  /** True when the values were curated by MD/Costing/Admin (override derived). */
  isCurated?: boolean;
  /** Curator note, when curated. */
  notes?: string | null;
};

export type MasterBenchmarkResult = {
  lines: MasterBenchmarkLine[];
  builtAt: string;
  error?: string;
};

export type MasterBenchmarkFlag = {
  line: MasterBenchmarkLine;
  actual: number;
  /** Percent above the average benchmark. */
  variancePercent: number;
};

/** How far above the average a line must be before MD review flags it. */
const MATERIAL_VARIANCE_PERCENT = 30;
const OPERATION_VARIANCE_PERCENT = 30;
const KNITTING_VARIANCE_PERCENT = 30;

function normLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = String(value).trim().replace(/\s+/g, " ").toLowerCase();
  return trimmed || null;
}

/** Aggregates unit costs by (normalized) material description. */
function aggregate(
  values: Array<{ key: string; value: number }>,
  category: MasterBenchmarkLine["category"],
  isTime = false
): MasterBenchmarkLine[] {
  const groups = new Map<string, number[]>();
  for (const { key, value } of values) {
    if (!Number.isFinite(value) || value <= 0) continue;
    const list = groups.get(key) ?? [];
    list.push(value);
    groups.set(key, list);
  }

  const lines: MasterBenchmarkLine[] = [];
  for (const [label, nums] of groups) {
    const sorted = [...nums].sort((a, b) => a - b);
    const average = sorted.reduce((sum, n) => sum + n, 0) / sorted.length;
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
    lines.push({
      label,
      category,
      average: round2(average),
      median: round2(median),
      max: round2(sorted[sorted.length - 1]),
      sampleSize: sorted.length,
      isTime
    });
  }

  return lines.sort((a, b) => (b.average ?? 0) - (a.average ?? 0));
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

/**
 * Curated benchmark row (master_material_benchmarks). Curated values override
 * the derived (auto-aggregated) benchmark lines for the same label+category.
 */
export type CuratedBenchmarkRow = {
  id: string;
  label: string;
  category: MasterBenchmarkLine["category"];
  curated_average: number | null;
  curated_median: number | null;
  curated_max: number | null;
  is_time: boolean;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
};

/** Lists every curated benchmark row (admin editor). */
export async function listCuratedBenchmarks(): Promise<{ data: CuratedBenchmarkRow[]; error: string | null }> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("master_material_benchmarks")
    .select("*")
    .order("category")
    .order("label");

  if (error) return { data: [], error: error.message };
  return { data: (data ?? []) as unknown as CuratedBenchmarkRow[], error: null };
}

/**
 * A recorded price change on a curated benchmark reference. Backed by the
 * tp_costing.master_benchmark_history table (migration 008). Recording is
 * best-effort: if the table is not migrated yet the save still succeeds and
 * the change is simply not archived.
 */
export type BenchmarkHistoryRow = {
  id: string;
  label: string;
  category: MasterBenchmarkLine["category"];
  prev_average: number | null;
  prev_median: number | null;
  prev_max: number | null;
  new_average: number | null;
  new_median: number | null;
  new_max: number | null;
  is_time: boolean;
  changed_by: string | null;
  notes: string | null;
  created_at: string;
};

export type BenchmarkHistoryEntry = {
  label: string;
  category: MasterBenchmarkLine["category"];
  prev_average: number | null;
  prev_median?: number | null;
  prev_max?: number | null;
  new_average: number | null;
  new_median?: number | null;
  new_max?: number | null;
  is_time: boolean;
  changed_by?: string | null;
  notes?: string | null;
};

/**
 * Records one price-history entry. Best-effort — never throws and never fails
 * the caller: when the history table is not migrated yet the entry is skipped
 * with a console log instead.
 */
export async function recordBenchmarkHistory(entry: BenchmarkHistoryEntry): Promise<boolean> {
  try {
    const supabase = createSupabaseServiceClient();
    const { error } = await supabase.from("master_benchmark_history").insert({
      label: entry.label,
      category: entry.category,
      prev_average: entry.prev_average,
      prev_median: entry.prev_median,
      prev_max: entry.prev_max,
      new_average: entry.new_average,
      new_median: entry.new_median,
      new_max: entry.new_max,
      is_time: entry.is_time,
      changed_by: entry.changed_by ?? null,
      notes: entry.notes ?? null
    });
    if (error) {
      // Table missing until migration 008 is applied — degrade, don't block saves.
      console.error("[master-benchmark] history not recorded:", error.message);
      return false;
    }
    return true;
  } catch (error) {
    console.error("[master-benchmark] history not recorded:", error instanceof Error ? error.message : error);
    return false;
  }
}

/**
 * Lists recorded price history, newest first. Returns an error string when the
 * history table is not migrated yet so callers can surface a migration notice.
 */
export async function listBenchmarkHistory(opts: { label?: string; category?: string; limit?: number } = {}): Promise<{
  data: BenchmarkHistoryRow[];
  error: string | null;
}> {
  try {
    const supabase = createSupabaseServiceClient();
    let query = supabase
      .from("master_benchmark_history")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(opts.limit ?? 50);
    if (opts.label) query = query.eq("label", pgrestValue(opts.label.trim().replace(/\s+/g, " ")));
    if (opts.category) query = query.eq("category", pgrestValue(opts.category));

    const { data, error } = await query;
    if (error) return { data: [], error: error.message };
    return { data: (data ?? []) as unknown as BenchmarkHistoryRow[], error: null };
  } catch (error) {
    return { data: [], error: error instanceof Error ? error.message : "Unable to load benchmark history" };
  }
}

/**
 * Upserts a curated benchmark row (label+category unique). Records the price
 * change in master_benchmark_history and returns the previous values so
 * callers (e.g. the admin route) can re-flag affected requests.
 */
export async function saveCuratedBenchmark(input: {
  id?: string | null;
  label: string;
  category: MasterBenchmarkLine["category"];
  curatedAverage: number | null;
  curatedMedian?: number | null;
  curatedMax?: number | null;
  isTime: boolean;
  notes?: string | null;
  isActive?: boolean;
  updatedBy?: string | null;
}): Promise<{ data: CuratedBenchmarkRow | null; error: string | null; previous: CuratedBenchmarkRow | null }> {
  const supabase = createSupabaseServiceClient();
  const now = new Date().toISOString();
  const normalizedLabel = input.label.trim().replace(/\s+/g, " ");
  const row = {
    label: normalizedLabel,
    category: input.category,
    curated_average: input.curatedAverage,
    curated_median: input.curatedMedian ?? null,
    curated_max: input.curatedMax ?? null,
    is_time: input.isTime,
    notes: input.notes?.trim() || null,
    is_active: input.isActive ?? true,
    updated_by: input.updatedBy ?? null,
    updated_at: now
  };

  // Fetch the previous row so the change can be archived and affected
  // requests re-flagged. Numeric values may arrive as strings via PostgREST.
  const { data: existing } = await supabase
    .from("master_material_benchmarks")
    .select("*")
    .eq("label", normalizedLabel)
    .eq("category", input.category)
    .maybeSingle();
  const previous = (existing as unknown as CuratedBenchmarkRow | null) ?? null;

  const { data, error } = await supabase
    .from("master_material_benchmarks")
    .upsert(row, { onConflict: "label,category" })
    .select("*")
    .single();

  if (error) return { data: null, error: error.message, previous };
  const saved = data as unknown as CuratedBenchmarkRow;

  // Archive the price change: on create (no previous) or when any curated
  // price value actually changed. Notes-only edits are not archived.
  const num = (value: unknown): number | null => {
    if (value === null || value === undefined) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const prevAverage = previous ? num(previous.curated_average) : null;
  const prevMedian = previous ? num(previous.curated_median) : null;
  const prevMax = previous ? num(previous.curated_max) : null;
  const changed =
    !previous ||
    prevAverage !== num(saved.curated_average) ||
    prevMedian !== num(saved.curated_median) ||
    prevMax !== num(saved.curated_max);
  if (changed) {
    await recordBenchmarkHistory({
      label: saved.label,
      category: saved.category,
      prev_average: prevAverage,
      prev_median: prevMedian,
      prev_max: prevMax,
      new_average: num(saved.curated_average),
      new_median: num(saved.curated_median),
      new_max: num(saved.curated_max),
      is_time: saved.is_time,
      changed_by: saved.updated_by,
      notes: saved.notes
    });
  }

  return { data: saved, error: null, previous };
}

/** Deletes a curated benchmark row by id. */
export async function deleteCuratedBenchmark(id: string): Promise<{ error: string | null }> {
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase.from("master_material_benchmarks").delete().eq("id", id);
  return { error: error?.message ?? null };
}

/** Loads the curated rows and merges them over the derived benchmark lines. */
function mergeCurated(
  derived: MasterBenchmarkLine[],
  curated: CuratedBenchmarkRow[]
): MasterBenchmarkLine[] {
  if (!curated.length) return derived;

  const byKey = new Map<string, MasterBenchmarkLine>();
  for (const line of derived) byKey.set(`${line.category}|${line.label}`, line);

  for (const row of curated) {
    if (!row.is_active) continue;
    const label = normLabel(row.label) ?? row.label;
    const key = `${row.category}|${label}`;
    const line: MasterBenchmarkLine = {
      label,
      category: row.category,
      average: row.curated_average,
      median: row.curated_median,
      max: row.curated_max,
      sampleSize: byKey.get(key)?.sampleSize ?? 0,
      isTime: row.is_time,
      isCurated: true,
      notes: row.notes
    };
    byKey.set(key, line);
  }

  return [...byKey.values()].sort((a, b) => (b.average ?? 0) - (a.average ?? 0));
}

/** Builds the benchmark from every submitted CBD in the database. */
export async function getMasterBenchmark(): Promise<MasterBenchmarkResult> {
  const supabase = createSupabaseServiceClient();

  try {
    // Material lines (yarn/fabric/trim) with unit costs — the structured table
    // is the most reliable source; we also merge in raw_payload structured lines.
    const { data: materialRows, error: linesError } = await supabase
      .from("cbd_material_lines")
      .select("material_name, unit_cost, section");

    if (linesError) throw linesError;

    const materialValues: Array<{ key: string; value: number }> = [];
    for (const row of (materialRows ?? []) as Array<{ material_name: string | null; unit_cost: number | null }>) {
      const key = normLabel(row.material_name);
      if (key && typeof row.unit_cost === "number") {
        materialValues.push({ key, value: row.unit_cost });
      }
    }

    // Operations + knitting lines live inside raw_payload of the CBD (the
    // Excel-template format). Read the latest submitted CBD per request.
    const { data: cbdRows, error: cbdError } = await supabase
      .from("factory_cbds")
      .select("raw_payload")
      .eq("status", "submitted")
      .order("submitted_at", { ascending: false })
      .limit(500);

    if (cbdError) throw cbdError;

    const operationValues: Array<{ key: string; value: number }> = [];
    const knittingValues: Array<{ key: string; value: number }> = [];

    for (const row of (cbdRows ?? []) as Array<{ raw_payload: Record<string, unknown> | null }>) {
      const payload = row.raw_payload ?? {};
      const ops = Array.isArray(payload.operationsLines) ? (payload.operationsLines as Array<Record<string, unknown>>) : [];
      for (const op of ops) {
        const key = normLabel(typeof op.operation === "string" ? op.operation : null);
        const value = typeof op.operationCost === "number" ? op.operationCost : parseFloat(String(op.operationCost ?? ""));
        if (key && Number.isFinite(value) && value > 0) {
          operationValues.push({ key, value });
        }
      }

      const knits = Array.isArray(payload.knittingLines) ? (payload.knittingLines as Array<Record<string, unknown>>) : [];
      for (const knit of knits) {
        const key = normLabel(typeof knit.machineType === "string" ? knit.machineType : null);
        const value = typeof knit.knittingTime === "number" ? knit.knittingTime : parseFloat(String(knit.knittingTime ?? ""));
        if (key && Number.isFinite(value) && value > 0) {
          knittingValues.push({ key, value });
        }
      }

      // Structured yarn/fabric/trim lines embedded in the payload (new format).
      for (const section of ["yarnLines", "fabricLines", "trimLines"] as const) {
        const sectionLines = Array.isArray(payload[section]) ? (payload[section] as Array<Record<string, unknown>>) : [];
        for (const line of sectionLines) {
          const key = normLabel(typeof line.name === "string" ? line.name : null);
          const value = typeof line.materialCost === "number" ? line.materialCost : parseFloat(String(line.materialCost ?? ""));
          if (key && Number.isFinite(value) && value > 0) {
            materialValues.push({ key, value });
          }
        }
      }
    }

    const derivedLines = [
      ...aggregate(materialValues, "material"),
      ...aggregate(operationValues, "operation"),
      ...aggregate(knittingValues, "knitting", true)
    ];

    // Curated references override derived values for the same label+category.
    const { data: curatedRows, error: curatedError } = await supabase
      .from("master_material_benchmarks")
      .select("*")
      .order("category")
      .order("label");
    if (curatedError) throw curatedError;

    const lines = mergeCurated(derivedLines, (curatedRows ?? []) as unknown as CuratedBenchmarkRow[]);

    return { lines, builtAt: new Date().toISOString() };
  } catch (error) {
    return {
      lines: [],
      builtAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : "Unable to build master benchmark"
    };
  }
}

/** Finds the benchmark line for a description (fuzzy: exact normalized match first, then prefix). */
export function findBenchmarkLine(
  benchmark: MasterBenchmarkLine[],
  label: string | null | undefined,
  category: MasterBenchmarkLine["category"]
): MasterBenchmarkLine | null {
  const key = normLabel(label);
  if (!key) return null;

  const exact = benchmark.find((line) => line.category === category && line.label === key);
  if (exact) return exact;

  // Prefix match (e.g. "100% Acrylic ..." vs "100% Acrylic") so partial names still find a reference.
  return (
    benchmark.find((line) => line.category === category && (key.startsWith(line.label) || line.label.startsWith(key))) ?? null
  );
}

/** Flags a single value against its benchmark when it is materially above the average. */
export function flagAgainstBenchmark(
  benchmark: MasterBenchmarkLine[],
  label: string | null | undefined,
  category: MasterBenchmarkLine["category"],
  actual: number | null | undefined,
  variancePercent: number = MATERIAL_VARIANCE_PERCENT
): MasterBenchmarkFlag | null {
  if (actual === null || actual === undefined || !Number.isFinite(actual) || actual <= 0) return null;
  const line = findBenchmarkLine(benchmark, label, category);
  if (!line || line.average === null || line.average <= 0) return null;

  const pct = ((actual - line.average) / line.average) * 100;
  if (pct <= variancePercent) return null;

  return { line, actual: round2(actual), variancePercent: round2(pct) };
}

/** Convenience: flags every material line of a submitted CBD for the MD panel. */
export async function flagCbdAgainstMasterBenchmark(
  materialLines: Array<{ material_name: string | null; unit_cost: number | null }>,
  operationsLines: Array<{ operation: string | null; operationCost: number | null }>,
  knittingLines: Array<{ machineType: string | null; knittingTime: number | null }>
): Promise<{
  flags: MasterBenchmarkFlag[];
  benchmark: MasterBenchmarkLine[];
  error?: string;
}> {
  const benchmarkResult = await getMasterBenchmark();
  const benchmark = benchmarkResult.lines;

  const flags: MasterBenchmarkFlag[] = [];

  for (const line of materialLines) {
    const flag = flagAgainstBenchmark(benchmark, line.material_name, "material", line.unit_cost, MATERIAL_VARIANCE_PERCENT);
    if (flag) flags.push(flag);
  }
  for (const op of operationsLines) {
    const flag = flagAgainstBenchmark(benchmark, op.operation, "operation", op.operationCost, OPERATION_VARIANCE_PERCENT);
    if (flag) flags.push(flag);
  }
  for (const knit of knittingLines) {
    const flag = flagAgainstBenchmark(benchmark, knit.machineType, "knitting", knit.knittingTime, KNITTING_VARIANCE_PERCENT);
    if (flag) flags.push(flag);
  }

  return { flags, benchmark, error: benchmarkResult.error };
}
