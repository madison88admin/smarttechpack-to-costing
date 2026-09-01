export type CostingLineForTotals = {
  total_cost: number | null;
  currency: string | null;
};

export type CostingTotals = {
  materialTotal: number;
  laborCost: number;
  overheadCost: number;
  packagingCost: number;
  testingCost: number;
  profitMarginPercent: number;
  profitAmount: number;
  grandTotal: number; // FOB cost (materials + labor + overhead + packaging + testing + profit)
  currency: string;
  // Landed cost components
  freightCost: number;
  dutyRatePercent: number;
  dutyAmount: number;
  insuranceCost: number;
  customsClearanceCost: number;
  inlandTransportCost: number;
  landedCost: number; // FOB + freight + duty + insurance + customs + inland
  landedCostPerUnit: number;
  // Pricing & margin
  wholesaleMarkup: number;
  wholesalePrice: number;
  retailMarkup: number;
  retailPrice: number;
  grossMarginPercent: number;
  breakEvenQuantity: number;
  moq: number;
};

export function calculateCostingTotals(input: {
  rawPayload?: unknown;
  lines?: CostingLineForTotals[] | null;
  fallbackCurrency?: string | null;
}): CostingTotals {
  const raw = readRawPayload(input.rawPayload);
  const lineTotal =
    input.lines?.reduce((sum, line) => sum + (typeof line.total_cost === "number" ? line.total_cost : 0), 0) ?? 0;
  // Structured CBDs persist every section (materials, knitting, and operations)
  // in cbd_material_lines. Summing every row therefore overstates material cost.
  // Prefer the explicit material-only total stored in the structured payload.
  const materialTotal = readOptionalNumber(raw.materialTotal) ?? lineTotal;
  const laborCost = readNumber(raw.laborCost);
  const overheadCost = readNumber(raw.overheadCost);
  const packagingCost = readNumber(raw.packagingCost);
  const testingCost = readNumber(raw.testingCost);
  const profitMarginPercent = readNumber(raw.profitMargin);
  const subtotal = materialTotal + laborCost + overheadCost + packagingCost + testingCost;
  const profitAmount = readOptionalNumber(raw.profitCost) ?? subtotal * (profitMarginPercent / 100);
  const calculatedGrandTotal = subtotal + profitAmount;
  // The template-driven Factory CBD includes knitting and a fixed profit value
  // that are not represented by the legacy component model above. Its stored
  // factoryCostTotal/grandTotal is the authoritative approved FOB value.
  // For outlier/approval checks we must ensure line-derived totals are not
  // masked by a stale raw.grandTotal — if structured lines exist, the
  // calculated total (from material lines + components) is ground truth unless
  // factoryCostTotal is explicitly present. Fall back to raw.grandTotal only
  // when no material lines are available.
  const hasLines = Boolean(input.lines && input.lines.length > 0);
  const grandTotal =
    readOptionalNumber(raw.factoryCostTotal) ??
    (hasLines ? calculatedGrandTotal : readOptionalNumber(raw.grandTotal) ?? calculatedGrandTotal);

  // Landed cost components
  const freightCost = readNumber(raw.freightCost);
  const dutyRatePercent = readNumber(raw.dutyRate);
  const insuranceCost = readNumber(raw.insuranceCost);
  const customsClearanceCost = readNumber(raw.customsClearanceCost);
  const inlandTransportCost = readNumber(raw.inlandTransportCost);

  // Duty is calculated on CIF value (Cost + Insurance + Freight)
  const cifValue = grandTotal + insuranceCost + freightCost;
  const dutyAmount = cifValue * (dutyRatePercent / 100);

  const landedCost =
    grandTotal + freightCost + dutyAmount + insuranceCost + customsClearanceCost + inlandTransportCost;

  // Pricing & margin
  const moq = readNumber(raw.moq);
  const wholesaleMarkup = readNumber(raw.wholesaleMarkup) || 2.2;
  const retailMarkup = readNumber(raw.retailMarkup) || 2.3;
  const wholesalePrice = landedCost * wholesaleMarkup;
  const retailPrice = wholesalePrice * retailMarkup;
  const grossMarginPercent = landedCost > 0 ? ((wholesalePrice - landedCost) / wholesalePrice) * 100 : 0;

  // Break-even: fixed costs / (price - variable cost per unit)
  // Using overhead + packaging + testing as "fixed" costs for the order
  const fixedCosts = (overheadCost + packagingCost + testingCost) * (moq > 0 ? moq : 1);
  const contributionPerUnit = wholesalePrice - landedCost;
  const breakEvenQuantity = contributionPerUnit > 0 ? Math.ceil(fixedCosts / contributionPerUnit) : 0;

  return {
    materialTotal,
    laborCost,
    overheadCost,
    packagingCost,
    testingCost,
    profitMarginPercent,
    profitAmount,
    grandTotal,
    currency: raw.currency ?? input.lines?.find((line) => line.currency)?.currency ?? input.fallbackCurrency ?? "USD",
    freightCost,
    dutyRatePercent,
    dutyAmount,
    insuranceCost,
    customsClearanceCost,
    inlandTransportCost,
    landedCost,
    landedCostPerUnit: landedCost,
    wholesaleMarkup,
    wholesalePrice,
    retailMarkup,
    retailPrice,
    grossMarginPercent,
    breakEvenQuantity,
    moq
  };
}

function readRawPayload(rawPayload: unknown) {
  if (!rawPayload || typeof rawPayload !== "object") {
    return {};
  }

  const payload = rawPayload as Record<string, unknown>;

  return {
    currency: typeof payload.currency === "string" ? payload.currency : undefined,
    laborCost: payload.laborCost,
    overheadCost: payload.overheadCost,
    packagingCost: payload.packagingCost,
    testingCost: payload.testingCost,
    materialTotal: payload.materialTotal,
    profitCost: payload.profitCost,
    factoryCostTotal: payload.factoryCostTotal,
    grandTotal: payload.grandTotal,
    profitMargin: payload.profitMargin,
    moq: payload.moq,
    freightCost: payload.freightCost,
    dutyRate: payload.dutyRate,
    insuranceCost: payload.insuranceCost,
    customsClearanceCost: payload.customsClearanceCost,
    inlandTransportCost: payload.inlandTransportCost,
    wholesaleMarkup: payload.wholesaleMarkup,
    retailMarkup: payload.retailMarkup
  };
}

function readNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return 0;

  const parsed = Number(value.replace(/,/g, ""));

  return Number.isFinite(parsed) ? parsed : 0;
}

function readOptionalNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return null;

  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * How the actual factory cost compares to the approved costing this request
 * was copied from (the baseline reference). Null when either side is missing.
 */
export function baselineComparison(currentTotal: number | null | undefined, baselineTotal: number | null | undefined) {
  if (currentTotal == null || baselineTotal == null) return null;
  const delta = currentTotal - baselineTotal;
  const deltaPercent = baselineTotal !== 0 ? (delta / Math.abs(baselineTotal)) * 100 : 0;
  return {
    delta,
    deltaPercent,
    direction: delta > 0 ? "above" : delta < 0 ? "below" : "equal" as const
  };
}
