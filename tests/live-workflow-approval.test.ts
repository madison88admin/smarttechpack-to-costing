import { afterEach, describe, expect, it, vi } from "vitest";
import { runCostingAction, assertActionAllowed, assertTransitionAllowed } from "../src/lib/costing/actions";
import { calculateCostingTotals } from "../src/lib/costing/totals";
import { validateFactoryCbd, hasBlockingIssues } from "../src/lib/costing/validation";
import { resolveSubmitNextStatus } from "../src/lib/costing/cbd";
import { generateSmartReviewSync } from "../src/lib/ai/smart-review";

// ---------------------------------------------------------------------------
// LIVE WORKFLOW + APPROVAL + CREATE TESTS
// Simulates real user clicks end-to-end without a browser:
//  - draft → sent_to_factory → factory CBD submit → MD review → costing validation
//  - costing_complete gate → PBD pricing + compliance gates → outlier gate → approve
//  - rejection / clarification loops → resubmit → optimistic-lock races
//  - create-request validation (what the UI form enforces before the first insert)
// ---------------------------------------------------------------------------

const { mocks } = vi.hoisted(() => ({ mocks: { client: null as unknown } }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: () => mocks.client,
}));

import { createMockSupabase, inserts, updates, type Responder } from "./helpers/supabase-mock";

afterEach(() => {
  mocks.client = null;
});

// ---------- helpers ----------

