import { safeNextGenPostOnce } from "./client";

type RawRow = Record<string, unknown>;

export type PurchaseOrderLine = {
  id: string;
  productId: string | null;
  poNumber: string | null;
  style: string | null;
  color: string | null;
  size: string | null;
  quantity: number | null;
  supplier: string | null;
  customer: string | null;
  season: string | null;
  unitCost: number | null;
  subtotal: number | null;
  raw: RawRow;
};

function unwrapRows(value: unknown): RawRow[] {
  if (Array.isArray(value)) return value.filter((row): row is RawRow => !!row && typeof row === "object");
  if (!value || typeof value !== "object") return [];
  const source = value as Record<string, unknown>;
  for (const key of ["Data", "data", "Items", "items", "Results", "results"]) {
    const rows = unwrapRows(source[key]);
    if (rows.length) return rows;
  }
  return [];
}

function firstText(row: RawRow, keys: string[]): string | null {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function firstNumber(row: RawRow, keys: string[]): number | null {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Number(value.replace(/[,$\s]/g, ""));
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

export function normalizePurchaseOrderLine(row: RawRow, index: number): PurchaseOrderLine {
  return {
    id: firstText(row, ["Id", "ID", "id", "LineId", "OrderLineId"]) ?? `po-line-${index + 1}`,
    // PurchaseOrder/Read calls the linked style a "Commodity". ProductId is
    // present in some NextGen tenants; this tenant exposes the same relation
    // as CommodityId in its PO-line grid.
    productId: firstText(row, ["ProductId", "ProductID", "productId", "CommodityId"]),
    poNumber: firstText(row, ["PrimaryUserDefinedFieldValuesTextUdf3", "OrderName", "PONumber", "PurchaseOrderNumber"]),
    style: firstText(row, ["CommodityName", "Style", "StyleNumber", "Product", "ProductName"]),
    color: firstText(row, ["OptionColourName", "Color", "ColorName", "Colour"]),
    size: firstText(row, ["SizeName", "Size"]),
    quantity: firstNumber(row, ["Quantity", "Qty"]),
    supplier: firstText(row, ["OrderSupplierName", "Factory", "Vendor", "Supplier"]),
    customer: firstText(row, ["CustomerName", "Customer"]),
    season: firstText(row, ["Season", "RangeName"]),
    unitCost: firstNumber(row, ["FOB", "UnitCost", "Cost", "PurchasePrice", "FactoryCost"]),
    subtotal: firstNumber(row, ["SubTotal", "TotalAmount", "LineTotal", "ExtendedCost", "LineAmount"]),
    raw: row
  };
}

/**
 * Reads the confirmed NextGen PurchaseOrder/Read grid request. NextGen owns
 * the line-level relation to ProductId; this mapper deliberately preserves the
 * raw row while exposing only the costing fields the request form can use.
 */
export async function fetchPurchaseOrderLines() {
  const response = await safeNextGenPostOnce("poRead", {
    sort: "PrimaryUserDefinedFieldValuesTextUdf3-desc~OrderName-asc",
    group: "",
    filter: "",
    page: 1,
    pageSize: 500,
    aggregates: ""
  });

  if (!response.ok) {
    return { ok: false as const, status: response.status, lines: [] as PurchaseOrderLine[], detail: response.body };
  }
  return { ok: true as const, status: response.status, lines: unwrapRows(response.body).map(normalizePurchaseOrderLine), detail: null };
}
