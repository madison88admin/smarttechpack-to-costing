import { describe, expect, it } from "vitest";
import { assertActionAllowed, assertTransitionAllowed } from "../src/lib/costing/actions";
import type { CostingStatus } from "../src/lib/workflow/status";

// =============================================================================
// Unit tests for the pure transition engine in src/lib/costing/actions.ts.
//
// Coverage map vs. the 13 status-changing transitions in docs/system-flow-diagram.md §3:
//   [1]  draft -> sent_to_factory                       send_to_factory     ✅ (engine)
//   [2]  sent_to_factory -> for_md_review             submit              ✅ engine + tests/cbd-submit-integration.test.ts
//                                                                          (blocking-error branch -> needs_clarification also covered)
//   [3]  needs_clarification -> for_md_review          submit (resubmit)   ✅ (engine)
//   [4]  for_md_review -> for_costing_review           md_review (pass)    ✅ tests/md-review.test.ts
//   [5]  for_md_review -> needs_clarification          md_review (clarify) ✅ tests/md-review.test.ts
//   [6]  for_costing_review -> for_pbd_review          costing_complete    ✅ (engine; checklist gate is
//                                                                              DB-side, not unit-tested here)
//   [7]  for_costing_review -> needs_clarification     costing_clarify     ✅ (engine)
//   [8]  for_pbd_review -> needs_clarification         clarify             ✅ (engine)
//   [9]  for_pbd_review -> approved                    approve            ✅
//   [10] for_pbd_review -> rejected                    reject              ✅ (engine)
//   [11] approved -> needs_clarification               customer_rejected_revised
//                                                                          ✅ tests/customer-status.test.ts
//
// Role gates: costing_* -> Costing or Admin; approve/reject -> PBD or Admin;
// The former Manager actions are invalid because PBD owns the single decision.
// send_to_factory / submit / clarify carry no
// role gate in the engine — they are gated in the route layer instead.
// =============================================================================

