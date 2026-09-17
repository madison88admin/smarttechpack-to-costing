import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { allRoles, canAccessHistoricalCostData, type UserRole } from "../src/lib/auth/roles";

// ─────────────────────────────────────────────────────────────────────────────
// Navigation parity for the historical surfaces.
//
// The sidebar is a client component, so it cannot import the access predicate —
// the rule lives beside next/headers. It therefore declares roles per entry, and
// that declaration is exactly what drifted: Viewer was offered Historical Costing
// while the page guard (canAccessHistoricalCostData) and the history export both
// refused them. These tests pin the two historical entries to the rule, so the
// declaration can no longer silently disagree with the guard it points at.
//
// Super Admin keeps no operational links by design — an existing navigation
// policy, not an access rule — which is why the expectation excludes it.
// ─────────────────────────────────────────────────────────────────────────────

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} })
}));

import { SidebarNav } from "../src/components/sidebar-nav";

const HISTORICAL_ENTRIES = ["/history", "/like-styles"];

describe("sidebar — historical surfaces mirror the access rule", () => {
  it.each(allRoles)("%s sees them exactly when the rule allows", (role: UserRole) => {
    const html = renderToStaticMarkup(<SidebarNav role={role} userName="Tester" />);

    for (const href of HISTORICAL_ENTRIES) {
      const expected = role !== "superadmin" && canAccessHistoricalCostData(role);
      expect(html.includes(`href="${href}"`), `${role} → ${href}`).toBe(expected);
    }
  });

  it("keeps the surfaces that are NOT historical on the broader internal rule", () => {
    // Guardrail against over-applying the historical rule: Finance, Reporting and
    // Production are dashboards Viewer may read (canAccessInternalCostData).
    for (const role of ["viewer"] as UserRole[]) {
      const html = renderToStaticMarkup(<SidebarNav role={role} userName="Tester" />);
      for (const href of ["/finance", "/reports", "/production"]) {
        expect(html.includes(`href="${href}"`), `${role} → ${href}`).toBe(true);
      }
    }
  });
});
