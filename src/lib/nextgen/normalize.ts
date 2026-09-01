type UnknownRecord = Record<string, unknown>;

export type ProductSearchResult = {
  entityId: string;
  styleNumber: string;
  name: string;
  description?: string;
  /** Product lifecycle status (e.g. "Dropped", "Active") — the historical archive flag. */
  status?: string;
  isClosed?: boolean;
  closedDate?: string;
  rangeName?: string;
  customerName?: string;
  /** External/buyer reference (e.g. "CK-F18-0082") — a buyer SKU. */
  externalReference?: string;
  commodityType?: string;
  /** Default costing record name (e.g. "00000001941") + prices/currency/supplier. */
  costingName?: string;
  purchasePrice?: string;
  sellingPrice?: string;
  currency?: string;
  supplierName?: string;
  /** Derivation history: the product this one was copied/developed from. */
  originalId?: string;
  originalName?: string;
  originalRange?: string;
  createdDateTime?: string;
  lastEditedDateTime?: string;
  composition?: string;
  /** Labor metrics (SMV = standard minute value, GSD SMV, allowed/factory time). */
  smv?: string;
  gsdSmv?: string;
  allowedTime?: string;
  factoryTime?: string;
  raw: unknown;
};

export type BomLineResult = {
  id: string;
  /** Real NextGen material id (MaterialId). The BOM line id (Id) is often a different number. */
  materialId?: string;
  category: string;
  materialName: string;
  materialDescription?: string;
  materialType?: string;
  usage?: number | string;
  size?: string;
  isMainMaterial?: boolean;
  /** Product style number the line belongs to (ProductName, e.g. "M88100481 - 3"). */
  styleNumber?: string;
  /** Product lifecycle status in NextGen (e.g. "Dropped", "Approved"). */
  productStatus?: string;
  /** Material lifecycle status in NextGen (e.g. "Approved"). */
  materialStatus?: string;
  /** NextGen range/season the product belongs to (e.g. "FH:2018"). */
  rangeName?: string;
  customerName?: string;
  /** External/buyer reference (e.g. "CK-F18-0082") — a buyer SKU. */
  externalReference?: string;
  /** NextGen costing record id linked to this BOM line. */
  costingId?: string;
  /** BOM header version (HeaderVersionNumber) and comment (BomVersionComment). */
  headerVersion?: string;
  bomVersionComment?: string;
  /** Supplier profile attached to the material line. */
  supplierName?: string;
  placement?: string;
  quotePrice?: string;
  quoteCurrency?: string;
  complianceStatus?: string;
  colorway?: string;
  raw?: unknown;
};

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function firstString(record: UnknownRecord, keys: string[]) {
  for (const key of keys) {
    const value = record[key];

    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }

  return "";
}

function firstDeepString(record: UnknownRecord, keys: string[], depth = 0): string {
  const direct = firstString(record, keys);
  if (direct) return direct;
  if (depth >= 3) return "";
  const normalizedKeys = new Set(keys.map((key) => key.replace(/[^a-z0-9]/gi, "").toLowerCase()));
  for (const [key, value] of Object.entries(record)) {
    const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
    if (normalizedKeys.has(normalized)) {
      if (typeof value === "string" && value.trim()) return value.trim();
      if (typeof value === "number") return String(value);
    }
    if (isRecord(value)) {
      const nested = firstDeepString(value, keys, depth + 1);
      if (nested) return nested;
    }
  }
  return "";
}

function complianceSummary(record: UnknownRecord) {
  const fields = [
    ["Bluesign", ["BluesignStatus", "Bluesign", "IsBluesign"]],
    ["RSL", ["RSLStatus", "RSL", "RslApprovalStatus"]],
    ["REACH", ["REACHStatus", "REACH", "ReachStatus"]]
  ] as const;
  const values = fields
    .map(([label, keys]) => {
      const value = firstDeepString(record, [...keys]);
      return value ? `${label}: ${value}` : null;
    })
    .filter((value): value is string => Boolean(value));
  return values.join(" · ") || firstDeepString(record, ["ComplianceStatus", "ApprovalStatus"]);
}

