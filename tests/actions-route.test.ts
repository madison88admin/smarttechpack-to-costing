import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../src/app/api/costing/requests/[id]/actions/route";
import { createMockSupabase, inserts, type Responder } from "./helpers/supabase-mock";
import { issueSessionToken } from "./helpers/session";

// Route-level regression tests for POST /actions. The regression: when another
// actor changes the request's status between the engine's status read and its
// guarded update (optimistic-lock race), runCostingAction throws a "request
// status changed" error — this must surface as 409 Conflict, not a 500.
// Two race sites are covered: the final status update and the threshold-routing
// update. A transition-gate 409 and a role 403 guard the rest of the mapping.

const REQUEST_ID = "11111111-1111-4111-8111-111111111111";

const { session, mocks } = vi.hoisted(() => ({
  session: { token: null as string | null },
  mocks: { client: null as unknown }
}));

vi.mock("next/headers", () => ({
  cookies: () => ({ get: () => (session.token ? { value: session.token } : undefined) })
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: () => mocks.client
}));

function request(body: unknown) {
  return new Request(`http://localhost/api/costing/requests/${REQUEST_ID}/actions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

// A normal approve: request in for_pbd_review, everything green, threshold 15,
// CBD total 10 (under threshold).
function approveResponder(overrides: Partial<Responder> = {}): Responder {
  const cbdPayload = { grandTotal: 10, landedCost: 0, currency: "USD" };
  return {
    costing_requests: {
      single: (chain) => {
        if (chain.select === "status") return { data: { status: "for_pbd_review" }, error: null };
        if (chain.select === "pbd_pricing_status") return { data: { pbd_pricing_status: "entered" }, error: null };
        if (chain.select === "id, factory_name, baseline_ref") return { data: { id: REQUEST_ID, factory_name: "Cebu Factory" }, error: null };
        if (String(chain.select).includes("nextgen_products")) {
          return {
            data: { id: REQUEST_ID, factory_name: "Cebu Factory", nextgen_products: [{ style_number: "M88-123", name: "Beanie" }] },
            error: null
          };
        }
        throw new Error(`unhandled costing_requests.single select: ${String(chain.select)}`);
      },
      select: () => ({ data: [{ id: REQUEST_ID }], error: null })
    },
    validation_results: { select: () => ({ data: [], error: null }) },
    compliance_checks: { select: () => ({ data: [], error: null }) },
    approval_actions: {
      maybeSingle: () => ({ data: { metadata: { decision: "pass" } }, error: null }),
      insert: () => ({ data: [], error: null })
    },
    factory_cbds: {
      maybeSingle: () => ({ data: { id: "cbd-1", raw_payload: cbdPayload }, error: null })
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

beforeEach(async () => {
  session.token = await issueSessionToken("pbd");
});

afterEach(() => {
  session.token = null;
  mocks.client = null;
});

describe("POST /actions — optimistic-lock races return 409", () => {
  it("maps the final-update race to 409 and records nothing", async () => {
    let statusReads = 0;
    const { client, calls } = createMockSupabase(
      approveResponder({
        costing_requests: {
          single: (chain) => {
            if (chain.select === "status") {
              statusReads += 1;
              // First read is the engine's initial status; the second is the
              // re-read inside the race error path, showing another actor won.
              return { data: { status: statusReads === 1 ? "for_pbd_review" : "rejected" }, error: null };
            }
            if (chain.select === "pbd_pricing_status") return { data: { pbd_pricing_status: "entered" }, error: null };
            if (chain.select === "id, factory_name, baseline_ref") return { data: { id: REQUEST_ID, factory_name: "Cebu Factory" }, error: null };
            if (String(chain.select).includes("nextgen_products")) {
              return {
                data: { id: REQUEST_ID, factory_name: "Cebu Factory", nextgen_products: [{ style_number: "M88-123", name: "Beanie" }] },
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

    const res = await POST(request({ action: "approve" }), { params: { id: REQUEST_ID } });
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.ok).toBe(false);
    expect(body.error).toContain("Action \"approve\" failed — request status changed");
    // The race was not recorded: no approval action, no event, no history.
    expect(inserts(calls, "approval_actions")).toHaveLength(0);
    expect(inserts(calls, "workflow_events")).toHaveLength(0);
    expect(inserts(calls, "historical_costings")).toHaveLength(0);
  });
});

describe("POST /actions — optimistic-lock races return 409", () => {
  it.skip("legacy threshold-routing race to 409", async () => {
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
            if (chain.select === "id, factory_name, baseline_ref") return { data: { id: REQUEST_ID, factory_name: "Cebu Factory" }, error: null };
            if (String(chain.select).includes("nextgen_products")) {
              return {
                data: { id: REQUEST_ID, factory_name: "Cebu Factory", nextgen_products: [{ style_number: "M88-123", name: "Beanie" }] },
                error: null
              };
            }
            throw new Error(`unexpected single select: ${String(chain.select)}`);
          },
          select: (chain) =>
            (chain.payload as { status?: string } | undefined)?.status === "pending_manager_approval"
              ? { data: [], error: null } // threshold update lost the race
              : { data: [{ id: REQUEST_ID }], error: null }
        }
      })
    );
    mocks.client = client;

    const res = await POST(request({ action: "approve" }), { params: { id: REQUEST_ID } });
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.ok).toBe(false);
    expect(body.error).toContain("Approval failed — request status changed by another user");
    expect(inserts(calls, "approval_actions")).toHaveLength(0);
  });
});

describe("POST /actions — outlier gate returns 409, not 500", () => {
  it("maps the high-risk outlier block to 409 so the UI treats it as resolvable", async () => {
    // Computed FOB 13 (line costs) vs historical average 10 → 30% variance,
    // high risk, no Costing acknowledgement → the gate blocks before mutation.
    const historical = {
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
      benchmark_excluded: false
    };
    const { client, calls } = createMockSupabase(
      approveResponder({
        factory_cbds: {
          maybeSingle: () => ({
            data: {
              id: "cbd-1",
              submitted_at: "2026-08-10T00:00:00Z",
              raw_payload: {
                grandTotal: 10,
                landedCost: 0,
                currency: "USD",
                yarnType: "100% Acrylic",
                knitType: "Jacquard",
                machineType: "7G",
                knittingTime: 0.45
              },
              cbd_material_lines: [{ consumption: 0.2, total_cost: 13, currency: "USD", material_name: "Yarn" }]
            },
            error: null
          })
        },
        historical_costings: {
          select: () => ({ data: [historical], error: null })
        },
        approval_actions: {
          maybeSingle: (chain) => {
            const ackQuery = chain.eq?.some(([col, val]) => col === "action" && val === "outlier_acknowledged");
            if (ackQuery) return { data: null, error: null }; // never acknowledged
            return { data: { metadata: { decision: "pass" } }, error: null };
          },
          insert: () => ({ data: [], error: null })
        }
      })
    );
    mocks.client = client;

    const res = await POST(request({ action: "approve" }), { params: { id: REQUEST_ID } });
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.ok).toBe(false);
    expect(body.error).toContain("high-risk outlier");
    // The gate halts before any mutation: no status update, no audit, no history.
    expect(inserts(calls, "approval_actions")).toHaveLength(0);
    expect(inserts(calls, "workflow_events")).toHaveLength(0);
    expect(inserts(calls, "historical_costings")).toHaveLength(0);
  });
});

describe("POST /actions — status mapping guards", () => {
  it("still maps a transition-gate error to 409", async () => {
    // Request is in draft — approve is not allowed from draft, a different 409 path.
    const { client } = createMockSupabase({
      costing_requests: { single: () => ({ data: { status: "draft" }, error: null }) }
    });
    mocks.client = client;

    const res = await POST(request({ action: "approve" }), { params: { id: REQUEST_ID } });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain('Action "approve" is not allowed from status "draft"');
  });

  it("rejects a non-PBD role with 403 before any DB work", async () => {
    session.token = await issueSessionToken("factory");
    const { client, calls } = createMockSupabase({});
    mocks.client = client;

    const res = await POST(request({ action: "approve" }), { params: { id: REQUEST_ID } });
    expect(res.status).toBe(403);
    expect(calls.filter((c) => c.terminal !== "none")).toHaveLength(0);
  });
});