const STATUSES: CostingStatus[] = [
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

const ALL_ROLES = ["superadmin", "admin", "manager", "pbd", "costing", "factory", "md", "viewer"] as const;

// Mirrors `validTransitions` in src/lib/costing/actions.ts — the source of truth.
const ACTIONS: Record<string, CostingStatus[]> = {
  send_to_factory: ["draft"],
  submit: ["sent_to_factory", "needs_clarification"],
  costing_complete: ["for_costing_review"],
  costing_clarify: ["for_costing_review"],
  clarify: ["for_pbd_review", "needs_clarification"],
  approve: ["for_pbd_review"],
  reject: ["for_pbd_review"]
};

describe("assertActionAllowed — known actions", () => {
  it("accepts every known action for a role that passes its gate", () => {
    // Admin passes every gate; send_to_factory/submit/clarify pass for any role.
    for (const action of Object.keys(ACTIONS)) {
      expect(assertActionAllowed(action, "admin"), `action: ${action}`).toBeNull();
    }
  });

  it("rejects unknown actions with 'Invalid action' regardless of role", () => {
    expect(assertActionAllowed("explode", "admin")).toBe("Invalid action");
    expect(assertActionAllowed("approve_now", "pbd")).toBe("Invalid action");
    expect(assertActionAllowed("", "superadmin")).toBe("Invalid action");
    expect(assertActionAllowed("APPROVE", "pbd")).toBe("Invalid action"); // case-sensitive
  });
});

describe("assertActionAllowed — role gates", () => {
  it.each(["costing_complete", "costing_clarify"])(
    "%s requires Costing Team or Admin tier",
    (action) => {
      for (const role of ["costing", "admin", "superadmin"] as const) {
        expect(assertActionAllowed(action, role), `role: ${role}`).toBeNull();
      }
      for (const role of ["pbd", "manager", "factory", "md", "viewer"] as const) {
        expect(assertActionAllowed(action, role), `role: ${role}`).toBe(
          `Action "${action}" requires Costing Team or Admin role`
        );
      }
    }
  );

  it.each(["approve", "reject"])("%s requires PBD or Admin tier", (action) => {
    for (const role of ["pbd", "admin", "superadmin"] as const) {
      expect(assertActionAllowed(action, role), `role: ${role}`).toBeNull();
    }
    for (const role of ["costing", "manager", "factory", "md", "viewer"] as const) {
      expect(assertActionAllowed(action, role), `role: ${role}`).toBe(
        `Action "${action}" requires PBD or Admin role`
      );
    }
  });

  it.each(["manager_approve", "manager_reject"])("rejects removed legacy action %s", (action) => {
    for (const role of ALL_ROLES) {
      expect(assertActionAllowed(action, role)).toBe("Invalid action");
    }
  });

  it("leaves send_to_factory, submit, and clarify ungated in the engine (route layer gates them)", () => {
    // These are gated upstream: send_to_factory/clarify in actions/route.ts
    // (PBD or Admin), submit in cbd/route.ts (Factory or Admin). The engine
    // itself must not reject them, otherwise valid callers would break.
    for (const action of ["send_to_factory", "submit", "clarify"]) {
      for (const role of ALL_ROLES) {
        expect(assertActionAllowed(action, role), `action: ${action}, role: ${role}`).toBeNull();
      }
    }
  });

  it("treats a missing role like a non-privileged role", () => {
    expect(assertActionAllowed("approve")).toBe(`Action "approve" requires PBD or Admin role`);
    expect(assertActionAllowed("manager_approve", null)).toBe("Invalid action");
    expect(assertActionAllowed("send_to_factory", null)).toBeNull();
  });
});

describe("assertTransitionAllowed — all 9 valid edges", () => {
  it.each(
    Object.entries(ACTIONS).flatMap(([action, fromStatuses]) =>
      fromStatuses.map((fromStatus) => [action, fromStatus] as const)
    )
  )("allows %s from %s", (action, fromStatus) => {
    expect(assertTransitionAllowed(action, fromStatus)).toBeNull();
  });

  it("exactly covers the 9 documented (action, from-status) pairs", () => {
    const edges = Object.entries(ACTIONS).flatMap(([action, fromStatuses]) =>
      fromStatuses.map((fromStatus) => `${action}::${fromStatus}`)
    );
    expect(edges).toHaveLength(9);
  });
});

describe("assertTransitionAllowed — denied from-statuses", () => {
  it.each(Object.keys(ACTIONS))("rejects %s from every status outside its allowed set", (action) => {
    const allowed = ACTIONS[action];
    for (const fromStatus of STATUSES) {
      if (allowed.includes(fromStatus)) continue;
      expect(assertTransitionAllowed(action, fromStatus)).toBe(
        `Action "${action}" is not allowed from status "${fromStatus}". Allowed from: ${allowed.join(", ")}`
      );
    }
  });

  it("is permissive about unknown actions (assertActionAllowed rejects them first)", () => {
    // runCostingAction consults the transition gate only after the action gate
    // has accepted the action, so unknown actions must not trip this function.
    expect(assertTransitionAllowed("explode", "approved")).toBeNull();
  });
});

describe("gate precedence (mirrors runCostingAction order)", () => {
  it("rejects in order: invalid action > role gate > transition gate", () => {
    // 1. Unknown action wins over any role or status check.
    expect(assertActionAllowed("explode", "viewer")).toBe("Invalid action");

    // 2. A role violation is reported before the from-status is ever consulted
    //    (a viewer cannot trigger costing_complete from any status).
    expect(assertActionAllowed("costing_complete", "viewer")).toBe(
      `Action "costing_complete" requires Costing Team or Admin role`
    );

    // 3. Only after the role gate passes does the transition gate apply.
    expect(assertTransitionAllowed("costing_complete", "draft")).toBe(
      `Action "costing_complete" is not allowed from status "draft". Allowed from: for_costing_review`
    );
    expect(assertTransitionAllowed("approve", "pending_manager_approval")).toBe(
      `Action "approve" is not allowed from status "pending_manager_approval". Allowed from: for_pbd_review`
    );
  });
});
