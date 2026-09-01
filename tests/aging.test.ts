import { describe, expect, it } from "vitest";
import { businessDaysSince } from "../src/lib/costing/aging";

describe("business-day SLA aging", () => {
  it("excludes Saturday and Sunday", () => {
    expect(businessDaysSince("2026-08-07T08:00:00Z", new Date("2026-08-10T08:00:00Z"))).toBe(1);
  });

  it("counts weekdays across a full work week", () => {
    expect(businessDaysSince("2026-08-03T08:00:00Z", new Date("2026-08-10T08:00:00Z"))).toBe(5);
  });
});

import { ownerRoleForStatus } from "../src/lib/costing/aging";

describe("SLA owner role mapping", () => {
  it("maps each status to the accountable role", () => {
    expect(ownerRoleForStatus("draft")).toBe("pbd");
    expect(ownerRoleForStatus("sent_to_factory")).toBe("factory");
    expect(ownerRoleForStatus("needs_clarification")).toBe("factory");
    expect(ownerRoleForStatus("for_md_review")).toBe("md");
    expect(ownerRoleForStatus("for_costing_review")).toBe("costing");
    expect(ownerRoleForStatus("for_pbd_review")).toBe("pbd");
    expect(ownerRoleForStatus("pending_manager_approval")).toBe("pbd");
  });

  it("returns null for terminal or unknown statuses", () => {
    expect(ownerRoleForStatus("approved")).toBeNull();
    expect(ownerRoleForStatus("rejected")).toBeNull();
    expect(ownerRoleForStatus("whatever")).toBeNull();
  });
});

import { getSlaDays, calendarDaysSince } from "../src/lib/workflow/sla";
import { defaultWorkflowSettings } from "../src/lib/admin/settings";

const settings = {
  ...defaultWorkflowSettings,
  draftSlaHours: 48,
  factorySubmissionSlaHours: 36,
  mdReviewSlaHours: 24,
  costingReviewSlaHours: 24,
  pbdApprovalSlaHours: 24,
  factorySubmissionSlaDays: 1.5,
  approvalSlaDays: 1
};

describe("shared SLA thresholds (hours-based)", () => {
  it("converts hours to days per status", () => {
    expect(getSlaDays("sent_to_factory", settings)).toBe(1.5); // 36h
    expect(getSlaDays("needs_clarification", settings)).toBe(1.5);
    expect(getSlaDays("for_md_review", settings)).toBe(1); // 24h
    expect(getSlaDays("for_costing_review", settings)).toBe(1);
    expect(getSlaDays("for_pbd_review", settings)).toBe(1);
    expect(getSlaDays("pending_manager_approval", settings)).toBe(1);
  });

  it("returns no SLA for terminal statuses", () => {
    expect(getSlaDays("approved", settings)).toBeNull();
    expect(getSlaDays("rejected", settings)).toBeNull();
  });

  it("gives drafts a 48h SLA so unsent requests escalate too", () => {
    expect(getSlaDays("draft", settings)).toBe(2); // 48h
  });

  it("counts calendar days (weekends included)", () => {
    // Friday 08:00 → Monday 08:00 is 3 calendar days.
    expect(calendarDaysSince("2026-08-07T08:00:00Z", new Date("2026-08-10T08:00:00Z"))).toBe(3);
    expect(calendarDaysSince("2026-08-10T08:00:00Z", new Date("2026-08-10T08:00:00Z"))).toBe(0);
  });
});
