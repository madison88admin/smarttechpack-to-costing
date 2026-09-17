import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getWorkflowSettings } from "@/lib/admin/settings";
import { calendarDaysSince, formatSlaDuration, getSlaDays, getSlaHours, hoursSince } from "@/lib/workflow/sla";
import { enqueueNotificationsForPendingEvents } from "@/lib/notifications/queue";
import { activeStatuses, internalReviewStatuses } from "@/lib/workflow/status";

type RequestRow = {
  id: string;
  request_number: string | null;
  status: string;
  factory_name: string | null;
  updated_at: string;
  created_at: string;
};

type EscalationResult = {
  remindersSent: number;
  escalationsSent: number;
  escalatedRequestIds: string[];
  remindedRequestIds: string[];
};

// Default reminder/escalation thresholds (days since last status change)
// SLA is hours-based: FTY=36h, Costing=24h, PBD=24h
// Reminder at 80% of SLA, escalation at 100% of SLA
const DEFAULT_REMINDER_DAYS = 1;
const DEFAULT_ESCALATION_DAYS = 2;

export async function processEscalations(): Promise<EscalationResult> {
  const supabase = createSupabaseServiceClient();
  const settings = await getWorkflowSettings();

  const reminderDays = (settings as any).reminderDays ?? DEFAULT_REMINDER_DAYS;
  const escalationDays = (settings as any).escalationDays ?? DEFAULT_ESCALATION_DAYS;

  const { data: requests, error } = await supabase
    .from("costing_requests")
    .select("id, request_number, status, factory_name, updated_at, created_at")
    .in("status", activeStatuses)
    .order("updated_at", { ascending: true })
    .limit(200);

  if (error) throw error;
  if (!requests || requests.length === 0) {
    return { remindersSent: 0, escalationsSent: 0, escalatedRequestIds: [], remindedRequestIds: [] };
  }

  const typedRequests = requests as unknown as RequestRow[];

  const remindedIds: string[] = [];
  const escalatedIds: string[] = [];

  for (const request of typedRequests) {
    const hoursInStatus = hoursSince(request.updated_at);
    // Hours-based SLA takes precedence; statuses without one fall back to the
    // day-based SLA.
    const slaHours =
      getSlaHours(request.status, settings) ??
      (getSlaDays(request.status, settings) ?? 0) * 24;

    if (slaHours <= 0) continue;

    // Check if we already sent a reminder/escalation recently for this request
    const { data: existingNotifs } = await supabase
      .from("notification_queue")
      .select("id, subject, created_at")
      .eq("costing_request_id", request.id)
      .order("created_at", { ascending: false })
      .limit(5);

    const recentNotifs = (existingNotifs ?? []) as Array<{ subject: string; created_at: string }>;
    const hasRecentReminder = recentNotifs.some(
      (n) => n.subject.includes("Reminder") && calendarDaysSince(n.created_at) < 1
    );
    const hasRecentEscalation = recentNotifs.some(
      (n) => n.subject.includes("ESCALATION") && calendarDaysSince(n.created_at) < 2
    );

    // Reminder fires at reminderPercent% of the SLA (80% by default) — never
    // on day 0 for hour-scale SLAs — and again while still inside the
    // escalation grace window.
    const reminderThresholdHours = (slaHours * ((settings as any).reminderPercent ?? 80)) / 100;
    if (hoursInStatus >= reminderThresholdHours && hoursInStatus < slaHours + escalationDays * 24) {
      if (!hasRecentReminder) {
        await enqueueEscalationNotification(supabase, request, "reminder", hoursInStatus, slaHours);
        remindedIds.push(request.id);
      }
    }

    // Escalation once the SLA plus the post-SLA grace window has elapsed.
    if (hoursInStatus >= slaHours + escalationDays * 24) {
      if (!hasRecentEscalation) {
        await enqueueEscalationNotification(supabase, request, "escalation", hoursInStatus, slaHours);
        escalatedIds.push(request.id);
      }
    }
  }

  // Also enqueue any pending workflow events
  await enqueueNotificationsForPendingEvents().catch(() => {
    // Non-fatal — escalation notifications are already enqueued
  });

  return {
    remindersSent: remindedIds.length,
    escalationsSent: escalatedIds.length,
    escalatedRequestIds: escalatedIds,
    remindedRequestIds: remindedIds
  };
}

