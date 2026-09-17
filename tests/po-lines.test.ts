import { describe, expect, it } from "vitest";
import { normalizePurchaseOrderLine } from "../src/lib/nextgen/po-lines";

describe("NextGen PurchaseOrder/Read line mapping", () => {
  it("maps the confirmed PO-line field aliases without depending on a PO header", () => {
    const line = normalizePurchaseOrderLine({
      ID: "line-19",
      CommodityId: "product-42",
      PrimaryUserDefinedFieldValuesTextUdf3: "PO-1001",
      CommodityName: "M8836315",
      OptionColourName: "Navy",
      SizeName: "OS",
      Quantity: "1,200",
      OrderSupplierName: "PT UwU jump",
      CustomerName: "Sorel",
      Season: "F27",
      FOB: "2.05",
      LineTotal: "2,460.00"
    }, 0);

    expect(line).toMatchObject({
      id: "line-19",
      productId: "product-42",
      poNumber: "PO-1001",
      style: "M8836315",
      color: "Navy",
      size: "OS",
      quantity: 1200,
      supplier: "PT UwU jump",
      customer: "Sorel",
      season: "F27",
      unitCost: 2.05,
      subtotal: 2460
    });
  });

  it("does not manufacture a linked product when the upstream line has none", () => {
    const line = normalizePurchaseOrderLine({ OrderName: "PO-1002", Qty: 10 }, 2);
    expect(line.id).toBe("po-line-3");
    expect(line.productId).toBeNull();
    expect(line.style).toBeNull();
    expect(line.quantity).toBe(10);
  });
});
