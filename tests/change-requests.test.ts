import { afterEach, describe, expect, it, vi } from "vitest";
import {
  changeValuesMatch,
  createChangeRequest,
  readCbdFieldValue,
  resolveOpenChangeRequests
} from "../src/lib/costing/change-requests";

const { mocks } = vi.hoisted(() => ({ mocks: { client: null as unknown } }));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: () => mocks.client
}));

import { createMockSupabase, inserts, type Responder } from "./helpers/supabase-mock";

afterEach(() => {
  mocks.client = null;
});

describe("changeValuesMatch", () => {
  it("matches numbers loosely and text case-insensitively", () => {
    expect(changeValuesMatch("0.80", 0.8)).toBe(true);
    expect(changeValuesMatch("Flat 7G", "flat 7g")).toBe(true);
    expect(changeValuesMatch("  Flat-7GG  ", "Flat-7GG")).toBe(true);
  });

  it("rejects blanks and genuine differences", () => {
    expect(changeValuesMatch("", "Flat 7G")).toBe(false);
    expect(changeValuesMatch("Flat 7G", "")).toBe(false);
    expect(changeValuesMatch(null, "x")).toBe(false);
    expect(changeValuesMatch("Flat 7G", "Flat 12G")).toBe(false);
    expect(changeValuesMatch("10", "12")).toBe(false);
  });
});

describe("readCbdFieldValue", () => {
  const payload = {
    machineType: "Flat 12G",
    laborCost: 0.75,
    knittingLines: [
      { machineType: "Flat 12G", knittingTime: 12, sah: 0.05, knittingCost: 0.6 },
      { machineType: "Flat 7G", knittingTime: 8, sah: 0.05, knittingCost: 0.4 }
    ],
    yarnLines: [{ name: "Cotton 20/2", consumption: "38", materialPrice: "5.2" }],
    operationsLines: [{ operation: "Linking", operationCost: "0.15" }]
  };

  it("reads top-level keys and header-prefixed keys", () => {
    expect(readCbdFieldValue(payload, null, "machineType")).toBe("Flat 12G");
    expect(readCbdFieldValue(payload, null, "laborCost")).toBe("0.75");
    expect(readCbdFieldValue(payload, null, "header.machineType")).toBe("Flat 12G");
  });

  it("reads structured rows by name, index, and operation identity", () => {
    expect(readCbdFieldValue(payload, null, "yarnLines.Cotton 20/2.materialPrice")).toBe("5.2");
    expect(readCbdFieldValue(payload, null, "knittingLines.1.machineType")).toBe("Flat 7G");
    expect(readCbdFieldValue(payload, null, "knittingLines.0.knittingTime")).toBe("12");
    expect(readCbdFieldValue(payload, null, "operationsLines.Linking.operationCost")).toBe("0.15");
  });

  it("reads legacy material lines by normalized name", () => {
    const legacy = [{ material_name: "Yarn", unit_cost: 5, consumption: 1, total_cost: 5 }];
    expect(readCbdFieldValue({}, legacy, "legacyMaterialLines.yarn.unit_cost")).toBe("5");
    expect(readCbdFieldValue({}, legacy, "legacyMaterialLines.YARN.consumption")).toBe("1");
    expect(readCbdFieldValue({}, [], "legacyMaterialLines.yarn.unit_cost")).toBeNull();
  });

  it("returns null for missing rows, fields, and malformed keys", () => {
    expect(readCbdFieldValue(payload, null, "nope")).toBeNull();
    expect(readCbdFieldValue(payload, null, "yarnLines.Missing.materialPrice")).toBeNull();
    expect(readCbdFieldValue(payload, null, "a.b.c.d")).toBeNull();
    expect(readCbdFieldValue(null, null, "machineType")).toBeNull();
  });
});

describe("createChangeRequest", () => {
  it("rejects missing requested value, reason, and field", async () => {
    const base = {
      costingRequestId: "req-1",
      section: "Knitting & Operations",
      fieldKey: "knittingLines.0.machineType",
      requestedValue: "Flat 7G",
      reason: "Gauge too coarse"
    };
    await expect(createChangeRequest({ ...base, requestedValue: "  " })).rejects.toThrow("Requested value is required");
    await expect(createChangeRequest({ ...base, reason: "" })).rejects.toThrow("Reason is required");
    await expect(createChangeRequest({ ...base, fieldKey: "" })).rejects.toThrow("Field is required");
  });

  it("inserts an open row with normalized priority", async () => {
    const { client, calls } = createMockSupabase({
      cbd_change_requests: {
        single: () => ({ data: { id: "cr-1" }, error: null })
      }
    });
    mocks.client = client;

    const result = await createChangeRequest({
      costingRequestId: "req-1",
      section: "Knitting & Operations",
      fieldKey: "knittingLines.0.machineType",
      fieldLabel: "Machine / Gauge Type",
      currentValue: "Flat 12G",
      requestedValue: "Flat 7G",
      reason: "Gauge too coarse",
      priority: "URGENT",
      requestedByRole: "md"
    });

    expect(result).toEqual({ id: "cr-1" });
    // insert().select().single() records under the final terminal — match by payload.
    const written = calls.filter((c) => c.table === "cbd_change_requests" && c.chain.payload);
    expect(written).toHaveLength(1);
    expect(written[0].chain.payload).toMatchObject({
      costing_request_id: "req-1",
      status: "open",
      priority: "urgent",
      requested_by_role: "md"
    });
  });
});

describe("resolveOpenChangeRequests", () => {
  function resolveResponder(open: Array<{ id: string; field_key: string; requested_value: string }>): Responder {
    return {
      cbd_change_requests: {
        select: () => ({ data: open, error: null }),
        insert: () => ({ data: [], error: null })
      }
    };
  }

  it("addresses rows whose requested value is now present", async () => {
    const { client, calls } = createMockSupabase(
      resolveResponder([
        { id: "cr-1", field_key: "machineType", requested_value: "Flat 7G" },
        { id: "cr-2", field_key: "moq", requested_value: "2000" }
      ])
    );
    mocks.client = client;

    const result = await resolveOpenChangeRequests({
      costingRequestId: "req-1",
      cbdId: "cbd-9",
      rawPayload: { machineType: "Flat 7G", moq: 1000 }
    });

    expect(result).toEqual({ addressed: 1, remaining: 1 });
    const updates = calls.filter((c) => c.table === "cbd_change_requests" && c.terminal === "select" && c.chain.payload);
    expect(updates).toHaveLength(1);
    expect(updates[0].chain.payload).toMatchObject({ status: "addressed", resolved_cbd_id: "cbd-9" });
  });

  it("does nothing when nothing is open", async () => {
    const { client } = createMockSupabase(resolveResponder([]));
    mocks.client = client;

    await expect(
      resolveOpenChangeRequests({ costingRequestId: "req-1", cbdId: "cbd-9", rawPayload: {} })
    ).resolves.toEqual({ addressed: 0, remaining: 0 });
  });
});
