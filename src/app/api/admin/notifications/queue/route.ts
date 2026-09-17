import { NextResponse } from "next/server";
import { canAccessAdmin, getCurrentRole } from "@/lib/auth/roles";
import { notificationQueueSummary, requeueFailedNotifications } from "@/lib/notifications/queue";

// GET /api/admin/notifications/queue
// Outbound email/Teams queue health: which transport can send, how many rows are
// waiting, and why the last failure happened.
export async function GET() {
  if (!canAccessAdmin(getCurrentRole())) {
    return NextResponse.json({ ok: false, error: "Admin role required" }, { status: 403 });
  }

  try {
    return NextResponse.json({ ok: true, data: await notificationQueueSummary() });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to read the notification queue" },
      { status: 500 }
    );
  }
}

// POST /api/admin/notifications/queue
// Requeues permanently-failed notifications so they retry now that a transport
// exists. Body: { "force"?: true } to park them as pending even when no
// transport is configured yet.
export async function POST(request: Request) {
  if (!canAccessAdmin(getCurrentRole())) {
    return NextResponse.json({ ok: false, error: "Admin role required" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));

  try {
    const result = await requeueFailedNotifications({ force: body?.force === true });

    // No transport yet: the rows are deliberately untouched, so tell the caller
    // why instead of reporting a successful requeue of zero.
    if (result.skipped) {
      return NextResponse.json({ ok: false, error: result.skipped, ...result }, { status: 409 });
    }

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to requeue notifications" },
      { status: 500 }
    );
  }
}
