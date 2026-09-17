import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getWorkflowSettings } from "@/lib/admin/settings";
import nodemailer from "nodemailer";

type WorkflowEventRow = {
  id: string;
  costing_request_id: string | null;
  event_type: string;
  actor_role: string | null;
  payload: Record<string, unknown>;
  notification_status: string;
};

type RequestRow = {
  id: string;
  request_number: string | null;
  factory_name: string | null;
  status: string;
};

export type EmailTransport = "microsoft-graph" | "smtp" | "dev-console" | "none";

// Which transport, if any, can actually carry an email right now. Mirrors the
// precedence inside sendEmail() so the queue never queues work it cannot send.
// Outside production a missing transport is fine — sendEmail() logs instead.
export function emailTransport(): EmailTransport {
  if (process.env.MS_GRAPH_TENANT_ID && process.env.MS_GRAPH_CLIENT_ID && process.env.MS_GRAPH_CLIENT_SECRET) {
    return "microsoft-graph";
  }
  if (process.env.SMTP_URL) return "smtp";
  return process.env.NODE_ENV === "production" ? "none" : "dev-console";
}

export function sendableChannels(): string[] {
  const channels: string[] = [];
  if (emailTransport() !== "none") channels.push("email", "reminder", "escalation");
  if (process.env.TEAMS_WEBHOOK_URL) channels.push("teams");
  return channels;
}

export async function enqueueNotificationsForPendingEvents() {
  const supabase = createSupabaseServiceClient();
  const settings = await getWorkflowSettings();

  if (!settings.enableEmailNotifications && !settings.enableTeamsNotifications) {
    return { processed: 0, skipped: "notifications disabled" };
  }

  // Fetch pending workflow events
  const { data: events, error: eventsError } = await supabase
    .from("workflow_events")
    .select("id, costing_request_id, event_type, actor_role, payload, notification_status")
    .eq("notification_status", "pending")
    .order("created_at", { ascending: true })
    .limit(50);

  if (eventsError) throw eventsError;
  if (!events || events.length === 0) return { processed: 0 };

  const eventsTyped = events as unknown as WorkflowEventRow[];

  // Fetch request details for all events
  const requestIds = [...new Set(eventsTyped.map((e) => e.costing_request_id).filter(Boolean))] as string[];
  const { data: requests } = await supabase
    .from("costing_requests")
    .select("id, request_number, factory_name, status")
    .in("id", requestIds);

  const requestMap = new Map<string, RequestRow>();
  for (const req of (requests ?? []) as unknown as RequestRow[]) {
    requestMap.set(req.id, req);
  }

  // Fetch notification recipients
  const { data: recipients } = await supabase
    .from("notification_recipients")
    .select("event_type, role, email, is_active")
    .eq("is_active", true);

  const recipientMap = new Map<string, string[]>();
  for (const r of (recipients ?? []) as Array<{ event_type: string; role: string; email: string | null }>) {
    if (!r.email) continue;
    const list = recipientMap.get(r.event_type) ?? [];
    list.push(r.email);
    recipientMap.set(r.event_type, list);
  }

  const { data: templates } = await supabase
    .from("notification_templates")
    .select("event_type,channel,subject_template,body_template")
    .eq("is_active", true);
  const templateMap = new Map(
    ((templates ?? []) as Array<{ event_type: string; channel: string; subject_template: string; body_template: string }>).map(
      (template) => [`${template.event_type}:${template.channel}`, template]
    )
  );

  let enqueued = 0;

  for (const event of eventsTyped) {
    const request = event.costing_request_id ? requestMap.get(event.costing_request_id) : null;
    const fallbackSubject = buildSubject(event.event_type, request ?? null);
    const fallbackBody = buildBody(event.event_type, request ?? null, event.payload);
    const recipientEmails = recipientMap.get(event.event_type) ?? [];

    // Always enqueue to admin if no specific recipients configured
    const targets = recipientEmails.length ? recipientEmails : (process.env.NOTIFICATION_FALLBACK_EMAIL ? [process.env.NOTIFICATION_FALLBACK_EMAIL] : []);

    if (settings.enableEmailNotifications) {
      const template = templateMap.get(`${event.event_type}:email`);
      const subject = renderTemplate(template?.subject_template ?? fallbackSubject, request ?? null, event.payload);
      const body = renderTemplate(template?.body_template ?? fallbackBody, request ?? null, event.payload);
      for (const email of targets) {
        await supabase.from("notification_queue").insert({
          workflow_event_id: event.id,
          costing_request_id: event.costing_request_id,
          channel: "email",
          recipient: email,
          subject,
          body,
          status: "pending"
        });
        enqueued++;
      }
    }

    if (settings.enableTeamsNotifications && process.env.TEAMS_WEBHOOK_URL) {
      const template = templateMap.get(`${event.event_type}:teams`);
      const subject = renderTemplate(template?.subject_template ?? fallbackSubject, request ?? null, event.payload);
      const body = renderTemplate(template?.body_template ?? fallbackBody, request ?? null, event.payload);
      await supabase.from("notification_queue").insert({
        workflow_event_id: event.id,
        costing_request_id: event.costing_request_id,
        channel: "teams",
        recipient: process.env.TEAMS_WEBHOOK_URL,
        subject,
        body,
        status: "pending"
      });
      enqueued++;
    }

    // Mark event as queued
    await supabase
      .from("workflow_events")
      .update({ notification_status: "queued" })
      .eq("id", event.id);
  }

  return { processed: eventsTyped.length, enqueued };
}

