import { afterEach, describe, expect, it, vi } from "vitest";
import { runCostingAction } from "../src/lib/costing/actions";

// ---------------------------------------------------------------------------
// Integration-style tests for runCostingAction with a mocked Supabase client.
// The fake reproduces the chainable PostgREST API (.from().select().eq()...)
// and routes every terminal call through a per-table responder, so tests can
// drive threshold routing, optimistic-lock races, checklist/compliance/pricing
// gates, and the historical-costing save without a database.
// ---------------------------------------------------------------------------

const { mocks } = vi.hoisted(() => ({ mocks: { client: null as unknown } }));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: () => mocks.client
}));

import { createMockSupabase, inserts, updates, type Responder } from "./helpers/supabase-mock";

afterEach(() => {
  mocks.client = null;
});

// Shared responder for a normal approve: request in for_pbd_review, everything
// green, threshold 15, CBD total 10 (under threshold).
function approveResponder(overrides: Partial<Responder> = {}): Responder {
  const cbdPayload = { grandTotal: 10, landedCost: 0, currency: "USD" };
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
      maybeSingle: () => ({ data: { metadata: { decision: "pass" } }, error: null }),
      insert: () => ({ data: [], error: null })
    },
    factory_cbds: {
      maybeSingle: (chain) =>
        String(chain.select).includes("cbd_material_lines")
          ? { data: { id: "cbd-1", raw_payload: cbdPayload, cbd_material_lines: [{ consumption: 1, total_cost: 5, currency: "USD", material_name: "Yarn" }] }, error: null }
          : { data: { id: "cbd-1", raw_payload: cbdPayload }, error: null }
    },
    historical_costings: {
      maybeSingle: () => ({ data: null, error: null }),
      delete: () => ({ data: [], error: null }),
      insert: () => ({ data: [], error: null })
    },
    workflow_events: { insert: () => ({ data: [], error: null }) },
    ...overrides
  };
}

describe("runCostingAction — pre-DB gates", () => {
  it("preserves the previous historical snapshot when replacement fails", async () => {
    const { client, calls } = createMockSupabase(approveResponder({ historical_costings: {
      maybeSingle: () => ({ data: { id: "history-existing" }, error: null }),
      select: () => ({ data: null, error: new Error("history write failed") })
    } }));
    mocks.client = client;
    await expect(runCostingAction("req-1", "approve", null, "pbd")).rejects.toThrow("history write failed");
    expect(calls.filter(call => call.table === "historical_costings" && call.terminal === "delete")).toHaveLength(0);
  });
  it("rejects an unknown action without touching the database", async () => {
    const { client, calls } = createMockSupabase({});
    mocks.client = client;
    await expect(runCostingAction("req-1", "explode", null, "pbd")).rejects.toThrow("Invalid action");
    expect(calls).toHaveLength(0);
  });

  it("rejects a role violation before querying the current status", async () => {
    const { client, calls } = createMockSupabase({});
    mocks.client = client;
    await expect(runCostingAction("req-1", "approve", null, "factory")).rejects.toThrow(
      'Action "approve" requires PBD or Admin role'
    );
    expect(calls).toHaveLength(0);
  });

  it("rejects a transition that is not allowed from the current status", async () => {
    const { client, calls } = createMockSupabase({
      costing_requests: { single: () => ({ data: { status: "draft" }, error: null }) }
    });
    mocks.client = client;
    await expect(runCostingAction("req-1", "submit", null, "factory")).rejects.toThrow(
      'Action "submit" is not allowed from status "draft". Allowed from: sent_to_factory, needs_clarification'
    );
    expect(calls).toHaveLength(1); // only the status read happened
  });
});

