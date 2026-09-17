import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { offers, survey } from "./helpers/element-survey";
import { issueSessionToken } from "./helpers/session";
import {
  allRoles,
  canAccessHistoricalCostData,
  canAccessInternalCostData,
  canDownloadCostingReports,
  canDownloadRequestExports,
  canRunCostingAction,
  canRunPbdAction,
  type UserRole
} from "../src/lib/auth/roles";

// ─────────────────────────────────────────────────────────────────────────────
// Page affordance vs the rule its ROUTE enforces.
//
// "Who may see and export internal cost data" has one owner in
// src/lib/auth/roles.ts: canAccessInternalCostData (everything but Factory) and
// canAccessHistoricalCostData (that, minus Viewer) for the historical surfaces,
// which is what docs/module-ownership.md specifies. It drifted because surfaces
// either reached for the broader predicate or re-listed roles: /history admitted
// Viewer while its own export answered 403, /reports offered its downloads to MD
// and Viewer (both 401), and the facet dropdown that only the Like Styles search
// calls had a hand-rolled copy of the rule.
//
// These tests call the real pages with a real signed session and compare the
// links they render against the predicate the route behind each link reads, so a
// page guard that diverges from its route fails here rather than needing a probe.
// Negative control: gating /reports on the older, broader canAccessInternalCostData
// rule fails the MD and Viewer cases; reverting is green.
// ─────────────────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({ token: null as string | null }));

vi.mock("next/headers", () => ({
  cookies: () => ({ get: () => (mocks.token ? { value: mocks.token } : undefined) })
}));

vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
  notFound: () => {
    throw new Error("notFound");
  },
  usePathname: () => "/",
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} })
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: () => {
    throw new Error("the pages under test own no query — they must delegate to their lib owner");
  }
}));

vi.mock("@/lib/costing/history", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/costing/history")>()),
  tryListHistoricalCostings: async () => ({ data: [], error: null }),
  countHistoricalCostings: async () => 0
}));

vi.mock("@/lib/reporting", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/reporting")>()),
  tryGetReportData: async () => ({ data: null, error: null })
}));

vi.mock("@/lib/nextgen/filter-options", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/nextgen/filter-options")>()),
  tryGetNextGenFilterOptions: async () => ({ brands: [], customers: [], seasons: [] })
}));

import ReportsPage from "../src/app/reports/page";
import HistoryPage from "../src/app/history/page";

/** Renders a page as a role, turning the guard's redirect into a value. */
async function renderAs(role: UserRole, render: () => Promise<unknown>) {
  mocks.token = await issueSessionToken(role);
  try {
    return { tree: survey(await render()), redirected: null as string | null };
  } catch (error) {
    const message = String((error as Error)?.message ?? error);
    if (!message.startsWith("redirect:")) throw error;
    return { tree: null, redirected: message.slice("redirect:".length) };
  }
}

const source = (path: string) => readFileSync(path, "utf8");

describe("the internal cost-data rule keeps one owner", () => {
  it("derives the historical boundary from the internal one (minus Viewer)", () => {
    for (const role of allRoles) {
      expect(canAccessHistoricalCostData(role), role).toBe(canAccessInternalCostData(role) && role !== "viewer");
    }
  });

  it("puts the request/CBD downloads on that same boundary", () => {
    for (const role of allRoles) {
      expect(canDownloadRequestExports(role), role).toBe(canAccessHistoricalCostData(role));
    }
    // The loose thread: this predicate used to be `role !== "viewer"`, which
    // admitted Factory at the route and left the middleware as the only layer
    // refusing it — the route and the rule disagreed about Factory.
    expect(canDownloadRequestExports("factory")).toBe(false);
    expect(canDownloadRequestExports("viewer")).toBe(false);
    expect(canDownloadRequestExports("md")).toBe(true);
  });

  it("keeps the report/register downloads on the lane expression the routes used", () => {
    for (const role of allRoles) {
      expect(canDownloadCostingReports(role), role).toBe(canRunPbdAction(role) || canRunCostingAction(role));
    }
  });
});

describe("pages offer exactly what their routes allow", () => {
  it("/reports — export links follow the report download rule", async () => {
    for (const role of allRoles) {
      const { tree, redirected } = await renderAs(role, () => ReportsPage({ searchParams: {} }));
      const mayRead = role !== "superadmin" && canAccessInternalCostData(role);

      if (!mayRead) {
        expect(redirected, `${role} should be sent away from /reports`).toBe("/");
        continue;
      }
      expect(redirected, role).toBeNull();

      const expected = canDownloadCostingReports(role);
      for (const endpoint of ["/api/export/report.csv", "/api/export/report.xlsx"]) {
        expect(offers(tree!.hrefs, endpoint), `${role} ${endpoint}`).toBe(expected);
      }
    }
  });

  it("/history — a reader is a downloader, because the guard is the export's own rule", async () => {
    for (const role of allRoles) {
      const { tree, redirected } = await renderAs(role, () => HistoryPage({ searchParams: {} }));

      if (!canAccessHistoricalCostData(role)) {
        expect(redirected, `${role} must not reach the register`).toBe("/");
        continue;
      }
      expect(redirected, role).toBeNull();
      expect(offers(tree!.hrefs, "/api/export/history.csv"), `${role} export link`).toBe(true);
    }
  });
});

describe("routes and pages name the rule instead of re-listing roles", () => {
  it.each([
    ["src/app/api/export/report.csv/route.ts", "canDownloadCostingReports"],
    ["src/app/api/export/report.xlsx/route.ts", "canDownloadCostingReports"],
    ["src/app/api/export/register.csv/route.ts", "canDownloadCostingReports"],
    ["src/app/api/export/register.xlsx/route.ts", "canDownloadCostingReports"],
    ["src/app/api/export/requests.csv/route.ts", "canDownloadRequestExports"],
    ["src/app/api/export/cbd-detail.csv/route.ts", "canDownloadRequestExports"],
    ["src/app/api/export/history.csv/route.ts", "canAccessHistoricalCostData"],
    ["src/app/api/historical/distinct/route.ts", "canAccessHistoricalCostData"],
    ["src/app/history/page.tsx", "canAccessHistoricalCostData"],
    ["src/app/reports/page.tsx", "canDownloadCostingReports"]
  ])("%s reads %s", (path, predicate) => {
    expect(source(path)).toContain(predicate);
  });

  it("does not let the historical page fall back to the broader rule", () => {
    const history = source("src/app/history/page.tsx");
    expect(history).not.toContain("canAccessInternalCostData");
  });

  it("does not let the facet dropdown keep its hand-rolled Viewer exclusion", () => {
    const distinct = source("src/app/api/historical/distinct/route.ts");
    expect(distinct).not.toContain('role === "viewer"');
    expect(distinct).not.toContain("canAccessInternalCostData");
  });

  it.each([
    ["src/app/api/export/report.csv/route.ts"],
    ["src/app/api/export/register.xlsx/route.ts"],
    ["src/app/reports/page.tsx"],
    ["src/app/history/page.tsx"]
  ])("%s no longer hand-rolls the lane or the role list", (path) => {
    const text = source(path);
    expect(text).not.toMatch(/canRunPbdAction\(role\)\s*\|\|\s*canRunCostingAction\(role\)/);
    expect(text).not.toMatch(/role === "(viewer|factory|manager)"/);
  });
});
