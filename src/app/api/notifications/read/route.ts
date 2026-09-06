import { NextResponse } from "next/server";
import { getCurrentRole } from "@/lib/auth/roles";
import { markNotificationsRead } from "@/lib/notifications/read-state";
import { markInAppAlertsRead } from "@/lib/notifications/in-app";
import { requestIdFromNotificationKey } from "@/lib/notifications/keys";

// POST /api/notifications/read
// Marks derived feed notifications as read/dismissed for the current user's role.
// Body: { "keys": ["overdue-<updated>-<requestId>", "review-<status>-<updated>-<requestId>", ...] }
// The keys are the ones emitted by /api/notifications/pending; duplicates and
// already-read keys are ignored server-side.
//
// The request ids embedded in the keys are also used to clear the same
// requests' in-app change-alert badges, so dismissing a bell item keeps the
// dashboard's two notification stores in sync. That marking is best-effort — a
// failure there must never fail the bell dismissal itself.
export async function POST(request: Request) {
  const role = getCurrentRole();
  if (!role || role === "viewer") {
    return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
  }

  let keys: string[] = [];
  try {
    const body = (await request.json()) as { keys?: unknown };
    if (body.keys !== undefined) {
      if (!Array.isArray(body.keys)) {
        return NextResponse.json({ ok: false, error: "keys must be an array" }, { status: 400 });
      }
      keys = body.keys.filter((key): key is string => typeof key === "string").slice(0, 200);
    }
  } catch {
    return NextResponse.json({ ok: false, error: "keys must be an array" }, { status: 400 });
  }

  if (keys.length === 0) {
    return NextResponse.json({ ok: true, updated: 0, inAppUpdated: 0 });
  }

  try {
    const updated = await markNotificationsRead(role, keys);

    // Best-effort: clear the in-app change-alert badges for the requests these
    // keys refer to (deduped). Never fail the bell dismissal on a read-state
    // hiccup — mirrors the reverse direction in /api/notifications/in-app/read.
    let inAppUpdated = 0;
    try {
      const requestIds = [
        ...new Set(keys.map(requestIdFromNotificationKey).filter((id): id is string => Boolean(id)))
      ];
      if (requestIds.length > 0) {
        inAppUpdated = await markInAppAlertsRead(role, { requestIds });
      }
    } catch {
      // Best-effort — ignore.
    }

    return NextResponse.json({ ok: true, updated, inAppUpdated });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to mark notifications read" },
      { status: 500 }
    );
  }
}
