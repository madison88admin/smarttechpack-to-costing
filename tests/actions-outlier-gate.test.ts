import { afterEach, describe, expect, it, vi } from "vitest";
import { runCostingAction } from "../src/lib/costing/actions";

// Tyler's "before PBD review" enforcement: PBD approval must be blocked while
// high-risk outliers are flagged (grand total far from historical average, or
// consumption/knitting time far above the attribute benchmark). Validation
// errors and compliance are separate gates; this one catches the outliers
// that used to be warning-only.

const { mocks } = vi.hoisted(() => ({ mocks: { client: null as unknown } }));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: () => mocks.client
}));

import { createMockSupabase, inserts, updates, type Responder } from "./helpers/supabase-mock";

afterEach(() => {
  mocks.client = null;
});

type HistRow = Record<string, unknown>;

function historicalRow(overrides: Partial<HistRow> = {}): HistRow {
  return {
    id: "h1",
    costing_request_id: "other-req",
    style_number: "M88-OLD",
    factory_name: "Cebu Factory",
    total_cost: 10,
    currency: "USD",
    approved_at: "2025-01-10T00:00:00Z",
    yarn_type: "100% Acrylic",
    knit_type: "Jacquard",
    machine_type: "7G",
    construction: "Rib",
    product_category: "Hats",
    average_consumption: 0.2,
    knitting_time: 0.45,
    benchmark_excluded: false,
    ...overrides
  };
}

function responder(overrides: {
  historical?: HistRow[];
  cbdPayload?: Record<string, unknown>;
  lines?: Array<Record<string, unknown>>;
  /** created_at of the latest outlier_acknowledged action (null = none). */
  acknowledgedAt?: string | null;
} = {}): Responder {
  const cbdPayload = overrides.cbdPayload ?? {
    grandTotal: 10,
    landedCost: 0,
    currency: "USD",
    yarnType: "100% Acrylic",
    knitType: "Jacquard",
    machineType: "7G",
    knittingTime: 0.45
  };
  const lines = overrides.lines ?? [{ consumption: 0.2, total_cost: 5, currency: "USD", material_name: "Yarn" }];
  const historical = overrides.historical ?? [];
  const acknowledgedAt = overrides.acknowledgedAt ?? null;

  return {
    costing_requests: {
      single: (chain) => {
        if (chain.select === "status") return { data: { status: "for_pbd_review" }, error: null };
        if (chain.select === "pbd_pricing_status") return { data: { pbd_pricing_status: "entered" }, error: null };
        if (chain.select === "id, factory_name, baseline_ref") return { data: { id: "req-1", factory_name: "Cebu Factory" }, error: null };
        if (String(chain.select).includes("nextgen_products")) {
          return {
            data: { id: "req-1", factory_name: "Cebu Factory", nextgen_products: [{ style_number: "M88-123", name: "Beanie" }] },
            error: null
          };
        }
        throw new Error(`unhandled costing_requests.single select: ${String(chain.select)}`);
      },
      select: () => ({ data: [{ id: "req-1" }], error: null })
    },
    validation_results: { select: () => ({ data: [], error: null }) },
    compliance_checks: { select: () => ({ data: [], error: null }) },
    approval_actions: {
      maybeSingle: (chain) => {
        const ackQuery = chain.eq?.some(([col, val]) => col === "action" && val === "outlier_acknowledged");
        if (ackQuery) {
          return { data: acknowledgedAt ? { created_at: acknowledgedAt } : null, error: null };
        }
        return { data: { metadata: { decision: "pass" } }, error: null };
      },
      insert: () => ({ data: [], error: null })
    },
    workflow_settings: { single: () => ({ data: { key: "manager_approval_threshold", value: "15" }, error: null }) },
    factory_cbds: {
      maybeSingle: (chain) =>
        String(chain.select).includes("cbd_material_lines")
          ? { data: { id: "cbd-1", submitted_at: "2026-08-10T00:00:00Z", raw_payload: cbdPayload, cbd_material_lines: lines }, error: null }
          : { data: { id: "cbd-1", submitted_at: "2026-08-10T00:00:00Z", raw_payload: cbdPayload }, error: null }
    },
    historical_costings: {
      maybeSingle: () => ({ data: null, error: null }),
      select: () => ({ data: historical, error: null }),
      delete: () => ({ data: [], error: null }),
      insert: () => ({ data: [], error: null })
    },
    workflow_events: { insert: () => ({ data: [], error: null }) }
  };
}

function checklistResponderForCosting(): Responder {
  return {
    costing_requests: {
      single: () => ({ data: { status: "for_costing_review" }, error: null }),
      select: () => ({ data: [{ id: "req-1" }], error: null })
    },
    validation_checklist_items: { select: () => ({ data: [], error: null }) },
    request_checklist_results: {
      select: () => ({
        data: [
          { checklist_code: "moq_checked", is_checked: true, comment: "", checked_by_role: "costing", checked_at: "2026-08-10T00:00:00.000Z" },
          { checklist_code: "lead_time_checked", is_checked: true, comment: "", checked_by_role: "costing", checked_at: "2026-08-10T00:00:00.000Z" },
          { checklist_code: "packaging_checked", is_checked: true, comment: "", checked_by_role: "costing", checked_at: "2026-08-10T00:00:00.000Z" },
          { checklist_code: "comparable_style_reviewed", is_checked: true, comment: "", checked_by_role: "costing", checked_at: "2026-08-10T00:00:00.000Z" }
        ],
        error: null
      })
    },
    approval_actions: { insert: () => ({ data: [], error: null }) },
    workflow_events: { insert: () => ({ data: [], error: null }) }
  };
}

