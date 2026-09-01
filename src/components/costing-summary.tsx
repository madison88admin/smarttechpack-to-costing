import Link from "next/link";
import type { BaselineRef } from "@/lib/costing/history";
import { baselineComparison, type CostingTotals } from "@/lib/costing/totals";

type StructuredCbdData = {
  yarnTotal?: number;
  fabricTotal?: number;
  trimTotal?: number;
  materialTotal?: number;
  knittingTotal?: number;
  operationsTotal?: number;
  packagingTotal?: number;
  overheadProfitTotal?: number;
  factoryCostTotal?: number;
  standardPackagingCost?: number;
  specialPackagingCost?: number;
  overheadCost?: number;
  profitCost?: number;
  yarnLines?: Array<{ name?: string; consumption?: number; materialPrice?: number; materialCost?: number }>;
  knittingLines?: Array<{ machineType?: string; knittingTime?: number; sah?: number; knittingCost?: number }>;
  operationsLines?: Array<{ operation?: string; operationCost?: number }>;
};

export function CostingSummary({
  totals,
  cbdData,
  baselineRef = null,
  role = null
}: {
  totals: CostingTotals | null;
  cbdData?: StructuredCbdData | null;
  /** Approved costing this request was copied from ("Copy baseline"). */
  baselineRef?: BaselineRef | null;
  /** When "factory", internal pricing (landed cost, margin, markups) is hidden. */
  role?: string | null;
}) {
  // Landed cost and margin are internal (Madison88) data — the factory supplies
  // the cost basis but never sees the customer-facing pricing waterfall.
  const isFactory = role === "factory";
  if (!totals) {
    return (
      <section className="panel">
        <h2>Costing Summary</h2>
        <p className="eyebrow">No factory CBD submitted yet.</p>
        {baselineRef ? <BaselineReferenceLine baselineRef={baselineRef} /> : null}
      </section>
    );
  }

  // Check if we have structured CBD data (new format)
  const hasStructuredData = cbdData && (cbdData.yarnTotal !== undefined || cbdData.factoryCostTotal !== undefined);
  const yarnTotal = cbdData?.yarnTotal ?? 0;
  const fabricTotal = cbdData?.fabricTotal ?? 0;
  const trimTotal = cbdData?.trimTotal ?? 0;
  const knittingTotal = cbdData?.knittingTotal ?? 0;
  const operationsTotal = cbdData?.operationsTotal ?? 0;
  const stdPackaging = cbdData?.standardPackagingCost ?? 0;
  const specialPackaging = cbdData?.specialPackagingCost ?? 0;
  const packagingTotal = cbdData?.packagingTotal ?? stdPackaging + specialPackaging;
  const overheadCost = cbdData?.overheadCost ?? totals.overheadCost;
  const profitCost = cbdData?.profitCost ?? totals.profitAmount;
  const factoryCostTotal = cbdData?.factoryCostTotal ?? totals.grandTotal;

  const hasLandedCost =
    totals.freightCost > 0 ||
    totals.dutyAmount > 0 ||
    totals.insuranceCost > 0 ||
    totals.customsClearanceCost > 0 ||
    totals.inlandTransportCost > 0;

  return (
    <section className="panel">
      <h2>Costing Summary</h2>

      {/* FOB Cost Breakdown — Excel template structure */}
      <h3 style={{ marginTop: 0 }}>Factory Cost Breakdown</h3>
      <div className="summary-list">
        {hasStructuredData ? (
          <>
            {/* Yarn */}
            {yarnTotal > 0 && (
              <div>
                <span>Yarn</span>
                <strong>{formatMoney(yarnTotal, totals.currency)}</strong>
              </div>
            )}
            {/* Fabric */}
            {fabricTotal > 0 && (
              <div>
                <span>Fabric</span>
                <strong>{formatMoney(fabricTotal, totals.currency)}</strong>
              </div>
            )}
            {/* Trim */}
            {trimTotal > 0 && (
              <div>
                <span>Trim</span>
                <strong>{formatMoney(trimTotal, totals.currency)}</strong>
              </div>
            )}
            <div className="summary-subtotal">
              <span>Total Material & Submaterials</span>
              <strong>{formatMoney(yarnTotal + fabricTotal + trimTotal || totals.materialTotal, totals.currency)}</strong>
            </div>
            {/* Knitting */}
            {knittingTotal > 0 && (
              <div>
                <span>Knitting</span>
                <strong>{formatMoney(knittingTotal, totals.currency)}</strong>
              </div>
            )}
            {/* Operations */}
            {operationsTotal > 0 && (
              <div>
                <span>Operations</span>
                <strong>{formatMoney(operationsTotal, totals.currency)}</strong>
              </div>
            )}
            {/* Packaging */}
            <div>
              <span>Packaging (Std + Special)</span>
              <strong>{formatMoney(packagingTotal, totals.currency)}</strong>
            </div>
            {/* Overhead/Profit */}
            <div>
              <span>Overhead</span>
              <strong>{formatMoney(overheadCost, totals.currency)}</strong>
            </div>
            <div>
              <span>Profit</span>
              <strong>{formatMoney(profitCost, totals.currency)}</strong>
            </div>
            <div className="summary-total">
              <span>Total Factory Cost</span>
              <strong>{formatMoney(factoryCostTotal, totals.currency)}</strong>
            </div>
          </>
        ) : (
          <>
            {/* Legacy format (old CBDs) */}
            <div>
              <span>Material Total</span>
              <strong>{formatMoney(totals.materialTotal, totals.currency)}</strong>
            </div>
            <div>
              <span>Operations (Labor)</span>
              <strong>{formatMoney(totals.laborCost, totals.currency)}</strong>
            </div>
            <div>
              <span>Overhead</span>
              <strong>{formatMoney(totals.overheadCost, totals.currency)}</strong>
            </div>
            <div>
              <span>Packaging</span>
              <strong>{formatMoney(totals.packagingCost, totals.currency)}</strong>
            </div>
            <div>
              <span>Profit / Margin</span>
              <strong>
                {formatMoney(totals.profitAmount, totals.currency)} ({totals.profitMarginPercent}%)
              </strong>
            </div>
            <div className="summary-total">
              <span>FOB Cost (Grand Total)</span>
              <strong>{formatMoney(totals.grandTotal, totals.currency)}</strong>
            </div>
          </>
        )}
      </div>

      {baselineRef ? <BaselineReferenceLine baselineRef={baselineRef} currentTotal={totals.grandTotal} /> : null}

      {/* Landed Cost — internal only, never shown to factory */}
      {!isFactory && hasLandedCost ? (
        <>
          <h3 style={{ marginTop: 20 }}>Landed Cost</h3>
          <div className="summary-list">
            <div>
              <span>FOB Cost</span>
              <strong>{formatMoney(factoryCostTotal > 0 ? factoryCostTotal : totals.grandTotal, totals.currency)}</strong>
            </div>
            <div>
              <span>Freight</span>
              <strong>{formatMoney(totals.freightCost, totals.currency)}</strong>
            </div>
            <div>
              <span>Insurance</span>
              <strong>{formatMoney(totals.insuranceCost, totals.currency)}</strong>
            </div>
            <div>
              <span>Import Duty ({totals.dutyRatePercent}%)</span>
              <strong>{formatMoney(totals.dutyAmount, totals.currency)}</strong>
            </div>
            <div>
              <span>Customs Clearance</span>
              <strong>{formatMoney(totals.customsClearanceCost, totals.currency)}</strong>
            </div>
            <div>
              <span>Inland Transport</span>
              <strong>{formatMoney(totals.inlandTransportCost, totals.currency)}</strong>
            </div>
            <div className="summary-total landed">
              <span>Total Landed Cost / Unit</span>
              <strong>{formatMoney(totals.landedCost, totals.currency)}</strong>
            </div>
          </div>
        </>
      ) : isFactory ? null : (
        <p className="eyebrow" style={{ marginTop: 12 }}>
          No landed cost data provided. Factory cost shown only.
        </p>
      )}

      {/* Pricing & Margin — internal only, never shown to factory */}
      {!isFactory && hasLandedCost ? (
        <>
          <h3 style={{ marginTop: 20 }}>Pricing & Margin</h3>
          <div className="summary-list">
            <div>
              <span>Wholesale Markup</span>
              <strong>{totals.wholesaleMarkup}× Landed</strong>
            </div>
            <div>
              <span>Wholesale Price</span>
              <strong>{formatMoney(totals.wholesalePrice, totals.currency)}</strong>
            </div>
            <div>
              <span>Retail Markup</span>
              <strong>{totals.retailMarkup}× Wholesale</strong>
            </div>
            <div>
              <span>Retail Price</span>
              <strong>{formatMoney(totals.retailPrice, totals.currency)}</strong>
            </div>
            <div>
              <span>Gross Margin</span>
              <strong className={totals.grossMarginPercent >= 50 ? "text-green" : totals.grossMarginPercent >= 30 ? "text-amber" : "text-red"}>
                {totals.grossMarginPercent.toFixed(1)}%
              </strong>
            </div>
            {totals.breakEvenQuantity > 0 ? (
              <div>
                <span>Break-Even Quantity</span>
                <strong>{totals.breakEvenQuantity.toLocaleString()} units</strong>
              </div>
            ) : null}
          </div>
        </>
      ) : null}

      {/* Visual Breakdown */}
      <CostBreakdownChart
        totals={totals}
        hasLandedCost={hasLandedCost}
        hasStructuredData={hasStructuredData}
        isFactory={isFactory}
        yarnTotal={yarnTotal}
        fabricTotal={fabricTotal}
        trimTotal={trimTotal}
        knittingTotal={knittingTotal}
        operationsTotal={operationsTotal}
        packagingTotal={packagingTotal}
        overheadCost={overheadCost}
        profitCost={profitCost}
      />
    </section>
  );
}

