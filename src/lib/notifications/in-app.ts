import { createSupabaseServiceClient } from "@/lib/supabase/server";

// In-app change alerts surfaced on the dashboard.
//
// Every BOM / CBD change and PBD pricing update (plus role "your turn" alerts)
// is recorded in tp_costing.in_app_alerts with the role that should act on it.
// The dashboard shows unread alerts per role and per request, and marks them
// read when the user opens the request or clicks "Mark all read".

export type InAppAlert = {
  id: string;
  costingRequestId: string;
  alertType: string;
  recipientRole: string;
  title: string;
  body: string | null;
  payload: Record<string, unknown> | null;
  createdAt: string;
  requestNumber: string | null;
  factoryName: string | null;
  status: string | null;
};

export type UnreadAlertSummary = {
  alerts: InAppAlert[];
  totalUnread: number;
  perRequest: Record<string, number>;
};

/**
 * Records an in-app alert. Never throws — callers invoke this best-effort
 * alongside the email/Teams enqueue so a failure here can never block the
 * workflow write. Returns true when the row was inserted.
 */
export async function recordInAppAlert(input: {
  requestId: string;
  alertType: string;
  recipientRole: string;
  title: string;
  body?: string;
  payload?: Record<string, unknown>;
}): Promise<boolean> {
  try {
    const supabase = createSupabaseServiceClient();
    const { error } = await supabase.from("in_app_alerts").insert({
      costing_request_id: input.requestId,
      alert_type: input.alertType,
      recipient_role: input.recipientRole,
      title: input.title,
      body: input.body ?? null,
      payload: input.payload ?? null
    });
    return !error;
  } catch (error) {
    console.error("[notifications] in-app alert not recorded:", error instanceof Error ? error.message : error);
    return false;
  }
}

/**
 * Fetches unread alerts for a role, optionally scoped to one request.
 * Request metadata (number, factory, status) is embedded for rendering.
 */
export async function getUnreadInAppAlerts(role: string, opts: { requestId?: string } = {}): Promise<UnreadAlertSummary> {
  const supabase = createSupabaseServiceClient();

  let query = supabase
    .from("in_app_alerts")
    .select(
      `id, costing_request_id, alert_type, recipient_role, title, body, payload, created_at,
       costing_requests ( request_number, factory_name, status )`
    )
    .eq("recipient_role", role)
    .is("read_at", null)
    .order("created_at", { ascending: false })
    .limit(100);

  if (opts.requestId) {
    query = query.eq("costing_request_id", opts.requestId);
  }

  const { data, error } = await query;
  if (error) throw error;

  const alerts: InAppAlert[] = ((data ?? []) as Array<Record<string, unknown>>).map((row) => {
    const request = row.costing_requests as Record<string, unknown> | null;
    return {
      id: String(row.id),
      costingRequestId: String(row.costing_request_id),
      alertType: String(row.alert_type ?? "change"),
      recipientRole: String(row.recipient_role ?? role),
      title: String(row.title ?? "Change alert"),
      body: (row.body as string | null) ?? null,
      payload: (row.payload as Record<string, unknown> | null) ?? null,
      createdAt: String(row.created_at ?? ""),
      requestNumber: (request?.request_number as string | null) ?? null,
      factoryName: (request?.factory_name as string | null) ?? null,
      status: (request?.status as string | null) ?? null
    };
  });

  const perRequest: Record<string, number> = {};
  for (const alert of alerts) {
    perRequest[alert.costingRequestId] = (perRequest[alert.costingRequestId] ?? 0) + 1;
  }

  return { alerts, totalUnread: alerts.length, perRequest };
}

/**
 * Marks alerts read for a role. When `requestIds` is empty, every unread alert
 * for the role is marked (the dashboard "Mark all read" action). Returns the
 * number of rows updated.
 */
export async function markInAppAlertsRead(role: string, opts: { requestIds?: string[] } = {}): Promise<number> {
  const supabase = createSupabaseServiceClient();

  let query = supabase
    .from("in_app_alerts")
    .update({ read_at: new Date().toISOString() })
    .eq("recipient_role", role)
    .is("read_at", null);

  if (opts.requestIds?.length) {
    query = query.in("costing_request_id", opts.requestIds);
  }

  const { data, error } = await query.select("id");
  if (error) throw error;
  return (data ?? []).length;
}

/** Best-effort wrapper used by API routes. */
export async function tryGetUnreadInAppAlerts(role: string) {
  try {
    return { data: await getUnreadInAppAlerts(role), error: null };
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : "Unable to load in-app alerts"
    };
  }
}
