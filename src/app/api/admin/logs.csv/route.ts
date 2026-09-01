import { listSystemErrorLogs } from "@/lib/admin/logs";
import { canAccessAdmin, getCurrentRole } from "@/lib/auth/roles";
import { csvResponse, toCsv } from "@/lib/export/csv";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  if (!canAccessAdmin(getCurrentRole())) {
    return NextResponse.json({ ok: false, error: "Admin role required" }, { status: 403 });
  }

  const url = new URL(request.url);
  const query = url.searchParams.get("q") ?? "";
  const severity = url.searchParams.get("severity") ?? "all";

  const { data: logs } = await listSystemErrorLogs({
    limit: 10000,
    offset: 0,
    query,
    severity
  }).catch(() => ({ data: [], total: 0 }));

  const headers = ["created_at", "severity", "source", "message"];
  const csv = toCsv(
    logs.map((l) => ({
      created_at: l.created_at,
      severity: l.severity,
      source: l.source,
      message: l.message
    })),
    headers
  );

  return csvResponse(`error-logs-${new Date().toISOString().slice(0, 10)}.csv`, csv);
}
