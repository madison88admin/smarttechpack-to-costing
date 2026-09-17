import { afterEach, describe, expect, it, vi } from "vitest";
import { runCostingAction, assertActionAllowed } from "../src/lib/costing/actions";
import { validateFactoryCbd, hasBlockingIssues } from "../src/lib/costing/validation";
import { calculateCostingTotals } from "../src/lib/costing/totals";

// ---------------------------------------------------------------------------
// USER TESTING (UAT) — scenarios a real person would follow in the browser
// Roles: factory → md → costing → pbd → manager → admin
// Each scenario mirrors manual QA steps and asserts the same gates the UI shows.
// ---------------------------------------------------------------------------

const { mocks } = vi.hoisted(() => ({ mocks: { client: null as unknown } }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: () => mocks.client,
}));
import { createMockSupabase, inserts, updates } from "./helpers/supabase-mock";

afterEach(() => (mocks.client = null));

function uatResponder(status: string, extra: Record<string, unknown> = {}) {
  return {
    costing_requests: {
      single: (chain: { select: unknown }) => {
        if (chain.select === "status") return { data: { status }, error: null };
        if (chain.select === "pbd_pricing_status") return { data: { pbd_pricing_status: "entered" }, error: null };
        if (String(chain.select).includes("nextgen_products")) return { data: { id: "req-1", factory_name: "Cebu Factory", nextgen_products: [{ style_number: "M88-123" }] }, error: null };
        if (chain.select === "id, factory_name, baseline_ref") return { data: { id: "req-1", factory_name: "Cebu Factory" }, error: null };
        throw new Error(`unhandled ${String(chain.select)}`);
      },
      select: () => ({ data: [{ id: "req-1" }], error: null }),
    },
    validation_results: { select: () => ({ data: [], error: null }) },
    compliance_checks: { select: () => ({ data: [], error: null }) },
    approval_actions: {
      maybeSingle: () => ({ data: { metadata: { decision: "pass" } }, error: null }),
      insert: () => ({ data: [], error: null }),
    },
    factory_cbds: {
      maybeSingle: (chain: { select: unknown }) => String(chain.select).includes("cbd_material_lines")
        ? { data: { id: "cbd-1", submitted_at: "2026-08-10T00:00:00Z", raw_payload: { grandTotal: 10, currency: "USD", yarnType: "Cotton", knitType: "Jersey", machineType: "Flat", knittingTime: 0.4 }, cbd_material_lines: [{ consumption: 0.2, total_cost: 10, currency: "USD", material_name: "Yarn" }] }, error: null }
        : { data: { id: "cbd-1", raw_payload: { grandTotal: 10, currency: "USD" } }, error: null },
    },
    historical_costings: { select: () => ({ data: [], error: null }), maybeSingle: () => ({ data: null, error: null }), delete: () => ({ data: [], error: null }), insert: () => ({ data: [], error: null }) },
    workflow_events: { insert: () => ({ data: [], error: null }) },
    workflow_settings: { single: () => ({ data: { key: "manager_approval_threshold", value: "15" }, error: null }) },
    validation_checklist_items: { select: () => ({ data: [], error: null }) },
    request_checklist_results: {
      select: () => ({ data: [
        { checklist_code: "moq_checked", is_checked: true, comment: "", checked_by_role: "costing", checked_at: "2026-08-10T00:00:00.000Z" },
        { checklist_code: "lead_time_checked", is_checked: true, comment: "", checked_by_role: "costing", checked_at: "2026-08-10T00:00:00.000Z" },
        { checklist_code: "packaging_checked", is_checked: true, comment: "", checked_by_role: "costing", checked_at: "2026-08-10T00:00:00.000Z" },
        { checklist_code: "comparable_style_reviewed", is_checked: true, comment: "", checked_by_role: "costing", checked_at: "2026-08-10T00:00:00.000Z" },
      ], error: null }),
    },
    ...extra,
  } as never;
}

