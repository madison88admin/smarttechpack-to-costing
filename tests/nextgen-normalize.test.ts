import { describe, expect, it } from "vitest";
import { normalizeBomLines, normalizeProductSearch } from "../src/lib/nextgen/normalize";

// Fixtures mirror the real NextGen response shapes probed live
// (ReadProductManagerBoM + ProductManagerProductsGrid/Read).

const bomRow = {
  Id: 9040,
  ProductId: 14451,
  ProductName: "M88100481 - 3",
  BoMItemCategoryName: "Yarn",
  MaterialId: 178,
  MaterialName: "Regular Spun Acrylic - solid",
  MaterialDescription: "(UJ-001 Solid) 100% Acrylic, 2/28Nm",
  CommodityTypeName: "Hats",
  DefaultRating: 0.42,
  DefaultMaterialSizeName: "No Size",
  IsMainMaterial: true,
  StatusName: "Dropped",
  MaterialStatusName: "Approved",
  RangeName: "FH:2018",
  CustomerName: "Calvin Klein",
  ExternalReference: "CK-F18-0082",
  CostingId: 1941,
  HeaderVersionNumber: 3,
  BomVersionComment: "Updated after PBD review",
  MaterialSupplierProfileSupplierName: "Hangzhou U-Jump Arts and Crafts Co. Ltd"
};

describe("normalizeBomLines", () => {
  it("surfaces the historical/SKU fields alongside the existing ones", () => {
    const [line] = normalizeBomLines({ Data: [bomRow], Total: 1 });

    expect(line.id).toBe("9040"); // BOM line id
    expect(line.materialId).toBe("178"); // real NextGen material id
    expect(line.materialName).toBe("Regular Spun Acrylic - solid");
    expect(line.category).toBe("Yarn");
    expect(line.usage).toBe("0.42");
    expect(line.isMainMaterial).toBe(true);

    // New historical/SKU fields
    expect(line.styleNumber).toBe("M88100481 - 3");
    expect(line.productStatus).toBe("Dropped");
    expect(line.materialStatus).toBe("Approved");
    expect(line.rangeName).toBe("FH:2018");
    expect(line.customerName).toBe("Calvin Klein");
    expect(line.externalReference).toBe("CK-F18-0082");
    expect(line.costingId).toBe("1941");
    expect(line.headerVersion).toBe("3");
    expect(line.bomVersionComment).toBe("Updated after PBD review");
    expect(line.supplierName).toBe("Hangzhou U-Jump Arts and Crafts Co. Ltd");
  });

  it("keeps id fallback and filtering behavior", () => {
    const rows = normalizeBomLines({
      Data: [
        { MaterialName: "Fabric A", MaterialId: 55 },
        { MaterialId: 66 } // no name/category → filtered out
      ],
      Total: 2
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("55"); // falls back to MaterialId
    expect(rows[0].materialId).toBe("55");
  });

  it("tolerates rows without material ids (id synthesized)", () => {
    const [line] = normalizeBomLines({ Data: [{ MaterialName: "Trim" }] });
    expect(line.materialId).toBeUndefined();
    expect(line.id).toBe("bom-line-1");
  });
});

const productRow = {
  Id: 14451,
  Name: "M88100481 - 3",
  Description: "DIRECTIONAL RIB CUFF HAT",
  StatusName: "Dropped",
  IsClosed: false,
  ClosedDate: null,
  RangeName: "FH:2018",
  CustomerName: "Calvin Klein",
  CustomerReference: "DIRECTIONAL RIB CUFF HAT",
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
  CompositionConcatenated: "100% Acrylic"
};

describe("normalizeProductSearch", () => {
  it("captures historical lifecycle, costing, and SKU fields", () => {
    const [p] = normalizeProductSearch({ Data: [productRow], Total: 1 });

    expect(p.entityId).toBe("14451");
    expect(p.styleNumber).toBe("M88100481 - 3");
    expect(p.status).toBe("Dropped");
    expect(p.isClosed).toBe(false);
    expect(p.rangeName).toBe("FH:2018");
    expect(p.customerName).toBe("Calvin Klein");
    expect(p.externalReference).toBe("CK-F18-0082");
    expect(p.commodityType).toBe("Hats");
    expect(p.costingName).toBe("00000001941");
    expect(p.purchasePrice).toBe("2.85");
    expect(p.sellingPrice).toBe("4.3");
    expect(p.currency).toBe("USD");
    expect(p.supplierName).toBe("Hangzhou U-Jump Arts and Crafts Co. Ltd");
    expect(p.originalId).toBe("14267");
    expect(p.originalName).toBe("M88100481 - 2");
    expect(p.originalRange).toBe("FH:2018");
    expect(p.createdDateTime).toBe("2017-09-12T10:11:46.029");
    expect(p.lastEditedDateTime).toBe("2018-04-26T17:00:01.636");
    expect(p.composition).toBe("100% Acrylic");
  });

  it("falls back gracefully on sparse rows", () => {
    const [p] = normalizeProductSearch({ Data: [{ DomainEntityId: "7" }] });
    expect(p.entityId).toBe("7");
    expect(p.styleNumber).toBe("7");
    expect(p.name).toBe("Unnamed product");
    expect(p.status).toBeUndefined();
  });
});

describe("normalizeProductSearch labor metrics", () => {
  it("normalizes SMV/labor metrics from the product row", () => {
    const [p] = normalizeProductSearch({
      Data: [
        {
          Id: "178",
          Name: "M88100481 - 3",
          SMV: "0.45",
          GsdSMV: "0.42",
          AllowedTime: "0.48",
          FactoryTime: "0.51"
        }
      ]
    });
    expect(p.smv).toBe("0.45");
    expect(p.gsdSmv).toBe("0.42");
    expect(p.allowedTime).toBe("0.48");
    expect(p.factoryTime).toBe("0.51");
  });

  it("leaves labor metrics undefined when absent", () => {
    const [p] = normalizeProductSearch({ Data: [{ Id: "179", Name: "M88-1" }] });
    expect(p.smv).toBeUndefined();
    expect(p.gsdSmv).toBeUndefined();
    expect(p.allowedTime).toBeUndefined();
    expect(p.factoryTime).toBeUndefined();
  });
});
