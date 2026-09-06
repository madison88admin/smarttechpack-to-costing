import { afterEach, describe, expect, it, vi } from "vitest";
import { runCostingAction } from "../src/lib/costing/actions";
import { submitFactoryCbd, type SubmitCbdInput } from "../src/lib/costing/cbd";
import { createCostingRequest } from "../src/lib/costing/requests";
import { POST } from "../src/app/api/costing/requests/[id]/md-review/route";
import { createMockSupabase, inserts, updates, type Call, type Responder } from "./helpers/supabase-mock";
import { issueSessionToken } from "./helpers/session";

// ---------------------------------------------------------------------------
// FULL LIFECYCLE — one request driven end to end through the real code paths:
//   PBD createCostingRequest (draft)
//   → PBD runCostingAction send_to_factory (sent_to_factory)
//   → factory submitFactoryCbd (for_md_review)
//   → MD md-review route POST pass (for_costing_review)
//   → Costing runCostingAction costing_complete (for_pbd_review)
//   → PBD runCostingAction approve (approved + historical costing row)
// Each step asserts the status transition, the audit rows (approval_actions +
// workflow_events), and the final historical_costings insert. This is the
// golden path a real user clicks, with no pure-helper shortcuts: every status
// change goes through the actual workflow engine / route.
// ---------------------------------------------------------------------------

const REQUEST_ID = "11111111-1111-4111-8111-111111111111";

/** Latest approval_actions insert as a typed row (mock payloads are unknown). */
function actionRow(calls: Call[]) {
  return inserts(calls, "approval_actions")[0] as Record<string, unknown>;
}

/** Latest workflow_events insert as a typed row (mock payloads are unknown). */
function eventRow(calls: Call[]) {
  return inserts(calls, "workflow_events")[0] as Record<string, unknown>;
}

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

afterEach(() => {
  mocks.client = null;
  session.token = null;
});

/** Clean structured CBD payload — mirrors what the factory wizard submits. */
function cbdInput(overrides: Partial<SubmitCbdInput> = {}): SubmitCbdInput {
  return {
    costingRequestId: REQUEST_ID,
    status: "submitted",
    currency: "USD",
    laborCost: "2",
    overheadCost: "1",
    moq: "100",
    leadTimeDays: "30",
    materialBufferPercent: "5",
    packagingCost: "0.5",
    testingCost: "0.5",
    brandNominatedItems: "None",
    m88Packaging: "Standard",
    yarnType: "Cotton",
    knitType: "Jersey",
    machineType: "Flat knit",
    construction: "Rib",
    productCategory: "Hats",
    customer: "TestCustomer",
    season: "SS27",
    yarnLines: [{ name: "Yarn", consumption: 0.2, materialPrice: 5, materialCost: 1 }],
    lines: [{ materialName: "Yarn", unitCost: "5", consumption: "1" }],
    ...overrides
  };
}