describe("UAT — Factory user", () => {
  it("factory sees validation errors before submit (cannot submit with zero unit cost)", () => {
    const issues = validateFactoryCbd({
      currency: "USD", laborCost: "1", overheadCost: "1", moq: "100", leadTimeDays: "30", materialBufferPercent: "5", packagingCost: "0.1", testingCost: "0.1",
      brandNominatedItems: "None", m88Packaging: "Std", yarnType: "Cotton", knitType: "Jersey", machineType: "Flat",
      lines: [{ materialName: "Yarn", consumption: "1", unitCost: "0", currency: "USD" }],
    } as Parameters<typeof validateFactoryCbd>[0]);
    expect(hasBlockingIssues(issues)).toBe(true);
    expect(issues.map((i) => i.message).join(" ")).toContain("zero or negative unit cost");
  });

  it("factory submits a realistic structured CBD and totals pencil out", () => {
    const totals = calculateCostingTotals({
      rawPayload: { materialTotal: 2.8, laborCost: 0.5, overheadCost: 0.2, packagingCost: 0.12, profitCost: 0.25, factoryCostTotal: 3.87, currency: "USD" },
      lines: [{ total_cost: 2.8, currency: "USD" }],
    });
    expect(totals.grandTotal).toBeCloseTo(3.87);
    expect(totals.materialTotal).toBeCloseTo(2.8);
    // UI would show landed > fob when freight present
    const withFreight = calculateCostingTotals({
      rawPayload: { materialTotal: 3.87, currency: "USD", freightCost: 0.6, dutyRate: 10, insuranceCost: 0.05 },
      lines: [{ total_cost: 3.87, currency: "USD" }],
    });
    expect(withFreight.landedCost).toBeGreaterThan(withFreight.grandTotal);
  });

  it("factory cannot approve — role gate shows 'requires PBD' error (UI disables Approve button)", async () => {
    const { client } = createMockSupabase(uatResponder("for_pbd_review"));
    mocks.client = client;
    await expect(runCostingAction("req-1", "approve", null, "factory")).rejects.toThrow('requires PBD');
  });
});

describe("UAT — MD reviewer", () => {
  it("MD review pending blocks PBD approval (user sees blocker banner)", async () => {
    const base = uatResponder("for_pbd_review") as unknown as Record<string, unknown>;
    const { client } = createMockSupabase({
      ...(base as object),
      approval_actions: {
        maybeSingle: (chain: { eq?: [string, unknown][] }) => {
          const isAck = chain.eq?.some(([c, v]) => c === "action" && v === "outlier_acknowledged");
          if (isAck) return { data: null, error: null };
          return { data: null, error: null }; // no MD review at all
        },
        insert: () => ({ data: [], error: null }),
      },
    } as never);
    mocks.client = client;
    await expect(runCostingAction("req-1", "approve", null, "pbd")).rejects.toThrow("MD technical review is passed");
  });

  it("MD compliance failure (RSL pending) would have been shown in the compliance panel and blocks approval", async () => {
    const { client } = createMockSupabase(uatResponder("for_pbd_review", {
      compliance_checks: { select: () => ({ data: [{ check_type: "rsl", status: "pending" }], error: null }) },
    } as never));
    mocks.client = client;
    await expect(runCostingAction("req-1", "approve", null, "pbd")).rejects.toThrow("RSL compliance is pending");
  });
});

