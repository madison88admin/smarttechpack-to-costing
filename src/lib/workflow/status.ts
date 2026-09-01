import type { UserRole } from "@/lib/auth/roles";

export type CostingStatus =
  | "draft"
  | "sent_to_factory"
  | "needs_clarification"
  | "for_md_review"
  | "for_costing_review"
  | "for_pbd_review"
  | "pending_manager_approval"
  | "approved"
  | "rejected"
  // Display-only status used to mask internal review stages from factory users.
  | "under_review";

export const statusLabels: Record<CostingStatus, string> = {
  draft: "Draft",
  sent_to_factory: "Sent to Factory",
  needs_clarification: "Needs Clarification",
  for_md_review: "For MD Review",
  for_costing_review: "For Costing Review",
  for_pbd_review: "For PBD Review",
  pending_manager_approval: "For PBD Review",
  approved: "Internally Approved",
  rejected: "Internally Rejected",
  under_review: "Under Review"
};

export const statusTone: Record<CostingStatus, "neutral" | "blue" | "amber" | "green" | "red"> = {
  draft: "neutral",
  sent_to_factory: "blue",
  needs_clarification: "amber",
  for_md_review: "blue",
  for_costing_review: "blue",
  for_pbd_review: "amber",
  pending_manager_approval: "amber",
  approved: "green",
  rejected: "red",
  under_review: "blue"
};

export const phaseOneStatuses: CostingStatus[] = [
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

/**
 * Internal review stages that factory users must never see by name. These are
 * MD / Costing / PBD decisions, so the factory only ever sees "Under Review".
 */
export const internalReviewStatuses: CostingStatus[] = [
  "for_md_review",
  "for_costing_review",
  "for_pbd_review",
  "pending_manager_approval"
];

/** Statuses the factory can act on directly. */
export const factoryActionableStatuses: CostingStatus[] = [
  "draft",
  "sent_to_factory",
  "needs_clarification"
];

/** Statuses that are completely invisible to factory users — the internal
 * review stages plus the terminal "internally approved" outcome. Direct links
 * to requests in these statuses redirect factory users away, and they never
 * appear in the factory request list. */
export const factoryHiddenStatuses: CostingStatus[] = [...internalReviewStatuses, "approved"];

/**
 * Masks internal review statuses for factory users so they cannot see which
 * internal stage (MD, Costing, PBD, Manager) a request is in — those become
 * the generic "Under Review". Every other role sees the real status.
 */
export function maskStatusForRole(status: string, role: UserRole | string): CostingStatus {
  if (role === "factory" && internalReviewStatuses.includes(status as CostingStatus)) {
    return "under_review";
  }
  return (status as CostingStatus) ?? "draft";
}

/** The internal review statuses, for dashboard filters that should be hidden from factory. */
export const internalReviewStatusNames = internalReviewStatuses;
