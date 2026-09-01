import { NextResponse } from "next/server";
import { getCurrentRole } from "@/lib/auth/roles";
import { tryGetUnreadInAppAlerts } from "@/lib/notifications/in-app";

// GET /api/notifications/in-app
// Unread in-app change alerts (BOM changed, PBD pricing updated, role "your
// turn" alerts) for the current user's role. Includes per-request counts so
// the dashboard can badge requests that have unread alerts.
export async function GET() {
  const role = getCurrentRole();
  if (!role || role === "viewer") {
    return NextResponse.json({ ok: true, alerts: [], totalUnread: 0, perRequest: {} });
  }

  const { data, error } = await tryGetUnreadInAppAlerts(role);
  if (error || !data) {
    return NextResponse.json(
      { ok: false, error: error ?? "Unable to load in-app alerts", alerts: [], totalUnread: 0, perRequest: {} },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    alerts: data.alerts,
    totalUnread: data.totalUnread,
    perRequest: data.perRequest
  });
}
