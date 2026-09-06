// =============================================================================
// DESTRUCTIVE TEST SUITE
// -----------------------------------------------------------------------------
// Deliberately hostile battery against the workflow engine. Every test runs
// against the mocked Supabase client (tests/helpers/supabase-mock.ts), so no
// real database is ever touched. Sections:
//
//   1. Exhaustive action × role matrix (7 actions × 8 roles = 56 combos)
//   2. CBD validation boundary battery (validateFactoryCbd / hasBlockingIssues)
//   3. Benchmark variance extremes (validateBenchmarkVariance)
//   4. Role request-list visibility matrix (getStatusesForRoles, 8 × 9)
//   5. createCostingRequest destructive gates (duplicate block, BOM replace,
//      DB failure propagation)
//   6. runCostingAction destructive extras (send_to_factory,
//      DB chaos — nothing is silently swallowed)
//
// Where the suite pins behavior that looks wrong, the test documents WHY the
// system behaves that way (defense in depth vs. a genuine gap).
// =============================================================================

import { afterEach, describe, expect, it, vi } from "vitest";
import { assertActionAllowed, runCostingAction } from "../src/lib/costing/actions";
import { hasBlockingIssues, validateBenchmarkVariance, validateFactoryCbd } from "../src/lib/costing/validation";
import { getStatusesForRoles, createCostingRequest } from "../src/lib/costing/requests";
import type { UserRole } from "../src/lib/auth/roles";
import { createMockSupabase, inserts, type Responder } from "./helpers/supabase-mock";

const { mocks } = vi.hoisted(() => ({ mocks: { client: null as unknown } }));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: () => mocks.client
}));

afterEach(() => {
  mocks.client = null;
});

// =============================================================================
// 1. EXHAUSTIVE ACTION × ROLE MATRIX
// =============================================================================

const ACTIONS = [
  "send_to_factory",
  "submit",
  "clarify",
  "costing_complete",
  "costing_clarify",
  "approve",
  "reject"
] as const;

const ROLES: UserRole[] = ["superadmin", "admin", "manager", "pbd", "costing", "factory", "md", "viewer"];

// Engine-level role gates (mirrors assertActionAllowed). send_to_factory /
// submit / clarify carry NO engine gate — the route layer gates them
// (PBD or Admin in actions/route.ts, Factory or Admin in cbd/route.ts).
// Viewer passing them here is intentional and covered by that layering.
const ALLOWED_BY_ACTION: Record<string, UserRole[]> = {
  send_to_factory: ROLES,
  submit: ROLES,
  clarify: ROLES,
  costing_complete: ["superadmin", "admin", "costing"],
  costing_clarify: ["superadmin", "admin", "costing"],
  approve: ["superadmin", "admin", "pbd"],
  reject: ["superadmin", "admin", "pbd"]
};

const GATE_MESSAGE: Record<string, string> = {
  costing_complete: 'Action "costing_complete" requires Costing Team or Admin role',
  costing_clarify: 'Action "costing_clarify" requires Costing Team or Admin role',
  approve: 'Action "approve" requires PBD or Admin role',
  reject: 'Action "reject" requires PBD or Admin role'
};

describe("DESTRUCTIVE 1 — action × role matrix (56 combos)", () => {
  it.each(ACTIONS.flatMap((action) => ROLES.map((role) => [action, role] as const)))(
    "%s as %s",
    (action, role) => {
      const expected = ALLOWED_BY_ACTION[action].includes(role) ? null : GATE_MESSAGE[action];
      expect(assertActionAllowed(action, role), `${action}/${role}`).toBe(expected);
    }
  );

  it("treats missing/undefined role as viewer (least privilege)", () => {
    for (const action of ["approve", "reject", "costing_complete", "costing_clarify"]) {
      expect(assertActionAllowed(action), `${action} undefined`).toBe(GATE_MESSAGE[action]);
      expect(assertActionAllowed(action, null), `${action} null`).toBe(GATE_MESSAGE[action]);
      expect(assertActionAllowed(action, ""), `${action} empty`).toBe(GATE_MESSAGE[action]);
    }
  });

  it("rejects case-mangled and unknown action names before any role check", () => {
    expect(assertActionAllowed("APPROVE", "pbd")).toBe("Invalid action");
    expect(assertActionAllowed("approve ", "pbd")).toBe("Invalid action");
    expect(assertActionAllowed("manager_Approve", "manager")).toBe("Invalid action");
    expect(assertActionAllowed("delete", "superadmin")).toBe("Invalid action");
    expect(assertActionAllowed("cancel", "admin")).toBe("Invalid action");
    expect(assertActionAllowed("close", "admin")).toBe("Invalid action");
    expect(assertActionAllowed("", "admin")).toBe("Invalid action");
  });

  it("rejects the retired Manager action endpoints for every role", () => {
    for (const action of ["manager_approve", "manager_reject"]) {
      for (const role of ROLES) expect(assertActionAllowed(action, role)).toBe("Invalid action");
    }
  });
});