describe("approve — single PBD decision", () => {
  it("approves and saves history regardless of the retired threshold", async () => {
    const { client, calls } = createMockSupabase(approveResponder());
    mocks.client = client;

    const result = await runCostingAction("req-1", "approve", "Looks good", "pbd", "PBD User", "u-1");

    expect(result).toEqual({ status: "approved" });

    // PBD is the final internal approval owner.
    const requestUpdates = updates(calls, "costing_requests");
    expect(requestUpdates).toHaveLength(1);
    expect(requestUpdates[0]).toMatchObject({ status: "approved" });

    expect(inserts(calls, "historical_costings")).toHaveLength(1);

    // Approval is recorded with immutable actor identity.
    const actionInserts = inserts(calls, "approval_actions");
    expect(actionInserts).toHaveLength(1);
    expect(actionInserts[0]).toMatchObject({
      action: "approve",
      from_status: "for_pbd_review",
      to_status: "approved",
      actor_role: "pbd",
      actor_name: "PBD User",
      actor_user_id: "u-1",
      comment: "Looks good"
    });

    // Workflow event recorded.
    expect(inserts(calls, "workflow_events")).toHaveLength(1);
  });

  it("does not create a second Manager stage when cost exceeds a legacy threshold", async () => {
    const { client, calls } = createMockSupabase(
      approveResponder({
        factory_cbds: {
          maybeSingle: () => ({
            data: { id: "cbd-1", raw_payload: { grandTotal: 30, landedCost: 0, currency: "USD" } },
            error: null
          })
        }
      })
    );
    mocks.client = client;

    const result = await runCostingAction("req-1", "approve", null, "pbd");

    expect(result).toEqual({ status: "approved" });

    // The single PBD decision saves history and advances the workflow.
    expect(inserts(calls, "historical_costings")).toHaveLength(1);
    const actionInserts = inserts(calls, "approval_actions");
    expect(actionInserts).toHaveLength(1);
    expect(actionInserts[0]).toMatchObject({ action: "approve", to_status: "approved" });

    const requestUpdates = updates(calls, "costing_requests");
    expect(requestUpdates).toHaveLength(1);
    expect(requestUpdates[0]).toMatchObject({ status: "approved" });
  });

  it("approves even when landed cost differs from the factory total", async () => {
    const { client, calls } = createMockSupabase(
      approveResponder({
        factory_cbds: {
          maybeSingle: () => ({
            data: { id: "cbd-1", raw_payload: { grandTotal: 5, landedCost: 100, currency: "USD" } },
            error: null
          })
        }
      })
    );
    mocks.client = client;

    const result = await runCostingAction("req-1", "approve", null, "pbd");

    expect(result).toEqual({ status: "approved" });
  });

  // Approval has no second gate at any spend: the retired threshold setting is
  // gone from the code and its workflow_settings row from the database. No
  // workflow_settings.single handler is registered below, and the shared mock
  // throws on an unhandled single() read — so reintroducing a threshold lookup
  // fails here instead of silently routing every approval back for a second look.
  it("never consults a separate approval-threshold setting", async () => {
    const { client, calls } = createMockSupabase(approveResponder({}));
    mocks.client = client;

    const result = await runCostingAction("req-1", "approve", null, "pbd");
    expect(result).toEqual({ status: "approved" });

    expect(inserts(calls, "historical_costings")).toHaveLength(1);
    expect(calls.filter((call) => call.table === "workflow_settings" && call.terminal === "single")).toEqual([]);
  });

  // The historical row is what the Like Styles machine table averages, so the
  // approval must snapshot the cost basis and the real selling price it was
  // approved at — the PBD price first, then the NextGen-ported one.
  it("snapshots the landed cost and the real selling price on the historical row", async () => {
    const { client, calls } = createMockSupabase(
      approveResponder({
        costing_requests: {
          single: (chain) => {
            if (chain.select === "status") return { data: { status: "for_pbd_review" }, error: null };
            if (chain.select === "pbd_pricing_status") return { data: { pbd_pricing_status: "entered" }, error: null };
            if (String(chain.select).includes("nextgen_products")) {
              return {
                data: {
                  id: "req-1",
                  factory_name: "Cebu Factory",
                  pbd_pricing: { wholesalePrice: 12 },
                  nextgen_products: [{ style_number: "M88-123", name: "Beanie", raw_payload: { DefaultProductCostingCostingSellingPrice: "3.75" } }]
                },
                error: null
              };
            }
            return { data: { id: "req-1", factory_name: "Cebu Factory" }, error: null };
          },
          select: () => ({ data: [{ id: "req-1" }], error: null })
        },
        factory_cbds: {
          maybeSingle: () => ({
            data: {
              id: "cbd-1",
              raw_payload: { grandTotal: 10, freightCost: 2, currency: "USD" },
              cbd_material_lines: [{ consumption: 1, total_cost: 5, currency: "USD", material_name: "Yarn" }]
            },
            error: null
          })
        }
      })
    );
    mocks.client = client;

    await runCostingAction("req-1", "approve", null, "pbd");

    const row = inserts(calls, "historical_costings")[0] as Record<string, unknown>;
    // Landed cost adds the freight the CBD recorded on top of the line-derived
    // FOB total (5 material + 2 freight).
    expect(row.landed_cost).toBe(7);
    // PBD's own price wins over the NextGen-ported 3.75.
    expect(row.selling_price).toBe(12);
  });

  it("falls back to the NextGen selling price when PBD entered none", async () => {
    const { client, calls } = createMockSupabase(
      approveResponder({
        costing_requests: {
          single: (chain) => {
            if (chain.select === "status") return { data: { status: "for_pbd_review" }, error: null };
            if (chain.select === "pbd_pricing_status") return { data: { pbd_pricing_status: "entered" }, error: null };
            if (String(chain.select).includes("nextgen_products")) {
              return {
                data: {
                  id: "req-1",
                  factory_name: "Cebu Factory",
                  pbd_pricing: {},
                  nextgen_products: [{ style_number: "M88-123", name: "Beanie", raw_payload: { DefaultProductCostingCostingSellingPrice: "3.75" } }]
                },
                error: null
              };
            }
            return { data: { id: "req-1", factory_name: "Cebu Factory" }, error: null };
          },
          select: () => ({ data: [{ id: "req-1" }], error: null })
        }
      })
    );
    mocks.client = client;

    await runCostingAction("req-1", "approve", null, "pbd");

    expect((inserts(calls, "historical_costings")[0] as Record<string, unknown>).selling_price).toBe(3.75);
  });

  // Deploying the app before the migration is applied must never block an
  // approval: the costing is saved without the cost columns and picks them up
  // on the next write.
  it("saves the historical row without the cost columns while migration 018 is pending", async () => {
    let attempts = 0;
    const { client, calls } = createMockSupabase(
      approveResponder({
        historical_costings: {
          maybeSingle: () => ({ data: null, error: null }),
          insert: () => {
            attempts += 1;
            return attempts === 1
              ? { data: null, error: { message: 'column "landed_cost" of relation "historical_costings" does not exist' } }
              : { data: [], error: null };
          }
        }
      })
    );
    mocks.client = client;

    const result = await runCostingAction("req-1", "approve", null, "pbd");

    expect(result).toEqual({ status: "approved" });
    const rows = inserts(calls, "historical_costings") as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveProperty("landed_cost");
    expect(rows[1]).not.toHaveProperty("landed_cost");
    expect(rows[1]).not.toHaveProperty("selling_price");
    // Everything else about the expensive snapshot is still recorded.
    expect(rows[1]).toMatchObject({ style_number: "M88-123", factory_name: "Cebu Factory" });
  });
});