async function enqueueEscalationNotification(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  request: RequestRow,
  type: "reminder" | "escalation",
  hoursInStatus: number,
  slaHours: number
) {
  const isEscalation = type === "escalation";
  const overdueHours = Math.max(0, hoursInStatus - slaHours);
  const subject = isEscalation
    ? `[ESCALATION] ${request.request_number} — ${formatSlaDuration(overdueHours)} overdue in ${request.status}`
    : `[Reminder] ${request.request_number} — SLA approaching (${formatSlaDuration(hoursInStatus)} / ${formatSlaDuration(slaHours)})`;

  const body = [
    `Request: ${request.request_number}`,
    `Factory: ${request.factory_name ?? "Unassigned"}`,
    `Status: ${request.status}`,
    `Hours in current status: ${Math.round(hoursInStatus * 10) / 10}h`,
    `SLA threshold: ${formatSlaDuration(slaHours)}`,
    ``,
    isEscalation
      ? `This request has exceeded the SLA by ${formatSlaDuration(overdueHours)}. Manager action required.`
      : `This request is approaching its SLA threshold. Please review and take action.`,
    ``,
    `View request: ${process.env.NEXT_PUBLIC_APP_URL ?? ""}/requests/${request.id}`
  ].join("\n");

  // Determine recipients — SLA reminders and breaches go to EVERYONE (all
  // active users + the configured escalation/fallback email) so no one misses
  // a stale request. Deduplicated by email.
  const escalationEmail = process.env.ESCALATION_EMAIL ?? process.env.NOTIFICATION_FALLBACK_EMAIL;
  const teamsWebhook = process.env.TEAMS_WEBHOOK_URL;

  const channel = isEscalation ? "escalation" : "reminder";

  // Internal review stages (MD, Costing, and PBD) are invisible to factory
  // users in the UI — the same rule must hold in email. Factory users are
  // excluded from reminders/escalations about internal statuses, so the
  // internal stage name can never leak to them.
  const isInternalStatus = internalReviewStatuses.includes(
    request.status as (typeof internalReviewStatuses)[number]
  );

  const recipients = new Set<string>();
  if (escalationEmail) recipients.add(escalationEmail);

  const { data: allUsers } = await supabase
    .from("user_profiles")
    .select("email, role")
    .eq("is_active", true)
    .not("email", "is", null);

  for (const user of (allUsers ?? []) as Array<{ email: string | null; role: string | null }>) {
    const email = user.email?.trim().toLowerCase();
    if (!email) continue;
    if (isInternalStatus && user.role === "factory") continue;
    recipients.add(email);
  }

  for (const email of recipients) {
    await supabase.from("notification_queue").insert({
      costing_request_id: request.id,
      channel,
      recipient: email,
      subject,
      body,
      status: "pending"
    });
  }

  if (teamsWebhook && isEscalation) {
    await supabase.from("notification_queue").insert({
      costing_request_id: request.id,
      channel: "teams",
      recipient: teamsWebhook,
      subject,
      body,
      status: "pending"
    });
  }

  // Log the escalation as a workflow event
  await supabase.from("workflow_events").insert({
    costing_request_id: request.id,
    event_type: isEscalation ? "escalation" : "reminder",
    actor_role: "system",
    payload: { hoursInStatus, slaHours, channel },
    notification_status: "queued"
  });
}



export async function tryProcessEscalations() {
  try {
    const result = await processEscalations();
    return { ...result, error: null };
  } catch (error) {
    return {
      remindersSent: 0,
      escalationsSent: 0,
      escalatedRequestIds: [] as string[],
      remindedRequestIds: [] as string[],
      error: error instanceof Error ? error.message : "Escalation processing failed"
    };
  }
}

// Get escalation status for display on dashboard/request detail
export async function getEscalationStatus(requestId: string): Promise<{
  isEscalated: boolean;
  isReminded: boolean;
  lastEscalationAt: string | null;
  lastReminderAt: string | null;
}> {
  const supabase = createSupabaseServiceClient();

  const { data } = await supabase
    .from("workflow_events")
    .select("event_type, created_at")
    .eq("costing_request_id", requestId)
    .in("event_type", ["escalation", "reminder"])
    .order("created_at", { ascending: false })
    .limit(10);

  const events = (data ?? []) as Array<{ event_type: string; created_at: string }>;
  const lastEscalation = events.find((e) => e.event_type === "escalation");
  const lastReminder = events.find((e) => e.event_type === "reminder");

  return {
    isEscalated: !!lastEscalation,
    isReminded: !!lastReminder,
    lastEscalationAt: lastEscalation?.created_at ?? null,
    lastReminderAt: lastReminder?.created_at ?? null
  };
}
