import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { nextGenPost } from "@/lib/nextgen/client";
import { nextGenMetaFromRaw } from "@/lib/nextgen/product-meta";

// Selling / landed-cost / margin figures ported from NextGen so PBD skips
// manual pricing entry. NextGen puts a style's pricing on the product grid row:
// the default costing's selling price and purchase (FOB) price, plus the
// costing sheet's Financial-FOB columns. All of it is snapshotted into
// nextgen_products.raw_payload at request creation and read back from there —
// no extra ERP roundtrip at approval time.

export type NextGenPricing = {
  sellingPrice: number | null;
  /** The costing sheet's subtotal landed cost — FOB plus the allowances below. */
  landedCost: number | null;
  /** FOB purchase price, the landed cost's base component. */
  purchasePrice: number | null;
  /** The ERP's own margin value for the costing (selling − landed). */
  margin: number | null;
  currency: string | null;
};

/**
 * The costing sheet's Financial-FOB columns, by position on the grid row.
 *
 * NextGen exposes them as unlabelled `CostingSheetValueN`, so the mapping is
 * anchored to an invariant rather than trusted blindly: over every priced style
 * we sampled (16/16), Value5 equals selling − Value4 and Value4 is at or above
 * FOB. Value2/Value3 are the small support-materials / miscellaneous
 * allowances that make Value4 a *landed* total rather than a copy of FOB.
 */
const COSTING_SHEET_LANDED_KEY = "CostingSheetValue4";
const COSTING_SHEET_MARGIN_KEY = "CostingSheetValue5";

/** Any other sheet columns are kept in the snapshot for the audit trail. */
const COSTING_SHEET_KEY = /^CostingSheetValue\d+$/;

/** Where a real customer-facing selling price came from. */
export type SellingPriceSource = "pbd" | "nextgen" | null;

/**
 * The real customer-facing selling price for a request, and where it came from.
 *
 * Single owner of the precedence — PBD-entered price wins, then the
 * NextGen-ported selling price — so the margin panel, the approval gate, and
 * the historical-costing snapshot can never disagree about the price a style
 * was actually sold at. Nothing here invents a value: null means no real price
 * is known, and callers that need a fallback say so themselves (the margin
 * panel marks its markup estimate "est.").
 */
export function resolveSellingPrice(input: {
  pbdPricing?: unknown;
  nextGenRaw?: unknown;
}): { price: number | null; source: SellingPriceSource } {
  const pricing = input.pbdPricing && typeof input.pbdPricing === "object"
    ? (input.pbdPricing as Record<string, unknown>)
    : {};
  const pbd = parseNextGenPrice(pricing.wholesalePrice);
  if (pbd !== null) return { price: pbd, source: "pbd" };
  const nextgen = nextGenPricingFromRaw(input.nextGenRaw).sellingPrice;
  return nextgen !== null ? { price: nextgen, source: "nextgen" } : { price: null, source: null };
}

