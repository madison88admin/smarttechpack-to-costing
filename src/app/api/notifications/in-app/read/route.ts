import { NextResponse } from "next/server";
import { getCurrentRole } from "@/lib/auth/roles";
import { markInAppAlertsRead } from "@/lib/notifications/in-app";
import { markNotificationsRead } from "@/lib/notifications/read-state";
import { tryListCostingRequests } from "@/lib/costing/requests";
import { overdueNotificationKey, reviewNotificationKey } from "@/lib/notifications/keys";

// POST /api/notifications/in-app/read
// Marks in-app alerts read for the current user's role. Body:
//   { "requestIds": ["uuid", ...] }  — mark only these requests (optional;
//                                      omit for "mark all read")
// The same requests' derived bell receipts are also marked, so viewing a
// request (or "Mark all read" on the change-alerts panel) clears the bell's
// SLA / review items for that request too. Bell marking is best-effort — a
// failure there must never block the in-app alert update.
export async function POST(request: Request) {
  const role = getCurrentRole();
  if (!role || role === "viewer") {
    return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
  }

  let requestIds: string[] | undefined;
  try {
    const body = (await request.json()) as { requestIds?: unknown };
    if (body.requestIds !== undefined) {
      if (!Array.isArray(body.requestIds)) {
        return NextResponse.json({ ok: false, error: "requestIds must be an array" }, { status: 400 });
      }
      requestIds = body.requestIds.filter((id): id is string => typeof id === "string");
    }
  } catch {
    // No body — treat as "mark all read".
  }

  try {
    const updated = await markInAppAlertsRead(role, { requestIds });

    // Best-effort: clear the derived bell receipts for the same requests.
    let bellKeys = 0;
    try {
      const { data } = await tryListCostingRequests({
        status: "all",
        limit: 200,
        offset: 0,
        roles: [role]
      });
      const rows = (data ?? []).filter((row) => !requestIds || requestIds.includes(row.id));
      const keys: string[] = [];
      for (const row of rows) {
        keys.push(overdueNotificationKey(row), reviewNotificationKey(row));
      }
      bellKeys = keys.length ? await markNotificationsRead(role, keys) : 0;
    } catch {
      // Bell marking is best-effort — never fail the in-app update.
    }

    return NextResponse.json({ ok: true, updated, bellKeys });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to mark alerts read" },
      { status: 500 }
    );
  }
}