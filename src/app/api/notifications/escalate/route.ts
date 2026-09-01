import { NextResponse } from "next/server";
import { canAccessAdmin, getCurrentRole } from "@/lib/auth/roles";
import { tryProcessEscalations } from "@/lib/notifications/escalation";
import { processNotificationQueue } from "@/lib/notifications/queue";

// POST /api/notifications/escalate
// Admin or cron-triggered endpoint that:
// 1. Checks all active requests for SLA breaches
// 2. Sends reminders for approaching SLA
// 3. Sends escalations for significantly overdue requests
// 4. Processes the notification queue to actually send them
export async function POST(request: Request) {
  const cronSecret = request.headers.get("x-cron-secret");
  const expectedSecret = process.env.CRON_SECRET;

  if (cronSecret && expectedSecret && cronSecret === expectedSecret) {
    // Authorized via cron secret
  } else {
    const role = getCurrentRole();
    if (!canAccessAdmin(role)) {
      return NextResponse.json(
        { ok: false, error: "Only admins can trigger escalation processing" },
        { status: 403 }
      );
    }
  }

  try {
    const escalationResult = await tryProcessEscalations();
    const sendResult = await processNotificationQueue();

    return NextResponse.json({
      ok: true,
      escalations: escalationResult,
      sent: sendResult
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Escalation processing failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
