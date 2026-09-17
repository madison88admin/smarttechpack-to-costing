import { cookies } from "next/headers";
import { readSessionPayload, SESSION_COOKIE } from "./session";

export type UserRole = "superadmin" | "admin" | "pbd" | "costing" | "factory" | "md" | "viewer";

const roleLabels: Record<UserRole, string> = {
  superadmin: "Super Admin",
  admin: "Admin",
  pbd: "PBD",
  costing: "Costing Team",
  factory: "Factory",
  md: "MD (Merchandising)",
  viewer: "Viewer"
};

export const allRoles: UserRole[] = ["superadmin", "admin", "pbd", "costing", "factory", "md", "viewer"];

export function getCurrentRole(): UserRole {
  const role = getCurrentIdentity()?.role;

  // Manager no longer exists as a role (it was always the PBD decision owner, so
  // the workflow never had a separate gate for it). A session signed before the
  // retirement carries a role value that is no longer in the vocabulary and
  // therefore falls through to "viewer" below: fail closed, never an
  // escalation, and the user simply signs in again. No user_profiles row holds
  // the retired role, and the login route refuses it outright.
  if (allRoles.includes(role as UserRole)) {
    return role as UserRole;
  }

  return "viewer";
}

export function getCurrentUserName(): string {
  return getCurrentIdentity()?.name ?? "Guest";
}

export function getCurrentUserId(): string | null {
  const sub = getCurrentIdentity()?.sub ?? null;
  // Pilot users have non-UUID IDs like "pilot-pbd". DB columns expecting UUIDs
  // (approval_actions.actor_user_id, workflow_events.actor_user_id) reject these,
  // so return null for non-UUID values. The actor_role and actor_name are still
  // recorded for audit purposes.
  if (sub && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sub)) {
    return null;
  }
  return sub;
}

export function getCurrentUserEmail(): string | null {
  return getCurrentIdentity()?.email ?? null;
}

export function getCurrentIdentity() {
  return readSessionPayload(cookies().get(SESSION_COOKIE)?.value);
}

export function getRoleLabel(role: UserRole) {
  return roleLabels[role];
}

// Super Admin and Admin can do everything below
export function isAdminTier(role: UserRole) {
  return role === "superadmin" || role === "admin";
}

// PBD and Admin tier can create costing requests
export function canCreateRequest(role: UserRole) {
  return isAdminTier(role) || role === "pbd";
}

// Factory and Admin tier can submit CBD
export function canSubmitFactoryCbd(role: UserRole) {
  return isAdminTier(role) || role === "factory";
}

// Costing Team can validate cost sheets, run checklist, record comparisons
export function canRunCostingAction(role: UserRole) {
  return isAdminTier(role) || role === "costing";
}

// PBD can approve/reject/clarify (segregation of duties: Costing validates, PBD approves)
export function canRunPbdAction(role: UserRole) {
  return isAdminTier(role) || role === "pbd";
}

// MD (Merchandising) can check operations, knitting machine, and yarn based on sample's construction
export function canRunMdAction(role: UserRole) {
  return isAdminTier(role) || role === "md";
}

// Costing Team can also review CBD (read-only approval flow)
export function canReviewCbd(role: UserRole) {
  return isAdminTier(role) || role === "pbd" || role === "costing";
}

// Admin tier only (admin settings, audit logs, error logs, user management)
export function canAccessAdmin(role: UserRole) {
  return isAdminTier(role);
}

// Super Admin only — user management, system maintenance, role assignment
export function canManageUsers(role: UserRole) {
  return role === "superadmin";
}

// Internal operational data (approved costs, finance metrics, production and
// historical costing) must never be exposed to Factory users. Keep this
// centralized so pages and download endpoints enforce the same boundary as
// the sidebar instead of relying on hidden navigation links.
export function canAccessInternalCostData(role: UserRole) {
  // Every role except Factory — derived from allRoles so a new role inherits
  // the boundary (Factory is the only role that must never see internal costs).
  return (allRoles.filter((r) => r !== "factory") as UserRole[]).includes(role);
}

// Historical costing and Like Styles: the internal cost data minus the read-only
// Viewer role. ONE owner for those surfaces — the history page, the Like Styles
// page, their exports and the facet dropdown they share all read this rule.
// Derived from canAccessInternalCostData so a new role inherits the boundary.
//
// The rule fell apart when surfaces re-listed roles or reached for the broader
// predicate: the history page admitted Viewer while its own export refused them,
// and the facet dropdown (which only the Like Styles search calls) did the same.
// If a new historical surface appears, call this — do not re-list roles.
export function canAccessHistoricalCostData(role: UserRole) {
  return canAccessInternalCostData(role) && role !== "viewer";
}

// Download endpoints that list requests or their CBD detail
// (`/api/export/requests.csv`, `/api/export/cbd-detail.csv`). They take the same
// boundary as every other internal cost-data surface — Factory never receives
// internal request/cost rows and the read-only Viewer never extracts them — so
// this reads that one rule rather than hand-rolling `role !== "viewer"`, which
// admitted Factory at the route and left the middleware as the only thing
// refusing it.
export function canDownloadRequestExports(role: UserRole) {
  return canAccessHistoricalCostData(role);
}

// Report and register downloads (`/api/export/report.{csv,xlsx}` and
// `/api/export/register.{csv,xlsx}`) are a lane capability, not a read-only one:
// the PBD and Costing lanes plus the admin tier. The reporting page's export
// buttons read this same rule, so MD and Viewer — who may read the report but
// were never allowed to download it — are no longer offered a button that
// answers 401.
export function canDownloadCostingReports(role: UserRole) {
  return canRunPbdAction(role) || canRunCostingAction(role);
}

// Super Admin only — system maintenance (sync, import, escalation triggers)
export function canPerformSystemMaintenance(role: UserRole) {
  return role === "superadmin";
}
