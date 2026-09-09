import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { pgrestOrTerms, pgrestValue } from "@/lib/supabase/filters";

/**
 * Known severity values (from the admin error-log filter). Values outside
 * this vocabulary are treated as "no filter" — the same security semantics as
 * the status whitelist — so hostile multi-word values can never reach the
 * PostgREST .eq() filter where they can hang the query.
 */
export const KNOWN_SEVERITIES = ["error", "warning", "info"] as const;

export type LogSeverity = (typeof KNOWN_SEVERITIES)[number];

/**
 * Known audit event types (from the admin audit filter dropdown). Unknown
 * values fall back to "no filter" exactly like the status whitelist.
 */
export const KNOWN_EVENT_TYPES = [
  "approve",
  "reject",
  "clarify",
  "costing_clarify",
  "costing_complete",
  "factory_submit",
  "send_to_factory",
  "md_review",
  "customer_status_changed",
  "escalation",
  "reminder",
  "cost_sheet_ready",
  "cost_sheet_not_ready",
  "bom_changed",
  "nextgen_backfill",
  "nextgen_metadata_changed",
  "pbd_pricing_updated",
  "factory_assignment_changed"
] as const;

export type AuditEventType = (typeof KNOWN_EVENT_TYPES)[number];

export async function listSystemErrorLogs(opts?: {
  limit?: number;
  offset?: number;
  query?: string;
  severity?: string;
}) {
  const supabase = createSupabaseServiceClient();
  const limit = opts?.limit ?? 50;
  const offset = opts?.offset ?? 0;

  let request = supabase
    .from("system_error_logs")
    .select("id,source,severity,message,metadata,created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  const severity = opts?.severity ?? "all";
  if (severity !== "all" && (KNOWN_SEVERITIES as readonly string[]).includes(severity)) {
    request = request.eq("severity", pgrestValue(severity));
  }

  if (opts?.query?.trim()) {
    // Quote the value so commas/spaces in the search term are literal instead
    // of being parsed as PostgREST filter grammar (which errors or hangs).
    request = request.or(pgrestOrTerms(["message", "source"], opts.query.trim()));
  }

  const { data, error, count } = await request;
  if (error) throw error;

  return { data: data ?? [], total: count ?? 0 };
}

export async function listAuditEvents(opts?: {
  limit?: number;
  offset?: number;
  query?: string;
  eventType?: string;
}) {
  const supabase = createSupabaseServiceClient();
  const limit = opts?.limit ?? 50;
  const offset = opts?.offset ?? 0;

  let request = supabase
    .from("workflow_events")
    .select("id,costing_request_id,event_type,actor_role,payload,notification_status,created_at,processed_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  const eventType = opts?.eventType ?? "all";
  if (eventType !== "all" && (KNOWN_EVENT_TYPES as readonly string[]).includes(eventType)) {
    request = request.eq("event_type", pgrestValue(eventType));
  }

  if (opts?.query?.trim()) {
    // Quote the value so commas/spaces in the search term are literal instead
    // of being parsed as PostgREST filter grammar (which errors or hangs).
    request = request.or(pgrestOrTerms(["event_type", "actor_role"], opts.query.trim()));
  }

  const { data, error, count } = await request;
  if (error) throw error;

  return { data: data ?? [], total: count ?? 0 };
}
