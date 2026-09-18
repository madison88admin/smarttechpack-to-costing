import { afterEach, describe, expect, it, vi } from "vitest";
import { submitFactoryCbd, type SubmitCbdInput } from "../src/lib/costing/cbd";
import { createMockSupabase, inserts, updates, type Call } from "./helpers/supabase-mock";

// Integration-style tests for submitFactoryCbd with a mocked Supabase client:
// the allowed-from pre-check, nextStatus resolution, and what actually gets
// written (CBD row, validation results, request status, approval action, event).

const { mocks } = vi.hoisted(() => ({ mocks: { client: null as unknown } }));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: () => mocks.client
}));

afterEach(() => {
  mocks.client = null;
});

function validInput(overrides: Partial<SubmitCbdInput> = {}): SubmitCbdInput {
  return {
    costingRequestId: "req-1",
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
    lines: [{ materialName: "Yarn", unitCost: "5", consumption: "1" }],
    ...overrides
  };
}

// The CBD row is written via .insert().select().single(), so its call records
// terminal "single" with the insert payload in the chain.
function cbdRowInserts(calls: Call[]) {
  return calls.filter((c) => c.table === "factory_cbds" && c.terminal === "single").map((c) => c.chain.payload);
}

function submitResponder(
  requestStatus: string,
  clarificationAction?: "clarify" | "costing_clarify" | "md_review",
  prerequisites: { mdPassed?: boolean; costingPassed?: boolean } = { mdPassed: true, costingPassed: true }
) {
  const approvalRows = clarificationAction
    ? [
        { action: clarificationAction, to_status: "needs_clarification", metadata: null, created_at: "2026-08-27T03:00:00Z" },
        {
          action: "md_review",
          to_status: prerequisites.mdPassed === false ? "needs_clarification" : "for_costing_review",
          metadata: { decision: prerequisites.mdPassed === false ? "needs_clarification" : "pass" },
          created_at: "2026-08-27T01:00:00Z"
        },
        ...(prerequisites.costingPassed === false
          ? []
          : [{ action: "costing_complete", to_status: "for_pbd_review", metadata: null, created_at: "2026-08-27T02:00:00Z" }])
      ]
    : [];
  return {
    costing_requests: {
      single: () => ({
        data: {
          status: requestStatus,
          factory_name: "Cebu Factory",
          nextgen_products: [{ style_number: "M88-123", name: "Beanie" }]
        },
        error: null
      }),
      // The optimistic-lock status update (.update().eq().eq().select("id"))
      // returns one row when the lock is won, zero when the race is lost.
      select: () => ({ data: [{ id: "req-1" }], error: null })
    },
    factory_cbds: {
      single: () => ({ data: { id: "cbd-1" }, error: null }),
      // No revision on file by default, so every submit writes one.
      maybeSingle: (): { data: unknown; error: unknown } => ({ data: null, error: null })
    },
    ...(clarificationAction
      ? { approval_actions: { select: () => ({ data: approvalRows, error: null }) } }
      : {}),
    historical_costings: { select: () => ({ data: [], error: null }) }, // no benchmark history
    workflow_settings: { maybeSingle: () => ({ data: null, error: null }) }
  };
}