describe("approve — optimistic-lock races", () => {
  it("fails when another user changed the status between read and final update", async () => {
    let statusReads = 0;
    const { client, calls } = createMockSupabase(
      approveResponder({
        costing_requests: {
          single: (chain) => {
            if (chain.select === "status") {
              statusReads += 1;
              return { data: { status: statusReads === 1 ? "for_pbd_review" : "rejected" }, error: null };
            }
            if (chain.select === "pbd_pricing_status") return { data: { pbd_pricing_status: "entered" }, error: null };
            if (chain.select === "id, factory_name, baseline_ref") return { data: { id: "req-1", factory_name: "Cebu Factory" }, error: null };
            if (String(chain.select).includes("nextgen_products")) {
              return {
                data: { id: "req-1", factory_name: "Cebu Factory", nextgen_products: [{ style_number: "M88-123", name: "Beanie" }] },
                error: null
              };
            }
            throw new Error(`unexpected single select: ${String(chain.select)}`);
          },
          select: () => ({ data: [], error: null }) // optimistic lock finds no rows
        }
      })
    );
    mocks.client = client;

    await expect(runCostingAction("req-1", "approve", null, "pbd")).rejects.toThrow(
      "Action \"approve\" failed — request status changed"
    );

    // Nothing was recorded and no event emitted — and crucially, no historical
    // costing row either: history is saved only after the optimistic lock wins.
    expect(inserts(calls, "approval_actions")).toHaveLength(0);
    expect(inserts(calls, "workflow_events")).toHaveLength(0);
    expect(inserts(calls, "historical_costings")).toHaveLength(0);
  });

  it.skip("legacy threshold-routing race (manager is part of PBD approval)", async () => {
    const { client, calls } = createMockSupabase(
      approveResponder({
        factory_cbds: {
          maybeSingle: () => ({
            data: { id: "cbd-1", raw_payload: { grandTotal: 30, landedCost: 0, currency: "USD" } },
            error: null
          })
        },
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
            throw new Error(`unexpected single select: ${String(chain.select)}`);
          },
          select: (chain) =>
            (chain.payload as { status?: string } | undefined)?.status === "pending_manager_approval"
              ? { data: [], error: null } // threshold update lost the race
              : { data: [{ id: "req-1" }], error: null }
        }
      })
    );
    mocks.client = client;

    await expect(runCostingAction("req-1", "approve", null, "pbd")).rejects.toThrow(
      "Approval failed — request status changed by another user. Please refresh and try again."
    );
    expect(inserts(calls, "approval_actions")).toHaveLength(0);
  });
});

