import { describe, expect, it } from "vitest";
import { formatSlaDuration, getSlaDays, getSlaHours, hoursSince, slaKeyFor } from "../src/lib/workflow/sla";
import { defaultWorkflowSettings, type WorkflowSettings } from "../src/lib/admin/settings";

// SLA engine: each status reads its OWN SLA (draft / factory / MD / costing /
// PBD), drafts get a 48h SLA so unsent requests escalate, and reminders are
// percentage-based instead of firing on day 0.

const settings: WorkflowSettings = {
  ...defaultWorkflowSettings,
  draftSlaHours: 48,
  factorySubmissionSlaHours: 36,
  mdReviewSlaHours: 24,
  costingReviewSlaHours: 24,
  pbdApprovalSlaHours: 24
};

describe("slaKeyFor", () => {
  it("maps every tracked status to its own SLA key", () => {
    expect(slaKeyFor("draft")).toBe("draft");
    expect(slaKeyFor("sent_to_factory")).toBe("factorySubmission");
    expect(slaKeyFor("needs_clarification")).toBe("factorySubmission");
    expect(slaKeyFor("for_md_review")).toBe("mdReview");
    expect(slaKeyFor("for_costing_review")).toBe("costingReview");
    expect(slaKeyFor("for_pbd_review")).toBe("pbdApproval");
    expect(slaKeyFor("pending_manager_approval")).toBe("");
    expect(slaKeyFor("approved")).toBe("");
  });
});

describe("getSlaHours / getSlaDays", () => {
  it("gives drafts a 48h SLA so unsent requests escalate too", () => {
    expect(getSlaHours("draft", settings)).toBe(48);
    expect(getSlaDays("draft", settings)).toBe(2);
  });

  it("uses a dedicated MD review SLA, separate from costing", () => {
    const custom = { ...settings, mdReviewSlaHours: 18, costingReviewSlaHours: 30 } as WorkflowSettings;
    expect(getSlaHours("for_md_review", custom)).toBe(18);
    expect(getSlaHours("for_costing_review", custom)).toBe(30);
    // Proves they are NOT the same setting key.
    expect(getSlaDays("for_md_review", custom)).not.toBe(getSlaDays("for_costing_review", custom));
  });

  it("keeps the per-step factory and PBD SLAs", () => {
    expect(getSlaHours("sent_to_factory", settings)).toBe(36);
    expect(getSlaHours("needs_clarification", settings)).toBe(36);
    expect(getSlaHours("for_pbd_review", settings)).toBe(24);
  });

  it("falls back to the day-based approval SLA for pending_manager_approval", () => {
    expect(getSlaHours("pending_manager_approval", settings)).toBeNull();
    expect(getSlaDays("pending_manager_approval", settings)).toBe(settings.approvalSlaDays);
  });

  it("returns null for statuses without an SLA (approved/rejected)", () => {
    expect(getSlaHours("approved", settings)).toBeNull();
    expect(getSlaDays("approved", settings)).toBeNull();
  });

  it("falls back to the legacy day keys when the hours setting is unset", () => {
    const legacy = { ...settings, factorySubmissionSlaHours: 0 } as WorkflowSettings;
    expect(getSlaHours("sent_to_factory", legacy)).toBeNull();
    expect(getSlaDays("sent_to_factory", legacy)).toBe(legacy.factorySubmissionSlaDays);
  });
});

describe("hoursSince / formatSlaDuration", () => {
  it("computes fractional hours", () => {
    const past = new Date(Date.now() - 90 * 60_000); // 1.5h ago
    expect(hoursSince(past.toISOString())).toBeCloseTo(1.5, 1);
  });

  it("never returns negative for future timestamps", () => {
    expect(hoursSince(new Date(Date.now() + 60_000).toISOString())).toBe(0);
  });

  it("formats hours under 48h and days above", () => {
    expect(formatSlaDuration(19.2)).toBe("19h");
    expect(formatSlaDuration(36)).toBe("36h");
    expect(formatSlaDuration(48)).toBe("2.0d");
    expect(formatSlaDuration(120)).toBe("5.0d");
  });
});