function unwrapRows(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  if (!isRecord(body)) return [];

  for (const key of ["Data", "data", "Items", "items", "Results", "results", "Rows", "rows", "Records", "records"]) {
    const value = body[key];
    if (Array.isArray(value)) return value;
    if (isRecord(value)) {
      const nested = unwrapRows(value);
      if (nested.length) return nested;
    }
  }

  return [];
}

export function normalizeProductSearch(body: unknown): ProductSearchResult[] {
  return unwrapRows(body)
    .filter(isRecord)
    .map((row) => {
      const entityId = firstString(row, [
        "Id",
        "id",
        "EntityId",
        "entityId",
        "ProductId",
        "productId",
        "DomainEntityId"
      ]);
      const styleNumber = firstString(row, [
        "Name",
        "name",
        "StyleNumber",
        "styleNumber",
        "ProductNumber",
        "productNumber",
        "Code",
        "code"
      ]);
      const name = firstString(row, ["CustomerReference", "customerReference", "Description", "description", "ProductName", "productName", "Name", "name"]);
      const description = firstString(row, ["Description", "description", "LongDescription", "longDescription"]);

      return {
        entityId,
        styleNumber: styleNumber || name || entityId,
        name: name || styleNumber || "Unnamed product",
        description: description || undefined,
        status: firstString(row, ["StatusName", "status"]) || undefined,
        isClosed: typeof row.IsClosed === "boolean" ? row.IsClosed : undefined,
        closedDate: firstString(row, ["ClosedDate", "ArchiveDate", "CompletedDate"]) || undefined,
        rangeName: firstString(row, ["RangeName", "rangeName"]) || undefined,
        customerName: firstString(row, ["CustomerName", "customerName"]) || undefined,
        externalReference: firstString(row, ["ExternalReference", "externalReference", "CustomerReference", "customerReference"]) || undefined,
        commodityType: firstString(row, ["CommodityTypeName", "commodityTypeName"]) || undefined,
        costingName: firstString(row, ["DefaultCostingName", "defaultCostingName"]) || undefined,
        purchasePrice: firstString(row, ["DefaultProductCostingCostingPurchasePrice"]) || undefined,
        sellingPrice: firstString(row, ["DefaultProductCostingCostingSellingPrice"]) || undefined,
        currency:
          firstString(row, [
            "DefaultProductCostingCostingPurchaseCurrencyName",
            "DefaultProductCostingCostingSellingCurrencyName"
          ]) || undefined,
        supplierName: firstString(row, ["DefaultProductCostingCostingProductSupplierName"]) || undefined,
        originalId: firstString(row, ["OriginalId", "originalId"]) || undefined,
        originalName: firstString(row, ["OriginalName", "originalName"]) || undefined,
        originalRange: firstString(row, ["OriginalRange", "originalRange"]) || undefined,
        createdDateTime: firstString(row, ["CreatedDateTime", "createdDateTime"]) || undefined,
        lastEditedDateTime: firstString(row, ["LastEditedDateTime", "lastEditedDateTime"]) || undefined,
        composition: firstString(row, ["CompositionConcatenated", "Composition", "composition"]) || undefined,
        smv: firstString(row, ["SMV", "Smv", "StandardMinuteValue"]) || undefined,
        gsdSmv: firstString(row, ["GsdSMV", "GSD", "GsdSmv"]) || undefined,
        allowedTime: firstString(row, ["AllowedTime", "AllowedMinutes", "AllowedSeconds"]) || undefined,
        factoryTime: firstString(row, ["FactoryTime", "FactoryMinutes", "ActualTime"]) || undefined,
        raw: row
      };
    })
    .filter((row) => row.entityId || row.styleNumber);
}

