import { NextResponse } from "next/server";
import { canAccessAdmin, getCurrentRole } from "@/lib/auth/roles";
import { enqueueNotificationsForPendingEvents, processNotificationQueue } from "@/lib/notifications/queue";

// POST /api/notifications/process
// Admin-triggered or cron-triggered endpoint that:
// 1. Enqueues notifications for pending workflow events
// 2. Sends pending notifications from the queue
export async function POST(request: Request) {
  // Allow cron via secret header, or admin role
  const cronSecret = request.headers.get("x-cron-secret");
  const expectedSecret = process.env.CRON_SECRET;

  if (cronSecret && expectedSecret && cronSecret === expectedSecret) {
    // Authorized via cron secret
  } else {
    const role = getCurrentRole();
    if (!canAccessAdmin(role)) {
      return NextResponse.json(
        { ok: false, error: "Only admins can trigger notification processing" },
        { status: 403 }
      );
    }
  }

  try {
    const enqueueResult = await enqueueNotificationsForPendingEvents();
    const sendResult = await processNotificationQueue();

    return NextResponse.json({
      ok: true,
      enqueued: enqueueResult,
      sent: sendResult
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Notification processing failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
