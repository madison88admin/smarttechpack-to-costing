import { describe, expect, it } from "vitest";
import {
  assertCustomerReviewEditable,
  assertCustomerStatusKnown,
  assertCustomerStatusTransition,
  computeRevisionNumber,
  CUSTOMER_REVISION_DUE_DAYS,
  CUSTOMER_STATUSES,
  CUSTOMER_STATUS_TRANSITIONS,
  customerStatusDerivedUpdates,
  customerStatusTargets,
  customerStatusTargetsForRequest
} from "../src/lib/costing/customer-status";
import { canRunPbdAction } from "../src/lib/auth/roles";

// Covers doc transition [13]: customer_rejected_revised rewinds an approved
// request back to needs_clarification while keeping the customer review state.

describe("customer-status machine — known statuses", () => {
  it("accepts all 7 documented statuses", () => {
    for (const status of CUSTOMER_STATUSES) {
      expect(assertCustomerStatusKnown(status), `status: ${status}`).toBeNull();
    }
  });

  it("rejects unknown or malformed statuses", () => {
    expect(assertCustomerStatusKnown("")).toBe("Invalid customer status");
    expect(assertCustomerStatusKnown("APPROVED")).toBe("Invalid customer status");
    expect(assertCustomerStatusKnown("customer_approved ")).toBe("Invalid customer status");
    expect(assertCustomerStatusKnown("shipped")).toBe("Invalid customer status");
    expect(assertCustomerStatusKnown("pending")).toBe("Invalid customer status");
  });
});

describe("customer-status machine — 9 valid edges", () => {
  it.each(
    (Object.entries(CUSTOMER_STATUS_TRANSITIONS) as [string, string[]][]).flatMap(([from, tos]) =>
      tos.map((to) => [from, to] as const)
    )
  )("allows %s -> %s", (from, to) => {
    expect(assertCustomerStatusTransition(from, to)).toBeNull();
    expect(customerStatusTargets(from as (typeof CUSTOMER_STATUSES)[number])).toContain(to);
  });

  it("closed is a terminal state", () => {
    expect(CUSTOMER_STATUS_TRANSITIONS.closed).toEqual([]);
    expect(customerStatusTargets("closed")).toEqual([]);
  });
});

describe("customer-status machine — deny matrix", () => {
  it("rejects every from -> to pair outside the transition map", () => {
    let validEdges = 0;
    for (const from of CUSTOMER_STATUSES) {
      for (const to of CUSTOMER_STATUSES) {
        const allowed = CUSTOMER_STATUS_TRANSITIONS[from].includes(to);
        if (allowed) {
          validEdges += 1;
          continue;
        }
        expect(assertCustomerStatusTransition(from, to)).toBe(
          `Cannot move customer review from "${from}" to "${to}"`
        );
      }
    }
    expect(validEdges).toBe(9); // the full machine is pinned: 7×7 = 49 pairs
  });

  it("rejects a transition from an unknown from-status", () => {
    expect(assertCustomerStatusTransition("approved", "closed")).toBe(
      `Cannot move customer review from "approved" to "closed"`
    );
  });
});

describe("computeRevisionNumber", () => {
  it("increments only on customer_rejected_revised", () => {
    expect(computeRevisionNumber(0, "customer_rejected_revised")).toBe(1);
    expect(computeRevisionNumber(2, "customer_rejected_revised")).toBe(3);
    expect(computeRevisionNumber(null, "customer_rejected_revised")).toBe(1);
    expect(computeRevisionNumber(undefined, "customer_rejected_revised")).toBe(1);
  });

  it("leaves the number unchanged for any other move", () => {
    expect(computeRevisionNumber(0, "customer_approved")).toBe(0);
    expect(computeRevisionNumber(3, "sent_to_customer")).toBe(3);
    expect(computeRevisionNumber(null, "closed")).toBe(0);
  });
});

describe("customerStatusDerivedUpdates", () => {
  const now = "2026-08-10T12:00:00.000Z";

  it("stamps customer_submitted_at when sent to customer", () => {
    expect(customerStatusDerivedUpdates("sent_to_customer", now, 0)).toEqual({
      customer_submitted_at: now
    });
  });

  it("stamps customer_decision_at on approval or revision", () => {
    expect(customerStatusDerivedUpdates("customer_approved", now, 0)).toEqual({
      customer_decision_at: now
    });
  });

  it("rewinds the request to needs_clarification on customer revision (doc transition [13])", () => {
    const updates = customerStatusDerivedUpdates("customer_rejected_revised", now, 4);
    expect(updates.customer_decision_at).toBe(now);
    expect(updates.customer_revision_number).toBe(4);
    expect(updates.status).toBe("needs_clarification"); // the post-approval regression
    expect(updates.customer_revision_due_at).toBe(
      new Date(new Date(now).getTime() + CUSTOMER_REVISION_DUE_DAYS * 86_400_000).toISOString()
    );
  });

  it("sets no derived fields for the remaining moves", () => {
    for (const status of ["not_submitted", "pending_customer_submission", "under_negotiation", "closed"] as const) {
      expect(customerStatusDerivedUpdates(status, now, 0), `status: ${status}`).toEqual({});
    }
  });
});

describe("customer review approval gate (assertCustomerReviewEditable)", () => {
  it("only allows moves after the internal approval", () => {
    expect(assertCustomerReviewEditable("approved")).toBeNull();
  });

  it("blocks every pre-approval and post-rejection request status", () => {
    for (const requestStatus of [
      "draft",
      "sent_to_factory",
      "for_md_review",
      "for_costing_review",
      "for_pbd_review",
      "needs_clarification",
      "rejected"
    ]) {
      const error = assertCustomerReviewEditable(requestStatus);
      expect(error, `request status: ${requestStatus}`).toContain("after the internal approval");
    }
  });

  it("exposes no customer targets while the request is unapproved", () => {
    expect(customerStatusTargetsForRequest("not_submitted", "sent_to_factory")).toEqual([]);
    expect(customerStatusTargetsForRequest("pending_customer_submission", "draft")).toEqual([]);
    expect(customerStatusTargetsForRequest("sent_to_customer", "needs_clarification")).toEqual([]);
  });

  it("keeps the full machine reachable once approved", () => {
    expect(customerStatusTargetsForRequest("pending_customer_submission", "approved")).toEqual(["sent_to_customer"]);
    expect(customerStatusTargetsForRequest("sent_to_customer", "approved")).toEqual([
      "under_negotiation",
      "customer_approved",
      "customer_rejected_revised"
    ]);
    expect(customerStatusTargetsForRequest("customer_approved", "approved")).toEqual(["closed"]);
    expect(customerStatusTargetsForRequest("not_submitted", "approved")).toEqual(["pending_customer_submission"]);
  });
});

describe("PBD role gate (canRunPbdAction)", () => {
  it("allows PBD, Admin, and Super Admin", () => {
    for (const role of ["pbd", "admin", "superadmin"] as const) {
      expect(canRunPbdAction(role), `role: ${role}`).toBe(true);
    }
  });

  it("denies every other role", () => {
    for (const role of ["costing", "factory", "md", "viewer"] as const) {
      expect(canRunPbdAction(role), `role: ${role}`).toBe(false);
    }
  });
});
