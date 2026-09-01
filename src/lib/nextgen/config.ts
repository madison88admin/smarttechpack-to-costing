export type NextGenEndpointKey =
  | "productSearch"
  | "productRead"
  | "productOptions"
  | "productBom"
  | "poSearch"
  | "poRead"
  | "poGetById"
  | "mpoSearch"
  | "mpoRead"
  | "mpoLines"
  | "mpoTotals";

export const nextGenEndpoints: Record<NextGenEndpointKey, string> = {
  productSearch: process.env.NEXTGEN_PRODUCT_SEARCH_PATH ?? "/ProductManagerProductsGrid/Read",
  productRead: process.env.NEXTGEN_PRODUCT_READ_PATH ?? "/Product/GetById",
  productOptions:
    process.env.NEXTGEN_PRODUCT_OPTIONS_PATH ?? "/ProductOption/ProductOptionsGridRead",
  productBom: process.env.NEXTGEN_PRODUCT_BOM_PATH ?? "/WhereUsed/ReadProductManagerBoM",
  poSearch: process.env.NEXTGEN_PO_SEARCH_PATH ?? "/PurchaseOrder/OrderGridRead",
  poRead: process.env.NEXTGEN_PO_READ_PATH ?? "/PurchaseOrder/Read",
  poGetById: process.env.NEXTGEN_PO_GET_BY_ID_PATH ?? "/PurchaseOrder/GetById",
  mpoSearch: process.env.NEXTGEN_MPO_SEARCH_PATH ?? "/MaterialPurchaseOrder/MPOGridRead",
  mpoRead: process.env.NEXTGEN_MPO_READ_PATH ?? "/MaterialPurchaseOrder/GetById",
  mpoLines: process.env.NEXTGEN_MPO_LINES_PATH ?? "/MaterialPurchaseOrder/MPOLIGridRead",
  mpoTotals: process.env.NEXTGEN_MPO_TOTALS_PATH ?? "/MaterialPurchaseOrder/GetHeader"
};

export function getNextGenBaseUrl() {
  const baseUrl = process.env.NEXTGEN_BASE_URL;

  if (!baseUrl) {
    throw new Error("NEXTGEN_BASE_URL is not configured");
  }

  return baseUrl.replace(/\/$/, "");
}

export type BomConfig = {
  entityType: number;
  filterField: string;
  filterOperator: string;
  pageSize: number;
  userAreaClaim: string;
  showTabs: string;
  viewCachePath: string;
};

export function getBomConfig(): BomConfig {
  return {
    entityType: Number(process.env.NEXTGEN_BOM_ENTITY_TYPE ?? 23),
    filterField: process.env.NEXTGEN_BOM_FILTER_FIELD ?? "ProductId",
    filterOperator: process.env.NEXTGEN_BOM_FILTER_OPERATOR ?? "eq",
    pageSize: Number(process.env.NEXTGEN_BOM_PAGE_SIZE ?? 200),
    userAreaClaim: process.env.NEXTGEN_BOM_USER_AREA_CLAIM ?? "FullAccess",
    showTabs: process.env.NEXTGEN_BOM_SHOW_TABS ?? "False",
    viewCachePath: process.env.NEXTGEN_BOM_VIEWCACHE_PATH ?? "/ViewCache/BillOfMaterial"
  };
}