function renderTemplate(template: string, request: RequestRow | null, payload: Record<string, unknown>) {
  const values: Record<string, string> = {
    requestNumber: request?.request_number ?? "Request",
    factoryName: request?.factory_name ?? "Unassigned",
    status: request?.status ?? "unknown",
    requestId: request?.id ?? "",
    ...Object.fromEntries(Object.entries(payload ?? {}).map(([key, value]) => [key, value == null ? "" : String(value)]))
  };
  return template.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, key: string) => values[key] ?? "");
}

export async function processNotificationQueue() {
  const supabase = createSupabaseServiceClient();

  // Selecting only sendable channels keeps two failure modes away: burning a
  // row's three attempts on a transport that does not exist (which is how the
  // permanently-failed backlog built up), and letting a blocked channel starve
  // the rows behind it — an unconfigured email transport must not stop Teams
  // notifications, or a Teams handoff must not stop email.
  const sendableChannelNames = sendableChannels();
  if (sendableChannelNames.length === 0) {
    return {
      sent: 0,
      failed: 0,
      skipped: "No notification transport configured (Microsoft Graph, SMTP or TEAMS_WEBHOOK_URL)"
    };
  }

  const { data: notifications, error } = await supabase
    .from("notification_queue")
    .select("id, channel, recipient, subject, body, attempts")
    .eq("status", "pending")
    .in("channel", sendableChannelNames)
    .order("created_at", { ascending: true })
    .limit(20);

  if (error) throw error;
  if (!notifications || notifications.length === 0) {
    return { sent: 0, failed: 0 };
  }

  let sent = 0;
  let failed = 0;

  for (const notif of notifications as Array<{
    id: string;
    channel: string;
    recipient: string;
    subject: string | null;
    body: string | null;
    attempts: number;
  }>) {
    try {
      if (notif.channel === "email" || notif.channel === "reminder" || notif.channel === "escalation") {
        await sendEmail(notif.recipient, notif.subject ?? "Costing Workflow Notification", notif.body ?? "");
      } else if (notif.channel === "teams") {
        await sendTeamsMessage(notif.recipient, notif.subject ?? "Costing Workflow Notification", notif.body ?? "");
      }

      await supabase
        .from("notification_queue")
        .update({ status: "sent", sent_at: new Date().toISOString() })
        .eq("id", notif.id);
      sent++;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Send failed";
      const newAttempts = notif.attempts + 1;
      const newStatus = newAttempts >= 3 ? "failed" : "pending";

      await supabase
        .from("notification_queue")
        .update({
          status: newStatus,
          attempts: newAttempts,
          last_error: errorMsg
        })
        .eq("id", notif.id);
      failed++;
    }
  }

  return { sent, failed };
}

