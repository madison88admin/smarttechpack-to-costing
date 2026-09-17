import { afterEach, describe, expect, it, vi } from "vitest";

// NextGen pricing: parsing, snapshot extraction, the ERP fetch, and the lazy
// resolution that keeps PBD from typing a price the ERP already carries.
// Contract, in one place:
//   - a price is only a positive finite number; everything else is "unknown"
//   - extraction is the single answer to "what does this snapshot carry", used
//     by both request creation and the lazy resolution below
//   - the ERP fetch never throws and never returns a partial row
//   - resolution reads the snapshot; when it has no selling price it looks the
//     entity up ONCE, merges without overwriting stored keys, caches the merge,
//     and repeats are absorbed by the attempt guard
//   - locally created styles (`manual:<style>`) are never looked up

const { mocks } = vi.hoisted(() => ({ mocks: { client: null as unknown } }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: () => mocks.client
}));

const { nextGenPostMock } = vi.hoisted(() => ({
  nextGenPostMock: { fn: null as null | ((...args: unknown[]) => unknown) }
}));
vi.mock("@/lib/nextgen/client", () => ({
  nextGenPost: (...args: unknown[]) => {
    if (!nextGenPostMock.fn) throw new Error("nextGenPost not stubbed");
    return nextGenPostMock.fn(...args);
  }
}));

import { createMockSupabase, updates } from "./helpers/supabase-mock";
import {
  fetchNextGenPricingSnapshot,
  getNextGenPricingForRequest,
  nextGenPricingFromRaw,
  resetPricingAttemptCache
} from "../src/lib/costing/nextgen-pricing";

afterEach(() => {
  mocks.client = null;
  nextGenPostMock.fn = null;
  resetPricingAttemptCache();
});

const NO_PRICING = { sellingPrice: null, landedCost: null, purchasePrice: null, margin: null, currency: null };

/** An ERP grid row carrying the ported costing prices. */
const erpRow = (selling?: string, purchase?: string, currency?: string) => ({
  ...(selling ? { DefaultProductCostingCostingSellingPrice: selling } : {}),
  ...(purchase ? { DefaultProductCostingCostingPurchasePrice: purchase } : {}),
  ...(currency ? { DefaultProductCostingCostingPurchaseCurrencyName: currency } : {})
});

/** A stored snapshot as the pricing port writes it. */
const snapshot = (raw: Record<string, unknown>) => ({ id: "prod-1", nextgen_entity_id: "12993", raw_payload: raw });

/** Fake ERP grid: answers `Id~eq~'<id>'` from a per-entity row map. */
function stubErp(rowsByEntityId: Record<string, unknown>, calls: string[] = []) {
  nextGenPostMock.fn = async (...args: unknown[]) => {
    const filter = String((args[1] as { filter?: string } | undefined)?.filter ?? "");
    const entityId = /Id~eq~'([^']*)'/.exec(filter)?.[1] ?? "";
    calls.push(entityId);
    const row = rowsByEntityId[entityId];
    return { ok: true, body: { Data: row ? [row] : [] } };
  };
  return calls;
}

/** Points the request read at a product join row and records DB calls. */
function stubRequest(product: Record<string, unknown> | null) {
  const { client, calls } = createMockSupabase({
    costing_requests: {
      single: () => ({ data: { nextgen_products: product ? [product] : [] }, error: null })
    }
  });
  mocks.client = client;
  return calls;
}

describe("price parsing", () => {
  // Exercised through the extractor: the only way a stored snapshot exposes a
  // price, so these boundaries are the ones that actually reach the app.
  it.each([
    ["erp strings", "15.00", 15],
    ["dollar signs", "$12.50", 12.5],
    ["prefixed currency", "USD 9.99", 9.99],
    ["numbers", 7, 7],
    ["zero", "0", null],
    ["zero decimals", "0.00", null],
    ["negative", "-3", null],
    ["blank", "", null],
    ["null", null, null],
    ["undefined", undefined, null],
    ["non-numeric", "N/A", null]
  ])("reads %s as the right selling price", (_label, input, expected) => {
    expect(nextGenPricingFromRaw({ DefaultProductCostingCostingSellingPrice: input }).sellingPrice).toBe(expected);
  });
});

