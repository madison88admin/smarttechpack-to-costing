import { NextResponse } from "next/server";
import { canAccessAdmin, getCurrentRole } from "@/lib/auth/roles";
import { trySendDailyDigest } from "@/lib/notifications/daily-digest";
import { processNotificationQueue } from "@/lib/notifications/queue";
import { defaultWorkflowSettings, getWorkflowSettings } from "@/lib/admin/settings";

// POST /api/notifications/daily-digest
// Admin-triggered or cron-triggered endpoint that:
// 1. Summarizes BOM/CBD submissions and PBD pricing changes from the last 24h
// 2. Emails the digest to the costing team via the notification queue
// 3. Processes the queue so the digest is actually sent
//
// Suggested cron (daily): 0 7 * * * curl -X POST -H "x-cron-secret: $CRON_SECRET" \
//   https://<app>/api/notifications/daily-digest
export async function POST(request: Request) {
  const cronSecret = request.headers.get("x-cron-secret");
  const expectedSecret = process.env.CRON_SECRET;

  if (cronSecret && expectedSecret && cronSecret === expectedSecret) {
    // Authorized via cron secret. Respect the admin schedule configuration.
    const settings = await getWorkflowSettings().catch(() => defaultWorkflowSettings);
    if (!settings.enableScheduledReports) {
      return NextResponse.json({ ok: true, enqueued: 0, sent: { sent: 0, failed: 0 }, skipped: "scheduled reports disabled" });
    }
    if (settings.scheduledReportFrequency === "weekly" && new Date().getUTCDay() !== 1) {
      return NextResponse.json({ ok: true, enqueued: 0, sent: { sent: 0, failed: 0 }, skipped: "weekly report runs on Monday" });
    }
  } else {
    const role = getCurrentRole();
    if (!canAccessAdmin(role)) {
      return NextResponse.json(
        { ok: false, error: "Only admins can trigger the daily digest" },
        { status: 403 }
      );
    }
  }

  const result = await trySendDailyDigest();

  let sent = { sent: 0, failed: 0 };
  if (result.ok && result.enqueued > 0) {
    sent = await processNotificationQueue();
  }

  return NextResponse.json(
    {
      ok: result.ok,
      enqueued: result.enqueued,
      sent,
      skipped: "skipped" in result ? result.skipped : null,
      error: result.error ?? null
    },
    { status: result.ok ? 200 : 500 }
  );
}
