import { listAuditEvents } from "@/lib/admin/logs";
import { canAccessAdmin, getCurrentRole } from "@/lib/auth/roles";
import { csvResponse, toCsv } from "@/lib/export/csv";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  if (!canAccessAdmin(getCurrentRole())) {
    return NextResponse.json({ ok: false, error: "Admin role required" }, { status: 403 });
  }

  const url = new URL(request.url);
  const query = url.searchParams.get("q") ?? "";
  const eventType = url.searchParams.get("eventType") ?? "all";

  const { data: events } = await listAuditEvents({
    limit: 10000,
    offset: 0,
    query,
    eventType
  }).catch(() => ({ data: [], total: 0 }));

  const headers = ["created_at", "event_type", "actor_role", "notification_status", "costing_request_id", "payload"];
  const csv = toCsv(
    events.map((e) => ({
      created_at: e.created_at,
      event_type: e.event_type,
      actor_role: e.actor_role ?? "System",
      notification_status: e.notification_status,
      costing_request_id: e.costing_request_id ?? "",
      payload: JSON.stringify(e.payload ?? {})
    })),
    headers
  );

  return csvResponse(`audit-events-${new Date().toISOString().slice(0, 10)}.csv`, csv);
}