describe("nextGenPricingFromRaw", () => {
  it.each([
    [
      "a full port",
      {
        DefaultProductCostingCostingSellingPrice: "15.00",
        DefaultProductCostingCostingPurchasePrice: "9.00",
        DefaultProductCostingCostingSellingCurrencyName: "USD"
      },
      { sellingPrice: 15, landedCost: null, purchasePrice: 9, margin: null, currency: "USD" }
    ],
    ["target price fallback", { TargetMaximumSellingPrice: "20", TargetMinimumPurchasePrice: "11" }, { sellingPrice: 20, landedCost: null, purchasePrice: 11, margin: null, currency: null }],
    // The Financial-FOB columns the ERP writes positionally on the grid row.
    [
      "the costing sheet's landed cost and margin",
      {
        DefaultProductCostingCostingSellingPrice: "3.75",
        DefaultProductCostingCostingPurchasePrice: "2.98",
        CostingSheetValue2: "0.2",
        CostingSheetValue3: "0.15",
        CostingSheetValue4: "3.37",
        CostingSheetValue5: "0.38"
      },
      { sellingPrice: 3.75, landedCost: 3.37, purchasePrice: 2.98, margin: 0.38, currency: null }
    ],
    [
      "a zero margin as a real margin",
      { DefaultProductCostingCostingPurchasePrice: "3.75", CostingSheetValue4: "3.75", CostingSheetValue5: "0" },
      { sellingPrice: null, landedCost: 3.75, purchasePrice: 3.75, margin: 0, currency: null }
    ],
    // A landed cost below the FOB it is built from means the column is not the
    // landed total — better nothing than a margin the ERP never claimed.
    [
      "ignores a sheet landed cost below FOB",
      { DefaultProductCostingCostingPurchasePrice: "2.98", CostingSheetValue4: "1.00", CostingSheetValue5: "2.75" },
      { sellingPrice: null, landedCost: null, purchasePrice: 2.98, margin: null, currency: null }
    ],
    [
      "purchase currency winning when both are ported",
      {
        DefaultProductCostingCostingSellingPrice: "4",
        DefaultProductCostingCostingPurchaseCurrencyName: "USD",
        DefaultProductCostingCostingSellingCurrencyName: "EUR"
      },
      { sellingPrice: 4, landedCost: null, purchasePrice: null, margin: null, currency: "USD" }
    ],
    ["a snapshot with no price", { notes: null, source: "nextgen", DefaultProductCostingCostingProductSupplierName: "Hangzhou" }, NO_PRICING],
    ["a landed cost with no selling price", { DefaultProductCostingCostingPurchasePrice: "9.00" }, { sellingPrice: null, landedCost: null, purchasePrice: 9, margin: null, currency: null }],
    ["an empty snapshot", {}, NO_PRICING],
    ["a null snapshot", null, NO_PRICING]
  ])("reads %s", (_label, raw, expected) => {
    expect(nextGenPricingFromRaw(raw)).toEqual(expected);
  });
});

describe("fetchNextGenPricingSnapshot", () => {
  it("queries the product grid by entity id and keeps only the pricing keys", async () => {
    const calls = stubErp({ "12688": { Id: "12688", Name: "BIRD HEAD TOQUE", ...erpRow("3.75", "2.98"), JunkColumn: "ignored" } });

    await expect(fetchNextGenPricingSnapshot("12688")).resolves.toEqual(erpRow("3.75", "2.98"));
    expect(calls).toEqual(["12688"]);
  });

  it("keeps the costing sheet's columns, which hold the landed cost and margin", async () => {
    stubErp({
      "12688": {
        Id: "12688",
        ...erpRow("3.75", "2.98", "USD"),
        CostingSheetValue2: 0.2,
        CostingSheetValue3: 0.15,
        CostingSheetValue4: 3.37,
        CostingSheetValue5: 0.38,
        SomeOtherColumn: "ignored"
      }
    });

    const snapshot = await fetchNextGenPricingSnapshot("12688");
    expect(snapshot).toEqual({ ...erpRow("3.75", "2.98", "USD"), CostingSheetValue2: 0.2, CostingSheetValue3: 0.15, CostingSheetValue4: 3.37, CostingSheetValue5: 0.38 });
    // …and the captured row now resolves the three figures PBD reads.
    expect(nextGenPricingFromRaw(snapshot)).toEqual({
      sellingPrice: 3.75,
      landedCost: 3.37,
      purchasePrice: 2.98,
      margin: 0.38,
      currency: "USD"
    });
  });

  it.each([
    ["an unknown style", async () => ({ ok: true, body: { Data: [], Total: 0 } }), null],
    ["an upstream failure", async () => ({ ok: false, body: null }), null],
    ["an unreachable ERP", async () => { throw new Error("down"); }, null],
    ["a blank response body", async () => ({ ok: true, body: null }), null]
  ])("returns null for %s", async (_label, respond, expected) => {
    nextGenPostMock.fn = respond as (...args: unknown[]) => unknown;
    await expect(fetchNextGenPricingSnapshot("1")).resolves.toBe(expected);
  });

  it("never calls the ERP for a blank entity id", async () => {
    const calls = stubErp({});
    await expect(fetchNextGenPricingSnapshot("  ")).resolves.toBeNull();
    expect(calls).toEqual([]);
  });
});

