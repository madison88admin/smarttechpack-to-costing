import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getWorkflowSettings } from "@/lib/admin/settings";
import { recordInAppAlert } from "./in-app";

// Change alerts addressed to the role that owns the NEXT step of a request.
// These are enqueued directly into the notification_queue (the same channel the
// escalation/queue processors send), so they work without
// notification_recipients configuration rows.
//
// Business requirement: whoever has to act on revised numbers is told what
// moved and why it is their turn —
//   (a) the BOM / CBD material lines changed on a factory resubmit (the review
//       lane the correction re-enters: Costing, or MD for a technical review), and
//   (b) PBD changes anything in the costing (pricing) review -> Costing.
// A correction that returns straight to PBD does not re-open Costing's gate, so
// that lane sends no change alert — see the call site in lib/costing/cbd.ts.

export type ChangeAlertKind = "bom_changed" | "pbd_pricing_updated";

/** Roles that re-examine the numbers after a change — the alert's audience. */
export type ChangeAlertOwnerRole = "costing" | "md";

type ChangeAlertInput = {
  /** Role that owns the next step: receives the email, Teams post, and in-app alert. */
  recipientRole: ChangeAlertOwnerRole;
  requestId: string;
  requestNumber: string | null;
  factoryName: string | null;
  subject: string;
  body: string;
  kind: ChangeAlertKind;
  /** Pre-formatted "Field: old → new" lines, also stored on the in-app payload. */
  changes?: string[];
};

/**
 * Enqueues a change alert to the role that owns the next step. Never throws —
 * callers invoke this on a best-effort basis after the workflow write succeeds.
 * Returns the number of notifications enqueued.
 */
