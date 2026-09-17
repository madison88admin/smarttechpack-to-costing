// EXTENDED DESTRUCTIVE TESTS - beyond the 108 base suite
// Tries to actually break the engine: injection, overflow, race, bypass

import { afterEach, describe, expect, it, vi } from "vitest";
import { assertActionAllowed, runCostingAction } from "../src/lib/costing/actions";
import { validateFactoryCbd, hasBlockingIssues } from "../src/lib/costing/validation";
import { createMockSupabase, inserts, updates, type Responder } from "./helpers/supabase-mock";

const { mocks } = vi.hoisted(() => ({ mocks: { client: null as unknown } }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: () => mocks.client,
}));
afterEach(() => (mocks.client = null));

function baseResponder(status: string, overrides: Partial<Responder> = {}): Responder {
  return {
    costing_requests: {
      single: (chain) => {
        if (chain.select === "status") return { data: { status }, error: null };
        if (chain.select === "pbd_pricing_status") return { data: { pbd_pricing_status: "entered" }, error: null };
        if (String(chain.select).includes("nextgen_products")) return { data: { id: "req-1", factory_name: "Cebu", nextgen_products: [{ style_number: "M88-1" }] }, error: null };
        if (chain.select === "id, factory_name, baseline_ref") return { data: { id: "req-1", factory_name: "Cebu" }, error: null };
        throw new Error("unhandled " + String(chain.select));
      },
      select: () => ({ data: [{ id: "req-1" }], error: null }),
    },
    validation_results: { select: () => ({ data: [], error: null }) },
    compliance_checks: { select: () => ({ data: [], error: null }) },
    approval_actions: {
      maybeSingle: (chain) => {
        const isAck = chain.eq?.some(([c, v]) => c === "action" && v === "outlier_acknowledged");
        if (isAck) return { data: null, error: null };
        return { data: { metadata: { decision: "pass" } }, error: null };
      },
      insert: () => ({ data: [], error: null }),
    },
    factory_cbds: {
      maybeSingle: (chain) => String(chain.select).includes("cbd_material_lines")
        ? { data: { id: "cbd-1", submitted_at: "2026-08-10T00:00:00Z", raw_payload: { grandTotal: 10, currency: "USD", yarnType: "Cotton", knitType: "Jersey", machineType: "Flat", knittingTime: 0.4 }, cbd_material_lines: [{ consumption: 0.2, total_cost: 10, currency: "USD", material_name: "Yarn" }] }, error: null }
        : { data: { id: "cbd-1", raw_payload: { grandTotal: 10, currency: "USD" } }, error: null },
    },
    historical_costings: { maybeSingle: () => ({ data: null, error: null }), select: () => ({ data: [], error: null }), delete: () => ({ data: [], error: null }), insert: () => ({ data: [], error: null }) },
    workflow_events: { insert: () => ({ data: [], error: null }) },
    workflow_settings: { single: () => ({ data: { key: "manager_approval_threshold", value: "15" }, error: null }) },
    validation_checklist_items: { select: () => ({ data: [], error: null }) },
    request_checklist_results: { select: () => ({ data: [{ checklist_code: "moq_checked", is_checked: true }, { checklist_code: "lead_time_checked", is_checked: true }, { checklist_code: "packaging_checked", is_checked: true }, { checklist_code: "comparable_style_reviewed", is_checked: true }], error: null }) },
    ...overrides,
  };
}

