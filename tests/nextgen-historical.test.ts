import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  historicalDedupKey,
  mapNextGenProductToHistorical,
  NEXTGEN_HISTORICAL_EXCLUSION_REASON,
  NEXTGEN_HISTORICAL_SOURCE,
  statusFilter
} from "../src/lib/nextgen/historical";

// Real product-grid row shape captured live from NextGen
// (ProductManagerProductsGrid/Read).
const productRow = {
  Id: 14451,
  Name: "M88100481 - 3",
  Description: "DIRECTIONAL RIB CUFF HAT",
  StatusName: "Dropped",
  IsClosed: false,
  RangeName: "FH:2018",
  CustomerName: "Calvin Klein",
  DivisionName: "PVH",
  ExternalReference: "CK-F18-0082",
  CommodityTypeName: "Hats",
  DefaultCostingName: "00000001941",
  DefaultProductCostingCostingPurchasePrice: 2.85,
  DefaultProductCostingCostingSellingPrice: 4.3,
  DefaultProductCostingCostingPurchaseCurrencyName: "USD",
  DefaultProductCostingCostingProductSupplierName: "Hangzhou U-Jump Arts and Crafts Co. Ltd",
  OriginalId: 14267,
  OriginalName: "M88100481 - 2",
  OriginalRange: "FH:2018",
  CreatedDateTime: "2017-09-12T10:11:46.029",
  LastEditedDateTime: "2018-04-26T17:00:01.636",
  ClosedDate: null,
  CompositionConcatenated: "100% Acrylic"
};

describe("mapNextGenProductToHistorical", () => {
  it("maps SKU, default costing, supplier, and lifecycle into the historical shape", () => {
    const r = mapNextGenProductToHistorical(productRow);

    expect(r.style_number).toBe("M88100481 - 3");
    expect(r.factory_name).toBe("Hangzhou U-Jump Arts and Crafts Co. Ltd");
    expect(r.currency).toBe("USD");
    expect(r.total_cost).toBe(2.85);
    expect(r.product_category).toBe("Hats");
    expect(r.yarn_type).toBe("100% Acrylic");
    expect(r.customer).toBe("Calvin Klein");
    expect(r.brand).toBe("PVH");
    expect(r.season).toBe("FH:2018");
    expect(r.approved_at).toBe("2018-04-26T17:00:01.636"); // ClosedDate null → LastEditedDateTime
    expect(r.nextgen_entity_id).toBe("14451");
    expect(r.source).toBe(NEXTGEN_HISTORICAL_SOURCE);
    expect(r.benchmark_excluded).toBe(true);
    expect(r.benchmark_exclusion_reason).toBe(NEXTGEN_HISTORICAL_EXCLUSION_REASON);
    expect(r.raw_payload).toBe(productRow);

    // Searchable text carries the SKU aliases for ilike search
    expect(r.searchable_text).toContain("M88100481 - 3");
    expect(r.searchable_text).toContain("CK-F18-0082");
    expect(r.searchable_text).toContain("Calvin Klein");
    expect(r.searchable_text).toContain("M88100481 - 2");
  });

  it("prefers ClosedDate for approved_at and falls back to creation date", () => {
    const closed = mapNextGenProductToHistorical({ ...productRow, ClosedDate: "2018-01-05T00:00:00" });
    expect(closed.approved_at).toBe("2018-01-05T00:00:00");

    const minimal = mapNextGenProductToHistorical({ Id: 9, Name: "S1", CreatedDateTime: "2016-03-01T00:00:00" });
    expect(minimal.approved_at).toBe("2016-03-01T00:00:00");
    expect(minimal.total_cost).toBeNull();
    expect(minimal.currency).toBe("USD"); // default
    expect(minimal.factory_name).toBeNull();
  });

  it("falls back to TargetMinimumPurchasePrice when no default costing exists", () => {
    const r = mapNextGenProductToHistorical({
      Id: 5,
      Name: "S2",
      TargetMinimumPurchasePrice: "1.25"
    });
    expect(r.total_cost).toBe(1.25);
  });
});

describe("historicalDedupKey", () => {
  it("is case-insensitive and ignores surrounding whitespace", () => {
    expect(historicalDedupKey(" M88-1 ", "Hangzhou")).toBe(historicalDedupKey("m88-1", "hangzhou"));
    expect(historicalDedupKey("A", null)).toBe(historicalDedupKey("a", null));
  });
});

describe("statusFilter", () => {
  it("escapes single quotes", () => {
    expect(statusFilter("Dropped")).toBe("StatusName~eq~'Dropped'");
    expect(statusFilter("O'Brien")).toBe("StatusName~eq~'O''Brien'");
  });
});

// --- fetch + enrich behavior against mocked NextGen ---
import { fetchBom } from "../src/lib/nextgen/bom";
import { nextGenPost } from "../src/lib/nextgen/client";
import { enrichWithBomConsumption, fetchNextGenHistoricalProducts } from "../src/lib/nextgen/historical";

vi.mock("../src/lib/nextgen/client", () => ({ nextGenPost: vi.fn() }));
vi.mock("../src/lib/nextgen/bom", () => ({ fetchBom: vi.fn() }));