describe("submitFactoryCbd — submit path", () => {
  it("advances a sent_to_factory request to for_md_review with a clean CBD", async () => {
    const { client, calls } = createMockSupabase(submitResponder("sent_to_factory"));
    mocks.client = client;

    const result = await submitFactoryCbd(validInput());
    expect(result.id).toBe("cbd-1");
    expect(result.validationIssues).toEqual([]);

    // The CBD row is inserted with a submitted_at stamp.
    expect(cbdRowInserts(calls)).toHaveLength(1);
    expect(cbdRowInserts(calls)[0]).toMatchObject({ status: "submitted" });

    // Request advances, approval action and event are recorded.
    expect(updates(calls, "costing_requests")[0]).toMatchObject({ status: "for_md_review" });
    expect(inserts(calls, "approval_actions")[0]).toMatchObject({
      action: "submit",
      from_status: "sent_to_factory",
      to_status: "for_md_review",
      actor_role: "factory",
      comment: "Factory submitted CBD"
    });
    expect(inserts(calls, "workflow_events")).toHaveLength(1);
  });

  it("maps structured wizard sections into validation and persisted totals", async () => {
    const { client, calls } = createMockSupabase(submitResponder("sent_to_factory"));
    mocks.client = client;

    const result = await submitFactoryCbd(validInput({
      laborCost: undefined,
      packagingCost: undefined,
      lines: [],
      yarnLines: [{ name: "Cotton 20/2", consumption: "38", materialPrice: "5.2", materialCost: "0.1976" }],
      fabricLines: [{ name: "Lining", consumption: "1", materialPrice: "0.5", materialCost: "0.5" }],
      trimLines: [{ name: "Label", consumption: "1", materialPrice: "0.1", materialCost: "0.1" }],
      knittingLines: [{ machineType: "Flat-7GG", knittingTime: "2", knittingCost: "0.2" }],
      operationsLines: [{ operation: "Linking", operationCost: "0.15" }],
      standardPackagingCost: "0.12",
      specialPackagingCost: "0",
      overheadCost: "0.2",
      profitCost: "0.25"
    }));

    const ruleCodes = result.validationIssues.map((issue) => issue.ruleCode);
    expect(ruleCodes).not.toContain("missing_labor_cost");
    expect(ruleCodes).not.toContain("missing_packagingCost");
    expect(ruleCodes).not.toContain("no_material_lines");

    const cbdInsert = cbdRowInserts(calls)[0] as Record<string, unknown>;
    const rawPayload = cbdInsert.raw_payload as Record<string, unknown>;
    expect(Number(rawPayload.laborCost)).toBeCloseTo(0.35);
    expect(Number(rawPayload.packagingCost)).toBeCloseTo(0.12);
    expect(Number(rawPayload.factoryCostTotal)).toBeCloseTo(1.7176);
    expect(Number(rawPayload.grandTotal)).toBeCloseTo(1.7176);
  });

  it("routes back to needs_clarification when the CBD has blocking validation issues", async () => {
    const { client, calls } = createMockSupabase(submitResponder("sent_to_factory"));
    mocks.client = client;

    const result = await submitFactoryCbd(validInput({ currency: "" }));

    expect(result.validationIssues.some((issue) => issue.severity === "error")).toBe(true);
    expect(updates(calls, "costing_requests")[0]).toMatchObject({ status: "needs_clarification" });
    expect(inserts(calls, "approval_actions")[0]).toMatchObject({
      action: "submit",
      to_status: "needs_clarification",
      comment: "Factory submitted CBD with validation issues"
    });
    // Blocking issues are persisted to validation_results.
    expect(inserts(calls, "validation_results").length).toBeGreaterThan(0);
  });

  it("returns a PBD clarification resubmission directly to PBD review", async () => {
    const { client, calls } = createMockSupabase(submitResponder("needs_clarification", "clarify"));
    mocks.client = client;

    const result = await submitFactoryCbd(validInput());
    expect(updates(calls, "costing_requests")[0]).toMatchObject({ status: "for_pbd_review" });
    expect(inserts(calls, "approval_actions")[0]).toMatchObject({
      from_status: "needs_clarification",
      to_status: "for_pbd_review"
    });
    expect(result.validationIssues).toEqual([]);
  });

  it("returns Costing and MD clarification resubmissions to the requesting team", async () => {
    for (const [action, expected] of [
      ["costing_clarify", "for_costing_review"],
      ["md_review", "for_md_review"]
    ] as const) {
      const { client, calls } = createMockSupabase(submitResponder("needs_clarification", action));
      mocks.client = client;
      await submitFactoryCbd(validInput());
      expect(updates(calls, "costing_requests")[0]).toMatchObject({ status: expected });
    }
  });

  it("does not let a PBD correction skip an unresolved MD review", async () => {
    const { client, calls } = createMockSupabase(
      submitResponder("needs_clarification", "clarify", { mdPassed: false, costingPassed: true })
    );
    mocks.client = client;

    await submitFactoryCbd(validInput());
    expect(updates(calls, "costing_requests")[0]).toMatchObject({ status: "for_md_review" });
  });

  it("does not let a PBD correction skip an incomplete costing review", async () => {
    const { client, calls } = createMockSupabase(
      submitResponder("needs_clarification", "clarify", { mdPassed: true, costingPassed: false })
    );
    mocks.client = client;

    await submitFactoryCbd(validInput());
    expect(updates(calls, "costing_requests")[0]).toMatchObject({ status: "for_costing_review" });
  });

  it("refuses to submit from a non-allowed status before inserting the CBD", async () => {
    const { client, calls } = createMockSupabase(submitResponder("draft"));
    mocks.client = client;

    await expect(submitFactoryCbd(validInput())).rejects.toThrow(
      'Factory cannot submit CBD from status "draft". Allowed from: sent_to_factory, needs_clarification'
    );
    expect(cbdRowInserts(calls)).toHaveLength(0);
  });

  it("loses the optimistic lock on a concurrent submit — 409 race, no action recorded, orphan CBD rolled back", async () => {
    const responder = submitResponder("sent_to_factory");
    // The update returns zero rows: another user/action moved the request
    // between our pre-check and the status transition.
    responder.costing_requests.select = () => ({ data: [], error: null });
    const { client, calls } = createMockSupabase(responder);
    mocks.client = client;

    await expect(submitFactoryCbd(validInput())).rejects.toThrow(
      'CBD submit failed — request status changed from "sent_to_factory" by another user. Please refresh and try again.'
    );

    // The optimistic-lock update WAS attempted with the status condition,
    // but it returned zero rows — so nothing was advanced or recorded.
    const lockUpdate = calls.find(
      (c) => c.table === "costing_requests" && c.terminal === "select" && c.chain.payload
    );
    expect(lockUpdate).toBeTruthy();
    expect(lockUpdate!.chain.payload).toMatchObject({ status: "for_md_review" });
    expect(lockUpdate!.chain.eq).toEqual([
      ["id", "req-1"],
      ["status", "sent_to_factory"]
    ]);
    expect(inserts(calls, "approval_actions")).toHaveLength(0);
    expect(inserts(calls, "workflow_events")).toHaveLength(0);
    // The just-inserted CBD row was rolled back so no phantom submitted
    // revision remains in the trail.
    const rollback = calls.filter((c) => c.table === "factory_cbds" && c.terminal === "delete");
    expect(rollback).toHaveLength(1);
    expect(rollback[0].chain.eq).toEqual([["id", "cbd-1"]]);
  });
});