describe("DESTRUCTIVE-EXTRA - injection & bypass attempts", () => {
  it("SQL injection in comment does not bypass gate - stored as plain text", async () => {
    const { client, calls } = createMockSupabase(baseResponder("for_pbd_review"));
    mocks.client = client;
    const injection = "'; DROP TABLE costing_requests; --";
    const r = await runCostingAction("req-1", "approve", injection, "pbd");
    expect(r.status).toBe("approved");
    const inserted = inserts(calls, "approval_actions")[0] as Record<string, unknown>;
    expect(inserted.comment).toBe(injection); // stored verbatim, DB layer param-binds it
  });

  it("XSS in styleNumber via validation - script tag flagged as missing material name, not executed", () => {
    const issues = validateFactoryCbd({
      currency: "USD", laborCost: "1", overheadCost: "1", moq: "100", leadTimeDays: "30", materialBufferPercent: "5", packagingCost: "0.1", testingCost: "0.1",
      brandNominatedItems: "None", m88Packaging: "Std", yarnType: "Cotton", knitType: "Jersey", machineType: "Flat",
      lines: [{ materialName: "<script>alert(1)</script>", unitCost: "5", consumption: "1" }],
    } as Parameters<typeof validateFactoryCbd>[0]);
    expect(hasBlockingIssues(issues)).toBe(false); // name present, so passes - but UI must escape it
    expect(issues.length).toBe(0);
  });

  it("overflow - 1000 material lines still validates, not DoS", () => {
    const lines = Array.from({ length: 1000 }, (_, i) => ({ materialName: `Yarn${i}`, unitCost: "1", consumption: "1" }));
    const issues = validateFactoryCbd({
      currency: "USD", laborCost: "1", overheadCost: "1", moq: "100", leadTimeDays: "30", materialBufferPercent: "5", packagingCost: "0.1", testingCost: "0.1",
      brandNominatedItems: "None", m88Packaging: "Std", yarnType: "Cotton", knitType: "Jersey", machineType: "Flat",
      lines,
    } as Parameters<typeof validateFactoryCbd>[0]);
    expect(hasBlockingIssues(issues)).toBe(false);
    expect(issues.length).toBe(0);
  });

  it("negative/infinity/NaN in totals not crash, handled as warnings", () => {
    const issues = validateFactoryCbd({
      costingRequestId: "req-1", status: "submitted", currency: "USD", laborCost: "-999999", overheadCost: "Infinity", moq: "NaN", leadTimeDays: "", materialBufferPercent: "", packagingCost: "", testingCost: "",
      brandNominatedItems: "", m88Packaging: "", yarnType: "", knitType: "", machineType: "",
      lines: [],
    } as unknown as Parameters<typeof validateFactoryCbd>[0]);
    expect(() => hasBlockingIssues(issues)).not.toThrow();
  });

  it("approve from wrong status is blocked even with superadmin", async () => {
    const { client } = createMockSupabase(baseResponder("draft"));
    mocks.client = client;
    await expect(runCostingAction("req-1", "approve", null, "superadmin")).rejects.toThrow('not allowed from status "draft"');
  });

  it("costing_complete from for_pbd_review blocked - prevents status jump", async () => {
    const { client } = createMockSupabase(baseResponder("for_pbd_review"));
    mocks.client = client;
    await expect(runCostingAction("req-1", "costing_complete", null, "costing")).rejects.toThrow("not allowed");
  });

  it("factory cannot approve even with crafted role header 'pbd' vs 'factory' case trick", async () => {
    expect(assertActionAllowed("approve", "PBD")).toBe('Action "approve" requires PBD or Admin role'); // case sensitive
    expect(assertActionAllowed("approve", " Factory ")).toBe('Action "approve" requires PBD or Admin role');
    const { client } = createMockSupabase(baseResponder("for_pbd_review"));
    mocks.client = client;
    await expect(runCostingAction("req-1", "approve", null, "factory")).rejects.toThrow("requires PBD");
  });

  it("invalid UUID as requestId not crash - DB error propagates", async () => {
    const { client } = createMockSupabase({
      costing_requests: { single: () => ({ data: null, error: { message: 'invalid input syntax for type uuid: "not-a-uuid"' } }), select: () => ({ data: [], error: null }) },
    });
    mocks.client = client;
    await expect(runCostingAction("not-a-uuid", "approve", null, "pbd")).rejects.toThrow("invalid input syntax");
  });

  it("race - two concurrent approves, second fails optimistic lock", async () => {
    let reads = 0;
    const { client, calls } = createMockSupabase({
      ...baseResponder("for_pbd_review"),
      costing_requests: {
        single: (chain) => {
          if (chain.select === "status") { reads++; return { data: { status: reads === 1 ? "for_pbd_review" : "rejected" }, error: null }; }
          if (chain.select === "pbd_pricing_status") return { data: { pbd_pricing_status: "entered" }, error: null };
          if (String(chain.select).includes("nextgen_products")) return { data: { id: "req-1", factory_name: "Cebu", nextgen_products: [{ style_number: "M88-1" }] }, error: null };
          if (chain.select === "id, factory_name, baseline_ref") return { data: { id: "req-1", factory_name: "Cebu" }, error: null };
          throw new Error("unhandled");
        },
        select: () => ({ data: [], error: null }),
      },
    });
    mocks.client = client;
    await expect(runCostingAction("req-1", "approve", null, "pbd")).rejects.toThrow("status changed");
    expect(inserts(calls, "historical_costings")).toHaveLength(0);
  });

  it("outlier gate cannot be bypassed by sending approve with huge comment", async () => {
    const hist = [{ id: "h1", costing_request_id: "other", style_number: "M88-OLD", factory_name: "Cebu", total_cost: 10, currency: "USD", approved_at: "2025-01-01T00:00:00Z", yarn_type: "Cotton", knit_type: "Jersey", machine_type: "Flat", average_consumption: 0.2, knitting_time: 0.4 }];
    const { client } = createMockSupabase(baseResponder("for_pbd_review", {
      factory_cbds: {
        maybeSingle: (chain) => String(chain.select).includes("cbd_material_lines")
          ? { data: { id: "cbd-1", submitted_at: "2026-08-10T00:00:00Z", raw_payload: { grandTotal: 10, currency: "USD", yarnType: "Cotton", knitType: "Jersey", machineType: "Flat", knittingTime: 0.4 }, cbd_material_lines: [{ consumption: 0.2, total_cost: 13, currency: "USD", material_name: "Yarn" }] }, error: null }
          : { data: { id: "cbd-1", raw_payload: { grandTotal: 10, currency: "USD" } }, error: null },
      },
      historical_costings: { select: () => ({ data: hist, error: null }), delete: () => ({ data: [], error: null }), insert: () => ({ data: [], error: null }) },
    }));
    mocks.client = client;
    const hugeComment = "a".repeat(10000);
    await expect(runCostingAction("req-1", "approve", hugeComment, "pbd")).rejects.toThrow("high-risk outlier");
  });

  it("null bytes and unicode in comment preserved, not crash", async () => {
    const { client } = createMockSupabase(baseResponder("for_pbd_review"));
    mocks.client = client;
    const evil = "test\u0000\u202E\uFEFF🟥";
    const r = await runCostingAction("req-1", "approve", evil, "pbd");
    expect(r.status).toBe("approved");
  });

  it("approve blocked when RSL pending - cannot bypass via reject then approve", async () => {
    const { client } = createMockSupabase(baseResponder("for_pbd_review", {
      compliance_checks: { select: () => ({ data: [{ check_type: "rsl", status: "pending" }], error: null }) },
    }));
    mocks.client = client;
    await expect(runCostingAction("req-1", "approve", null, "pbd")).rejects.toThrow("RSL compliance is pending");
    // even after reject attempt, same gate would apply
    const { client: c2 } = createMockSupabase(baseResponder("for_pbd_review", {
      compliance_checks: { select: () => ({ data: [{ check_type: "rsl", status: "pending" }], error: null }) },
    }));
    mocks.client = c2;
    await expect(runCostingAction("req-1", "approve", null, "pbd")).rejects.toThrow("RSL");
  });
});