const mockedPost = vi.mocked(nextGenPost);
const mockedBom = vi.mocked(fetchBom);

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchNextGenHistoricalProducts", () => {
  it("pages through full grid pages and dedups by entity id", async () => {
    const page1 = { Data: Array.from({ length: 200 }, (_, i) => ({ Id: i + 1, Name: `S${i + 1}` })), Total: 250 };
    const page2 = { Data: Array.from({ length: 50 }, (_, i) => ({ Id: 201 + i, Name: `S${201 + i}` })), Total: 250 };
    mockedPost.mockResolvedValueOnce({ ok: true, status: 200, upstreamContentType: "application/json", body: page1 });
    mockedPost.mockResolvedValueOnce({ ok: true, status: 200, upstreamContentType: "application/json", body: page2 });

    const result = await fetchNextGenHistoricalProducts(["Dropped"], undefined);

    expect(mockedPost).toHaveBeenCalledTimes(2);
    expect(result.rows).toHaveLength(250);
    expect(result.rows[0].Id).toBe(1);
    expect(result.rows[249].Id).toBe(250);
    expect(result.perStatus).toEqual([{ status: "Dropped", total: 250 }]);
  });

  it("dedups a duplicate entity id across pages", async () => {
    const page1 = { Data: Array.from({ length: 200 }, (_, i) => ({ Id: i + 1, Name: `S${i + 1}` })), Total: 250 };
    const page2 = { Data: Array.from({ length: 50 }, (_, i) => ({ Id: 201 + i, Name: `S${201 + i}` })), Total: 250 };
    page2.Data[0].Id = 200; // duplicate of page1's last row
    mockedPost.mockResolvedValueOnce({ ok: true, status: 200, upstreamContentType: "application/json", body: page1 });
    mockedPost.mockResolvedValueOnce({ ok: true, status: 200, upstreamContentType: "application/json", body: page2 });

    const result = await fetchNextGenHistoricalProducts(["Dropped"], undefined);

    expect(result.rows).toHaveLength(249);
    expect(result.rows[249]).toBeUndefined();
  });

  it("respects the limit cap and stops paging", async () => {
    mockedPost.mockResolvedValue({ ok: true, status: 200, upstreamContentType: "application/json", body: { Data: [{ Id: 1, Name: "S1" }, { Id: 2, Name: "S2" }], Total: 100 } });

    const result = await fetchNextGenHistoricalProducts(["Dropped"], 2);

    expect(result.rows).toHaveLength(2);
    expect(mockedPost).toHaveBeenCalledTimes(1);
  });

  it("throws on upstream failure", async () => {
    mockedPost.mockResolvedValue({ ok: false, status: 500, upstreamContentType: "text/html", body: "boom" });

    await expect(fetchNextGenHistoricalProducts(["Dropped"], 1)).rejects.toThrow(/HTTP 500/);
  });
});

describe("enrichWithBomConsumption", () => {
  it("sums DefaultRating usage across BOM lines (best-effort)", async () => {
    const record = mapNextGenProductToHistorical({ Id: 14451, Name: "M88" });
    mockedBom.mockResolvedValue({
      ok: true,
      status: 200,
      upstreamContentType: "application/json",
      data: [
        { id: "1", category: "Yarn", materialName: "A", usage: 0.4 },
        { id: "2", category: "Trim", materialName: "B", usage: "0.15" }
      ],
      total: 2,
      rawBody: {}
    });

    await enrichWithBomConsumption([record], 10);

    expect(record.average_consumption).toBeCloseTo(0.55);
  });

  it("keeps consumption null when BOM fetch fails or is empty", async () => {
    const record = mapNextGenProductToHistorical({ Id: 14451, Name: "M88" });
    mockedBom.mockResolvedValue({
      ok: false,
      status: 500,
      upstreamContentType: "text/html",
      data: [],
      total: 0,
      rawBody: {}
    });

    await enrichWithBomConsumption([record], 10);
    expect(record.average_consumption).toBeUndefined();
  });
});

describe("knitting_time mapping", () => {
  it("maps GsdSMV into knitting_time", () => {
    const record = mapNextGenProductToHistorical({ ...productRow, GsdSMV: 0.42 });
    expect(record.knitting_time).toBe(0.42);
  });

  it("falls back across the SMV variants (SMV → FactoryTime → AllowedTime)", () => {
    const record = mapNextGenProductToHistorical({ ...productRow, SMV: 0.45, FactoryTime: 0.51 });
    expect(record.knitting_time).toBe(0.45);

    const factory = mapNextGenProductToHistorical({ ...productRow, AllowedTime: 0.48, FactoryTime: 0.51 });
    expect(factory.knitting_time).toBe(0.51);

    const allowed = mapNextGenProductToHistorical({ ...productRow, AllowedTime: 0.48 });
    expect(allowed.knitting_time).toBe(0.48);
  });

  it("keeps knitting_time null when no time fields exist in the row", () => {
    const record = mapNextGenProductToHistorical(productRow);
    expect(record.knitting_time).toBeNull();
  });
});
