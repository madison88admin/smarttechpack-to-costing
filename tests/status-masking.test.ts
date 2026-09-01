import { describe, expect, it } from "vitest";
import {
  factoryHiddenStatuses,
  internalReviewStatuses,
  maskStatusForRole,
  statusLabels,
  type CostingStatus
} from "../src/lib/workflow/status";
import { getStatusesForRoles } from "../src/lib/costing/requests";

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

describe("internalReviewStatuses", () => {
  it("covers every MD/Costing/PBD/Manager internal stage", () => {
    expect(internalReviewStatuses).toEqual([
      "for_md_review",
      "for_costing_review",
      "for_pbd_review",
      "pending_manager_approval"
    ]);
  });

  it("excludes factory-actionable and terminal statuses", () => {
    for (const status of ["draft", "sent_to_factory", "needs_clarification", "approved", "rejected"]) {
      expect(internalReviewStatuses).not.toContain(status);
    }
  });
});

describe("maskStatusForRole — factory visibility", () => {
  it("masks every internal review status to under_review for factory", () => {
    for (const status of internalReviewStatuses) {
      expect(maskStatusForRole(status, "factory")).toBe("under_review");
    }
  });

  it("keeps factory-actionable and terminal statuses unchanged for factory", () => {
    for (const status of ["draft", "sent_to_factory", "needs_clarification", "approved", "rejected"]) {
      expect(maskStatusForRole(status, "factory")).toBe(status);
    }
  });

  it("shows the real status to every other role", () => {
    for (const role of ["admin", "superadmin", "manager", "pbd", "costing", "md", "viewer"]) {
      for (const status of ALL_STATUSES) {
        expect(maskStatusForRole(status, role), `role: ${role}, status: ${status}`).toBe(status);
      }
    }
  });

  it("renders under_review with a blue tone and a label", () => {
    expect(statusLabels.under_review).toBe("Under Review");
    expect(maskStatusForRole("for_pbd_review", "factory")).toBe("under_review");
  });
});

describe("factory request-list visibility (getStatusesForRoles)", () => {
  it("hides every Madison88 internal review status from the factory list", () => {
    const factoryStatuses = getStatusesForRoles(["factory"]);
    for (const status of internalReviewStatuses) {
      expect(factoryStatuses, `status: ${status}`).not.toContain(status);
    }
  });

  it("hides internally-approved requests from the factory list", () => {
    const factoryStatuses = getStatusesForRoles(["factory"]);
    expect(factoryStatuses).not.toContain("approved");
  });

  it("keeps only factory-actionable statuses plus the rejected outcome", () => {
    const factoryStatuses = getStatusesForRoles(["factory"]);
    expect(factoryStatuses).toEqual(expect.arrayContaining(["draft", "sent_to_factory", "needs_clarification"]));
    expect(factoryStatuses).toContain("rejected");
    expect(factoryStatuses).toEqual(expect.arrayContaining(["draft", "sent_to_factory", "needs_clarification", "rejected"]));
  });

  it("factoryHiddenStatuses covers the internal stages plus internally approved", () => {
    expect(factoryHiddenStatuses).toEqual([
      "for_md_review",
      "for_costing_review",
      "for_pbd_review",
      "pending_manager_approval",
      "approved"
    ]);
  });

  it("lets internal roles see the internal review statuses", () => {
    for (const role of ["pbd", "costing", "admin", "superadmin", "viewer"]) {
      const statuses = getStatusesForRoles([role]);
      for (const status of internalReviewStatuses) {
        expect(statuses, `role: ${role}, status: ${status}`).toContain(status);
      }
    }
    // MD sees the review stages up to their own queue (technical review).
    const mdStatuses = getStatusesForRoles(["md"]);
    expect(mdStatuses).toContain("for_md_review");
    expect(mdStatuses).toContain("for_costing_review");
  });
});
