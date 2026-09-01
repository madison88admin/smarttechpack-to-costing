/**
 * NextGen product metadata helpers for the create-request auto-fill.
 * Kept pure so the factory form logic is unit-testable.
 */

// NextGen lifecycle statuses that mean the style is historical/archived.
export const NEXTGEN_HISTORICAL_STATUSES = new Set([
  "Dropped",
  "Closed",
  "Archived",
  "Completed",
  "Cancelled"
]);

export function isHistoricalNextGenStatus(status: string | null | undefined): boolean {
  return Boolean(status && NEXTGEN_HISTORICAL_STATUSES.has(status));
}

export type NextGenProductMeta = {
  entityId: string;
  styleNumber: string;
  name: string;
  description?: string;
  status?: string;
  externalReference?: string;
  rangeName?: string;
  customerName?: string;
  commodityType?: string;
  costingName?: string;
  purchasePrice?: string;
  sellingPrice?: string;
  currency?: string;
  supplierName?: string;
  originalName?: string;
  composition?: string;
  smv?: string;
  gsdSmv?: string;
  allowedTime?: string;
  factoryTime?: string;
  raw?: unknown;
};

function firstStringOf(raw: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return "";
}

/**
 * Pull NextGen metadata for the picked product, preferring the typed fields
 * that /api/product/search returns and falling back to the raw grid row.
 */
export function nextGenMetaOf(product: NextGenProductMeta) {
  const raw = (product.raw ?? {}) as Record<string, unknown>;
  const pick = (typed: string | undefined, keys: string[]) => typed ?? firstStringOf(raw, keys);

  return {
    status: pick(product.status, ["StatusName", "status"]),
    externalReference: pick(product.externalReference, ["ExternalReference"]),
    rangeName: pick(product.rangeName, ["RangeName", "SeasonName"]),
    customerName: pick(product.customerName, ["CustomerName"]),
    commodityType: pick(product.commodityType, ["CommodityTypeName"]),
    costingName: pick(product.costingName, ["DefaultCostingName"]),
    purchasePrice: pick(product.purchasePrice, ["DefaultProductCostingCostingPurchasePrice", "TargetMinimumPurchasePrice"]),
    sellingPrice: pick(product.sellingPrice, ["DefaultProductCostingCostingSellingPrice", "TargetMaximumSellingPrice"]),
    currency: pick(product.currency, ["DefaultProductCostingCostingPurchaseCurrencyName", "DefaultProductCostingCostingSellingCurrencyName"]),
    supplierName: pick(product.supplierName, ["DefaultProductCostingCostingProductSupplierName"]),
    originalName: pick(product.originalName, ["OriginalName"]),
    composition: pick(product.composition, ["CompositionConcatenated", "Composition", "MainMaterialDescription"]),
    smv: pick(product.smv, ["SMV", "Smv", "StandardMinuteValue"]),
    gsdSmv: pick(product.gsdSmv, ["GsdSMV", "GSD", "GsdSmv"]),
    allowedTime: pick(product.allowedTime, ["AllowedTime", "AllowedMinutes", "AllowedSeconds"]),
    factoryTime: pick(product.factoryTime, ["FactoryTime", "FactoryMinutes", "ActualTime"])
  };
}

export type NextGenMeta = ReturnType<typeof nextGenMetaOf>;

/**
 * Extract NextGen metadata from a stored raw_payload (the full NextGen row
 * snapshot saved at request creation) without typed search-result fields.
 */
export function nextGenMetaFromRaw(raw: unknown): NextGenMeta {
  const record = (isRecord(raw) ? raw : {}) as Record<string, unknown>;
  return nextGenMetaOf({ entityId: "", styleNumber: "", name: "", raw: record });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
