import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { pgrestOrTerms, pgrestValue } from "@/lib/supabase/filters";

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

  if (opts?.severity && opts.severity !== "all") {
    request = request.eq("severity", pgrestValue(opts.severity));
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

  if (opts?.eventType && opts.eventType !== "all") {
    request = request.eq("event_type", pgrestValue(opts.eventType));
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