describe("UAT — Costing team", () => {
  it("costing cannot complete checklist while items unchecked (UI shows '3 required unchecked')", async () => {
    const { client } = createMockSupabase({
      costing_requests: { single: () => ({ data: { status: "for_costing_review" }, error: null }), select: () => ({ data: [{ id: "req-1" }], error: null }) },
      validation_checklist_items: { select: () => ({ data: [], error: null }) },
      request_checklist_results: { select: () => ({ data: [{ checklist_code: "moq_checked", is_checked: true }], error: null }) },
      approval_actions: { insert: () => ({ data: [], error: null }) },
      workflow_events: { insert: () => ({ data: [], error: null }) },
    } as never);
    mocks.client = client;
    await expect(runCostingAction("req-1", "costing_complete", null, "costing")).rejects.toThrow("3 required checklist item(s) not checked");
  });

  it("costing completes and hands off to PBD (user clicks Costing Complete → toast 'Released to PBD')", async () => {
    const { client, calls } = createMockSupabase(uatResponder("for_costing_review"));
    mocks.client = client;
    const r = await runCostingAction("req-1", "costing_complete", null, "costing", "Costing Jane", "u-cost");
    expect(r.status).toBe("for_pbd_review");
    expect(updates(calls, "costing_requests")[0]).toMatchObject({ status: "for_pbd_review" });
  });

  it("costing can clarify back to factory when data looks off (user sees 'Sent back to Factory')", async () => {
    const { client, calls } = createMockSupabase({
      costing_requests: { single: () => ({ data: { status: "for_costing_review" }, error: null }), select: () => ({ data: [{ id: "req-1" }], error: null }) },
      factory_cbds: { select: () => ({ data: [], error: null }), maybeSingle: () => ({ data: null, error: null }) },
      approval_actions: { insert: () => ({ data: [], error: null }) },
      workflow_events: { insert: () => ({ data: [], error: null }) },
      user_profiles: { select: () => ({ data: [], error: null }) },
      workflow_settings: { maybeSingle: () => ({ data: null, error: null }) },
    } as never);
    mocks.client = client;
    const r = await runCostingAction("req-1", "costing_clarify", "Yarn consumption looks 4× benchmark", "costing");
    expect(r.status).toBe("needs_clarification");
    expect(inserts(calls, "approval_actions")[0]).toMatchObject({ action: "costing_clarify" });
  });
});

describe("UAT — PBD approver (main user)", () => {
  it("PBD sees outlier flag and must wait for Costing acknowledgement (manual QA: red banner, Approve disabled)", async () => {
    const hist = [{ id: "h1", costing_request_id: "other", style_number: "M88-OLD", factory_name: "Cebu Factory", total_cost: 10, currency: "USD", approved_at: "2025-01-01T00:00:00Z", yarn_type: "100% Acrylic", knit_type: "Jacquard", machine_type: "7G", average_consumption: 0.2, knitting_time: 0.45 }];
    const { client } = createMockSupabase(uatResponder("for_pbd_review", {
      factory_cbds: {
        maybeSingle: (chain: { select: unknown }) => String(chain.select).includes("cbd_material_lines")
          ? { data: { id: "cbd-1", submitted_at: "2026-08-10T00:00:00Z", raw_payload: { grandTotal: 10, currency: "USD", yarnType: "100% Acrylic", knitType: "Jacquard", machineType: "7G", knittingTime: 0.45 }, cbd_material_lines: [{ consumption: 0.2, total_cost: 13, currency: "USD", material_name: "Yarn" }] }, error: null }
          : { data: { id: "cbd-1", raw_payload: { grandTotal: 10, currency: "USD" } }, error: null },
      },
      historical_costings: { select: () => ({ data: hist, error: null }), maybeSingle: () => ({ data: null, error: null }), delete: () => ({ data: [], error: null }), insert: () => ({ data: [], error: null }) },
      approval_actions: {
        maybeSingle: (chain: { eq?: [string, unknown][] }) => {
          const isAck = chain.eq?.some(([c, v]) => c === "action" && v === "outlier_acknowledged");
          if (isAck) return { data: null, error: null };
          return { data: { metadata: { decision: "pass" } }, error: null };
        },
        insert: () => ({ data: [], error: null }),
      },
    } as never));
    mocks.client = client;
    await expect(runCostingAction("req-1", "approve", null, "pbd")).rejects.toThrow("high-risk outlier flags");
  });

  it("PBD can approve when everything green — creates historical costing row and bumps customer status", async () => {
    const { client, calls } = createMockSupabase(uatResponder("for_pbd_review"));
    mocks.client = client;
    const r = await runCostingAction("req-1", "approve", "Costing verified — approve for customer", "pbd", "PBD Alex", "u-pbd");
    expect(r.status).toBe("approved");
    expect(inserts(calls, "historical_costings")).toHaveLength(1);
    expect(updates(calls, "costing_requests")[0]).toMatchObject({ status: "approved", customer_status: "pending_customer_submission" });
  });

  it("PBD clarifies → factory gets notification (UAT: Factory bell shows 'PBD requested clarification')", async () => {
    const { client, calls } = createMockSupabase({
      costing_requests: { single: () => ({ data: { status: "for_pbd_review" }, error: null }), select: () => ({ data: [{ id: "req-1" }], error: null }) },
      factory_cbds: { select: () => ({ data: [], error: null }), maybeSingle: () => ({ data: null, error: null }) },
      approval_actions: { insert: () => ({ data: [], error: null }) },
      workflow_events: { insert: () => ({ data: [], error: null }) },
      user_profiles: { select: () => ({ data: [{ email: "factory@cebu.ph" }], error: null }) },
      workflow_settings: { maybeSingle: () => ({ data: { value: {} }, error: null }) },
    } as never);
    mocks.client = client;
    const r = await runCostingAction("req-1", "clarify", "Yarn price needs breakdown", "pbd");
    expect(r.status).toBe("needs_clarification");
    expect(inserts(calls, "approval_actions")[0]).toMatchObject({ action: "clarify" });
  });

  it("role checks match the single PBD decision shown in the UI", async () => {
    expect(assertActionAllowed("manager_approve", "pbd")).toBe("Invalid action");
    expect(assertActionAllowed("manager_approve", "manager")).toBe("Invalid action");
    expect(assertActionAllowed("approve", "pbd")).toBeNull();
  });
});

