import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { resolveRoleRecipients } from "./workflow-alerts";

// Admin alerts for system-level events that are not tied to a single request
// (e.g. the nightly NextGen backfill populating knitting-time / SMV values).
// Delivered as email via the notification_queue — costing_request_id is left
// null since these events span the whole historical library, not one request.
// Best-effort by design: a notification failure must never fail the job.

export type BackfillAlertInput = {
  updated: number;
  scanned: number;
  perStatus?: Array<{ status: string; total: number }>;
};

/** Subject/body for the "backfill populated new values" admin alert. */
export function backfillCompletedAlertBody(input: BackfillAlertInput): { subject: string; body: string } {
  const statusLines =
    input.perStatus && input.perStatus.length > 0
      ? ["", "Scanned per status:", ...input.perStatus.map((s) => `  • ${s.status}: ${s.total}`)]
      : [];
  return {
    subject: `NextGen backfill populated ${input.updated} new knitting-time / SMV value(s)`,
    body: [
      `The nightly NextGen backfill found ${input.updated} historical row(s) that now carry a knitting-time / SMV value and updated them.`,
      `Rows scanned: ${input.scanned}`,
      ...statusLines,
      "",
      "The Like Styles search, Smart Review benchmarks, and Reports comparisons can now use these values."
    ].join("\n")
  };
}

/**
 * Enqueues an email alert to the active admin/superadmin recipients (falling
 * back to ADMIN_NOTIFICATION_EMAIL / NOTIFICATION_FALLBACK_EMAIL). Never
 * throws — returns the number of notifications enqueued.
 */
export async function enqueueAdminAlert(input: {
  subject: string;
  body: string;
}): Promise<number> {
  try {
    const supabase = createSupabaseServiceClient();
    const recipients = await resolveRoleRecipients("admin");

    let enqueued = 0;
    for (const email of recipients) {
      await supabase.from("notification_queue").insert({
        channel: "email",
        recipient: email,
        subject: input.subject,
        body: input.body,
        status: "pending"
      });
      enqueued++;
    }
    return enqueued;
  } catch (error) {
    console.error("[notifications] admin alert not enqueued:", error instanceof Error ? error.message : error);
    return 0;
  }
}

/** Convenience wrapper: builds the backfill alert and enqueues it. */
export async function notifyBackfillCompleted(input: BackfillAlertInput): Promise<number> {
  if (input.updated <= 0) return 0;
  const { subject, body } = backfillCompletedAlertBody(input);
  return enqueueAdminAlert({ subject, body });
}

/**
 * Records a real (non-dry-run) backfill run in the audit trail
 * (workflow_events) so admins can see when and how many values were
 * populated. Library-wide — no costing_request_id. notification_status is
 * "queued" (not "pending") so the notification processor never picks it up
 * and tries to email it as a workflow change. Never throws.
 */
export async function recordBackfillAuditEvent(input: {
  actorRole: string | null;
  scanned: number;
  candidates: number;
  matched: number;
  updated: number;
  skipped: number;
  perStatus?: Array<{ status: string; total: number }>;
  enrichBom: boolean;
  errors?: string[];
}): Promise<boolean> {
  try {
    const supabase = createSupabaseServiceClient();
    const { error } = await supabase.from("workflow_events").insert({
      costing_request_id: null,
      event_type: "nextgen_backfill",
      actor_role: input.actorRole ?? "system",
      payload: {
        scanned: input.scanned,
        candidates: input.candidates,
        matched: input.matched,
        updated: input.updated,
        skipped: input.skipped,
        perStatus: input.perStatus ?? [],
        enrichBom: input.enrichBom,
        errors: input.errors ?? []
      },
      notification_status: "queued"
    });
    return !error;
  } catch (error) {
    console.error("[notifications] backfill audit event not recorded:", error instanceof Error ? error.message : error);
    return false;
  }
}
