import { describe, expect, it } from "vitest";
import {
  assertMdReviewDecision,
  assertMdReviewFromStatus,
  mdReviewComment,
  mdReviewTargetStatus
} from "../src/lib/costing/md-review";
import { canRunMdAction } from "../src/lib/auth/roles";
import type { CostingStatus } from "../src/lib/workflow/status";

// Covers doc transitions [4] and [5] — MD technical review runs right after
// the factory CBD submission, BEFORE costing validation:
//   for_md_review -> for_costing_review   (md_review decision = pass)
//   for_md_review -> needs_clarification  (md_review decision = needs_clarification)

const ALL_STATUSES: CostingStatus[] = [
  "draft",
  "sent_to_factory",
  "needs_clarification",
  "for_md_review",
  "for_costing_review",
  "for_pbd_review",
  "pending_manager_approval",
  "approved",
  "rejected"
];

describe("assertMdReviewDecision", () => {
  it("accepts pass with or without notes", () => {
    expect(assertMdReviewDecision("pass", "")).toBeNull();
    expect(assertMdReviewDecision("pass", "Machine check OK")).toBeNull();
  });

  it("accepts needs_clarification only with notes", () => {
    expect(assertMdReviewDecision("needs_clarification", "Yarn count mismatches sample")).toBeNull();
    expect(assertMdReviewDecision("needs_clarification", "")).toBe(
      "Notes are required when MD requests clarification"
    );
  });

  it("rejects anything that is not exactly pass or needs_clarification", () => {
    expect(assertMdReviewDecision(null, "")).toBe("decision must be pass or needs_clarification");
    expect(assertMdReviewDecision(undefined, "notes")).toBe("decision must be pass or needs_clarification");
    expect(assertMdReviewDecision("", "")).toBe("decision must be pass or needs_clarification");
    expect(assertMdReviewDecision("PASS", "")).toBe("decision must be pass or needs_clarification"); // case-sensitive
    expect(assertMdReviewDecision("pass ", "")).toBe("decision must be pass or needs_clarification"); // no trimming
    expect(assertMdReviewDecision("reject", "")).toBe("decision must be pass or needs_clarification");
  });
});

describe("mdReviewTargetStatus", () => {
  it("advances a passing review to for_costing_review (MD before Costing)", () => {
    expect(mdReviewTargetStatus("pass")).toBe("for_costing_review");
  });

  it("sends a clarification back to needs_clarification", () => {
    expect(mdReviewTargetStatus("needs_clarification")).toBe("needs_clarification");
  });
});

describe("assertMdReviewFromStatus", () => {
  it("allows for_md_review", () => {
    expect(assertMdReviewFromStatus("for_md_review")).toBeNull();
  });

  it("rejects every other status with the route's message", () => {
    for (const status of ALL_STATUSES) {
      if (status === "for_md_review") continue;
      expect(assertMdReviewFromStatus(status)).toBe(
        `MD review is only available after factory CBD submission (current status: ${status})`
      );
    }
  });
});

describe("mdReviewComment", () => {
  it("defaults to 'MD review passed' when no notes are given", () => {
    expect(mdReviewComment("pass", "")).toBe("MD review passed");
  });

  it("uses the provided notes otherwise", () => {
    expect(mdReviewComment("pass", "Machine check OK")).toBe("Machine check OK");
    expect(mdReviewComment("needs_clarification", "Yarn count mismatches")).toBe("Yarn count mismatches");
  });
});

describe("MD role gate (canRunMdAction)", () => {
  it("allows MD, Admin, and Super Admin", () => {
    for (const role of ["md", "admin", "superadmin"] as const) {
      expect(canRunMdAction(role), `role: ${role}`).toBe(true);
    }
  });

  it("denies every other role", () => {
    for (const role of ["pbd", "costing", "manager", "factory", "viewer"] as const) {
      expect(canRunMdAction(role), `role: ${role}`).toBe(false);
    }
  });
});