function CostBreakdownChart({
  totals,
  hasLandedCost,
  hasStructuredData,
  isFactory,
  yarnTotal = 0,
  fabricTotal = 0,
  trimTotal = 0,
  knittingTotal = 0,
  operationsTotal = 0,
  packagingTotal = 0,
  overheadCost = 0,
  profitCost = 0
}: {
  totals: CostingTotals;
  hasLandedCost: boolean;
  hasStructuredData?: boolean | null;
  isFactory?: boolean;
  yarnTotal?: number;
  fabricTotal?: number;
  trimTotal?: number;
  knittingTotal?: number;
  operationsTotal?: number;
  packagingTotal?: number;
  overheadCost?: number;
  profitCost?: number;
}) {
  const fobSegments = hasStructuredData
    ? [
        { label: "Yarn", value: yarnTotal, color: "#3b82f6" },
        { label: "Fabric", value: fabricTotal, color: "#06b6d4" },
        { label: "Trim", value: trimTotal, color: "#0ea5e9" },
        { label: "Knitting", value: knittingTotal, color: "#10b981" },
        { label: "Operations", value: operationsTotal, color: "#84cc16" },
        { label: "Packaging", value: packagingTotal, color: "#8b5cf6" },
        { label: "Overhead", value: overheadCost, color: "#f59e0b" },
        { label: "Profit", value: profitCost, color: "#22c55e" }
      ]
    : [
        { label: "Materials", value: totals.materialTotal, color: "#3b82f6" },
        { label: "Operations", value: totals.laborCost, color: "#10b981" },
        { label: "Overhead", value: totals.overheadCost, color: "#f59e0b" },
        { label: "Packaging", value: totals.packagingCost, color: "#8b5cf6" },
        { label: "Profit", value: totals.profitAmount, color: "#22c55e" }
      ];

  const fobTotal = fobSegments.reduce((sum, s) => sum + s.value, 0) || 1;

  return (
    <div style={{ marginTop: 20 }}>
      <h3 style={{ marginTop: 0 }}>Cost Breakdown</h3>

      {/* Horizontal stacked bar chart for FOB */}
      <div style={{ marginBottom: 8 }}>
        <p className="eyebrow" style={{ marginBottom: 4 }}>FOB Cost Composition</p>
        <div className="stacked-bar">
          {fobSegments.map((seg) => {
            const pct = (seg.value / fobTotal) * 100;
            if (pct < 0.1) return null;
            return (
              <div
                key={seg.label}
                className="stacked-bar-segment"
                style={{
                  width: `${pct}%`,
                  backgroundColor: seg.color
                }}
                title={`${seg.label}: ${pct.toFixed(1)}%`}
              />
            );
          })}
        </div>
        <div className="legend">
          {fobSegments.map((seg) => {
            const pct = (seg.value / fobTotal) * 100;
            if (pct < 0.1) return null;
            return (
              <span key={seg.label} className="legend-item">
                <span className="legend-dot" style={{ backgroundColor: seg.color }} />
                {seg.label} {pct.toFixed(1)}%
              </span>
            );
          })}
        </div>
      </div>

      {/* Waterfall: FOB → Landed — internal only, never shown to factory */}
      {!isFactory && hasLandedCost ? (
        <div style={{ marginTop: 16 }}>
          <p className="eyebrow" style={{ marginBottom: 4 }}>FOB → Landed Cost Waterfall</p>
          <div className="waterfall">
            <div className="waterfall-step">
              <div className="waterfall-bar" style={{ height: `${Math.min(100, (totals.grandTotal / totals.landedCost) * 100)}%`, backgroundColor: "#3b82f6" }} />
              <span className="waterfall-label">FOB</span>
              <span className="waterfall-value">{formatMoney(totals.grandTotal, totals.currency)}</span>
            </div>
            {totals.freightCost > 0 ? (
              <div className="waterfall-step">
                <div className="waterfall-bar" style={{ height: `${Math.min(100, (totals.freightCost / totals.landedCost) * 100)}%`, backgroundColor: "#f59e0b" }} />
                <span className="waterfall-label">Freight</span>
                <span className="waterfall-value">+{formatMoney(totals.freightCost, totals.currency)}</span>
              </div>
            ) : null}
            {totals.dutyAmount > 0 ? (
              <div className="waterfall-step">
                <div className="waterfall-bar" style={{ height: `${Math.min(100, (totals.dutyAmount / totals.landedCost) * 100)}%`, backgroundColor: "#ef4444" }} />
                <span className="waterfall-label">Duty</span>
                <span className="waterfall-value">+{formatMoney(totals.dutyAmount, totals.currency)}</span>
              </div>
            ) : null}
            {totals.insuranceCost > 0 ? (
              <div className="waterfall-step">
                <div className="waterfall-bar" style={{ height: `${Math.min(100, (totals.insuranceCost / totals.landedCost) * 100)}%`, backgroundColor: "#8b5cf6" }} />
                <span className="waterfall-label">Insurance</span>
                <span className="waterfall-value">+{formatMoney(totals.insuranceCost, totals.currency)}</span>
              </div>
            ) : null}
            {totals.customsClearanceCost > 0 ? (
              <div className="waterfall-step">
                <div className="waterfall-bar" style={{ height: `${Math.min(100, (totals.customsClearanceCost / totals.landedCost) * 100)}%`, backgroundColor: "#ec4899" }} />
                <span className="waterfall-label">Customs</span>
                <span className="waterfall-value">+{formatMoney(totals.customsClearanceCost, totals.currency)}</span>
              </div>
            ) : null}
            {totals.inlandTransportCost > 0 ? (
              <div className="waterfall-step">
                <div className="waterfall-bar" style={{ height: `${Math.min(100, (totals.inlandTransportCost / totals.landedCost) * 100)}%`, backgroundColor: "#14b8a6" }} />
                <span className="waterfall-label">Inland</span>
                <span className="waterfall-value">+{formatMoney(totals.inlandTransportCost, totals.currency)}</span>
              </div>
            ) : null}
            <div className="waterfall-step">
              <div className="waterfall-bar total" style={{ height: "100%", backgroundColor: "#1e40af" }} />
              <span className="waterfall-label">Landed</span>
              <span className="waterfall-value">{formatMoney(totals.landedCost, totals.currency)}</span>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function formatMoney(value: number, currency: string) {
  return `${currency} ${value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

/**
 * Read-only strip inside the Costing Summary showing the approved costing this
 * request was copied from, and how the actual factory cost compares to it —
 * so PBD/Costing reviewers see the reference without leaving the review flow.
 */
function BaselineReferenceLine({
  baselineRef,
  currentTotal = null
}: {
  baselineRef: BaselineRef;
  currentTotal?: number | null;
}) {
  const comparison = baselineComparison(currentTotal, baselineRef.totalCost);
  const currency = baselineRef.currency ?? "USD";
  const baseCost = baselineRef.totalCost != null ? formatMoney(baselineRef.totalCost, currency) : "—";

  return (
    <div className={`baseline-reference ${comparison ? `dir-${comparison.direction}` : ""}`}>
      <strong>Baseline reference</strong>
      <span className="eyebrow">
        Copied from approved costing {baselineRef.styleNumber ?? ""}
        {baselineRef.factoryName ? ` · ${baselineRef.factoryName}` : ""}
        {baselineRef.sourceRequestId ? (
          <>
            {" · "}
            <Link href={`/requests/${baselineRef.sourceRequestId}`}>open source</Link>
          </>
        ) : null}
      </span>
      <span className="baseline-values">
        <strong>{baseCost}</strong>
        {comparison && currentTotal != null ? (
          <span className={`baseline-delta dir-${comparison.direction}`}>
            {comparison.direction === "equal"
              ? "matches the current cost"
              : `current ${formatMoney(currentTotal, currency)} is ${comparison.direction} baseline by ${formatMoney(Math.abs(comparison.delta), currency)} (${Math.abs(comparison.deltaPercent).toFixed(1)}%)`}
          </span>
        ) : (
          <span className="eyebrow">Reference only — the factory&apos;s actual figures are shown above.</span>
        )}
      </span>
    </div>
  );
}