describe("costing_complete — checklist gate", () => {
  function checklistResponder(checkedCodes: string[]) {
    return {
      costing_requests: {
        single: () => ({ data: { status: "for_costing_review" }, error: null }),
        select: () => ({ data: [{ id: "req-1" }], error: null })
      },
      validation_checklist_items: { select: () => ({ data: [], error: null }) }, // falls back to the 4 defaults
      request_checklist_results: {
        select: () => ({
          data: checkedCodes.map((code) => ({
            checklist_code: code,
            is_checked: true,
            comment: "",
            checked_by_role: "costing",
            checked_at: "2026-08-10T00:00:00.000Z"
          })),
          error: null
        })
      },
      approval_actions: { insert: () => ({ data: [], error: null }) },
      workflow_events: { insert: () => ({ data: [], error: null }) }
    };
  }

  it("blocks costing_complete until all required checklist items are checked", async () => {
    const { client, calls } = createMockSupabase(checklistResponder(["moq_checked"]));
    mocks.client = client;

    await expect(runCostingAction("req-1", "costing_complete", null, "costing")).rejects.toThrow(
      "Cannot proceed — 3 required checklist item(s) not checked: Lead time checked, Packaging cost checked, Comparable style reviewed"
    );

    // No update and no action recorded.
    expect(updates(calls, "costing_requests")).toHaveLength(0);
    expect(inserts(calls, "approval_actions")).toHaveLength(0);
  });

  it("advances to for_pbd_review when all required checklist items are checked", async () => {
    const { client, calls } = createMockSupabase(
      checklistResponder(["moq_checked", "lead_time_checked", "packaging_checked", "comparable_style_reviewed"])
    );
    mocks.client = client;

    const result = await runCostingAction("req-1", "costing_complete", "All good", "costing", "Costing User", "u-3");
    expect(result).toEqual({ status: "for_pbd_review" });

    expect(updates(calls, "costing_requests")[0]).toMatchObject({ status: "for_pbd_review" });
    expect(inserts(calls, "approval_actions")[0]).toMatchObject({
      action: "costing_complete",
      from_status: "for_costing_review",
      to_status: "for_pbd_review",
      actor_role: "costing"
    });
  });
});