export type RequeueResult = {
  requeued: number;
  transport: EmailTransport;
  channels: string[];
  skipped?: string;
};

// Resets permanently-failed queue rows so they retry. Rows only reach `failed`
// after three real send errors and never leave it, so once an email transport is
// configured this is the switch that makes the parked backlog deliverable again.
//
// Without a transport the update is deliberately refused: requeueing into a
// transport that cannot send would just walk every row back to `failed` and
// spend its attempts again. `force` overrides that for the case where the rows
// are being parked for a later drain.
export async function requeueFailedNotifications(options: { force?: boolean } = {}): Promise<RequeueResult> {
  const supabase = createSupabaseServiceClient();
  const transport = emailTransport();
  const sendableChannelNames = sendableChannels();

  if (sendableChannelNames.length === 0 && !options.force) {
    return {
      requeued: 0,
      transport,
      channels: sendableChannelNames,
      skipped: "No email transport configured yet — failed notifications stay parked until Microsoft Graph, SMTP or TEAMS_WEBHOOK_URL is set"
    };
  }

  const base = supabase
    .from("notification_queue")
    .update({ status: "pending", attempts: 0, last_error: null })
    .eq("status", "failed");

  const { data, error } = await (options.force ? base : base.in("channel", sendableChannelNames)).select("id");
  if (error) throw error;

  return { requeued: (data ?? []).length, transport, channels: sendableChannelNames };
}

export type QueueSummary = {
  transport: EmailTransport;
  channels: string[];
  pending: number;
  sent: number;
  failed: number;
  lastError: string | null;
};

// Health of the outbound queue for the admin panel: what the transport can
// carry, how much is waiting, and why the last failure happened.
export async function notificationQueueSummary(): Promise<QueueSummary> {
  const supabase = createSupabaseServiceClient();

  const countOf = async (status: string) => {
    const { count, error } = await supabase
      .from("notification_queue")
      .select("id", { count: "exact", head: true })
      .eq("status", status);
    if (error) throw error;
    return count ?? 0;
  };

  const [pending, sent, failed] = await Promise.all([countOf("pending"), countOf("sent"), countOf("failed")]);

  const { data: lastFailed } = await supabase
    .from("notification_queue")
    .select("last_error")
    .eq("status", "failed")
    .order("created_at", { ascending: false })
    .limit(1);

  return {
    transport: emailTransport(),
    channels: sendableChannels(),
    pending,
    sent,
    failed,
    lastError: (lastFailed?.[0] as { last_error: string | null } | undefined)?.last_error ?? null
  };
}

async function sendEmail(to: string, subject: string, body: string) {
  const smtpUrl = process.env.SMTP_URL;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const fromEmail = process.env.NOTIFICATION_FROM_EMAIL ?? "no-reply@madison88.com";

  // If Microsoft Graph API is configured (constraint C-001: MS365 ecosystem)
  const graphTenantId = process.env.MS_GRAPH_TENANT_ID;
  const graphClientId = process.env.MS_GRAPH_CLIENT_ID;
  const graphClientSecret = process.env.MS_GRAPH_CLIENT_SECRET;

  if (graphTenantId && graphClientId && graphClientSecret) {
    await sendViaMicrosoftGraph(to, subject, body, fromEmail, {
      tenantId: graphTenantId,
      clientId: graphClientId,
      clientSecret: graphClientSecret
    });
    return;
  }

  // Never mark a production notification as sent when no transport exists.
  if (!smtpUrl) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Email transport is not configured (Microsoft Graph or SMTP required)");
    }
    console.info(`[DEV NOTIFICATION EMAIL] To: ${to} | Subject: ${subject}`);
    return;
  }

  const transporter = nodemailer.createTransport(
    smtpUser && smtpPass
      ? { url: smtpUrl, auth: { user: smtpUser, pass: smtpPass } }
      : smtpUrl
  );
  await transporter.sendMail({ from: fromEmail, to, subject, text: body });
}