/** Parses ERP price strings ("15.00", "$12.50", 12) — null unless positive. */
function parseNextGenPrice(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : null;
  if (typeof value !== "string") return null;
  const parsed = Number(value.replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** Same, for amounts where zero is a real answer — a margin of 0 breaks even. */
function parseAmount(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value !== "string") return null;
  const parsed = Number(value.replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/** Extracts ported pricing from a stored NextGen raw_payload snapshot. */
export function nextGenPricingFromRaw(raw: unknown): NextGenPricing {
  const meta = nextGenMetaFromRaw(raw);
  const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const purchasePrice = parseNextGenPrice(meta.purchasePrice);

  // A landed cost below the FOB it is built from cannot be the sheet's total —
  // the sheet adds support materials, commission, admin and miscellaneous on
  // top of FOB. Rejecting that keeps a mis-mapped column from quietly
  // reporting a margin the ERP never claimed.
  const sheetLanded = parseNextGenPrice(record[COSTING_SHEET_LANDED_KEY]);
  const landedCost = sheetLanded !== null && (purchasePrice === null || sheetLanded >= purchasePrice) ? sheetLanded : null;

  return {
    sellingPrice: parseNextGenPrice(meta.sellingPrice),
    landedCost,
    purchasePrice,
    margin: landedCost === null ? null : parseAmount(record[COSTING_SHEET_MARGIN_KEY]),
    currency: meta.currency?.trim() ? meta.currency.trim() : null
  };
}

/** Raw grid keys snapshotted for pricing (kept small on purpose). */
const PRICING_SNAPSHOT_KEYS = [
  "DefaultProductCostingCostingSellingPrice",
  "TargetMaximumSellingPrice",
  "DefaultProductCostingCostingPurchasePrice",
  "TargetMinimumPurchasePrice",
  "DefaultProductCostingCostingPurchaseCurrencyName",
  "DefaultProductCostingCostingSellingCurrencyName",
  "DefaultCostingName",
  "DefaultProductCostingCostingProductSupplierName"
] as const;

/**
 * Best-effort fetch of a product's pricing snapshot straight from NextGen
 * (used when a request was created with only an entity id). Uses the product
 * grid search filtered to the exact entity id — the same row shape the UI
 * search returns, which already carries the default costing prices. Never
 * throws — creation must not fail because the ERP is unreachable. Returns
 * null when the product or its prices are missing.
 */
export async function fetchNextGenPricingSnapshot(entityId: string): Promise<Record<string, unknown> | null> {
  try {
    const clean = String(entityId ?? "").trim().replace(/'/g, "''").slice(0, 100);
    if (!clean) return null;
    const result = await nextGenPost("productSearch", {
      take: 5,
      skip: 0,
      page: 1,
      pageSize: 5,
      filter: `Id~eq~'${clean}'`
    });
    const body = (result as { ok?: boolean; body?: unknown })?.body;
    if (!result?.ok || body == null) return null;
    const rows = Array.isArray(body)
      ? body
      : ((body as Record<string, unknown>).Data ?? (body as Record<string, unknown>).data);
    const row = (Array.isArray(rows) ? rows[0] : null) ?? (typeof body === "object" ? body : null);
    if (!row || typeof row !== "object") return null;
    const out: Record<string, unknown> = {};
    const source = row as Record<string, unknown>;
    // The named pricing columns, plus every costing-sheet column the row
    // carries — the sheet's position-based values are what hold the landed cost
    // and the margin, and they are not in the named list.
    for (const key of Object.keys(source)) {
      if (!PRICING_SNAPSHOT_KEYS.includes(key as (typeof PRICING_SNAPSHOT_KEYS)[number]) && !COSTING_SHEET_KEY.test(key)) continue;
      const value = source[key];
      if (value !== null && value !== undefined && String(value).trim() !== "") out[key] = value;
    }
    return Object.keys(out).length > 0 ? out : null;
  } catch {
    return null;
  }
}

/**
 * Requests whose ERP lookup already failed, so a page that renders repeatedly
 * (or a review session opened twice) does not re-ask NextGen on every read.
 * Process-local and short-lived on purpose: the moment the ERP recovers the
 * next attempt is allowed again.
 */
const attemptedEntityIds = new Map<string, number>();
const ATTEMPT_TTL_MS = 5 * 60 * 1000;

/** Test seam: clears the lazy-lookup attempt guard. */
export function resetPricingAttemptCache() {
  attemptedEntityIds.clear();
}

/**
 * Entity ids that can map to an ERP grid row. Locally created styles are stored
 * as `manual:<style>`, which no ERP lookup can resolve; anything else is
 * attempted once and the attempt guard absorbs repeats.
 */
function isResolvableEntityId(entityId: unknown): entityId is string {
  const value = String(entityId ?? "").trim();
  return value.length > 0 && !value.startsWith("manual:");
}

/**
 * Loads the ported pricing for a request.
 *
 * The snapshot is written at creation time, but requests created while the ERP
 * was unreachable (or before the port existed) carry no figures — and PBD must
 * never be asked to type a selling / landed cost that NextGen already knows.
 * So when the snapshot has no selling price this lazily pulls the product grid
 * row once and caches the merge back onto the snapshot, keeping the ERP lookup
 * in this single owner: the review page, the pricing panel, the margin math and
 * the approval gate all read the same numbers from here.
 *
 * Portfolio math (margin analytics) deliberately stays snapshot-only — it walks
 * many requests at once and must not fan out into one ERP call per row.
 */
export async function getNextGenPricingForRequest(requestId: string): Promise<NextGenPricing> {
  const empty: NextGenPricing = { sellingPrice: null, landedCost: null, purchasePrice: null, margin: null, currency: null };
  try {
    const supabase = createSupabaseServiceClient();
    const { data, error } = await supabase
      .from("costing_requests")
      .select("nextgen_products (id, nextgen_entity_id, raw_payload)")
      .eq("id", requestId)
      .single();
    if (error || !data) return empty;
    const product = Array.isArray(data.nextgen_products) ? data.nextgen_products[0] : data.nextgen_products;
    if (!product || typeof product !== "object") return empty;

    const row = product as { id?: string; nextgen_entity_id?: string; raw_payload?: unknown };
    const snapshot = nextGenPricingFromRaw(row.raw_payload);
    if (snapshot.sellingPrice !== null) return snapshot;
    if (!isResolvableEntityId(row.nextgen_entity_id)) return snapshot;

    const attemptedAt = attemptedEntityIds.get(row.nextgen_entity_id) ?? 0;
    if (Date.now() - attemptedAt < ATTEMPT_TTL_MS) return snapshot;
    attemptedEntityIds.set(row.nextgen_entity_id, Date.now());

    const fetched = await fetchNextGenPricingSnapshot(row.nextgen_entity_id);
    if (!fetched) return snapshot;

    // Same precedence as creation: caller/ERP values fill the gaps, existing
    // snapshot keys win, so nothing already stored is overwritten.
    const existing = row.raw_payload && typeof row.raw_payload === "object" ? row.raw_payload : {};
    const merged = { ...fetched, ...existing } as Record<string, unknown>;
    const resolved = nextGenPricingFromRaw(merged);

    // Best-effort cache: a failed write still leaves the caller with pricing.
    if (row.id) {
      await supabase.from("nextgen_products").update({ raw_payload: merged }).eq("id", row.id);
    }
    return resolved;
  } catch {
    return empty;
  }
}