describe("approve — validation and compliance gates", () => {
  it("blocks approval while an unresolved validation error exists", async () => {
    const { client } = createMockSupabase(
      approveResponder({
        validation_results: {
          select: () => ({ data: [{ id: "v1", message: "Unit cost is zero" }], error: null })
        }
      })
    );
    mocks.client = client;

    await expect(runCostingAction("req-1", "approve", null, "pbd")).rejects.toThrow(
      "Cannot approve while blocking validation issue exists: Unit cost is zero"
    );
  });

  it("blocks approval while RSL compliance is pending", async () => {
    const { client } = createMockSupabase(
      approveResponder({
        compliance_checks: {
          select: () => ({ data: [{ check_type: "rsl", status: "pending", notes: null }], error: null })
        }
      })
    );
    mocks.client = client;

    await expect(runCostingAction("req-1", "approve", null, "pbd")).rejects.toThrow(
      "Cannot approve while RSL compliance is pending. Resolve the compliance check first."
    );
  });

  it("blocks approval while REACH compliance has failed", async () => {
    const { client } = createMockSupabase(
      approveResponder({
        compliance_checks: {
          select: () => ({ data: [{ check_type: "reach", status: "failed", notes: null }], error: null })
        }
      })
    );
    mocks.client = client;

    await expect(runCostingAction("req-1", "approve", null, "pbd")).rejects.toThrow(
      "Cannot approve while REACH compliance is failed. Resolve the compliance check first."
    );
  });

  it("ignores non-blocking compliance checks (rsl passed, dpp pending)", async () => {
    const { client, calls } = createMockSupabase(
      approveResponder({
        compliance_checks: {
          select: () => ({
            data: [
              { check_type: "rsl", status: "passed", notes: null },
              { check_type: "dpp", status: "pending", notes: null } // dpp is not a hard gate
            ],
            error: null
          })
        }
      })
    );
    mocks.client = client;

    const result = await runCostingAction("req-1", "approve", null, "pbd");
    expect(result).toEqual({ status: "approved" });
    expect(inserts(calls, "approval_actions")).toHaveLength(1);
  });
});

