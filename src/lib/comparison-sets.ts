import { randomBytes } from "node:crypto";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { pgrestValue } from "@/lib/supabase/filters";

// Named, shareable Like Styles comparison sets.
//
// Costing or PBD saves the exact scored results of a comparison search (plus
// the filters that produced them) under a name. The set gets an unguessable
// share token, and the link opens a stable, read-only snapshot — so both roles
// review the SAME set even after the historical library changes. Sets can be
// anchored to a request so the request detail page lists them.

export type SavedComparisonSet = {
  id: string;
  name: string;
  requestId: string | null;
  filters: Record<string, unknown>;
  results: Array<Record<string, unknown>>;
  benchmark: Record<string, unknown> | null;
  shareToken: string;
  createdBy: string | null;
  createdByRole: string | null;
  createdAt: string;
};

export type SavedComparisonSetInput = {
  name: string;
  requestId?: string | null;
  filters?: Record<string, unknown>;
  results?: Array<Record<string, unknown>>;
  benchmark?: Record<string, unknown> | null;
  createdBy?: string | null;
  createdByRole?: string | null;
};

export async function createSavedComparisonSet(input: SavedComparisonSetInput): Promise<SavedComparisonSet> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("saved_comparison_sets")
    .insert({
      name: input.name.trim(),
      request_id: input.requestId ?? null,
      filters: input.filters ?? {},
      results: input.results ?? [],
      benchmark: input.benchmark ?? null,
      share_token: buildShareToken(),
      created_by: input.createdBy ?? null,
      created_by_role: input.createdByRole ?? null
    })
    .select()
    .single();

  if (error) throw error;
  return mapRow(data);
}

export async function getSavedComparisonSetByToken(token: string): Promise<SavedComparisonSet | null> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("saved_comparison_sets")
    .select()
    .eq("share_token", pgrestValue(token))
    .maybeSingle();

  if (error) throw error;
  return data ? mapRow(data) : null;
}

export async function listSavedComparisonSetsForRequest(requestId: string): Promise<SavedComparisonSet[]> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("saved_comparison_sets")
    .select()
    .eq("request_id", pgrestValue(requestId))
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) throw error;
  return ((data ?? []) as unknown[]).map(mapRow);
}

/** Best-effort wrapper used by the request detail page. */
export async function tryListSavedComparisonSetsForRequest(requestId: string) {
  try {
    return { data: await listSavedComparisonSetsForRequest(requestId), error: null };
  } catch (error) {
    return {
      data: [],
      error: error instanceof Error ? error.message : "Unable to load saved comparison sets"
    };
  }
}

/** The shareable URL for a saved set, e.g. http://host/comparison-sets/<token>. */
export function buildSetShareUrl(token: string): string {
  return `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/comparison-sets/${token}`;
}

/** Unguessable share token (32 hex chars). */
export function buildShareToken(): string {
  return randomBytes(16).toString("hex");
}

function mapRow(row: unknown): SavedComparisonSet {
  const record = (row ?? {}) as Record<string, unknown>;
  return {
    id: String(record.id ?? ""),
    name: String(record.name ?? ""),
    requestId: (record.request_id as string | null) ?? null,
    filters: (record.filters && typeof record.filters === "object" ? record.filters : {}) as Record<string, unknown>,
    results: Array.isArray(record.results) ? (record.results as Array<Record<string, unknown>>) : [],
    benchmark: (record.benchmark && typeof record.benchmark === "object" ? record.benchmark : null) as Record<string, unknown> | null,
    shareToken: String(record.share_token ?? ""),
    createdBy: (record.created_by as string | null) ?? null,
    createdByRole: (record.created_by_role as string | null) ?? null,
    createdAt: String(record.created_at ?? "")
  };
}