describe("approve — outlier gate before PBD approval", () => {
  it("blocks approval when the grand total is far above the historical average", async () => {
    // Computed FOB 13 (line costs) vs historical average 10 → 30% variance.
    // calculateCostingTotals derives the total from lines, not raw.grandTotal.
    const { client, calls } = createMockSupabase(
      responder({
        historical: [historicalRow()],
        lines: [{ consumption: 0.2, total_cost: 13, currency: "USD", material_name: "Yarn" }]
      })
    );
    mocks.client = client;

    await expect(runCostingAction("req-1", "approve", null, "pbd")).rejects.toThrow(
      /Cannot approve while high-risk outlier flags are active/
    );
    await expect(runCostingAction("req-1", "approve", null, "pbd")).rejects.toThrow(
      /30\.0% above historical average/
    );

    // Nothing was updated or recorded — the gate halts before any mutation.
    expect(updates(calls, "costing_requests")).toHaveLength(0);
    expect(inserts(calls, "approval_actions")).toHaveLength(0);
    expect(inserts(calls, "historical_costings")).toHaveLength(0);
  });

  it("blocks approval when consumption is far above the attribute benchmark", async () => {
    // Consumption 1.0 vs attribute benchmark 0.2 → 400% variance; computed FOB
    // 10 (line costs) keeps the cost variance at 0% so only consumption triggers.
    const { client, calls } = createMockSupabase(
      responder({
        historical: [historicalRow()],
        lines: [{ consumption: 1.0, total_cost: 10, currency: "USD", material_name: "Yarn" }]
      })
    );
    mocks.client = client;

    await expect(runCostingAction("req-1", "approve", null, "pbd")).rejects.toThrow(
      /Cannot approve while high-risk outlier flags are active/
    );
    await expect(runCostingAction("req-1", "approve", null, "pbd")).rejects.toThrow(
      /Consumption is above attribute benchmark/
    );

    expect(updates(calls, "costing_requests")).toHaveLength(0);
  });

  it("allows approval when the cost is within normal historical variance", async () => {
    // Computed FOB 10.5 (line costs) vs average 10 → 5% variance — inside both
    // the warning (15) and review (8) bands.
    const { client, calls } = createMockSupabase(
      responder({
        historical: [historicalRow()],
        lines: [{ consumption: 0.2, total_cost: 10.5, currency: "USD", material_name: "Yarn" }]
      })
    );
    mocks.client = client;

    const result = await runCostingAction("req-1", "approve", "OK", "pbd");
    // PBD approve always routes to manager for final approval.
    expect(result).toEqual({ status: "approved" });
    expect(updates(calls, "costing_requests")[0]).toMatchObject({ status: "approved" });
    // No historical costing on intermediate routing — only on manager_approve.
    expect(inserts(calls, "historical_costings")).toHaveLength(1);
  });

  it("allows approval when there is no historical data to compare against", async () => {
    const { client } = createMockSupabase(responder({ historical: [] }));
    mocks.client = client;

    const result = await runCostingAction("req-1", "approve", null, "pbd");
    // PBD approve always routes to manager for final approval.
    expect(result).toEqual({ status: "approved" });
  });

  it("blocks approval even with an acknowledgment that predates the latest CBD revision", async () => {
    // The coster acknowledged, but the factory submitted a NEWER CBD after it:
    // the acknowledgment is stale and the gate must still block.
    const { client, calls } = createMockSupabase(
      responder({
        historical: [historicalRow()],
        lines: [{ consumption: 0.2, total_cost: 13, currency: "USD", material_name: "Yarn" }],
        acknowledgedAt: "2026-08-01T00:00:00Z" // before cbd submitted_at 2026-08-10
      })
    );
    mocks.client = client;

    await expect(runCostingAction("req-1", "approve", null, "pbd")).rejects.toThrow(
      /not acknowledged by Costing/
    );
    expect(updates(calls, "costing_requests")).toHaveLength(0);
  });

  it("allows approval when Costing acknowledged the current CBD revision's outliers", async () => {
    // 30% variance above historical average is flagged, but the coster has
    // acknowledged it AFTER the latest CBD submission → the gate releases.
    const { client, calls } = createMockSupabase(
      responder({
        historical: [historicalRow()],
        lines: [{ consumption: 0.2, total_cost: 13, currency: "USD", material_name: "Yarn" }],
        acknowledgedAt: "2026-08-11T00:00:00Z" // after cbd submitted_at 2026-08-10
      })
    );
    mocks.client = client;

    const result = await runCostingAction("req-1", "approve", "Understood", "pbd");
    // PBD approve always routes to manager for final approval.
    expect(result).toEqual({ status: "approved" });
    expect(updates(calls, "costing_requests")[0]).toMatchObject({ status: "approved" });
    // No historical costing on intermediate routing — only on manager_approve.
    expect(inserts(calls, "historical_costings")).toHaveLength(1);
  });

  it("does not apply the gate to costing_complete (costing validation, not PBD approval)", async () => {
    const { client, calls } = createMockSupabase(checklistResponderForCosting());
    mocks.client = client;

    const result = await runCostingAction("req-1", "costing_complete", null, "costing");
    expect(result).toEqual({ status: "for_pbd_review" });
    expect(updates(calls, "costing_requests")[0]).toMatchObject({ status: "for_pbd_review" });
  });
});
