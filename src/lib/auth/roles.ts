import { cookies } from "next/headers";
import { readSessionPayload, SESSION_COOKIE } from "./session";

export type UserRole = "superadmin" | "admin" | "manager" | "pbd" | "costing" | "factory" | "md" | "viewer";

const roleLabels: Record<UserRole, string> = {
  superadmin: "Super Admin",
  admin: "Admin",
  manager: "PBD",
  pbd: "PBD",
  costing: "Costing Team",
  factory: "Factory",
  md: "MD (Merchandising)",
  viewer: "Viewer"
};

export const allRoles: UserRole[] = ["superadmin", "admin", "manager", "pbd", "costing", "factory", "md", "viewer"];

export function getCurrentRole(): UserRole {
  const role = getCurrentIdentity()?.role;

  // Manager was merged into the PBD decision owner. Normalize any legacy
  // session immediately while old database profiles are being migrated.
  if (role === "manager") return "pbd";

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

// Legacy compatibility only. Manager identities are normalized to PBD by the
// production-hardening migration; the workflow has no separate Manager gate.
export function canRunManagerAction(role: UserRole) {
  return canRunPbdAction(role) || role === "manager";
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

// Historical costing and like-style surfaces: the internal cost data minus the
// read-only Viewer role. Derived from canAccessInternalCostData so a new role
// inherits the boundary, and every route and page that gates on it reads the
// same rule instead of re-listing roles (the Like Styles search, its exports,
// the history exports and the historical facet dropdowns had drifted apart).
export function canAccessHistoricalCostData(role: UserRole) {
  return canAccessInternalCostData(role) && role !== "viewer";
}

// Super Admin only — system maintenance (sync, import, escalation triggers)
export function canPerformSystemMaintenance(role: UserRole) {
  return role === "superadmin";
}