describe("approve — PBD pricing and MD review gates", () => {
  it("blocks approval before the PBD selling price review is entered", async () => {
    const { client } = createMockSupabase(
      approveResponder({
        costing_requests: {
          single: (chain) => {
            if (chain.select === "pbd_pricing_status") {
              return { data: { pbd_pricing_status: null }, error: null };
            }
            if (chain.select === "status") return { data: { status: "for_pbd_review" }, error: null };
            throw new Error("unexpected single read");
          },
          select: () => ({ data: [{ id: "req-1" }], error: null })
        }
      })
    );
    mocks.client = client;

    await expect(runCostingAction("req-1", "approve", null, "pbd")).rejects.toThrow(
      "Cannot approve before PBD selling price review is entered."
    );
  });

  it("approves without manual pricing when NextGen carries the selling price", async () => {
    const { client, calls } = createMockSupabase(
      approveResponder({
        costing_requests: {
          single: (chain) => {
            if (chain.select === "status") return { data: { status: "for_pbd_review" }, error: null };
            if (chain.select === "pbd_pricing_status") return { data: { pbd_pricing_status: null }, error: null };
            if (String(chain.select).includes("raw_payload")) {
              return {
                data: {
                  nextgen_products: [{
                    raw_payload: {
                      DefaultProductCostingCostingSellingPrice: "15.00",
                      DefaultProductCostingCostingPurchasePrice: "9.00",
                      DefaultProductCostingCostingSellingCurrencyName: "USD"
                    }
                  }]
                },
                error: null
              };
            }
            if (chain.select === "id, factory_name, baseline_ref") return { data: { id: "req-1", factory_name: "Cebu Factory" }, error: null };
            if (String(chain.select).includes("nextgen_products")) {
              return {
                data: { id: "req-1", factory_name: "Cebu Factory", nextgen_products: [{ style_number: "M88-123", name: "Beanie" }] },
                error: null
              };
            }
            throw new Error(`unexpected single read: ${String(chain.select)}`);
          },
          select: () => ({ data: [{ id: "req-1" }], error: null })
        }
      })
    );
    mocks.client = client;

    const result = await runCostingAction("req-1", "approve", null, "pbd");
    expect(result).toEqual({ status: "approved" });
    expect(inserts(calls, "approval_actions")).toHaveLength(1);
  });

  it("reports when the pbd_pricing column is missing (migration 002 not applied)", async () => {
    const { client } = createMockSupabase(
      approveResponder({
        costing_requests: {
          single: (chain) => {
            if (chain.select === "pbd_pricing_status") {
              return { data: null, error: { message: 'column "pbd_pricing_status" does not exist' } };
            }
            if (chain.select === "status") return { data: { status: "for_pbd_review" }, error: null };
            throw new Error("unexpected single read");
          },
          select: () => ({ data: [{ id: "req-1" }], error: null })
        }
      })
    );
    mocks.client = client;

    await expect(runCostingAction("req-1", "approve", null, "pbd")).rejects.toThrow(
      "Database migration 002_approval_workflow_alignment.sql is required before approval."
    );
  });

  it("blocks approval when the MD review decision was not pass", async () => {
    const { client } = createMockSupabase(
      approveResponder({
        approval_actions: {
          maybeSingle: () => ({
            data: { metadata: { decision: "needs_clarification" } },
            error: null
          }),
          insert: () => ({ data: [], error: null })
        }
      })
    );
    mocks.client = client;

    await expect(runCostingAction("req-1", "approve", null, "pbd")).rejects.toThrow(
      "Cannot approve before MD technical review is passed."
    );
  });

  it("blocks approval when no MD review has been recorded yet", async () => {
    const { client } = createMockSupabase(
      approveResponder({
        approval_actions: {
          maybeSingle: () => ({ data: null, error: null }),
          insert: () => ({ data: [], error: null })
        }
      })
    );
    mocks.client = client;

    await expect(runCostingAction("req-1", "approve", null, "pbd")).rejects.toThrow(
      "Cannot approve before MD technical review is passed."
    );
  });
});

// Shared responder for actions that send the request back to the factory
// queue (clarify / costing_clarify / reject) — the notification helper reads
// request metadata, role recipients, and settings, then records the in-app
// alert and email.
function factoryNotificationResponder(fromStatus: string): Responder {
  return {
    costing_requests: {
      single: () => ({ data: { status: fromStatus }, error: null }),
      select: () => ({ data: [{ id: "req-1" }], error: null }),
      maybeSingle: () => ({ data: { request_number: "CR-7001", factory_name: "Cebu Factory" }, error: null })
    },
    user_profiles: { select: () => ({ data: [{ email: "factory@example.com" }], error: null }) },
    workflow_settings: { maybeSingle: () => ({ data: { value: {} }, error: null }) },
    approval_actions: { insert: () => ({ data: [], error: null }) },
    workflow_events: { insert: () => ({ data: [], error: null }) }
  };
}

