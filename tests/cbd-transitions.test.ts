import { describe, expect, it } from "vitest";
import { assertSubmitAllowedFrom, clarificationReturnStatus, resolveSubmitNextStatus } from "../src/lib/costing/cbd";
import type { ValidationIssue } from "../src/lib/costing/validation";

// Covers doc transitions [2] and [3]: a factory submit advances the request to
// for_md_review (MD technical review precedes costing validation), or back to
// needs_clarification when the CBD has blocking (severity = error) validation
// issues.

const NON_SUBMIT_STATUSES = [
  "draft",
  "for_md_review",
  "for_costing_review",
  "for_pbd_review",
  "approved",
  "rejected"
];

describe("assertSubmitAllowedFrom", () => {
  it("allows submission from sent_to_factory and needs_clarification", () => {
    expect(assertSubmitAllowedFrom("sent_to_factory")).toBeNull();
    expect(assertSubmitAllowedFrom("needs_clarification")).toBeNull();
  });

  it("rejects every other status with the route's message", () => {
    for (const status of NON_SUBMIT_STATUSES) {
      expect(assertSubmitAllowedFrom(status)).toBe(
        `Factory cannot submit CBD from status "${status}". Allowed from: sent_to_factory, needs_clarification`
      );
    }
  });
});

describe("resolveSubmitNextStatus", () => {
  const warning: ValidationIssue = { severity: "warning", ruleCode: "w", message: "w", fieldPath: "f" };
  const error: ValidationIssue = { severity: "error", ruleCode: "e", message: "e", fieldPath: "f" };

  it("advances to for_md_review when there are no blocking issues", () => {
    expect(resolveSubmitNextStatus([])).toBe("for_md_review");
    expect(resolveSubmitNextStatus([warning])).toBe("for_md_review");
    expect(resolveSubmitNextStatus([warning, warning])).toBe("for_md_review");
  });

  it("returns to needs_clarification when any error-severity issue exists", () => {
    expect(resolveSubmitNextStatus([error])).toBe("needs_clarification");
    expect(resolveSubmitNextStatus([warning, error, warning])).toBe("needs_clarification");
  });

  it("returns a valid PBD clarification resubmission directly to PBD review", () => {
    expect(resolveSubmitNextStatus([], clarificationReturnStatus("clarify"))).toBe("for_pbd_review");
  });

  it("returns Costing and MD clarification resubmissions to their originating review", () => {
    expect(resolveSubmitNextStatus([], clarificationReturnStatus("costing_clarify"))).toBe("for_costing_review");
    expect(resolveSubmitNextStatus([], clarificationReturnStatus("md_review"))).toBe("for_md_review");
  });

  it("keeps blocking validation errors in clarification regardless of return target", () => {
    expect(resolveSubmitNextStatus([error], "for_pbd_review")).toBe("needs_clarification");
  });
});