// =============================================================================
// 2. CBD VALIDATION BOUNDARY BATTERY
// =============================================================================

type CbdInput = Parameters<typeof validateFactoryCbd>[0];

function validCbd(overrides: Record<string, unknown> = {}): CbdInput {
  return {
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
  } as CbdInput;
}

describe("DESTRUCTIVE 2 — CBD validation boundaries", () => {
  it("accepts a clean CBD with zero issues", () => {
    expect(validateFactoryCbd(validCbd())).toEqual([]);
    expect(hasBlockingIssues([])).toBe(false);
  });

  it("flags missing currency as the only blocking (error) rule", () => {
    const issues = validateFactoryCbd(validCbd({ currency: "" }));
    expect(issues.some((i) => i.severity === "error" && i.ruleCode === "missing_currency")).toBe(true);
    expect(hasBlockingIssues(issues)).toBe(true);
  });

  it("rejects zero and negative line unit costs as blocking errors", () => {
    for (const unitCost of ["0", "-1", "-0.01"]) {
      const issues = validateFactoryCbd(validCbd({ lines: [{ materialName: "Yarn", unitCost, consumption: "1" }] }));
      expect(issues.some((i) => i.ruleCode === "invalid_unit_cost"), `unitCost=${unitCost}`).toBe(true);
      expect(hasBlockingIssues(issues), `unitCost=${unitCost}`).toBe(true);
    }
  });

  it("rejects negative line consumption as a blocking error", () => {
    const issues = validateFactoryCbd(validCbd({ lines: [{ materialName: "Yarn", unitCost: "5", consumption: "-0.5" }] }));
    expect(issues.some((i) => i.ruleCode === "invalid_consumption")).toBe(true);
    expect(hasBlockingIssues(issues)).toBe(true);
  });

  it("flags a missing/whitespace material name per line with the exact field path", () => {
    for (const name of ["", "   "]) {
      const issues = validateFactoryCbd(validCbd({ lines: [{ materialName: name, unitCost: "5", consumption: "1" }] }));
      const issue = issues.find((i) => i.ruleCode === "missing_material_name");
      expect(issue).toBeTruthy();
      expect(issue!.fieldPath).toBe("lines.0.materialName");
      expect(hasBlockingIssues(issues)).toBe(true);
    }
  });

  it("warns (non-blocking) when no material lines are submitted", () => {
    const issues = validateFactoryCbd(validCbd({ lines: [] }));
    expect(issues.some((i) => i.ruleCode === "no_material_lines" && i.severity === "warning")).toBe(true);
    expect(hasBlockingIssues(issues)).toBe(false);
  });

  it("warns (non-blocking) for missing header numbers, but never crashes on NaN/Infinity", () => {
    const issues = validateFactoryCbd(validCbd({ laborCost: "NaN", overheadCost: "Infinity", moq: "", packagingCost: "abc" }));
    for (const code of ["missing_labor_cost", "missing_overhead_cost", "missing_moq", "missing_packagingCost"]) {
      expect(issues.some((i) => i.ruleCode === code && i.severity === "warning"), code).toBe(true);
    }
    expect(hasBlockingIssues(issues)).toBe(false);
  });

  it("parses comma-formatted numbers as valid", () => {
    const issues = validateFactoryCbd(validCbd({ laborCost: "1,234.56", lines: [{ materialName: "Yarn", unitCost: "1,000.50", consumption: "1" }] }));
    expect(issues.filter((i) => i.ruleCode.startsWith("missing_") || i.ruleCode.startsWith("invalid_"))).toEqual([]);
  });

  it("DOCUMENTED BEHAVIOR: negative top-level costs pass the pure validator", () => {
    // validateFactoryCbd only null-checks the top-level header numbers; the
    // route-level Zod schema (cbdSubmitSchema -> optionalNumber.min(0)) is what
    // rejects negative laborCost/overheadCost with a 400. This layering means
    // any NON-route caller of submitFactoryCbd could slip negatives through the
    // validator — flagged as a hardening opportunity, not a current bug.
    const issues = validateFactoryCbd(validCbd({ laborCost: "-5", overheadCost: "-3", profitMargin: "150", dutyRate: "200" }));
    expect(issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(hasBlockingIssues(issues)).toBe(false);
  });

  it("hasBlockingIssues only counts severity === error", () => {
    const warnings = [
      { severity: "warning" as const, ruleCode: "w1", message: "w" },
      { severity: "info" as const, ruleCode: "i1", message: "i" }
    ];
    expect(hasBlockingIssues(warnings)).toBe(false);
    expect(hasBlockingIssues([...warnings, { severity: "error" as const, ruleCode: "e1", message: "e" }])).toBe(true);
  });
});

// =============================================================================
// 3. BENCHMARK VARIANCE EXTREMES
// =============================================================================

describe("DESTRUCTIVE 3 — benchmark variance extremes", () => {
  it("flags nothing exactly AT the threshold (strict inequality)", () => {
    expect(validateBenchmarkVariance({ currentTotal: 11.5, historicalAverage: 10, sampleSize: 3, variancePercent: 15, thresholdPercent: 15 })).toEqual([]);
    expect(validateBenchmarkVariance({ currentTotal: 8.5, historicalAverage: 10, sampleSize: 3, variancePercent: -15, thresholdPercent: 15 })).toEqual([]);
  });

  it("flags huge positive variance as a warning and huge negative as info", () => {
    const high = validateBenchmarkVariance({ currentTotal: 100, historicalAverage: 10, sampleSize: 3, variancePercent: 900 });
    expect(high[0]?.ruleCode).toBe("high_historical_variance");
    expect(high[0]?.severity).toBe("warning");

    const low = validateBenchmarkVariance({ currentTotal: 1, historicalAverage: 10, sampleSize: 3, variancePercent: -90 });
    expect(low[0]?.ruleCode).toBe("low_historical_variance");
    expect(low[0]?.severity).toBe("info");
  });

  it("returns no flags for degenerate inputs (no sample, nulls, NaN)", () => {
    expect(validateBenchmarkVariance({ currentTotal: 12, historicalAverage: 10, sampleSize: 0, variancePercent: 20 })).toEqual([]);
    expect(validateBenchmarkVariance({ currentTotal: null, historicalAverage: 10, sampleSize: 3, variancePercent: 20 })).toEqual([]);
    expect(validateBenchmarkVariance({ currentTotal: 12, historicalAverage: null, sampleSize: 3, variancePercent: 20 })).toEqual([]);
    expect(validateBenchmarkVariance({ currentTotal: 12, historicalAverage: 10, sampleSize: 3, variancePercent: NaN })).toEqual([]);
  });

  it("honors a custom threshold and appends the currency-conversion note", () => {
    const tight = validateBenchmarkVariance({ currentTotal: 11, historicalAverage: 10, sampleSize: 3, variancePercent: 10, thresholdPercent: 5 });
    expect(tight[0]?.ruleCode).toBe("high_historical_variance");

    const loose = validateBenchmarkVariance({ currentTotal: 11, historicalAverage: 10, sampleSize: 3, variancePercent: 10, thresholdPercent: 15 });
    expect(loose).toEqual([]);

    const noted = validateBenchmarkVariance({ currentTotal: 12, historicalAverage: 10, sampleSize: 3, variancePercent: 20, convertedCount: 2, convertedFrom: ["PHP", "EUR"] });
    expect(noted[0]?.message).toContain("2 record(s) converted from PHP, EUR");
  });
});

// =============================================================================
// 4. ROLE REQUEST-LIST VISIBILITY MATRIX
// =============================================================================

const ALL_STATUSES = [
  "draft",
  "sent_to_factory",
  "needs_clarification",
  "for_md_review",
  "for_costing_review",
  "for_pbd_review",
  "approved",
  "rejected"
];

const EXPECTED_VISIBILITY: Record<UserRole, string[]> = {
  superadmin: ALL_STATUSES,
  admin: ALL_STATUSES,
  viewer: ALL_STATUSES, // read-only dashboards: sees everything
  pbd: ALL_STATUSES, // owns the request end-to-end
  costing: ["for_md_review", "for_costing_review", "for_pbd_review", "needs_clarification", "approved", "rejected"],
  factory: ["draft", "sent_to_factory", "needs_clarification", "rejected"],
  manager: ["for_pbd_review", "approved", "rejected"],
  md: ["for_md_review", "for_costing_review", "for_pbd_review", "needs_clarification"]
};

describe("DESTRUCTIVE 4 — role visibility matrix (8 roles x 8 statuses)", () => {
  it.each(ROLES)("%s sees exactly its documented status set", (role) => {
    const actual = getStatusesForRoles([role]).sort();
    expect(actual).toEqual([...EXPECTED_VISIBILITY[role]].sort());
  });

  it("an empty roles list leaks nothing (no statuses at all)", () => {
    expect(getStatusesForRoles([])).toEqual([]);
  });

  it("multi-role sessions union their visibility", () => {
    const union = getStatusesForRoles(["factory", "md"]).sort();
    expect(union).toEqual(
      [...new Set([...EXPECTED_VISIBILITY.factory, ...EXPECTED_VISIBILITY.md])].sort()
    );
  });
});

// =============================================================================
// 5. createCostingRequest DESTRUCTIVE GATES
// =============================================================================

function createResponder(opts: { duplicate?: boolean } = {}): Responder {
  return {
    nextgen_products: {
      single: () => ({ data: { id: "prod-1" }, error: null })
    },
    costing_requests: {
      // Duplicate-active check (.select(...).limit(1))
      select: () =>
        opts.duplicate
          ? { data: [{ id: "req-dup", request_number: "CR-123456", status: "for_pbd_review" }], error: null }
          : { data: [], error: null },
      // Request insert (.insert().select().single())
      single: () => ({ data: { id: "req-1", request_number: "CR-654321", status: "draft" }, error: null })
    },
    nextgen_bom_lines: {
      delete: () => ({ data: [], error: null }),
      insert: () => ({ data: [], error: null })
    }
  };
}

function requestInsertPayload(calls: ReturnType<typeof createMockSupabase>["calls"]) {
  const call = calls.find((c) => c.table === "costing_requests" && c.terminal === "single");
  return call!.chain.payload as Record<string, unknown>;
}

describe("DESTRUCTIVE 5 — createCostingRequest gates", () => {
  it("creates a draft with a CR-XXXXXX request number and normal priority", async () => {
    const { client, calls } = createMockSupabase(createResponder());
    mocks.client = client;

    const request = await createCostingRequest({ styleNumber: "M88-1", factoryName: "Cebu Factory" });

    expect(request.id).toBe("req-1");
    const payload = requestInsertPayload(calls);
    expect(payload).toMatchObject({ status: "draft", priority: "normal", factory_name: "Cebu Factory", product_id: "prod-1" });
    expect(String(payload.request_number)).toMatch(/^CR-\d{6}$/);
  });

  it("BLOCKS a duplicate active request for the same style/factory", async () => {
    const { client } = createMockSupabase(createResponder({ duplicate: true }));
    mocks.client = client;

    await expect(
      createCostingRequest({ styleNumber: "M88-1", factoryName: "Cebu Factory" })
    ).rejects.toThrow("Duplicate active request exists for this style/factory: CR-123456");
  });

  it("forceCreate bypasses the duplicate block", async () => {
    const { client, calls } = createMockSupabase(createResponder({ duplicate: true }));
    mocks.client = client;

    const request = await createCostingRequest({ styleNumber: "M88-1", factoryName: "Cebu Factory", forceCreate: true });
    expect(request.id).toBe("req-1");
    // The duplicate check ran (select was consulted) but creation proceeded.
    expect(calls.some((c) => c.table === "costing_requests" && c.terminal === "select")).toBe(true);
  });

  it("skips the duplicate check entirely when no factory is named", async () => {
    const { client, calls } = createMockSupabase(createResponder());
    mocks.client = client;

    await createCostingRequest({ styleNumber: "M88-1" });
    expect(calls.filter((c) => c.table === "costing_requests" && c.terminal === "select")).toHaveLength(0);
  });

  it("replaces the BOM snapshot (delete old lines, insert mapped lines with parsed consumption)", async () => {
    const { client, calls } = createMockSupabase(createResponder());
    mocks.client = client;

    await createCostingRequest({
      styleNumber: "M88-1",
      bomLines: [
        { materialName: "Yarn", usage: "1,200", size: "kg" },
        { materialName: "Neck Tape", usage: "0.05", quotePrice: "3.50" }
      ]
    });

    const deletes = calls.filter((c) => c.table === "nextgen_bom_lines" && c.terminal === "delete");
    expect(deletes).toHaveLength(1);
    expect(deletes[0].chain.eq).toEqual([["product_id", "prod-1"]]);

    const bomInserts = inserts(calls, "nextgen_bom_lines");
    expect(bomInserts).toHaveLength(1);
    const lines = bomInserts[0] as Array<Record<string, unknown>>;
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ product_id: "prod-1", material_name: "Yarn", consumption: 1200, uom: "kg" });
    expect(lines[1]).toMatchObject({ material_name: "Neck Tape", consumption: 0.05, quote_price: 3.5 });
  });

  it("propagates DB failures instead of swallowing them", async () => {
    const responder = createResponder();
    responder.nextgen_products.single = () => ({ data: null, error: { message: "product upsert down" } });
    const { client } = createMockSupabase(responder);
    mocks.client = client;
    await expect(createCostingRequest({ styleNumber: "M88-1" })).rejects.toThrow("product upsert down");

    const responder2 = createResponder();
    responder2.nextgen_bom_lines.insert = () => ({ data: null, error: { message: "bom insert down" } });
    const { client: client2 } = createMockSupabase(responder2);
    mocks.client = client2;
    await expect(
      createCostingRequest({ styleNumber: "M88-1", bomLines: [{ materialName: "Yarn" }] })
    ).rejects.toThrow("bom insert down");
  });
});

