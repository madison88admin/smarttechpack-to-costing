import { describe, expect, it } from "vitest";
import { assertCostSheetReadyGate, resolveCostSheetReadyUpdates } from "../src/lib/costing/cost-sheet";

// Covers the post-approval cost_sheet_ready flag route: only internally
// approved requests can be flagged ready; clearing is always allowed.

const NON_APPROVED_STATUSES = [
  "draft",
  "sent_to_factory",
  "needs_clarification",
  "for_costing_review",
  "for_pbd_review",
  "pending_manager_approval",
  "rejected"
];

describe("assertCostSheetReadyGate", () => {
  it("allows marking an approved request ready", () => {
    expect(assertCostSheetReadyGate("approved", true)).toBeNull();
  });

  it("blocks marking a non-approved request ready", () => {
    for (const status of NON_APPROVED_STATUSES) {
      expect(assertCostSheetReadyGate(status, true)).toBe(
        "Cost sheet can only be marked ready for approved requests"
      );
    }
  });

  it("always allows clearing the flag, from any status", () => {
    for (const status of ["approved", ...NON_APPROVED_STATUSES]) {
      expect(assertCostSheetReadyGate(status, false)).toBeNull();
    }
  });
});

describe("resolveCostSheetReadyUpdates", () => {
  const now = "2026-08-10T00:00:00.000Z";

  it("sets the flag with timestamp and actor when ready", () => {
    expect(resolveCostSheetReadyUpdates(true, now, "costing")).toEqual({
      cost_sheet_ready: true,
      cost_sheet_ready_at: now,
      cost_sheet_ready_by: "costing"
    });
  });

  it("resets all three fields when clearing", () => {
    expect(resolveCostSheetReadyUpdates(false, now, "costing")).toEqual({
      cost_sheet_ready: false,
      cost_sheet_ready_at: null,
      cost_sheet_ready_by: null
    });
  });
});