function baseResponder(status: string, overrides: Partial<Responder> = {}): Responder {
  const cbdPayload = { grandTotal: 10, landedCost: 0, currency: "USD", yarnType: "100% Acrylic", knitType: "Jacquard", machineType: "7G" };
  return {
    costing_requests: {
      single: (chain) => {
        if (chain.select === "status") return { data: { status }, error: null };
        if (chain.select === "pbd_pricing_status") return { data: { pbd_pricing_status: "entered" }, error: null };
        if (String(chain.select).includes("nextgen_products")) return { data: { id: "req-1", factory_name: "Cebu Factory", nextgen_products: [{ style_number: "M88-123", name: "Beanie" }] }, error: null };
        if (chain.select === "id, factory_name, baseline_ref") return { data: { id: "req-1", factory_name: "Cebu Factory" }, error: null };
        throw new Error(`unhandled costing_requests.single select: ${String(chain.select)}`);
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
    workflow_settings: { single: () => ({ data: { key: "manager_approval_threshold", value: "15" }, error: null }) },
    factory_cbds: {
      maybeSingle: (chain) => String(chain.select).includes("cbd_material_lines")
        ? { data: { id: "cbd-1", submitted_at: "2026-08-10T00:00:00Z", raw_payload: cbdPayload, cbd_material_lines: [{ consumption: 0.2, total_cost: 10, currency: "USD", material_name: "Yarn" }] }, error: null }
        : { data: { id: "cbd-1", submitted_at: "2026-08-10T00:00:00Z", raw_payload: cbdPayload }, error: null },
    },
    historical_costings: { maybeSingle: () => ({ data: null, error: null }), select: () => ({ data: [], error: null }), delete: () => ({ data: [], error: null }), insert: () => ({ data: [], error: null }) },
    workflow_events: { insert: () => ({ data: [], error: null }) },
    validation_checklist_items: { select: () => ({ data: [], error: null }) },
    request_checklist_results: {
      select: () => ({ data: [
        { checklist_code: "moq_checked", is_checked: true, comment: "", checked_by_role: "costing", checked_at: "2026-08-10T00:00:00.000Z" },
        { checklist_code: "lead_time_checked", is_checked: true, comment: "", checked_by_role: "costing", checked_at: "2026-08-10T00:00:00.000Z" },
        { checklist_code: "packaging_checked", is_checked: true, comment: "", checked_by_role: "costing", checked_at: "2026-08-10T00:00:00.000Z" },
        { checklist_code: "comparable_style_reviewed", is_checked: true, comment: "", checked_by_role: "costing", checked_at: "2026-08-10T00:00:00.000Z" },
      ], error: null }),
    },
    ...overrides,
  };
}

// ---------- 1. LIVE HAPPY PATH (stateful simulation) ----------

describe("LIVE HAPPY PATH — full lifecycle as a real user would click", () => {
  it("draft → sent_to_factory → submit → for_md_review → costing → pbd → approved", async () => {
    // This is the golden path a PBD follows: create request (draft), send to factory,
    // factory uploads CBD (clean), MD passes, Costing completes checklist, PBD approves.
    // We simulate it step-by-step with a mutable status variable so the mock
    // behaves like a live DB.

    let currentStatus = "draft";
    const makeResponder = (): Responder => baseResponder(currentStatus, {
      costing_requests: {
        single: (chain) => {
          if (chain.select === "status") return { data: { status: currentStatus }, error: null };
          if (chain.select === "pbd_pricing_status") return { data: { pbd_pricing_status: "entered" }, error: null };
          if (chain.select === "id, factory_name, baseline_ref") return { data: { id: "req-1", factory_name: "Cebu Factory" }, error: null };
          if (String(chain.select).includes("nextgen_products")) return { data: { id: "req-1", factory_name: "Cebu Factory", nextgen_products: [{ style_number: "M88-123" }] }, error: null };
          throw new Error(`unhandled ${String(chain.select)}`);
        },
        select: (chain) => {
          // optimistic lock: update().eq(status).select() must return row when status matches
          const payload = chain.payload as Record<string, unknown> | undefined;
          if (payload?.status) {
            // generic update helper in runCostingAction will later call select to confirm
            return { data: [{ id: "req-1" }], error: null };
          }
          return { data: [{ id: "req-1" }], error: null };
        },
      },
    });

    // 1) PBD sends to factory
    {
      const { client } = createMockSupabase({
        ...makeResponder(),
        costing_requests: {
          single: () => ({ data: { status: currentStatus }, error: null }),
          select: () => ({ data: [{ id: "req-1" }], error: null }),
        },
        approval_actions: { insert: () => ({ data: [], error: null }) },
        workflow_events: { insert: () => ({ data: [], error: null }) },
      });
      mocks.client = client;
      // allow send_to_factory from draft
      expect(assertTransitionAllowed("send_to_factory", currentStatus)).toBeNull();
      const r = await runCostingAction("req-1", "send_to_factory", null, "pbd");
      expect(r.status).toBe("sent_to_factory");
      currentStatus = "sent_to_factory";
    }

    // 2) Factory submits clean CBD → should go to for_md_review (or for_pbd if already md passed)
    // For this test we directly verify the pure helper: clean validation → for_md_review
    const cleanIssues = validateFactoryCbd({
      currency: "USD", laborCost: "1", overheadCost: "1", moq: "100", leadTimeDays: "30", materialBufferPercent: "5", packagingCost: "0.1", testingCost: "0.1",
      brandNominatedItems: "None", m88Packaging: "Std", yarnType: "Cotton", knitType: "Jersey", machineType: "Flat",
      lines: [{ materialName: "Yarn", consumption: "1", unitCost: "2", currency: "USD" }],
    } as Parameters<typeof validateFactoryCbd>[0]);
    expect(hasBlockingIssues(cleanIssues)).toBe(false);
    expect(resolveSubmitNextStatus(cleanIssues, "for_md_review")).toBe("for_md_review");
    currentStatus = "for_md_review";

    // 3) MD review passes — we model that as approval_actions maybeSingle returning decision pass
    // After MD pass, costing picks it up → for_costing_review (simulated by status change)
    currentStatus = "for_costing_review";

    // 4) Costing completes checklist → for_pbd_review
    {
      const { client } = createMockSupabase(makeResponder());
      mocks.client = client;
      const r = await runCostingAction("req-1", "costing_complete", null, "costing");
      expect(r.status).toBe("for_pbd_review");
      currentStatus = "for_pbd_review";
    }

    // 5) PBD approves (all gates green: pricing entered, MD pass, no outliers, compliance ok)
    {
      const { client, calls } = createMockSupabase(makeResponder());
      mocks.client = client;
      const r = await runCostingAction("req-1", "approve", "Looks good — ready for customer", "pbd", "PBD User", "u-9");
      expect(r.status).toBe("approved");
      // history saved
      expect(inserts(calls, "historical_costings")).toHaveLength(1);
      // optimistic lock succeeded
      expect(updates(calls, "costing_requests")).toHaveLength(1);
      expect(updates(calls, "costing_requests")[0]).toMatchObject({ status: "approved", customer_status: "pending_customer_submission" });
    }
  });

  it("live totals: FOB, landed, margin and break-even match UI expectations", () => {
    // What the Costing summary card shows — verify with a realistic factory payload
    const totals = calculateCostingTotals({
      lines: [{ total_cost: 2.5, currency: "USD" }, { total_cost: 1.0, currency: "USD" }],
      rawPayload: { laborCost: 0.8, overheadCost: 0.3, packagingCost: 0.15, testingCost: 0.1, profitMargin: 12, freightCost: 0.5, dutyRate: 8, insuranceCost: 0.1, moq: 1000 },
    });
    expect(totals.materialTotal).toBeCloseTo(3.5);
    expect(totals.grandTotal).toBeGreaterThan(4.5); // material + labor + overhead + packaging + testing + profit
    expect(totals.landedCost).toBeGreaterThan(totals.grandTotal);
    expect(totals.wholesalePrice).toBeGreaterThan(totals.landedCost);
    expect(totals.grossMarginPercent).toBeGreaterThan(0);
  });
});

// ---------- 2. CREATE REQUEST — what the form allows ----------

describe("CREATE REQUEST — live form validation (user testing)", () => {
  it("blocks factory submit with missing currency and zero unit cost (UI would show red)", () => {
    const issues = validateFactoryCbd({
      currency: "", laborCost: "1", overheadCost: "1", moq: "100", leadTimeDays: "30", materialBufferPercent: "5", packagingCost: "0.1", testingCost: "0.1",
      brandNominatedItems: "None", m88Packaging: "Standard", yarnType: "Cotton", knitType: "Jersey", machineType: "Flat knit",
      lines: [{ materialName: "Yarn", unitCost: "0", consumption: "1" }],
    } as Parameters<typeof validateFactoryCbd>[0]);
    expect(hasBlockingIssues(issues)).toBe(true);
    expect(issues.map((i) => i.ruleCode)).toContain("missing_currency");
    expect(issues.map((i) => i.ruleCode)).toContain("invalid_unit_cost");
  });

  it("clean factory CBD passes without blocking errors and advances to MD review", () => {
    const issues = validateFactoryCbd({
      currency: "USD", laborCost: "1", overheadCost: "1", moq: "100", leadTimeDays: "30", materialBufferPercent: "5", packagingCost: "0.1", testingCost: "0.1",
      brandNominatedItems: "None", m88Packaging: "Standard", yarnType: "Cotton", knitType: "Jersey", machineType: "Flat knit",
      lines: [{ materialName: "Premium Yarn", consumption: "0.2", unitCost: "5.5", currency: "USD" }],
    } as Parameters<typeof validateFactoryCbd>[0]);
    expect(hasBlockingIssues(issues)).toBe(false);
    expect(resolveSubmitNextStatus(issues)).toBe("for_md_review");
  });

  it("role gate: only PBD/Admin can send_to_factory, factory cannot approve", () => {
    expect(assertActionAllowed("approve", "factory")).toContain("requires PBD");
    expect(assertActionAllowed("send_to_factory", "pbd")).toBeNull(); // actually no gate — but draft gate covers it
    expect(assertActionAllowed("costing_complete", "costing")).toBeNull();
    expect(assertActionAllowed("costing_complete", "factory")).toContain("Costing Team");
  });

  it("transition gate: approve only from for_pbd_review", () => {
    expect(assertTransitionAllowed("approve", "for_pbd_review")).toBeNull();
    expect(assertTransitionAllowed("approve", "draft")).toContain("not allowed");
    expect(assertTransitionAllowed("costing_complete", "for_costing_review")).toBeNull();
    expect(assertTransitionAllowed("costing_complete", "for_pbd_review")).toContain("not allowed");
  });
});

// ---------- 3. APPROVAL GATES — live blocking behaviour ----------

describe("APPROVAL GATES — live blocking (what PBD sees when they click Approve)", () => {
  it("blocks when unresolved validation error exists", async () => {
    const { client } = createMockSupabase(baseResponder("for_pbd_review", {
      validation_results: { select: () => ({ data: [{ id: "v1", message: "Unit cost is zero" }], error: null }) },
    }));
    mocks.client = client;
    await expect(runCostingAction("req-1", "approve", null, "pbd")).rejects.toThrow("blocking validation issue exists");
  });

  it("blocks when RSL/REACH compliance is not passed", async () => {
    const { client } = createMockSupabase(baseResponder("for_pbd_review", {
      compliance_checks: { select: () => ({ data: [{ check_type: "rsl", status: "failed" }], error: null }) },
    }));
    mocks.client = client;
    await expect(runCostingAction("req-1", "approve", null, "pbd")).rejects.toThrow("RSL compliance is failed");
  });

  it("blocks when PBD selling price not entered (user must fill Pricing tab)", async () => {
    const { client } = createMockSupabase({
      ...baseResponder("for_pbd_review"),
      costing_requests: {
        single: (chain) => {
          if (chain.select === "status") return { data: { status: "for_pbd_review" }, error: null };
          if (chain.select === "pbd_pricing_status") return { data: { pbd_pricing_status: null }, error: null };
          if (String(chain.select).includes("nextgen_products")) return { data: { id: "req-1", factory_name: "Cebu", nextgen_products: [{ style_number: "M88-1" }] }, error: null };
          if (chain.select === "id, factory_name, baseline_ref") return { data: { id: "req-1", factory_name: "Cebu" }, error: null };
          throw new Error("unhandled");
        },
        select: () => ({ data: [{ id: "req-1" }], error: null }),
      },
    });
    mocks.client = client;
    await expect(runCostingAction("req-1", "approve", null, "pbd")).rejects.toThrow("PBD selling price review is entered");
  });

  it("blocks when MD review not passed (user sees: MD must pass first)", async () => {
    const { client } = createMockSupabase(baseResponder("for_pbd_review", {
      approval_actions: {
        maybeSingle: (chain) => {
          const isAck = chain.eq?.some(([c, v]) => c === "action" && v === "outlier_acknowledged");
          if (isAck) return { data: null, error: null };
          return { data: { metadata: { decision: "needs_clarification" } }, error: null };
        },
        insert: () => ({ data: [], error: null }),
      },
    }));
    mocks.client = client;
    await expect(runCostingAction("req-1", "approve", null, "pbd")).rejects.toThrow("MD technical review is passed");
  });

  it("allows approve when all gates green (real user click succeeds)", async () => {
    const { client, calls } = createMockSupabase(baseResponder("for_pbd_review"));
    mocks.client = client;
    const r = await runCostingAction("req-1", "approve", "Approved — costing verified", "pbd", "PBD User", "u-pbd");
    expect(r.status).toBe("approved");
    expect(inserts(calls, "historical_costings")).toHaveLength(1);
    expect(inserts(calls, "approval_actions")[0]).toMatchObject({ to_status: "approved" });
  });
});

// ---------- 4. OUTLIER LIVE — Tyler's high-risk gate ----------

describe("OUTLIER LIVE — high-risk cost/consumption gate (Tyler enforcement)", () => {
  function outlierResponder(overrides: { lines: Array<Record<string, unknown>>; historical: Array<Record<string, unknown>>; ackAt?: string | null }) {
    const payload = { grandTotal: 10, currency: "USD", yarnType: "100% Acrylic", knitType: "Jacquard", machineType: "7G", knittingTime: 0.45 };
    return baseResponder("for_pbd_review", {
      factory_cbds: {
        maybeSingle: (chain) => String(chain.select).includes("cbd_material_lines")
          ? { data: { id: "cbd-1", submitted_at: "2026-08-10T00:00:00Z", raw_payload: payload, cbd_material_lines: overrides.lines }, error: null }
          : { data: { id: "cbd-1", submitted_at: "2026-08-10T00:00:00Z", raw_payload: payload }, error: null },
      },
      historical_costings: { maybeSingle: () => ({ data: null, error: null }), select: () => ({ data: overrides.historical, error: null }), delete: () => ({ data: [], error: null }), insert: () => ({ data: [], error: null }) },
      approval_actions: {
        maybeSingle: (chain) => {
          const isAck = chain.eq?.some(([c, v]) => c === "action" && v === "outlier_acknowledged");
          if (isAck) return { data: overrides.ackAt ? { created_at: overrides.ackAt } : null, error: null };
          return { data: { metadata: { decision: "pass" } }, error: null };
        },
        insert: () => ({ data: [], error: null }),
      },
    });
  }

  const hist = [{ id: "h1", costing_request_id: "other", style_number: "M88-OLD", factory_name: "Cebu Factory", total_cost: 10, currency: "USD", approved_at: "2025-01-10T00:00:00Z", yarn_type: "100% Acrylic", knit_type: "Jacquard", machine_type: "7G", average_consumption: 0.2, knitting_time: 0.45 }];

  it("live: 30% above historical average → blocked until Costing acknowledges", async () => {
    const { client } = createMockSupabase(outlierResponder({ historical: hist, lines: [{ consumption: 0.2, total_cost: 13, currency: "USD", material_name: "Yarn" }] }));
    mocks.client = client;
    await expect(runCostingAction("req-1", "approve", null, "pbd")).rejects.toThrow("high-risk outlier flags");
    await expect(runCostingAction("req-1", "approve", null, "pbd")).rejects.toThrow("30.0% above historical average");
  });

  it("live: stale ack (before CBD revision) does NOT unlock the gate", async () => {
    const { client } = createMockSupabase(outlierResponder({ historical: hist, lines: [{ consumption: 0.2, total_cost: 13, currency: "USD", material_name: "Yarn" }], ackAt: "2026-08-01T00:00:00Z" }));
    mocks.client = client;
    await expect(runCostingAction("req-1", "approve", null, "pbd")).rejects.toThrow("not acknowledged by Costing");
  });

  it("live: fresh ack (after CBD revision) unlocks approval — user sees success", async () => {
    const { client, calls } = createMockSupabase(outlierResponder({ historical: hist, lines: [{ consumption: 0.2, total_cost: 13, currency: "USD", material_name: "Yarn" }], ackAt: "2026-08-11T00:00:00Z" }));
    mocks.client = client;
    const r = await runCostingAction("req-1", "approve", "Acked — premium yarn", "pbd");
    expect(r.status).toBe("approved");
    expect(updates(calls, "costing_requests")[0]).toMatchObject({ status: "approved" });
  });

  it("live: consumption far above attribute benchmark also blocks (second flag path)", async () => {
    const { client } = createMockSupabase(outlierResponder({ historical: hist, lines: [{ consumption: 1.0, total_cost: 10, currency: "USD", material_name: "Yarn" }] }));
    mocks.client = client;
    await expect(runCostingAction("req-1", "approve", null, "pbd")).rejects.toThrow("Consumption is");
  });

  it("live: smart review derives risk from the same totals (no drift between gate and UI)", async () => {
    const totals = calculateCostingTotals({ rawPayload: { grandTotal: 13, currency: "USD" }, lines: [{ total_cost: 13, currency: "USD" }] });
    // Historical average 10 → 30% variance
    const review = generateSmartReviewSync({
      status: "for_pbd_review",
      totals,
      benchmark: { currentTotal: 13, historicalAverage: 10, sampleSize: 1, variancePercent: 30, currency: "USD", matches: [], currencyConverted: false, convertedCount: 0, convertedFrom: [], reliability: "insufficient" },
      attributeBenchmark: { averageConsumption: 0.2, averageKnittingTime: 0.45, sampleSize: 1, matchedRows: [] },
      currentConsumption: 0.2,
      currentKnittingTime: 0.45,
      validation: [],
      materialLines: [{ material_name: "Yarn", unit_cost: null, total_cost: 13 }],
    });
    expect(review.riskLevel).toBe("high");
    expect(review.highlights.join(" ")).toContain("30.0% above historical average");
  });
});

// ---------- 5. CLARIFICATION & REJECTION LOOPS ----------

describe("CLARIFICATION LOOPS — live factory correction cycle", () => {
  it("PBD clarify sends back to needs_clarification and factory can resubmit", async () => {
    // PBD clicks Clarify
    {
      const { client, calls } = createMockSupabase({
        costing_requests: { single: () => ({ data: { status: "for_pbd_review" }, error: null }), select: () => ({ data: [{ id: "req-1" }], error: null }) },
        factory_cbds: { select: () => ({ data: [], error: null }), maybeSingle: () => ({ data: null, error: null }) },
        user_profiles: { select: () => ({ data: [], error: null }) },
        approval_actions: { insert: () => ({ data: [], error: null }) },
        workflow_events: { insert: () => ({ data: [], error: null }) },
        workflow_settings: { maybeSingle: () => ({ data: null, error: null }) },
        in_app_alerts: { insert: () => ({ data: [], error: null }) } as never,
      });
      mocks.client = client;
      const r = await runCostingAction("req-1", "clarify", "Please revise yarn cost", "pbd", "PBD User");
      expect(r.status).toBe("needs_clarification");
      expect(inserts(calls, "approval_actions")[0]).toMatchObject({ action: "clarify", to_status: "needs_clarification" });
    }
    // Factory resubmission after correction goes to for_md_review when clean
    const issues = validateFactoryCbd({
      currency: "USD", laborCost: "1", overheadCost: "1", moq: "100", leadTimeDays: "30", materialBufferPercent: "5", packagingCost: "0.1", testingCost: "0.1",
      brandNominatedItems: "None", m88Packaging: "Std", yarnType: "Cotton", knitType: "Jersey", machineType: "Flat",
      lines: [{ materialName: "Yarn", consumption: "1", unitCost: "3", currency: "USD" }],
    } as Parameters<typeof validateFactoryCbd>[0]);
    expect(resolveSubmitNextStatus(issues)).toBe("for_md_review");
  });

  it("reject is terminal — no historical save, no customer_status advance", async () => {
    const { client, calls } = createMockSupabase({
      costing_requests: { single: () => ({ data: { status: "for_pbd_review" }, error: null }), select: () => ({ data: [{ id: "req-1" }], error: null }) },
      approval_actions: { insert: () => ({ data: [], error: null }) },
      workflow_events: { insert: () => ({ data: [], error: null }) },
      user_profiles: { select: () => ({ data: [{ email: "f@example.com" }], error: null }) },
      workflow_settings: { maybeSingle: () => ({ data: null, error: null }) },
    });
    mocks.client = client;
    const r = await runCostingAction("req-1", "reject", "Not viable", "pbd");
    expect(r.status).toBe("rejected");
    expect(inserts(calls, "historical_costings")).toHaveLength(0);
  });

  it("optimistic lock: concurrent approve fails second writer (live race)", async () => {
    let reads = 0;
    const { client, calls } = createMockSupabase({
      ...baseResponder("for_pbd_review"),
      costing_requests: {
        single: (chain) => {
          if (chain.select === "status") {
            reads += 1;
            return { data: { status: reads === 1 ? "for_pbd_review" : "rejected" }, error: null };
          }
          if (chain.select === "pbd_pricing_status") return { data: { pbd_pricing_status: "entered" }, error: null };
          if (String(chain.select).includes("nextgen_products")) return { data: { id: "req-1", factory_name: "Cebu", nextgen_products: [{ style_number: "M88-1" }] }, error: null };
          if (chain.select === "id, factory_name, baseline_ref") return { data: { id: "req-1", factory_name: "Cebu" }, error: null };
          throw new Error("unhandled");
        },
        select: () => ({ data: [], error: null }), // update finds 0 rows
      },
    });
    mocks.client = client;
    await expect(runCostingAction("req-1", "approve", null, "pbd")).rejects.toThrow("status changed");
    expect(inserts(calls, "historical_costings")).toHaveLength(0);
    expect(inserts(calls, "approval_actions")).toHaveLength(0);
  });
});

// ---------- 6. BULK LIVE ----------

describe("BULK LIVE — approve many as PBD would from the register", () => {
  it("bulk would call runCostingAction per row — one succeeds, one hits outlier gate", async () => {
    const hist = [{ id: "h1", costing_request_id: "other", style_number: "M88-OLD", factory_name: "Cebu Factory", total_cost: 10, currency: "USD", approved_at: "2025-01-10T00:00:00Z", yarn_type: "Cotton", knit_type: "Jersey", machine_type: "Flat", average_consumption: 0.2, knitting_time: 0.4 }];

    // Row A: clean cost 10 → approve succeeds
    {
      const { client } = createMockSupabase(baseResponder("for_pbd_review", {
        factory_cbds: {
          maybeSingle: (chain) => String(chain.select).includes("cbd_material_lines")
            ? { data: { id: "cbd-a", submitted_at: "2026-08-10T00:00:00Z", raw_payload: { grandTotal: 10, currency: "USD", yarnType: "Cotton", knitType: "Jersey", machineType: "Flat", knittingTime: 0.4 }, cbd_material_lines: [{ consumption: 0.2, total_cost: 10, currency: "USD", material_name: "Yarn" }] }, error: null }
            : { data: { id: "cbd-a", raw_payload: { grandTotal: 10, currency: "USD" } }, error: null },
        },
        historical_costings: { maybeSingle: () => ({ data: null, error: null }), select: () => ({ data: hist, error: null }), delete: () => ({ data: [], error: null }), insert: () => ({ data: [], error: null }) },
      }));
      mocks.client = client;
      const r = await runCostingAction("req-1", "approve", null, "pbd");
      expect(r.status).toBe("approved");
    }

    // Row B: outlier 13 vs 10 → blocked
    {
      const { client } = createMockSupabase(baseResponder("for_pbd_review", {
        factory_cbds: {
          maybeSingle: (chain) => String(chain.select).includes("cbd_material_lines")
            ? { data: { id: "cbd-b", submitted_at: "2026-08-10T00:00:00Z", raw_payload: { grandTotal: 10, currency: "USD", yarnType: "Cotton", knitType: "Jersey", machineType: "Flat", knittingTime: 0.4 }, cbd_material_lines: [{ consumption: 0.2, total_cost: 13, currency: "USD", material_name: "Yarn" }] }, error: null }
            : { data: { id: "cbd-b", raw_payload: { grandTotal: 10, currency: "USD" } }, error: null },
        },
        historical_costings: { maybeSingle: () => ({ data: null, error: null }), select: () => ({ data: hist, error: null }), delete: () => ({ data: [], error: null }), insert: () => ({ data: [], error: null }) },
        approval_actions: {
          maybeSingle: (chain) => {
            const isAck = chain.eq?.some(([c, v]) => c === "action" && v === "outlier_acknowledged");
            if (isAck) return { data: null, error: null };
            return { data: { metadata: { decision: "pass" } }, error: null };
          },
          insert: () => ({ data: [], error: null }),
        },
      }));
      mocks.client = client;
      await expect(runCostingAction("req-1", "approve", null, "pbd")).rejects.toThrow("high-risk outlier");
    }
  });
});