export async function enqueueChangeAlert(input: ChangeAlertInput): Promise<number> {
  try {
    const supabase = createSupabaseServiceClient();
    const settings = await getWorkflowSettings().catch(() => null);

    let enqueued = 0;
    const link = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/requests/${input.requestId}`;

    // Change alerts are core requested behavior — enqueue email to the real
    // recipients of the role that owns the next step, regardless of the master
    // notification toggle.
    const recipients = await resolveRoleRecipients(input.recipientRole);
    for (const email of recipients) {
      await supabase.from("notification_queue").insert({
        costing_request_id: input.requestId,
        channel: "email",
        recipient: email,
        subject: input.subject,
        body: `${input.body}\n\nView request: ${link}`,
        status: "pending"
      });
      enqueued++;
    }

    // Teams stays gated on the toggle + a configured webhook.
    if (settings?.enableTeamsNotifications && process.env.TEAMS_WEBHOOK_URL) {
      await supabase.from("notification_queue").insert({
        costing_request_id: input.requestId,
        channel: "teams",
        recipient: process.env.TEAMS_WEBHOOK_URL,
        subject: input.subject,
        body: input.body,
        status: "pending"
      });
      enqueued++;
    }

    // Surface as an in-app alert on the dashboard of the role that owns the
    // next step. Per-field old → new lines ride along in the payload so the
    // panel can render exactly what changed without recomputing the diff.
    await recordInAppAlert({
      requestId: input.requestId,
      alertType: input.kind,
      recipientRole: input.recipientRole,
      title: input.subject,
      body: input.body,
      payload: input.changes?.length ? { kind: input.kind, changes: input.changes } : { kind: input.kind }
    });

    return enqueued;
  } catch (error) {
    console.error("[notifications] change alert not sent:", error instanceof Error ? error.message : error);
    return 0;
  }
}

/** A single changed field formatted as "Label: old → new" for alert bodies. */
export type FieldChangeLine = {
  field: string;
  oldValue: string;
  newValue: string;
};

// What each owner of a changed CBD is being asked to do. The alert used to say
// "re-validate before approval" to everyone, which told MD to do Costing's job.
const CHANGE_ALERT_OWNER_COPY: Record<ChangeAlertOwnerRole, { label: string; subject: string; nextStep: string }> = {
  costing: {
    label: "Costing",
    subject: "Costing re-validation required",
    nextStep: "re-validate the revised costs before approval"
  },
  md: {
    label: "MD",
    subject: "MD review required",
    nextStep: "review the revised material, construction, and consumption figures"
  }
};

/** Alert sent when a factory CBD resubmission changes BOM/material lines. */
export function bomChangedAlertBody(input: {
  requestNumber: string | null;
  factoryName: string | null;
  changedCount: number;
  fobBefore: number;
  fobAfter: number;
  currency: string;
  /** Role that owns the next step — the alert is written for them. */
  ownerRole: ChangeAlertOwnerRole;
  /** Per-field old → new lines (newest submissions carry these; older callers omit). */
  changes?: FieldChangeLine[];
}): { subject: string; body: string } {
  const delta = input.fobAfter - input.fobBefore;
  const deltaPercent = input.fobBefore !== 0 ? (delta / Math.abs(input.fobBefore)) * 100 : 0;
  const direction = delta > 0 ? "+" : "";
  const shown = (input.changes ?? []).slice(0, 8);
  const hidden = (input.changes ?? []).length - shown.length;
  const owner = CHANGE_ALERT_OWNER_COPY[input.ownerRole];
  return {
    subject: `[${input.requestNumber ?? "Request"}] BOM / CBD changed by factory — ${input.changedCount} field(s) · ${owner.subject}`,
    body: [
      `Request: ${input.requestNumber ?? "Unknown"}`,
      `Factory: ${input.factoryName ?? "Unassigned"}`,
      `Changed fields: ${input.changedCount}`,
      `FOB: ${input.currency} ${input.fobBefore.toFixed(2)} → ${input.currency} ${input.fobAfter.toFixed(2)} (${direction}${deltaPercent.toFixed(1)}%)`,
      ...shown.map((change) => `• ${change.field}: ${change.oldValue} → ${change.newValue}`),
      ...(hidden > 0 ? [`• …and ${hidden} more field(s) — open the request to see all`] : []),
      ``,
      `The factory resubmitted the CBD with material/cost changes.`,
      `Next step (${owner.label}): ${owner.nextStep}.`
    ].join("\n")
  };
}

function priceOldNew(
  before: number | null | undefined,
  after: number | null,
  currency: string
): string {
  const fmt = (value: number | null | undefined) =>
    value === null || value === undefined ? "—" : `${currency} ${value.toFixed(2)}`;
  // First-time pricing has no "before" — keep the original single-value line.
  if (before === null || before === undefined) return fmt(after);
  return `${fmt(before)} → ${fmt(after)}`;
}

/** Alert sent when PBD changes pricing on a request under internal review. */
export function pbdPricingAlertBody(input: {
  requestNumber: string | null;
  factoryName: string | null;
  wholesalePrice: number | null;
  retailPrice: number | null;
  currency: string;
  changedBy: string | null;
  /** Previous prices when this is a re-price (omitted on first pricing). */
  wholesaleBefore?: number | null;
  retailBefore?: number | null;
}): { subject: string; body: string } {
  return {
    subject: `[${input.requestNumber ?? "Request"}] PBD updated costing pricing`,
    body: [
      `Request: ${input.requestNumber ?? "Unknown"}`,
      `Factory: ${input.factoryName ?? "Unassigned"}`,
      `Updated by: ${input.changedBy ?? "PBD"}`,
      `Wholesale price: ${priceOldNew(input.wholesaleBefore, input.wholesalePrice, input.currency)}`,
      `Retail price: ${priceOldNew(input.retailBefore, input.retailPrice, input.currency)}`,
      ``,
      `PBD changed the costing pricing during internal review. Please review the updated figures.`
    ].join("\n")
  };
}

/**
 * Alert sent when the BOM for a request's style changes in NextGen itself
 * (HeaderVersionNumber / BomVersionComment differ from the last known value).
 */
export function nextGenBomChangedAlertBody(input: {
  requestNumber: string | null;
  factoryName: string | null;
  styleNumber: string | null;
  versionBefore: string | null;
  versionAfter: string | null;
  commentAfter: string | null;
}): { subject: string; body: string } {
  const before = input.versionBefore ? `v${input.versionBefore}` : "—";
  const after = input.versionAfter ? `v${input.versionAfter}` : "—";
  const lines = [
    `Request: ${input.requestNumber ?? "Unknown"}`,
    `Factory: ${input.factoryName ?? "Unassigned"}`,
    `Style: ${input.styleNumber ?? "Unknown"} (NextGen)`,
    `BOM version: ${before} → ${after}`
  ];
  if (input.commentAfter) lines.push(`Version comment: ${input.commentAfter}`);
  lines.push("", "The BOM for this style was updated in NextGen. Please re-validate the costing.");

  return {
    subject: `[${input.requestNumber ?? "Request"}] NextGen BOM updated — ${before} → ${after}`,
    body: lines.join("\n")
  };
}

/**
 * Alert sent to PBD when Costing acknowledges the high-risk outlier flags on
 * a request under review — the PBD approval gate is released and the request
 * is ready to approve. Consumed via enqueueRoleChangeAlert, which prepends
 * the request number to the subject and appends the view link to the body.
 */
export function outlierAcknowledgedAlertBody(input: {
  acknowledgedBy: string | null;
  justification: string | null;
  flags: string[];
}): { subject: string; body: string } {
  const lines = [`Acknowledged by: ${input.acknowledgedBy ?? "Costing"}`];
  if (input.justification) lines.push(`Justification: ${input.justification}`);
  lines.push("", "Flagged outliers:", ...input.flags.map((flag) => `• ${flag}`));
  lines.push("", "Costing has reviewed and acknowledged the outliers — the approval gate is released.");

  return {
    subject: "Costing acknowledged outlier flags — approval gate released",
    body: lines.join("\n")
  };
}

// --- Role-scoped alerts -----------------------------------------------------
// Each workflow stage notifies the role that owns the NEXT step, so the
// relevant people always know it is their turn:
//   factory submit      -> MD (technical review)
//   BOM / CBD change    -> the lane the correction re-enters: Costing, or MD
//                          when the request is still in technical review
//   costing_complete    -> PBD (internal approval)
//   PBD pricing change  -> Costing (review updated figures)
//   outlier acknowledged-> PBD (approval gate released, ready to approve)

/**
 * Resolves active email recipients for a role from user_profiles, falling back
 * to the role-specific env var or NOTIFICATION_FALLBACK_EMAIL.
 */
export async function resolveRoleRecipients(role: string): Promise<string[]> {
  const supabase = createSupabaseServiceClient();
  const { data } = await supabase
    .from("user_profiles")
    .select("email")
    .eq("role", role)
    .eq("is_active", true);

  const emails = ((data ?? []) as Array<{ email: string | null }>)
    .map((row) => row.email)
    .filter((email): email is string => Boolean(email));

  if (emails.length) return emails;

  const roleEnvKey = `COSTING_NOTIFICATION_EMAIL`; // legacy key kept for costing
  const roleFallback =
    role === "costing"
      ? process.env.COSTING_NOTIFICATION_EMAIL
      : process.env[`${role.toUpperCase()}_NOTIFICATION_EMAIL`];
  const fallback = roleFallback ?? (role === "costing" ? roleEnvKey && process.env[roleEnvKey] : null) ?? process.env.NOTIFICATION_FALLBACK_EMAIL;
  return fallback ? [fallback] : [];
}

/**
 * Enqueues a role-scoped workflow alert (email + Teams) to the role that owns
 * the next step. Fetches request metadata for the subject/link. Never throws.
 */
export async function enqueueRoleChangeAlert(input: {
  role: string;
  requestId: string;
  title: string;
  bodyLines: string[];
  /** In-app alert type; defaults to "role_change". */
  alertType?: string;
}): Promise<number> {
  try {
    const supabase = createSupabaseServiceClient();
    const settings = await getWorkflowSettings().catch(() => null);

    const { data: request } = await supabase
      .from("costing_requests")
      .select("request_number,factory_name")
      .eq("id", input.requestId)
      .maybeSingle();

    const requestNumber = request?.request_number ?? "Request";
    const subject = `[${requestNumber}] ${input.title}`;
    const link = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/requests/${input.requestId}`;
    const body = [...input.bodyLines, "", `View request: ${link}`].join("\n");

    let enqueued = 0;

    // Role-scoped alerts are core requested behavior — enqueue email to the
    // real recipients for the role regardless of the master toggle.
    const recipients = await resolveRoleRecipients(input.role);
    for (const email of recipients) {
      await supabase.from("notification_queue").insert({
        costing_request_id: input.requestId,
        channel: "email",
        recipient: email,
        subject,
        body,
        status: "pending"
      });
      enqueued++;
    }

    // Teams stays gated on the toggle + a configured webhook.
    if (settings?.enableTeamsNotifications && process.env.TEAMS_WEBHOOK_URL) {
      await supabase.from("notification_queue").insert({
        costing_request_id: input.requestId,
        channel: "teams",
        recipient: process.env.TEAMS_WEBHOOK_URL,
        subject,
        body,
        status: "pending"
      });
      enqueued++;
    }

    // Surface as an in-app alert on the dashboard for the role that owns the
    // next step.
    await recordInAppAlert({
      requestId: input.requestId,
      alertType: input.alertType ?? "role_change",
      recipientRole: input.role,
      title: subject,
      body,
      payload: { role: input.role }
    });

    return enqueued;
  } catch (error) {
    console.error("[notifications] role change alert not sent:", error instanceof Error ? error.message : error);
    return 0;
  }
}
