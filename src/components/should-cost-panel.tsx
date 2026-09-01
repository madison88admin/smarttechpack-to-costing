"use client";

import { useState } from "react";
import { SkeletonCard } from "@/components/ui/skeleton";

type ShouldCostEstimate = {
  estimatedFOB: number;
  estimatedLanded: number;
  confidence: "low" | "medium" | "high";
  breakdown: { materials: number; labor: number; overhead: number; profit: number } | null;
  benchmarkSource: string;
  sampleSize: number;
  varianceFromQuote: number | null;
  recommendation: string;
};

export function ShouldCostPanel({
  yarnType,
  knitType,
  machineType,
  construction,
  productCategory,
  factoryName,
  actualQuoteTotal,
  currency,
  canEdit = true
}: {
  yarnType?: string | null;
  knitType?: string | null;
  machineType?: string | null;
  construction?: string | null;
  productCategory?: string | null;
  factoryName?: string | null;
  actualQuoteTotal?: number | null;
  currency: string;
  canEdit?: boolean;
}) {
  const [estimate, setEstimate] = useState<ShouldCostEstimate | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function calculate() {
    setLoading(true);
    setMessage("");
    try {
      const res = await fetch("/api/ai/should-cost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          yarnType, knitType, machineType, construction, productCategory, factoryName, actualQuoteTotal, currency
        })
      });
      const data = await res.json();
      if (data.ok && data.estimate) {
        setEstimate(data.estimate);
      } else {
        setMessage(data.message ?? data.error ?? "Unable to estimate");
      }
    } catch {
      setMessage("Failed to calculate should-cost");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="should-cost-panel">
      <div className="section-heading">
        <div>
          <h4>Historical Cost Outlook</h4>
          <p className="eyebrow">Rule-based comparison using approved historical styles</p>
        </div>
        <button className="button small-btn" onClick={calculate} disabled={loading || !canEdit} title={canEdit ? undefined : "Costing or admin access required"}>
          {loading ? "Calculating..." : "Estimate"}
        </button>
      </div>

      {message ? <p className="eyebrow">{message}</p> : null}

      {loading ? <SkeletonCard /> : null}

      {estimate ? (
        <div className="should-cost-result">
          <div className="result-card">
            <div className="result-row total">
              <span>Estimated FOB Cost</span>
              <strong>{fmt(estimate.estimatedFOB, currency)}</strong>
            </div>
            <div className="result-row">
              <span>Estimated Landed Cost</span>
              <strong>{fmt(estimate.estimatedLanded, currency)}</strong>
            </div>
            <div className="result-row">
              <span>Confidence</span>
              <strong className={
                estimate.confidence === "high" ? "text-green" :
                estimate.confidence === "medium" ? "text-amber" : "text-red"
              }>
                {estimate.confidence.toUpperCase()} ({estimate.sampleSize} samples)
              </strong>
            </div>
            {estimate.varianceFromQuote !== null ? (
              <div className="result-row total">
                <span>Variance from Quote</span>
                <strong className={
                  estimate.varianceFromQuote > 15 ? "text-red" :
                  estimate.varianceFromQuote > 5 ? "text-amber" : "text-green"
                }>
                  {estimate.varianceFromQuote > 0 ? "+" : ""}{estimate.varianceFromQuote.toFixed(1)}%
                </strong>
              </div>
            ) : null}
          </div>

          {estimate.breakdown ? <div className="breakdown" style={{ marginTop: 12 }}>
            <p className="eyebrow">Estimated Cost Breakdown</p>
            <div className="summary-list">
              <div><span>Estimated materials</span><strong>{fmt(estimate.breakdown.materials, currency)}</strong></div>
              <div><span>Estimated labor</span><strong>{fmt(estimate.breakdown.labor, currency)}</strong></div>
              <div><span>Estimated overhead</span><strong>{fmt(estimate.breakdown.overhead, currency)}</strong></div>
              <div><span>Estimated profit</span><strong>{fmt(estimate.breakdown.profit, currency)}</strong></div>
            </div>
          </div> : <p className="eyebrow" style={{ marginTop: 12 }}>Component breakdown unavailable: matching historical rows do not contain reliable component totals.</p>}

          <div className="recommendation" style={{ marginTop: 12 }}>
            <p className="eyebrow">Recommendation</p>
            <p>{estimate.recommendation}</p>
            <p className="eyebrow" style={{ marginTop: 4 }}>{estimate.benchmarkSource}</p>
            <p className="eyebrow" style={{ marginTop: 4 }}>Decision support only. Verify against the current CBD, MML, compliance, and commercial terms before approval.</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function fmt(value: number, currency: string) {
  return `${currency} ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