describe("getNextGenPricingForRequest", () => {
  it.each([
    {
      name: "reads a priced snapshot without touching the ERP",
      product: snapshot({ DefaultProductCostingCostingSellingPrice: "15.00" }),
      erp: {},
      expected: { sellingPrice: 15, landedCost: null, purchasePrice: null, margin: null, currency: null },
      erpCalls: 0,
      writes: 0
    },
    {
      name: "fetches, merges, caches and returns when the snapshot has no price",
      product: snapshot({ source: "nextgen", notes: null }),
      erp: { "12993": erpRow("3.45", "2.42", "USD") },
      expected: { sellingPrice: 3.45, landedCost: null, purchasePrice: 2.42, margin: null, currency: "USD" },
      erpCalls: 1,
      writes: 1
    },
    {
      name: "stays unpriced and writes nothing when the ERP has no price either",
      product: { ...snapshot({ source: "nextgen" }), nextgen_entity_id: "999999999" },
      erp: {},
      expected: NO_PRICING,
      erpCalls: 1,
      writes: 0
    },
    {
      name: "never looks up a locally created style",
      product: { ...snapshot({ source: "manual" }), nextgen_entity_id: "manual:STYLE-1" },
      erp: { "manual:STYLE-1": erpRow("9") },
      expected: NO_PRICING,
      erpCalls: 0,
      writes: 0
    },
    {
      name: "returns nulls when the request has no product row",
      product: null,
      erp: {},
      expected: NO_PRICING,
      erpCalls: 0,
      writes: 0
    }
  ])("$name", async ({ product, erp, expected, erpCalls, writes }) => {
    const erpLookups = stubErp(erp);
    const dbCalls = stubRequest(product);

    await expect(getNextGenPricingForRequest("req-1")).resolves.toEqual(expected);
    expect(erpLookups).toHaveLength(erpCalls);
    expect(updates(dbCalls, "nextgen_products")).toHaveLength(writes);
  });

  it("caches the merge without overwriting keys the snapshot already had", async () => {
    stubErp({ "12993": erpRow("3.45") });
    const dbCalls = stubRequest(snapshot({ source: "nextgen", notes: "keep me" }));

    await getNextGenPricingForRequest("req-1");

    expect(updates(dbCalls, "nextgen_products")).toEqual([
      { raw_payload: { ...erpRow("3.45"), source: "nextgen", notes: "keep me" } }
    ]);
  });

  it("absorbs repeat reads with the attempt guard", async () => {
    const erpLookups = stubErp({ "12993": erpRow("3.45") });
    stubRequest(snapshot({ source: "nextgen" }));

    await expect(getNextGenPricingForRequest("req-1")).resolves.toMatchObject({ sellingPrice: 3.45 });
    // The stubbed snapshot is still priceless, so only the guard can explain
    // the second read not asking the ERP again.
    await expect(getNextGenPricingForRequest("req-1")).resolves.toEqual(NO_PRICING);
    expect(erpLookups).toHaveLength(1);
  });

  it("degrades to nulls on database errors", async () => {
    const { client } = createMockSupabase({
      costing_requests: { single: () => ({ data: null, error: { message: "db down" } }) }
    });
    mocks.client = client;

    await expect(getNextGenPricingForRequest("req-1")).resolves.toEqual(NO_PRICING);
  });
});