describe("UAT — End-to-end create → approve → export (smoke)", () => {
  it("calculates correct landed & wholesale for the register export row", () => {
    // What finance sees in register.xlsx: one row per approved costing
    const totals = calculateCostingTotals({
      rawPayload: { currency: "USD", freightCost: 0.4, dutyRate: 12, insuranceCost: 0.08, wholesaleMarkup: 2.2, retailMarkup: 2.3, factoryCostTotal: 5.2 },
      lines: [{ total_cost: 5.2, currency: "USD" }],
    });
    expect(totals.grandTotal).toBeCloseTo(5.2);
    expect(totals.landedCost).toBeCloseTo(5.2 + 0.4 + 0.08 + (5.2 + 0.4 + 0.08) * 0.12, 2);
    expect(totals.wholesalePrice).toBeCloseTo(totals.landedCost * 2.2, 2);
    expect(totals.retailPrice).toBeCloseTo(totals.wholesalePrice * 2.3, 2);
  });

  it("validation info vs warning vs error map to the banner colours the user sees", () => {
    const issues = validateFactoryCbd({
      costingRequestId: "req-1", status: "submitted", currency: "USD", laborCost: "", overheadCost: "", moq: "", leadTimeDays: "", materialBufferPercent: "", packagingCost: "", testingCost: "",
      brandNominatedItems: "", m88Packaging: "", yarnType: "", knitType: "", machineType: "",
      lines: [],
    } as unknown as Parameters<typeof validateFactoryCbd>[0]);
    const severities = new Set(issues.map((i) => i.severity));
    expect(severities.has("warning")).toBe(true); // yellow banner
    expect(hasBlockingIssues(issues)).toBe(false); // no red blocker yet
    // But missing unit cost is red
    const withBadLine = validateFactoryCbd({
      costingRequestId: "req-1", status: "submitted", currency: "USD", laborCost: "1", overheadCost: "1", moq: "100", leadTimeDays: "30", materialBufferPercent: "5", packagingCost: "0.1", testingCost: "0.1",
      brandNominatedItems: "None", m88Packaging: "Std", yarnType: "Cotton", knitType: "Jersey", machineType: "Flat",
      lines: [{ materialName: "", unitCost: "", consumption: "1" }],
    } as unknown as Parameters<typeof validateFactoryCbd>[0]);
    expect(hasBlockingIssues(withBadLine)).toBe(true); // red blocker
  });
});
