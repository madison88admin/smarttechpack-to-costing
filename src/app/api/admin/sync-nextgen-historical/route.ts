import { NextResponse } from "next/server";
import { canAccessAdmin, getCurrentRole } from "@/lib/auth/roles";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { nextGenPost } from "@/lib/nextgen/client";
import {
  NEXTGEN_HISTORICAL_SOURCE,
  NEXTGEN_HISTORICAL_STATUSES,
  enrichWithBomConsumption,
  fetchNextGenHistoricalProducts,
  historicalDedupKey,
  mapNextGenProductToHistorical,
  statusFilter
} from "@/lib/nextgen/historical";

const MAX_INSERT_BATCH = 50;
const MAX_LIMIT = 20000;

function parseStatuses(raw: string | null): string[] {
  if (!raw) return [...NEXTGEN_HISTORICAL_STATUSES];
  const statuses = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const allowed = new Set(NEXTGEN_HISTORICAL_STATUSES);
  return statuses.filter((s) => allowed.has(s)).length ? statuses.filter((s) => allowed.has(s)) : [...NEXTGEN_HISTORICAL_STATUSES];
}

function parseLimit(raw: string | null): number | undefined {
  if (!raw) return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.min(parsed, MAX_LIMIT);
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

// GET /api/admin/sync-nextgen-historical?statuses=Dropped&limit=50
// Dry-run preview: NextGen counts per status + how many are already synced.
export async function GET(request: Request) {
  const role = getCurrentRole();
  if (!canAccessAdmin(role)) {
    return NextResponse.json({ ok: false, error: "Only admins can preview NextGen historical sync" }, { status: 403 });
  }

  const url = new URL(request.url);
  const statuses = parseStatuses(url.searchParams.get("statuses"));
  const limit = parseLimit(url.searchParams.get("limit"));

  const counts: Array<{ status: string; total: number }> = [];
  for (const status of statuses) {
    try {
      const result = await nextGenPost("productSearch", {
        take: 1,
        skip: 0,
        page: 1,
        pageSize: 1,
        filter: statusFilter(status)
      });
      const body = (result.body ?? {}) as { Total?: number };
      counts.push({ status, total: result.ok ? Number(body.Total ?? 0) : 0 });
    } catch (error) {
      const message = error instanceof Error ? error.message : "NextGen call failed";
      return NextResponse.json({ ok: false, error: message }, { status: 502 });
    }
  }

  const supabase = createSupabaseServiceClient();
  const { count: existing, error } = await supabase
    .from("historical_costings")
    .select("id", { count: "exact", head: true })
    .eq("source", NEXTGEN_HISTORICAL_SOURCE);

  if (error) {
    return NextResponse.json({ ok: false, error: `Failed to count synced rows: ${error.message}` }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    statuses: counts,
    totalInNextGen: counts.reduce((sum, c) => sum + c.total, 0),
    alreadySynced: existing ?? 0,
    limit,
    source: NEXTGEN_HISTORICAL_SOURCE
  });
}

// POST /api/admin/sync-nextgen-historical
// Body: { statuses?: string[], limit?: number, enrichBom?: boolean }
// Pulls Dropped/archived products + default costing from NextGen into
// historical_costings (source='nextgen', excluded from benchmarks).
export async function POST(request: Request) {
  const role = getCurrentRole();
  if (!canAccessAdmin(role)) {
    return NextResponse.json({ ok: false, error: "Only admins can sync NextGen historical data" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const statuses = parseStatuses(typeof body?.statuses === "string" ? body.statuses : null);
  const limit = parseLimit(typeof body?.limit === "string" ? body.limit : null);
  const enrichBom = body?.enrichBom === true;

  const supabase = createSupabaseServiceClient();

  try {
    const { rows, scanned, perStatus } = await fetchNextGenHistoricalProducts(statuses, limit);

    if (rows.length === 0) {
      return NextResponse.json({ ok: true, scanned: 0, inserted: 0, alreadySynced: 0, failed: 0, perStatus, message: "No historical products found for the selected statuses" });
    }

    const mapped = rows.map(mapNextGenProductToHistorical);
    if (enrichBom) {
      await enrichWithBomConsumption(mapped, 100);
    }

    // Skip rows already present (any source) for the same style + factory so
    // AI search and analytics never see near-duplicate rows.
    const styles = [...new Set(mapped.map((r) => r.style_number).filter((s): s is string => Boolean(s)))];
    const existingKeys = new Set<string>();
    for (const styleChunk of chunk(styles, 400)) {
      const { data: existing } = await supabase
        .from("historical_costings")
        .select("style_number, factory_name")
        .in("style_number", styleChunk)
        .limit(4000);
      for (const row of (existing ?? []) as Array<{ style_number: string | null; factory_name: string | null }>) {
        existingKeys.add(historicalDedupKey(row.style_number, row.factory_name));
      }
    }

    const toInsert = mapped.filter((record) => !existingKeys.has(historicalDedupKey(record.style_number, record.factory_name)));
    const alreadySynced = mapped.length - toInsert.length;

    let inserted = 0;
    const errors: string[] = [];
    for (const batch of chunk(toInsert, MAX_INSERT_BATCH)) {
      const { error } = await supabase.from("historical_costings").insert(batch);
      if (error) {
        errors.push(error.message);
      } else {
        inserted += batch.length;
      }
    }

    return NextResponse.json({
      ok: true,
      scanned,
      mapped: mapped.length,
      alreadySynced,
      inserted,
      failed: toInsert.length - inserted,
      errors: errors.length > 0 ? errors : undefined,
      perStatus,
      enrichBom,
      benchmarkExcluded: true
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "NextGen historical sync failed";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
