import { createSupabaseServiceClient } from "@/lib/supabase/server";

// Durable read receipts for the derived notification feed (/api/notifications/pending).
//
// The bell feed is recomputed from live request state on every poll, so without a
// stored marker every SLA / review item would re-nag on every page load, on every
// device, and for every role sharing a browser. Keys are emitted by the pending
// route (e.g. `overdue-<updated>-<requestId>`, `review-<status>-<updated>-<requestId>`)
// and stay stable while a request sits in one situation — a status transition (or
// any request touch) produces a fresh key so the item nags again only when the
// situation actually changed.

export async function getReadNotificationKeys(role: string): Promise<Set<string>> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("notification_reads")
    .select("notification_key")
    .eq("recipient_role", role);

  if (error) throw new Error(String((error as { message?: unknown })?.message ?? "Unable to load read notifications"));
  return new Set(((data ?? []) as Array<{ notification_key: string }>).map((row) => row.notification_key));
}

/**
 * Marks notification keys as read/dismissed for a role. Duplicates and already
 * read keys are ignored (upsert on conflict does nothing). Returns the number
 * of keys that were marked.
 */
export async function markNotificationsRead(role: string, keys: string[]): Promise<number> {
  const unique = [...new Set(keys.map((key) => key.trim()).filter(Boolean))];
  if (unique.length === 0) return 0;

  const supabase = createSupabaseServiceClient();
  const { error } = await supabase.from("notification_reads").upsert(
    unique.map((key) => ({ recipient_role: role, notification_key: key })),
    { onConflict: "recipient_role,notification_key", ignoreDuplicates: true }
  );
  if (error) throw new Error(String((error as { message?: unknown })?.message ?? "Unable to mark notifications read"));
  return unique.length;
}
