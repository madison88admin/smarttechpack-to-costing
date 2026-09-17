import type { WorkflowSettings } from "@/lib/admin/settings";

/**
 * Single source of truth for SLA thresholds across the workflow.
 *
 * SLAs are defined in HOURS per the costing process flow:
 *   - Draft (PBD): 48 hrs to send the request to the factory
 *   - Factory (FTY): 36 hrs to submit CBD after sample dispatch
 *   - MD: 24 hrs for the technical check
 *   - Costing: 24 hrs to validate after FTY CBD receipt
 *   - PBD: 24 hrs to add selling price after costing validation
 */

/** Maps a status to its SLA setting suffix ("factorySubmission" → factorySubmissionSlaHours). */
export function slaKeyFor(status: string): string {
  switch (status) {
    case "draft":
      return "draft";
    case "sent_to_factory":
    case "needs_clarification":
      return "factorySubmission";
    case "for_md_review":
      return "mdReview";
    case "for_costing_review":
      return "costingReview";
    case "for_pbd_review":
      return "pbdApproval";
    default:
      return "";
  }
}

/** The SLA in hours for a status, or null when the status has no SLA. */
export function getSlaHours(status: string, settings: WorkflowSettings): number | null {
  const key = slaKeyFor(status);
  if (!key) return null;
  const hours = (settings as unknown as Record<string, number>)[`${key}SlaHours`] ?? 0;
  return hours > 0 ? hours : null;
}

/**
 * Returns the SLA in DAYS (decimal) or null when the status has no SLA.
 * Hours-based settings take precedence; the day-based keys are legacy
 * fallbacks for statuses without a dedicated hours setting.
 */
export function getSlaDays(status: string, settings: WorkflowSettings): number | null {
  const hours = getSlaHours(status, settings);
  if (hours !== null) return hours / 24;

  switch (status) {
    case "sent_to_factory":
    case "needs_clarification":
      return settings.factorySubmissionSlaDays;
    default:
      return null;
  }
}

/** Fractional hours between an ISO timestamp and now (never negative). */
export function hoursSince(iso: string, now = new Date()): number {
  try {
    const ms = now.getTime() - new Date(iso).getTime();
    return Math.max(0, ms / 3_600_000);
  } catch {
    return 0;
  }
}

/** Calendar days (including weekends) between two ISO timestamps. */
export function calendarDaysSince(iso: string, now = new Date()): number {
  try {
    const ms = now.getTime() - new Date(iso).getTime();
    return Math.max(0, Math.floor(ms / 86_400_000));
  } catch {
    return 0;
  }
}

/** Human-friendly SLA duration: hours under 48h, days (1 decimal) above. */
export function formatSlaDuration(hours: number): string {
  if (hours < 48) return `${Math.max(1, Math.round(hours))}h`;
  return `${(hours / 24).toFixed(1)}d`;
}