// =============================================================================
// 6. runCostingAction DESTRUCTIVE EXTRAS
// =============================================================================

function simpleResponder(fromStatus: string): Responder {
  return {
    costing_requests: {
      single: () => ({ data: { status: fromStatus }, error: null }),
      select: () => ({ data: [{ id: "req-1" }], error: null })
    },
    approval_actions: { insert: () => ({ data: [], error: null }) },
    workflow_events: { insert: () => ({ data: [], error: null }) }
  };
}

describe("DESTRUCTIVE 6 — runCostingAction extras", () => {
  it("send_to_factory advances draft to sent_to_factory with no customer-status side effects", async () => {
    const { client, calls } = createMockSupabase(simpleResponder("draft"));
    mocks.client = client;

    const result = await runCostingAction("req-1", "send_to_factory", "send it", "pbd", "PBD User");
    expect(result).toEqual({ status: "sent_to_factory" });

    const requestUpdates = calls.filter((c) => c.table === "costing_requests" && c.terminal === "select" && c.chain.payload);
    expect(requestUpdates[0].chain.payload).toMatchObject({ status: "sent_to_factory" });
    expect(requestUpdates[0].chain.payload).not.toHaveProperty("customer_status");
    // The optimistic lock pins the from-status so a concurrent move loses.
    expect(requestUpdates[0].chain.eq).toEqual([
      ["id", "req-1"],
      ["status", "draft"]
    ]);
  });

  it("rejects retired Manager actions without touching the database", async () => {
    const { client, calls } = createMockSupabase({});
    mocks.client = client;

    await expect(runCostingAction("req-1", "manager_reject", "too expensive", "manager", "Lovy")).rejects.toThrow("Invalid action");
    expect(calls).toHaveLength(0);
  });

  it("DB chaos: a failing audit insert aborts the action instead of being ignored", async () => {
    const responder = simpleResponder("draft");
    responder.approval_actions.insert = () => ({ data: null, error: { message: "audit table down" } });
    const { client } = createMockSupabase(responder);
    mocks.client = client;

    await expect(runCostingAction("req-1", "send_to_factory", null, "pbd")).rejects.toThrow("audit table down");
  });

  it("DB chaos: a failing status read aborts before anything is written", async () => {
    const responder = simpleResponder("draft");
    responder.costing_requests.single = () => ({ data: null, error: { message: "costing_requests down" } });
    const { client, calls } = createMockSupabase(responder);
    mocks.client = client;

    await expect(runCostingAction("req-1", "send_to_factory", null, "pbd")).rejects.toThrow("costing_requests down");
    expect(inserts(calls, "approval_actions")).toHaveLength(0);
  });
});
