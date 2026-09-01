import { describe, expect, it } from "vitest";
import {
  isHistoricalNextGenStatus,
  nextGenMetaOf,
  type NextGenProductMeta
} from "../src/lib/nextgen/product-meta";

// Mirrors the real NextGen product-grid row shape (captured live).
const rawRow = {
  Id: 14451,
  Name: "M88100481 - 3",
  StatusName: "Dropped",
  RangeName: "FH:2018",
  CustomerName: "Calvin Klein",
  CommodityTypeName: "Hats",
  ExternalReference: "CK-F18-0082",
  DefaultCostingName: "00000001941",
  DefaultProductCostingCostingPurchasePrice: 2.85,
  DefaultProductCostingCostingSellingPrice: 4.3,
  DefaultProductCostingCostingPurchaseCurrencyName: "USD",
  DefaultProductCostingCostingProductSupplierName: "Hangzhou U-Jump Arts and Crafts Co. Ltd",
  OriginalName: "M88100481 - 2"
};

describe("isHistoricalNextGenStatus", () => {
  it("flags Dropped/Closed/Archived/Completed/Cancelled", () => {
    for (const status of ["Dropped", "Closed", "Archived", "Completed", "Cancelled"]) {
      expect(isHistoricalNextGenStatus(status)).toBe(true);
    }
  });

  it("accepts active statuses and empties", () => {
    expect(isHistoricalNextGenStatus("Active")).toBe(false);
    expect(isHistoricalNextGenStatus("In Progress")).toBe(false);
    expect(isHistoricalNextGenStatus(null)).toBe(false);
    expect(isHistoricalNextGenStatus(undefined)).toBe(false);
  });
});

describe("nextGenMetaOf", () => {
  it("reads the typed fields when present", () => {
    const product: NextGenProductMeta = {
      entityId: "14451",
      styleNumber: "M88100481 - 3",
      name: "DIRECTIONAL RIB CUFF HAT",
      status: "Dropped",
      externalReference: "CK-F18-0082",
      purchasePrice: "2.85",
      sellingPrice: "4.3",
      currency: "USD",
      supplierName: "Hangzhou U-Jump Arts and Crafts Co. Ltd",
      costingName: "00000001941",
      originalName: "M88100481 - 2"
    };

    const meta = nextGenMetaOf(product);

    expect(meta.status).toBe("Dropped");
    expect(meta.externalReference).toBe("CK-F18-0082");
    expect(meta.purchasePrice).toBe("2.85");
    expect(meta.sellingPrice).toBe("4.3");
    expect(meta.currency).toBe("USD");
    expect(meta.costingName).toBe("00000001941");
    expect(meta.supplierName).toBe("Hangzhou U-Jump Arts and Crafts Co. Ltd");
    expect(meta.originalName).toBe("M88100481 - 2");
  });

  it("falls back to the raw grid row for untyped fields", () => {
    const product: NextGenProductMeta = {
      entityId: "14451",
      styleNumber: "M88100481 - 3",
      name: "x",
      raw: rawRow
    };

    const meta = nextGenMetaOf(product);

    expect(meta.status).toBe("Dropped");
    expect(meta.rangeName).toBe("FH:2018");
    expect(meta.customerName).toBe("Calvin Klein");
    expect(meta.commodityType).toBe("Hats");
    expect(meta.externalReference).toBe("CK-F18-0082");
    expect(meta.purchasePrice).toBe("2.85");
    expect(meta.sellingPrice).toBe("4.3");
    expect(meta.currency).toBe("USD");
    expect(meta.supplierName).toBe("Hangzhou U-Jump Arts and Crafts Co. Ltd");
    expect(meta.originalName).toBe("M88100481 - 2");
  });

  it("returns empty strings for sparse products", () => {
    const meta = nextGenMetaOf({ entityId: "7", styleNumber: "S1", name: "n" });
    expect(meta.status).toBe("");
    expect(meta.purchasePrice).toBe("");
    expect(meta.supplierName).toBe("");
  });
});

describe("SMV/labor/composition extraction", () => {
  it("reads SMV, GSD, allowed/factory time and composition from typed fields", () => {
    const product: NextGenProductMeta = {
      entityId: "178",
      styleNumber: "M88100481 - 3",
      name: "HAT",
      composition: "100% Acrylic",
      smv: "0.45",
      gsdSmv: "0.42",
      allowedTime: "0.48",
      factoryTime: "0.51"
    };
    const meta = nextGenMetaOf(product);
    expect(meta.composition).toBe("100% Acrylic");
    expect(meta.smv).toBe("0.45");
    expect(meta.gsdSmv).toBe("0.42");
    expect(meta.allowedTime).toBe("0.48");
    expect(meta.factoryTime).toBe("0.51");
  });

  it("falls back to raw grid keys for SMV/labor/composition", () => {
    const raw = {
      Id: 178,
      Name: "M88100481 - 3",
      CompositionConcatenated: "100% Acrylic",
      SMV: 0.45,
      GsdSMV: 0.42,
      AllowedTime: 0.48,
      FactoryTime: 0.51
    };
    const meta = nextGenMetaOf({ entityId: "178", styleNumber: "x", name: "n", raw });
    expect(meta.composition).toBe("100% Acrylic");
    expect(meta.smv).toBe("0.45");
    expect(meta.gsdSmv).toBe("0.42");
    expect(meta.allowedTime).toBe("0.48");
    expect(meta.factoryTime).toBe("0.51");
  });

  it("leaves labor fields empty when absent", () => {
    const meta = nextGenMetaOf({ entityId: "7", styleNumber: "S1", name: "n" });
    expect(meta.smv).toBe("");
    expect(meta.gsdSmv).toBe("");
    expect(meta.allowedTime).toBe("");
    expect(meta.factoryTime).toBe("");
    expect(meta.composition).toBe("");
  });
});