// A resubmission whose content equals the revision already on file is the same
// CBD filed again (an impatient repeat, a reload-and-resubmit, or a deliberate
// hand-back). It must not add a revision to the trail, but the workflow must
// still move — otherwise a hand-back would be a dead end.
describe("submitFactoryCbd — identical resubmission", () => {
  /** The payload the previous revision holds, key order reversed to mimic jsonb. */
  async function firstRevisionPayload() {
    const { client, calls } = createMockSupabase(submitResponder("sent_to_factory"));
    mocks.client = client;
    await submitFactoryCbd(validInput());
    const row = (cbdRowInserts(calls)[0] ?? {}) as { raw_payload?: Record<string, unknown> };
    return Object.fromEntries(Object.entries(row.raw_payload ?? {}).reverse());
  }

  it("files no second revision, but still applies the transition and records the submit", async () => {
    const previousPayload = await firstRevisionPayload();
    const responder = submitResponder("needs_clarification");
    responder.factory_cbds.maybeSingle = () => ({ data: { id: "cbd-0", raw_payload: previousPayload }, error: null });
    const { client, calls } = createMockSupabase(responder);
    mocks.client = client;

    const result = await submitFactoryCbd(validInput());

    expect(result.duplicate).toBe(true);
    // The flow keeps pointing at the revision that is actually on file.
    expect(result.id).toBe("cbd-0");
    expect(cbdRowInserts(calls)).toHaveLength(0);
    expect(inserts(calls, "cbd_material_lines")).toHaveLength(0);
    // The hand-back still moves the request: status, audit action, event.
    expect(updates(calls, "costing_requests")[0]).toMatchObject({ status: "for_md_review" });
    expect(inserts(calls, "approval_actions")[0]).toMatchObject({ action: "submit", to_status: "for_md_review" });
    expect(inserts(calls, "workflow_events")).toHaveLength(1);
  });

  it("files a revision when a single value differs", async () => {
    const previousPayload = await firstRevisionPayload();
    const responder = submitResponder("needs_clarification");
    responder.factory_cbds.maybeSingle = () => ({
      data: { id: "cbd-0", raw_payload: { ...previousPayload, moq: 999 } },
      error: null
    });
    const { client, calls } = createMockSupabase(responder);
    mocks.client = client;

    const result = await submitFactoryCbd(validInput());

    expect(result.duplicate).toBe(false);
    expect(cbdRowInserts(calls)).toHaveLength(1);
  });

  it("always writes a draft, and never blocks on a failed lookup", async () => {
    const previousPayload = await firstRevisionPayload();
    const draftResponder = submitResponder("draft");
    draftResponder.factory_cbds.maybeSingle = () => ({ data: { id: "cbd-0", raw_payload: previousPayload }, error: null });
    const draftRun = createMockSupabase(draftResponder);
    mocks.client = draftRun.client;
    const draft = await submitFactoryCbd(validInput({ status: "draft" }));
    expect(draft.duplicate).toBe(false);
    expect(cbdRowInserts(draftRun.calls)).toHaveLength(1);

    // A lookup that errors must not swallow the submit.
    const brokenResponder = submitResponder("sent_to_factory");
    brokenResponder.factory_cbds.maybeSingle = () => ({ data: null, error: { message: "boom" } });
    const brokenRun = createMockSupabase(brokenResponder);
    mocks.client = brokenRun.client;
    const submitted = await submitFactoryCbd(validInput());
    expect(submitted.duplicate).toBe(false);
    expect(cbdRowInserts(brokenRun.calls)).toHaveLength(1);
  });
});

describe("submitFactoryCbd — draft save", () => {
  it("saves a draft without touching the request status or recording actions", async () => {
    const { client, calls } = createMockSupabase(submitResponder("draft"));
    mocks.client = client;

    const result = await submitFactoryCbd(validInput({ status: "draft" }));

    expect(result.id).toBe("cbd-1");
    expect(cbdRowInserts(calls)).toHaveLength(1);
    expect(cbdRowInserts(calls)[0]).toMatchObject({ status: "draft", submitted_at: null });
    expect(updates(calls, "costing_requests")).toHaveLength(0);
    expect(inserts(calls, "approval_actions")).toHaveLength(0);
    expect(inserts(calls, "workflow_events")).toHaveLength(0);
  });
});
