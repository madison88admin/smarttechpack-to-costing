import { createSupabaseServiceClient } from "@/lib/supabase/server";
import type { NextGenFilterOptions } from "./filter-options";

/**
 * Durable layer for the NextGen filter directory (migration 020).
 *
 * The directory comes from an ERP scan that walks up to 20 pages (~20s), so
 * without a persisted copy the first request after every restart or deploy pays
 * for the whole scan. This module owns the snapshot table: the scan and the
 * cache do not need to know it exists.
 */
const SNAPSHOT_TABLE = "nextgen_filter_option_cache";
const SNAPSHOT_ID = 1;

export async function loadFilterOptionsSnapshot(): Promise<{ data: NextGenFilterOptions; savedAt: number } | null> {
  try {
    const supabase = createSupabaseServiceClient();
    const { data, error } = await supabase
      .from(SNAPSHOT_TABLE)
      .select("payload, refreshed_at")
      .eq("id", SNAPSHOT_ID)
      .maybeSingle();
    if (error || !data) return null;
    const savedAt = Date.parse(String(data.refreshed_at));
    if (!Number.isFinite(savedAt)) return null;
    return { data: data.payload as NextGenFilterOptions, savedAt };
  } catch {
    // Table not migrated yet, or the database is unreachable: the ERP scan
    // still runs, exactly as it did before the snapshot existed.
    return null;
  }
}

/** Best-effort write of a scan; the caller never waits on it. */
export async function saveFilterOptionsSnapshot(data: NextGenFilterOptions): Promise<void> {
  // A scan that found nothing is not remembered, so one bad ERP moment cannot
  // become the directory every later boot serves.
  if (!data.factories.length && !data.yarnTypes.length && !data.customers.length) return;
  try {
    const supabase = createSupabaseServiceClient();
    await supabase
      .from(SNAPSHOT_TABLE)
      .upsert({ id: SNAPSHOT_ID, payload: data, refreshed_at: new Date().toISOString() });
  } catch {
    // The in-process cache is the authority for this process regardless.
  }
}