export function normalizeBomLines(body: unknown): BomLineResult[] {
  return unwrapRows(body)
    .filter(isRecord)
    .map((row, index) => {
      const materialId = firstString(row, ["MaterialId", "materialId"]);
      const id = firstString(row, ["Id", "id", "LineId", "lineId", "MaterialId", "materialId", "EntityId"]) || `bom-line-${index + 1}`;

      return {
        id,
        materialId: materialId || undefined,
        category: firstString(row, [
          "BoMItemCategoryName",
          "BOMItemCategoryName",
          "BomCategoryName",
          "CategoryName",
          "ItemCategoryName",
          "ComponentCategory",
          "category"
        ]),
        materialName: firstString(row, [
          "MaterialName",
          "materialName",
          "Material",
          "ItemName",
          "ComponentName",
          "Name",
          "name"
        ]),
        materialDescription:
          firstString(row, ["MaterialDescription", "ItemDescription", "ComponentDescription", "Description", "description"]) || undefined,
        materialType: firstString(row, ["CommodityTypeName", "MaterialTypeName", "TypeName", "ComponentType"]) || undefined,
        usage: firstString(row, ["DefaultRating", "Consumption", "Usage", "Quantity", "Qty", "RequiredQty", "NetConsumption"]) || undefined,
        size: firstString(row, ["DefaultMaterialSizeName", "MaterialSizeName", "SizeName", "Size", "UOM", "Uom"]) || undefined,
        isMainMaterial: typeof row.IsMainMaterial === "boolean" ? row.IsMainMaterial : undefined,
        styleNumber: firstString(row, ["ProductName", "productName", "StyleNumber", "styleNumber"]) || undefined,
        productStatus: firstString(row, ["StatusName", "ProductStatusName", "status"]) || undefined,
        materialStatus: firstString(row, ["MaterialStatusName"]) || undefined,
        rangeName: firstString(row, ["RangeName", "rangeName"]) || undefined,
        customerName: firstString(row, ["CustomerName", "customerName"]) || undefined,
        externalReference: firstString(row, ["ExternalReference", "externalReference"]) || undefined,
        costingId: firstString(row, ["CostingId", "costingId"]) || undefined,
        headerVersion: firstString(row, ["HeaderVersionNumber", "headerVersionNumber"]) || undefined,
        bomVersionComment: firstString(row, ["BomVersionComment", "bomVersionComment"]) || undefined,
        supplierName: firstDeepString(row, ["MaterialSupplierProfileSupplierName", "MaterialSupplierProfileName", "SupplierName", "Supplier", "VendorName"]) || undefined,
        placement: firstDeepString(row, ["Placement", "Placements", "MaterialPlacement", "PlacementName", "ComponentPlacement"]) || undefined,
        quotePrice: firstDeepString(row, ["QuotePrice", "CurrentQuotePrice", "QuotedPrice", "UnitPrice", "Price", "CurrentPrice"]) || undefined,
        quoteCurrency: firstDeepString(row, ["QuoteCurrency", "CurrentQuoteCurrency", "Currency", "CurrencyCode", "QuoteCurrencyName"]) || undefined,
        complianceStatus: complianceSummary(row) || undefined,
        colorway: firstDeepString(row, ["Colorway", "Colourway", "ColorName", "ColourName", "CommonColor", "ColorDescription"]) || undefined,
        raw: row
      };
    })
    .filter((line) => line.materialName || line.category);
}

export function summarizeBomShape(body: unknown) {
  const rows = unwrapRows(body).filter(isRecord);
  const keyCounts = new Map<string, number>();

  for (const row of rows.slice(0, 20)) {
    for (const key of Object.keys(row)) {
      keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);
    }
  }

  return {
    rowCount: rows.length,
    sampleKeys: [...keyCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([key]) => key)
      .slice(0, 40),
    normalizedCount: normalizeBomLines(body).length
  };
}
