// Pure customer-status lifecycle logic (no I/O). The route in
// src/app/api/costing/requests/[id]/customer-status/route.ts applies these
// verdicts and then performs the database work (update, revision history,
// attachments, workflow event).

export const CUSTOMER_STATUSES = [
  "not_submitted",
  "pending_customer_submission",
  "sent_to_customer",
  "under_negotiation",
  "customer_approved",
  "customer_rejected_revised",
  "closed"
] as const;

export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];

// Mirrors the `transitions` map in customer-status/route.ts.
export const CUSTOMER_STATUS_TRANSITIONS: Record<CustomerStatus, CustomerStatus[]> = {
  not_submitted: ["pending_customer_submission"],
  pending_customer_submission: ["sent_to_customer"],
  sent_to_customer: ["under_negotiation", "customer_approved", "customer_rejected_revised"],
  under_negotiation: ["customer_approved", "customer_rejected_revised"],
  customer_rejected_revised: ["pending_customer_submission"],
  customer_approved: ["closed"],
  closed: []
};

/** Returns an error message when `status` is not a known customer status, else null. */
export function assertCustomerStatusKnown(status: string): string | null {
  return CUSTOMER_STATUSES.includes(status as CustomerStatus) ? null : "Invalid customer status";
}

/** Returns the statuses reachable from `fromStatus`. */
export function customerStatusTargets(fromStatus: CustomerStatus): CustomerStatus[] {
  return CUSTOMER_STATUS_TRANSITIONS[fromStatus] ?? [];
}

/**
 * Returns an error message when the from → to transition is not allowed by the
 * customer-status machine, else null.
 */
export function assertCustomerStatusTransition(fromStatus: string, toStatus: string): string | null {
  if (!(CUSTOMER_STATUS_TRANSITIONS[fromStatus as CustomerStatus] ?? []).includes(toStatus as CustomerStatus)) {
    return `Cannot move customer review from "${fromStatus}" to "${toStatus}"`;
  }
  return null;
}

/** Revision number increments each time the customer rejects for revision. */
export function computeRevisionNumber(currentRevision: number | null | undefined, toStatus: string): number {
  return Number(currentRevision ?? 0) + (toStatus === "customer_rejected_revised" ? 1 : 0);
}

export const CUSTOMER_REVISION_DUE_DAYS = 3;

/**
 * Pure derivation of the extra fields set on each customer-status move.
 *
 * The rewind of the costing request itself (status → needs_clarification on
 * customer rejection) lives here so the post-approval regression can never
 * disappear unnoticed: a customer revision sends the request back to the
 * factory correction queue while keeping the customer review state visible.
 */
export function customerStatusDerivedUpdates(
  toStatus: CustomerStatus,
  now: string,
  revisionNumber: number
): Record<string, unknown> {
  const updates: Record<string, unknown> = {};
  if (toStatus === "sent_to_customer") updates.customer_submitted_at = now;
  if (toStatus === "customer_approved" || toStatus === "customer_rejected_revised") updates.customer_decision_at = now;
  if (toStatus === "customer_rejected_revised") {
    updates.customer_revision_due_at = new Date(
      new Date(now).getTime() + CUSTOMER_REVISION_DUE_DAYS * 86_400_000
    ).toISOString();
    updates.customer_revision_number = revisionNumber;
    updates.status = "needs_clarification";
  }
  return updates;
}