describe("FULL LIFECYCLE — create → factory → MD → costing → PBD approve", () => {
  it("drives one request through every stage and asserts statuses, audit rows, and history", async () => {
    let currentStatus = "draft";
    const auditActions: Array<Record<string, unknown>> = [];
    const auditEvents: Array<Record<string, unknown>> = [];

    // ---------- Step 1 — PBD creates the request (draft) ----------
    {
      const { client, calls } = createMockSupabase({
        nextgen_products: {
          single: () => ({ data: { id: "prod-1" }, error: null }) // upsert().select("id").single()
        },
        costing_requests: {
          select: () => ({ data: [], error: null }), // duplicate check
          single: () => ({ data: { id: REQUEST_ID, request_number: "CR-FULL1", status: "draft" }, error: null }) // insert().select().single()
        }
      });
      mocks.client = client;

      const created = await createCostingRequest({
        nextgenEntityId: "ng-1",
        styleNumber: "M88-123",
        productName: "Beanie",
        factoryName: "Cebu Factory",
        season: "SS27",
        brand: "Madison88",
        customer: "TestCustomer",
        productCategory: "Hats",
        bomLines: [{ materialName: "Yarn", usage: 0.2 }]
      });

      expect(created.id).toBe(REQUEST_ID);
      expect(created.status).toBe("draft");

      const requestInserts = calls.filter(
        (c) => c.table === "costing_requests" && c.terminal === "single" && c.chain.payload
      );
      expect(requestInserts).toHaveLength(1);
      const payload = requestInserts[0].chain.payload as Record<string, unknown>;
      expect(payload.status).toBe("draft");
      expect(String(payload.request_number)).toMatch(/^CR-/);
      expect(payload.factory_name).toBe("Cebu Factory");

      const productInserts = calls.filter(
        (c) => c.table === "nextgen_products" && c.terminal === "single" && c.chain.payload
      );
      expect(productInserts[0].chain.payload).toMatchObject({ style_number: "M88-123", nextgen_entity_id: "ng-1" });
    }

    // ---------- Step 2 — PBD sends the request to the factory ----------
    {
      const { client, calls } = createMockSupabase({
        costing_requests: {
          single: (chain) => {
            const sel = String(chain.select);
            if (sel === "status") return { data: { status: currentStatus }, error: null };
            if (sel === "factory_name, assigned_factory_user_id") return { data: { factory_name: "Cebu Factory", assigned_factory_user_id: null }, error: null };
            throw new Error(`unhandled costing_requests.single: ${sel}`);
          },
          select: () => ({ data: [{ id: REQUEST_ID }], error: null }) // optimistic-lock update wins
        },
        user_profiles: {
          maybeSingle: () => ({ data: { id: "factory-profile-1" }, error: null }) // auto-assign first active factory
        },
        approval_actions: { insert: () => ({ data: [], error: null }) },
        workflow_events: { insert: () => ({ data: [], error: null }) },
        workflow_settings: { maybeSingle: () => ({ data: null, error: null }) }
      });
      mocks.client = client;

      const result = await runCostingAction(REQUEST_ID, "send_to_factory", "Start the CBD", "pbd", "PBD User", "u-pbd");
      expect(result.status).toBe("sent_to_factory");
      currentStatus = "sent_to_factory";

      expect(updates(calls, "costing_requests")[0]).toMatchObject({
        status: "sent_to_factory",
        assigned_factory_user_id: "factory-profile-1" // auto-assigned so it is actionable immediately
      });
      const action = actionRow(calls);
      expect(action).toMatchObject({ action: "send_to_factory", from_status: "draft", to_status: "sent_to_factory", actor_role: "pbd" });
      auditActions.push(action);
      const event = eventRow(calls);
      expect(event.event_type).toBe("send_to_factory");
      auditEvents.push(event);
    }

    // ---------- Step 3 — Factory submits the structured CBD ----------
    {
      const { client, calls } = createMockSupabase({
        costing_requests: {
          single: (chain) => {
            const sel = String(chain.select);
            if (sel.includes("nextgen_products")) return { data: { status: currentStatus, factory_name: "Cebu Factory", nextgen_products: [{ style_number: "M88-123", name: "Beanie" }] }, error: null };
            throw new Error(`unhandled costing_requests.single: ${sel}`);
          },
          select: () => ({ data: [{ id: REQUEST_ID }], error: null })
        },
        factory_cbds: {
          single: () => ({ data: { id: "cbd-1" }, error: null }) // insert().select().single()
        },
        historical_costings: { select: () => ({ data: [], error: null }) }, // no benchmark history → clean submit
        workflow_settings: { maybeSingle: () => ({ data: null, error: null }) },
        approval_actions: { insert: () => ({ data: [], error: null }) },
        workflow_events: { insert: () => ({ data: [], error: null }) }
      });
      mocks.client = client;

      const result = await submitFactoryCbd(cbdInput());
      expect(result.id).toBe("cbd-1");
      expect(result.validationIssues).toEqual([]);

      // CBD row persisted as a submitted revision
      const cbdRows = calls.filter((c) => c.table === "factory_cbds" && c.terminal === "single" && c.chain.payload);
      expect(cbdRows[0].chain.payload).toMatchObject({ status: "submitted", costing_request_id: REQUEST_ID });
      expect((cbdRows[0].chain.payload as Record<string, unknown>).submitted_at).not.toBeNull();

      // Clean validation → for_md_review (MD technical review precedes costing)
      expect(updates(calls, "costing_requests")[0]).toMatchObject({ status: "for_md_review" });
      currentStatus = "for_md_review";

      const action = actionRow(calls);
      expect(action).toMatchObject({ action: "submit", from_status: "sent_to_factory", to_status: "for_md_review", actor_role: "factory" });
      auditActions.push(action);
      const event = eventRow(calls);
      expect(event.event_type).toBe("factory_submit");
      auditEvents.push(event);
    }

    // ---------- Step 4 — MD passes the technical review (real route) ----------
    {
      session.token = await issueSessionToken("md");
      const { client, calls } = createMockSupabase({
        costing_requests: {
          single: () => ({ data: { status: currentStatus }, error: null }),
          select: () => ({ data: [{ id: REQUEST_ID }], error: null })
        },
        approval_actions: { insert: () => ({ data: [], error: null }) },
        workflow_events: { insert: () => ({ data: [], error: null }) }
      });
      mocks.client = client;

      const res = await POST(
        new Request(`http://localhost/api/costing/requests/${REQUEST_ID}/md-review`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision: "pass", notes: "Tech check ok — machine and yarn confirmed" })
        }),
        { params: { id: REQUEST_ID } }
      );
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.decision).toBe("pass");
      expect(body.status).toBe("for_costing_review");
      currentStatus = "for_costing_review";

      const action = actionRow(calls);
      expect(action).toMatchObject({
        action: "md_review",
        actor_role: "md",
        from_status: "for_md_review",
        to_status: "for_costing_review",
        metadata: { decision: "pass" }
      });
      auditActions.push(action);
      const event = eventRow(calls);
      expect(event.event_type).toBe("md_review");
      auditEvents.push(event);
    }

    // ---------- Step 5 — Costing completes the validation checklist ----------
    {
      const { client, calls } = createMockSupabase({
        costing_requests: {
          single: (chain) => {
            if (String(chain.select) === "status") return { data: { status: currentStatus }, error: null };
            throw new Error(`unhandled costing_requests.single: ${String(chain.select)}`);
          },
          select: () => ({ data: [{ id: REQUEST_ID }], error: null })
        },
        // All 4 required checklist items checked by Costing → gate passes
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
        workflow_events: { insert: () => ({ data: [], error: null }) },
        workflow_settings: { maybeSingle: () => ({ data: null, error: null }) }
      });
      mocks.client = client;

      const result = await runCostingAction(REQUEST_ID, "costing_complete", "Validation complete", "costing", "Costing User", "u-costing");
      expect(result.status).toBe("for_pbd_review");
      currentStatus = "for_pbd_review";

      expect(updates(calls, "costing_requests")[0]).toMatchObject({ status: "for_pbd_review" });
      const action = actionRow(calls);
      expect(action).toMatchObject({ action: "costing_complete", from_status: "for_costing_review", to_status: "for_pbd_review", actor_role: "costing" });
      auditActions.push(action);
      const event = eventRow(calls);
      expect(event.event_type).toBe("costing_complete");
      auditEvents.push(event);
    }

    // ---------- Step 6 — PBD approves: all gates green → history saved ----------
    {
      const { client, calls } = createMockSupabase({
        costing_requests: {
          single: (chain) => {
            const sel = String(chain.select);
            if (sel === "status") return { data: { status: currentStatus }, error: null };
            if (sel === "pbd_pricing_status") return { data: { pbd_pricing_status: "entered" }, error: null };
            if (sel === "id, factory_name, baseline_ref") return { data: { id: REQUEST_ID, factory_name: "Cebu Factory", baseline_ref: null }, error: null };
            if (sel.includes("nextgen_products")) return { data: { id: REQUEST_ID, factory_name: "Cebu Factory", nextgen_products: [{ style_number: "M88-123", name: "Beanie" }] }, error: null };
            throw new Error(`unhandled costing_requests.single: ${sel}`);
          },
          select: () => ({ data: [{ id: REQUEST_ID }], error: null })
        },
        validation_results: { select: () => ({ data: [], error: null }) }, // no unresolved errors
        compliance_checks: { select: () => ({ data: [], error: null }) }, // RSL/REACH all clear
        approval_actions: {
          maybeSingle: (chain) => {
            const isAck = chain.eq?.some(([c, v]) => c === "action" && v === "outlier_acknowledged");
            if (isAck) return { data: null, error: null }; // never acknowledged — but no outliers below
            return { data: { metadata: { decision: "pass" } }, error: null }; // md_review passed
          },
          insert: () => ({ data: [], error: null })
        },
        factory_cbds: {
          maybeSingle: (chain) =>
            String(chain.select).includes("cbd_material_lines")
              ? {
                  data: {
                    id: "cbd-1",
                    submitted_at: "2026-08-10T00:00:00Z",
                    raw_payload: { grandTotal: 10, currency: "USD", yarnType: "Cotton", knitType: "Jersey", machineType: "Flat knit", construction: "Rib", productCategory: "Hats" },
                    cbd_material_lines: [{ consumption: 0.2, total_cost: 10, currency: "USD", material_name: "Yarn" }]
                  },
                  error: null
                }
              : { data: { id: "cbd-1", raw_payload: { grandTotal: 10, currency: "USD" } }, error: null }
        },
        historical_costings: {
          select: () => ({ data: [], error: null }), // no history → not an outlier
          delete: () => ({ data: [], error: null }),
          insert: () => ({ data: [], error: null })
        },
        workflow_events: { insert: () => ({ data: [], error: null }) },
        workflow_settings: { maybeSingle: () => ({ data: null, error: null }) }
      });
      mocks.client = client;

      const result = await runCostingAction(REQUEST_ID, "approve", "Approved — ready for customer", "pbd", "PBD User", "u-pbd");
      expect(result.status).toBe("approved");

      // Status transition + auto-advance of the customer lifecycle
      expect(updates(calls, "costing_requests")[0]).toMatchObject({
        status: "approved",
        customer_status: "pending_customer_submission"
      });

      // Historical costing row saved from the latest CBD (delete-then-insert)
      const historyInserts = inserts(calls, "historical_costings");
      expect(historyInserts).toHaveLength(1);
      expect(historyInserts[0]).toMatchObject({
        costing_request_id: REQUEST_ID,
        style_number: "M88-123",
        factory_name: "Cebu Factory",
        total_cost: 10,
        currency: "USD",
        yarn_type: "Cotton",
        knit_type: "Jersey"
      });

      const action = actionRow(calls);
      expect(action).toMatchObject({ action: "approve", from_status: "for_pbd_review", to_status: "approved", actor_role: "pbd" });
      auditActions.push(action);
      const event = eventRow(calls);
      expect(event.event_type).toBe("approve");
      auditEvents.push(event);
    }

    // ---------- Final audit trail: the full lifecycle is in the ledger ----------
    expect(auditActions.map((row) => row.action)).toEqual([
      "send_to_factory",
      "submit",
      "md_review",
      "costing_complete",
      "approve"
    ]);
    expect(auditActions.map((row) => row.from_status)).toEqual(["draft", "sent_to_factory", "for_md_review", "for_costing_review", "for_pbd_review"]);
    expect(auditActions.map((row) => row.to_status)).toEqual(["sent_to_factory", "for_md_review", "for_costing_review", "for_pbd_review", "approved"]);

    expect(auditEvents.map((row) => row.event_type)).toEqual([
      "send_to_factory",
      "factory_submit",
      "md_review",
      "costing_complete",
      "approve"
    ]);
  });

  it("a mid-lifecycle failure leaves no history and no approval rows (no phantom writes)", async () => {
    // Costing tries to complete before the checklist is done: the gate throws
    // BEFORE any status update or audit write, proving failed steps never leak.
    const { client, calls } = createMockSupabase({
      costing_requests: {
        single: () => ({ data: { status: "for_costing_review" }, error: null }),
        select: () => ({ data: [], error: null })
      },
      request_checklist_results: {
        select: () => ({
          data: [
            { checklist_code: "moq_checked", is_checked: true, comment: "", checked_by_role: "costing", checked_at: "2026-08-10T00:00:00.000Z" },
            { checklist_code: "lead_time_checked", is_checked: false, comment: "", checked_by_role: "costing", checked_at: null },
            { checklist_code: "packaging_checked", is_checked: false, comment: "", checked_by_role: "costing", checked_at: null },
            { checklist_code: "comparable_style_reviewed", is_checked: false, comment: "", checked_by_role: "costing", checked_at: null }
          ],
          error: null
        })
      },
      approval_actions: { insert: () => ({ data: [], error: null }) },
      workflow_events: { insert: () => ({ data: [], error: null }) },
      workflow_settings: { maybeSingle: () => ({ data: null, error: null }) }
    });
    mocks.client = client;

    await expect(runCostingAction(REQUEST_ID, "costing_complete", null, "costing")).rejects.toThrow("required checklist item");
    expect(updates(calls, "costing_requests")).toHaveLength(0);
    expect(inserts(calls, "approval_actions")).toHaveLength(0);
    expect(inserts(calls, "workflow_events")).toHaveLength(0);
    expect(inserts(calls, "historical_costings")).toHaveLength(0);
  });
});