async function sendViaMicrosoftGraph(
  to: string,
  subject: string,
  body: string,
  fromEmail: string,
  creds: { tenantId: string; clientId: string; clientSecret: string }
) {
  // Acquire token
  const tokenUrl = `https://login.microsoftonline.com/${creds.tenantId}/oauth2/v2.0/token`;
  const tokenRes = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials"
    })
  });

  if (!tokenRes.ok) {
    throw new Error(`Graph token request failed: ${tokenRes.status}`);
  }

  const tokenData = await tokenRes.json();
  const accessToken = tokenData.access_token;

  // Send mail
  const mailRes = await fetch("https://graph.microsoft.com/v1.0/users/" + fromEmail + "/sendMail", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: "Text", content: body },
        toRecipients: [{ emailAddress: { address: to } }]
      },
      saveToSentItems: false
    })
  });

  if (!mailRes.ok) {
    const errText = await mailRes.text();
    throw new Error(`Graph mail send failed: ${mailRes.status} ${errText}`);
  }
}

async function sendTeamsMessage(webhookUrl: string, subject: string, body: string) {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: `**${subject}**\n\n${body}`
    })
  });

  if (!res.ok) {
    throw new Error(`Teams webhook failed: ${res.status}`);
  }
}

function buildSubject(eventType: string, request: RequestRow | null): string {
  const reqNum = request?.request_number ?? "Unknown";
  switch (eventType) {
    case "send_to_factory":
      return `[${reqNum}] New CBD request sent to factory`;
    case "approve":
      return `[${reqNum}] Costing approved`;
    case "reject":
      return `[${reqNum}] Costing rejected`;
    case "clarify":
      return `[${reqNum}] Clarification requested`;
    case "submit":
      return `[${reqNum}] Factory CBD submitted for review`;
    case "customer_status_changed":
      return `[${reqNum}] Customer status updated`;
    case "bom_changed":
      return `[${reqNum}] BOM / CBD changed by factory`;
    case "pbd_pricing_updated":
      return `[${reqNum}] PBD updated costing pricing`;
    default:
      return `[${reqNum}] Workflow event: ${eventType}`;
  }
}

function buildBody(eventType: string, request: RequestRow | null, payload: Record<string, unknown>): string {
  const lines = [
    `Request: ${request?.request_number ?? "Unknown"}`,
    `Factory: ${request?.factory_name ?? "Unassigned"}`,
    `Event: ${eventType}`,
    `Status: ${request?.status ?? "Unknown"}`
  ];

  if (payload && typeof payload === "object") {
    const fromStatus = (payload as any).fromStatus;
    const toStatus = (payload as any).toStatus;
    const comment = (payload as any).comment;
    const changedCount = (payload as any).changedCount;
    if (fromStatus && toStatus) lines.push(`Transition: ${fromStatus} → ${toStatus}`);
    if (comment) lines.push(`Comment: ${comment}`);
    if (eventType === "bom_changed" && typeof changedCount === "number") {
      lines.push(`Changed fields: ${changedCount}`);
    }
    if (eventType === "pbd_pricing_updated") {
      const pricing = (payload as any).pricing;
      if (pricing && typeof pricing === "object") {
        const currency = pricing.currency ?? "USD";
        if (typeof pricing.wholesalePrice === "number") lines.push(`Wholesale: ${currency} ${pricing.wholesalePrice.toFixed(2)}`);
        if (typeof pricing.retailPrice === "number") lines.push(`Retail: ${currency} ${pricing.retailPrice.toFixed(2)}`);
      }
    }
  }

  lines.push(`\nView request: ${process.env.NEXT_PUBLIC_APP_URL ?? ""}/requests/${request?.id ?? ""}`);

  return lines.join("\n");
}