describe("reject — PBD rejection", () => {
  it("rejects from for_pbd_review without historical save or customer-status advance, notifying the factory", async () => {
    const { client, calls } = createMockSupabase(factoryNotificationResponder("for_pbd_review"));
    mocks.client = client;

    const result = await runCostingAction("req-1", "reject", "Over budget", "pbd", "PBD User");
    expect(result).toEqual({ status: "rejected" });

    // reject never consults the compliance/pricing/MD gates, thresholds, or history.
    // (workflow_settings is read once by the notification helper for Teams gating.)
    expect(calls.filter((c) => ["validation_results", "compliance_checks", "factory_cbds", "historical_costings"].includes(c.table))).toHaveLength(0);
    expect(calls.filter((c) => c.table === "workflow_settings")).toHaveLength(1);

    const requestUpdates = updates(calls, "costing_requests");
    expect(requestUpdates[0]).toMatchObject({ status: "rejected" });
    expect(requestUpdates[0]).not.toHaveProperty("customer_status");

    expect(inserts(calls, "approval_actions")[0]).toMatchObject({
      action: "reject",
      from_status: "for_pbd_review",
      to_status: "rejected",
      actor_role: "pbd"
    });

    // The factory is notified (in-app + email) that the costing was rejected.
    const inApp = inserts(calls, "in_app_alerts") as Array<Record<string, unknown>>;
    expect(inApp).toHaveLength(1);
    expect(inApp[0]).toMatchObject({ recipient_role: "factory", alert_type: "role_change" });
    expect(String(inApp[0].title)).toContain("rejected");
    expect(String(inApp[0].body)).toContain("Over budget");

    const emails = (inserts(calls, "notification_queue") as Array<Record<string, unknown>>).filter(
      (p) => p.channel === "email"
    );
    expect(emails).toHaveLength(1);
    expect(emails[0]).toMatchObject({ recipient: "factory@example.com", status: "pending" });
  });
});

describe("clarify / costing_clarify — factory notifications", () => {
  it("sends the CBD back to the factory and notifies the factory when PBD clarifies", async () => {
    const { client, calls } = createMockSupabase(factoryNotificationResponder("for_pbd_review"));
    mocks.client = client;

    const result = await runCostingAction("req-1", "clarify", "Fix the yarn price", "pbd", "PBD User");
    expect(result).toEqual({ status: "needs_clarification" });

    expect(updates(calls, "costing_requests")[0]).toMatchObject({ status: "needs_clarification" });
    expect(inserts(calls, "approval_actions")[0]).toMatchObject({ action: "clarify" });

    const inApp = inserts(calls, "in_app_alerts") as Array<Record<string, unknown>>;
    expect(inApp).toHaveLength(1);
    expect(inApp[0]).toMatchObject({ recipient_role: "factory", alert_type: "role_change" });
    expect(String(inApp[0].title)).toContain("PBD requested clarification");
    expect(String(inApp[0].body)).toContain("Fix the yarn price");
  });

  it("notifies the factory when Costing requests clarification from for_costing_review", async () => {
    const { client, calls } = createMockSupabase(factoryNotificationResponder("for_costing_review"));
    mocks.client = client;

    const result = await runCostingAction("req-1", "costing_clarify", null, "costing", "Costing User");
    expect(result).toEqual({ status: "needs_clarification" });

    const inApp = inserts(calls, "in_app_alerts") as Array<Record<string, unknown>>;
    expect(inApp).toHaveLength(1);
    expect(inApp[0]).toMatchObject({ recipient_role: "factory" });
    expect(String(inApp[0].title)).toContain("Costing requested clarification");

    const emails = (inserts(calls, "notification_queue") as Array<Record<string, unknown>>).filter(
      (p) => p.channel === "email"
    );
    expect(emails).toHaveLength(1);
    expect(emails[0]).toMatchObject({ recipient: "factory@example.com", status: "pending" });
  });

  it("still applies the action when the notification enqueue fails (best-effort)", async () => {
    const responder = factoryNotificationResponder("for_pbd_review");
    responder.user_profiles = {
      select: () => {
        throw new Error("recipient lookup down");
      }
    };
    const { client, calls } = createMockSupabase(responder);
    mocks.client = client;

    const result = await runCostingAction("req-1", "clarify", "revise", "pbd");
    expect(result).toEqual({ status: "needs_clarification" });
    expect(inserts(calls, "in_app_alerts")).toHaveLength(0);
    expect(inserts(calls, "approval_actions")[0]).toMatchObject({ action: "clarify" });
  });
});
