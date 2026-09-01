import { NextResponse } from "next/server";
import { canAccessAdmin, getCurrentRole } from "@/lib/auth/roles";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import {
  NEXTGEN_HISTORICAL_SOURCE,
  NEXTGEN_HISTORICAL_STATUSES,
  enrichWithBomConsumption,
  fetchNextGenHistoricalProducts,
  historicalDedupKey,
  mapNextGenProductToHistorical
} from "@/lib/nextgen/historical";
import { notifyBackfillCompleted, recordBackfillAuditEvent } from "@/lib/notifications/admin-alerts";

const MAX_LIMIT = 20000;

function isCronAuthorized(request: Request): boolean {
  const cronSecret = request.headers.get("x-cron-secret");
  const expected = process.env.CRON_SECRET;
  return Boolean(cronSecret && expected && cronSecret === expected);
}

function parseStatuses(raw: string | null): string[] {
  if (!raw) return [...NEXTGEN_HISTORICAL_STATUSES];
  const statuses = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const allowed = new Set(NEXTGEN_HISTORICAL_STATUSES);
  const kept = statuses.filter((s) => allowed.has(s));
  return kept.length ? kept : [...NEXTGEN_HISTORICAL_STATUSES];
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

type ExistingRow = {
  id: string;
  style_number: string | null;
  factory_name: string | null;
  knitting_time: number | null;
  average_consumption: number | null;
};

/** One field change a backfill would make (dry-run preview entry). */
export type DryRunChange = {
  style_number: string | null;
  factory_name: string | null;
  knitting_time?: { from: number | null; to: number };
  average_consumption?: { from: number | null; to: number };
};

/** Dry-run previews are capped so the response stays small. */
const PREVIEW_LIMIT = 100;

// POST /api/admin/backfill-nextgen-times
// Body: { statuses?: string[], limit?: number, enrichBom?: boolean, dryRun?: boolean }
// Re-fetches Dropped/archived products from NextGen and pushes knitting-time /
// SMV values (and optionally BOM consumption) into EXISTING NextGen-synced
// historical rows. The regular sync skips rows that already exist, so rows
// synced before NextGen populated its SMV fields would never receive them;
// this backfill closes that gap. Only rows with source='nextgen' are touched,
// nulls are never written over existing values, and no duplicates are created.
//
// Admin-triggered (UI) or cron-triggered (daily, x-cron-secret). When the run
// actually populates new knitting-time / SMV values, admins are alerted via
// the notification queue — best-effort, never failing the run itself.
//
// With dryRun: true nothing is written — the response lists the exact rows and
// fields that WOULD change (from → to), capped at PREVIEW_LIMIT entries, so
// admins can inspect the impact before committing a real run.
export async function POST(request: Request) {
  const cronAuthorized = isCronAuthorized(request);
  if (!cronAuthorized) {
    const role = getCurrentRole();
    if (!canAccessAdmin(role)) {
      return NextResponse.json({ ok: false, error: "Only admins can backfill NextGen historical times" }, { status: 403 });
    }
  }

  const body = await request.json().catch(() => null);
  const statuses = parseStatuses(typeof body?.statuses === "string" ? body.statuses : null);
  const limit = parseLimit(typeof body?.limit === "string" ? body.limit : null);
  const enrichBom = body?.enrichBom === true;
  const dryRun = body?.dryRun === true;

  const supabase = createSupabaseServiceClient();

  try {
    const { rows, scanned, perStatus } = await fetchNextGenHistoricalProducts(statuses, limit);
    if (rows.length === 0) {
      return NextResponse.json({
        ok: true,
        dryRun,
        scanned: 0,
        matched: 0,
        updated: 0,
        wouldUpdate: 0,
        skipped: 0,
        perStatus,
        message: "No historical products found for the selected statuses"
      });
    }

    const mapped = rows.map(mapNextGenProductToHistorical);
    if (enrichBom) {
      await enrichWithBomConsumption(mapped, 100);
    }

    // Only records that actually carry a new value are backfill candidates.
    const candidates = mapped.filter(
      (record) =>
        record.knitting_time != null ||
        (enrichBom && record.average_consumption != null)
    );

    // Locate existing NextGen-synced rows by style + factory (the dedup key the
    // original sync used), so we update — never duplicate — and never touch
    // approved-CBD or manual-import rows.
    const styles = [...new Set(candidates.map((r) => r.style_number).filter((s): s is string => Boolean(s)))];
    const byKey = new Map<string, ExistingRow[]>();
    for (const styleChunk of chunk(styles, 400)) {
      const { data: existing, error } = await supabase
        .from("historical_costings")
        .select("id, style_number, factory_name, knitting_time, average_consumption")
        .in("style_number", styleChunk)
        .eq("source", NEXTGEN_HISTORICAL_SOURCE)
        .limit(4000);
      if (error) throw error;
      for (const row of (existing ?? []) as ExistingRow[]) {
        const key = historicalDedupKey(row.style_number, row.factory_name);
        const bucket = byKey.get(key) ?? [];
        bucket.push(row);
        byKey.set(key, bucket);
      }
    }

    let updated = 0;
    let skipped = 0;
    const errors: string[] = [];
    const preview: DryRunChange[] = [];
    let previewTotal = 0;

    for (const record of candidates) {
      const key = historicalDedupKey(record.style_number, record.factory_name);
      const existingRows = byKey.get(key) ?? [];

      if (existingRows.length === 0) {
        skipped += 1; // no NextGen-synced row to update
        continue;
      }

      let changed = false;
      for (const existing of existingRows) {
        const change: DryRunChange = {
          style_number: existing.style_number,
          factory_name: existing.factory_name
        };
        if (record.knitting_time != null && existing.knitting_time !== record.knitting_time) {
          change.knitting_time = { from: existing.knitting_time, to: record.knitting_time };
        }
        if (enrichBom && record.average_consumption != null && existing.average_consumption !== record.average_consumption) {
          change.average_consumption = { from: existing.average_consumption, to: record.average_consumption };
        }
        if (!change.knitting_time && !change.average_consumption) continue;

        if (dryRun) {
          // Preview mode: collect the change, write nothing.
          previewTotal += 1;
          if (preview.length < PREVIEW_LIMIT) preview.push(change);
          changed = true;
          continue;
        }

        const updates: Record<string, unknown> = {};
        if (change.knitting_time) updates.knitting_time = change.knitting_time.to;
        if (change.average_consumption) updates.average_consumption = change.average_consumption.to;

        const { error } = await supabase
          .from("historical_costings")
          .update(updates)
          .eq("id", existing.id);
        if (error) {
          errors.push(error.message);
        } else {
          changed = true;
        }
      }
      if (changed) updated += 1;
      else skipped += 1;
    }

    if (dryRun) {
      return NextResponse.json({
        ok: true,
        dryRun: true,
        scanned,
        candidates: candidates.length,
        matched: byKey.size,
        wouldUpdate: updated,
        wouldSkip: skipped,
        preview,
        totalPreview: previewTotal,
        previewTruncated: previewTotal > preview.length,
        perStatus,
        enrichBom
      });
    }

    // Record the run in the audit trail (workflow_events) — every real run is
    // logged with counts so admins can see when values were populated. Runs
    // even when nothing changed; dry-runs are never recorded.
    const audited = await recordBackfillAuditEvent({
      actorRole: cronAuthorized ? "system" : getCurrentRole(),
      scanned,
      candidates: candidates.length,
      matched: byKey.size,
      updated,
      skipped,
      perStatus,
      enrichBom,
      errors
    }).catch(() => false);

    // Alert admins (best-effort) when new knitting-time / SMV values were
    // actually populated — a silent success with no new data sends nothing.
    const alerted = await notifyBackfillCompleted({ updated, scanned, perStatus }).catch(() => 0);

    return NextResponse.json({
      ok: true,
      scanned,
      candidates: candidates.length,
      matched: byKey.size,
      updated,
      skipped,
      alerted,
      audited,
      errors: errors.length > 0 ? errors : undefined,
      perStatus,
      enrichBom
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "NextGen backfill failed";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
