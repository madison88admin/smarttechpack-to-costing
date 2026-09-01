import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const defaultWorkflowSettings = {
  warningVariancePercent: 15,
  reviewVariancePercent: 8,
  // SLA in hours per the costing process flow:
  // - Draft (PBD): 48 hrs to send the request to the factory
  // - Factory (FTY): 36 hrs to submit CBD after sample dispatch
  // - MD: 24 hrs for the technical check
  // - Costing Team: 24 hrs to validate and enter costs in NG after FTY CBD receipt
  // - PBD: 24 hrs to add selling price in NG after receiving NG costing notification
  draftSlaHours: 48,
  factorySubmissionSlaHours: 36,
  mdReviewSlaHours: 24,
  costingReviewSlaHours: 24,
  pbdApprovalSlaHours: 24,
  // SLA reminder fires at this % of the SLA (80% by default), not on day 0.
  reminderPercent: 80,
  // Legacy day-based SLAs (kept for backward compatibility)
  approvalSlaDays: 1,
  factorySubmissionSlaDays: 1.5,
  enableEmailNotifications: false,
  enableTeamsNotifications: false,
  managerApprovalThreshold: 0,
  // Minimum gross margin (USD/unit, wholesale price − landed cost). Falls below
  // this are FLAGGED as a soft warning for the manual Costing ↔ PBD discussion
  // — they never block approval.
  marginThresholdUsd: 1,
  reminderDays: 1,
  escalationDays: 2,
  enableScheduledReports: false,
  scheduledReportFrequency: "daily" as "daily" | "weekly",
  scheduledReportHourUtc: 7,
  scheduledReportRecipients: ""
};

export type WorkflowSettings = typeof defaultWorkflowSettings;

export async function getWorkflowSettings() {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase.from("workflow_settings").select("value").eq("key", "main").maybeSingle();

  if (error) throw error;

  const stored = data?.value && typeof data.value === "object" ? data.value as Record<string, unknown> : {};
  return {
    ...defaultWorkflowSettings,
    ...stored
  } as WorkflowSettings;
}

export async function saveWorkflowSettings(input: Partial<Record<keyof WorkflowSettings, unknown>>) {
  const settings = {
    warningVariancePercent: toNumber(input.warningVariancePercent, defaultWorkflowSettings.warningVariancePercent),
    reviewVariancePercent: toNumber(input.reviewVariancePercent, defaultWorkflowSettings.reviewVariancePercent),
    approvalSlaDays: toNumber(input.approvalSlaDays, defaultWorkflowSettings.approvalSlaDays),
    factorySubmissionSlaDays: toNumber(input.factorySubmissionSlaDays, defaultWorkflowSettings.factorySubmissionSlaDays),
    draftSlaHours: toNumber(input.draftSlaHours, defaultWorkflowSettings.draftSlaHours),
    factorySubmissionSlaHours: toNumber(input.factorySubmissionSlaHours, defaultWorkflowSettings.factorySubmissionSlaHours),
    mdReviewSlaHours: toNumber(input.mdReviewSlaHours, defaultWorkflowSettings.mdReviewSlaHours),
    costingReviewSlaHours: toNumber(input.costingReviewSlaHours, defaultWorkflowSettings.costingReviewSlaHours),
    pbdApprovalSlaHours: toNumber(input.pbdApprovalSlaHours, defaultWorkflowSettings.pbdApprovalSlaHours),
    reminderPercent: Math.min(100, Math.max(1, Math.round(toNumber(input.reminderPercent, defaultWorkflowSettings.reminderPercent)))),
    enableEmailNotifications: input.enableEmailNotifications === true || input.enableEmailNotifications === "true",
    enableTeamsNotifications: input.enableTeamsNotifications === true || input.enableTeamsNotifications === "true",
    managerApprovalThreshold: 0,
    marginThresholdUsd: toNumber(input.marginThresholdUsd, defaultWorkflowSettings.marginThresholdUsd),
    reminderDays: toNumber(input.reminderDays, defaultWorkflowSettings.reminderDays),
    escalationDays: toNumber(input.escalationDays, defaultWorkflowSettings.escalationDays),
    enableScheduledReports: input.enableScheduledReports === true || input.enableScheduledReports === "true",
    scheduledReportFrequency: input.scheduledReportFrequency === "weekly" ? "weekly" : "daily",
    scheduledReportHourUtc: Math.min(23, Math.max(0, Math.round(toNumber(input.scheduledReportHourUtc, defaultWorkflowSettings.scheduledReportHourUtc)))),
    scheduledReportRecipients: String(input.scheduledReportRecipients ?? defaultWorkflowSettings.scheduledReportRecipients).trim()
  };
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase.from("workflow_settings").upsert({
    key: "main",
    value: settings,
    updated_at: new Date().toISOString()
  });

  if (error) throw error;

  return settings;
}

function toNumber(value: unknown, fallback: number) {
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").replace(/,/g, ""));

  return Number.isFinite(parsed) ? parsed : fallback;
}
