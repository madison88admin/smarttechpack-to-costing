"use client";

import { useState, useMemo } from "react";

type ScenarioInput = {
  materialTotal: number;
  laborCost: number;
  overheadCost: number;
  packagingCost: number;
  testingCost: number;
  profitMargin: number;
  freightCost: number;
  dutyRate: number;
  insuranceCost: number;
  customsClearanceCost: number;
  inlandTransportCost: number;
  wholesaleMarkup: number;
  retailMarkup: number;
  moq: number;
  currency: string;
};

type ScenarioResult = {
  subtotal: number;
  profitAmount: number;
  fobCost: number;
  cifValue: number;
  dutyAmount: number;
  landedCost: number;
  wholesalePrice: number;
  retailPrice: number;
  grossMargin: number;
  totalOrderValue: number;
  profitPerUnit: number;
  totalProfit: number;
};

export function WhatIfAnalyzer({ baseline }: { baseline: ScenarioInput }) {
  const [scenario, setScenario] = useState<ScenarioInput>(baseline);
  const [savedScenarios, setSavedScenarios] = useState<Array<{ name: string; input: ScenarioInput; result: ScenarioResult }>>([]);

  const result = useMemo<ScenarioResult>(() => calculateScenario(scenario), [scenario]);

  function update(field: keyof ScenarioInput, value: string) {
    const num = parseFloat(value.replace(/,/g, ""));
    setScenario((prev) => ({
      ...prev,
      [field]: Number.isFinite(num) ? num : 0
    }));
  }

  function reset() {
    setScenario(baseline);
  }

  function saveScenario() {
    const name = prompt("Scenario name (e.g., 'High MOQ - Wool blend'):");
    if (!name) return;
    setSavedScenarios((prev) => [...prev, { name, input: { ...scenario }, result }]);
  }

  function loadScenario(s: { input: ScenarioInput }) {
    setScenario(s.input);
  }

  const vsBaseline = {
    fobDiff: result.fobCost - calculateScenario(baseline).fobCost,
    landedDiff: result.landedCost - calculateScenario(baseline).landedCost,
    marginDiff: result.grossMargin - calculateScenario(baseline).grossMargin
  };

  return (
    <div>
      <div className="section-heading" style={{ marginBottom: 12 }}>
        <div>
          <h3>What-If Costing Scenarios</h3>
          <p className="eyebrow">Adjust cost components to see real-time impact on landed cost, pricing, and margin</p>
        </div>
        <div className="form-actions">
          <button className="button secondary small-btn" onClick={reset}>Reset to Baseline</button>
          <button className="button small-btn" onClick={saveScenario}>Save Scenario</button>
        </div>
      </div>

      <div className="whatif-grid">
        {/* Input panel */}
        <div className="whatif-inputs">
          <h4>Cost Components (per unit)</h4>
          <div className="whatif-field">
            <label>Material Total</label>
            <input className="input" type="number" step="0.01" value={scenario.materialTotal} onChange={(e) => update("materialTotal", e.target.value)} />
          </div>
          <div className="whatif-field">
            <label>Labor Cost</label>
            <input className="input" type="number" step="0.01" value={scenario.laborCost} onChange={(e) => update("laborCost", e.target.value)} />
          </div>
          <div className="whatif-field">
            <label>Overhead</label>
            <input className="input" type="number" step="0.01" value={scenario.overheadCost} onChange={(e) => update("overheadCost", e.target.value)} />
          </div>
          <div className="whatif-field">
            <label>Packaging</label>
            <input className="input" type="number" step="0.01" value={scenario.packagingCost} onChange={(e) => update("packagingCost", e.target.value)} />
          </div>
          <div className="whatif-field">
            <label>Testing</label>
            <input className="input" type="number" step="0.01" value={scenario.testingCost} onChange={(e) => update("testingCost", e.target.value)} />
          </div>
          <div className="whatif-field">
            <label>Profit Margin (%)</label>
            <input className="input" type="number" step="0.1" value={scenario.profitMargin} onChange={(e) => update("profitMargin", e.target.value)} />
          </div>

          <h4 style={{ marginTop: 12 }}>Landed Cost</h4>
          <div className="whatif-field">
            <label>Freight</label>
            <input className="input" type="number" step="0.01" value={scenario.freightCost} onChange={(e) => update("freightCost", e.target.value)} />
          </div>
          <div className="whatif-field">
            <label>Duty Rate (%)</label>
            <input className="input" type="number" step="0.1" value={scenario.dutyRate} onChange={(e) => update("dutyRate", e.target.value)} />
          </div>
          <div className="whatif-field">
            <label>Insurance</label>
            <input className="input" type="number" step="0.01" value={scenario.insuranceCost} onChange={(e) => update("insuranceCost", e.target.value)} />
          </div>
          <div className="whatif-field">
            <label>Customs Clearance</label>
            <input className="input" type="number" step="0.01" value={scenario.customsClearanceCost} onChange={(e) => update("customsClearanceCost", e.target.value)} />
          </div>
          <div className="whatif-field">
            <label>Inland Transport</label>
            <input className="input" type="number" step="0.01" value={scenario.inlandTransportCost} onChange={(e) => update("inlandTransportCost", e.target.value)} />
          </div>

          <h4 style={{ marginTop: 12 }}>Pricing & Volume</h4>
          <div className="whatif-field">
            <label>Wholesale Markup (×)</label>
            <input className="input" type="number" step="0.1" value={scenario.wholesaleMarkup} onChange={(e) => update("wholesaleMarkup", e.target.value)} />
          </div>
          <div className="whatif-field">
            <label>Retail Markup (×)</label>
            <input className="input" type="number" step="0.1" value={scenario.retailMarkup} onChange={(e) => update("retailMarkup", e.target.value)} />
          </div>
          <div className="whatif-field">
            <label>MOQ (units)</label>
            <input className="input" type="number" step="1" value={scenario.moq} onChange={(e) => update("moq", e.target.value)} />
          </div>
        </div>

        {/* Results panel */}
        <div className="whatif-results">
          <h4>Live Results</h4>
          <div className="result-card">
            <div className="result-row">
              <span>FOB Cost / Unit</span>
              <strong>{fmt(result.fobCost, scenario.currency)}</strong>
              {vsBaseline.fobDiff !== 0 ? <span className={vsBaseline.fobDiff > 0 ? "text-red" : "text-green"}>{vsBaseline.fobDiff > 0 ? "+" : ""}{fmt(vsBaseline.fobDiff, scenario.currency)}</span> : null}
            </div>
            <div className="result-row">
              <span>Duty Amount</span>
              <strong>{fmt(result.dutyAmount, scenario.currency)}</strong>
            </div>
            <div className="result-row total">
              <span>Landed Cost / Unit</span>
              <strong>{fmt(result.landedCost, scenario.currency)}</strong>
              {vsBaseline.landedDiff !== 0 ? <span className={vsBaseline.landedDiff > 0 ? "text-red" : "text-green"}>{vsBaseline.landedDiff > 0 ? "+" : ""}{fmt(vsBaseline.landedDiff, scenario.currency)}</span> : null}
            </div>
            <div className="result-row">
              <span>Wholesale Price</span>
              <strong>{fmt(result.wholesalePrice, scenario.currency)}</strong>
            </div>
            <div className="result-row">
              <span>Retail Price</span>
              <strong>{fmt(result.retailPrice, scenario.currency)}</strong>
            </div>
            <div className="result-row total">
              <span>Gross Margin</span>
              <strong className={result.grossMargin >= 50 ? "text-green" : result.grossMargin >= 30 ? "text-amber" : "text-red"}>
                {result.grossMargin.toFixed(1)}%
              </strong>
              {vsBaseline.marginDiff !== 0 ? <span className={vsBaseline.marginDiff > 0 ? "text-green" : "text-red"}>{vsBaseline.marginDiff > 0 ? "+" : ""}{vsBaseline.marginDiff.toFixed(1)}pp</span> : null}
            </div>
            <div className="result-row">
              <span>Profit / Unit</span>
              <strong>{fmt(result.profitPerUnit, scenario.currency)}</strong>
            </div>
            <div className="result-row">
              <span>Order Value (MOQ × Wholesale)</span>
              <strong>{fmt(result.totalOrderValue, scenario.currency)}</strong>
            </div>
            <div className="result-row total">
              <span>Total Profit (MOQ × Unit)</span>
              <strong className="text-green">{fmt(result.totalProfit, scenario.currency)}</strong>
            </div>
          </div>

          {/* Margin indicator */}
          <div className="margin-indicator" style={{ marginTop: 12 }}>
            <div className="margin-bar">
              <div
                className="margin-fill"
                style={{
                  width: `${Math.min(100, Math.max(0, result.grossMargin))}%`,
                  backgroundColor: result.grossMargin >= 50 ? "#16a34a" : result.grossMargin >= 30 ? "#d97706" : "#dc2626"
                }}
              />
            </div>
            <div className="margin-labels">
              <span>0%</span>
              <span>30% (warn)</span>
              <span>50% (target)</span>
              <span>100%</span>
            </div>
          </div>
        </div>
      </div>

      {/* Saved scenarios */}
      {savedScenarios.length > 0 ? (
        <div style={{ marginTop: 16 }}>
          <h4>Saved Scenarios</h4>
          <table className="table compact">
            <thead>
              <tr>
                <th>Name</th>
                <th>FOB</th>
                <th>Landed</th>
                <th>Wholesale</th>
                <th>Margin</th>
                <th>Order Profit</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {savedScenarios.map((s, i) => (
                <tr key={i}>
                  <td><strong>{s.name}</strong></td>
                  <td>{fmt(s.result.fobCost, s.input.currency)}</td>
                  <td>{fmt(s.result.landedCost, s.input.currency)}</td>
                  <td>{fmt(s.result.wholesalePrice, s.input.currency)}</td>
                  <td className={s.result.grossMargin >= 50 ? "text-green" : s.result.grossMargin >= 30 ? "text-amber" : "text-red"}>
                    {s.result.grossMargin.toFixed(1)}%
                  </td>
                  <td className="text-green">{fmt(s.result.totalProfit, s.input.currency)}</td>
                  <td>
                    <button className="button secondary small-btn" onClick={() => loadScenario(s)}>Load</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

function calculateScenario(s: ScenarioInput): ScenarioResult {
  const subtotal = s.materialTotal + s.laborCost + s.overheadCost + s.packagingCost + s.testingCost;
  const profitAmount = subtotal * (s.profitMargin / 100);
  const fobCost = subtotal + profitAmount;
  const cifValue = fobCost + s.insuranceCost + s.freightCost;
  const dutyAmount = cifValue * (s.dutyRate / 100);
  const landedCost = fobCost + s.freightCost + dutyAmount + s.insuranceCost + s.customsClearanceCost + s.inlandTransportCost;
  const wholesalePrice = landedCost * s.wholesaleMarkup;
  const retailPrice = wholesalePrice * s.retailMarkup;
  const grossMargin = wholesalePrice > 0 ? ((wholesalePrice - landedCost) / wholesalePrice) * 100 : 0;
  const profitPerUnit = wholesalePrice - landedCost;
  const totalOrderValue = wholesalePrice * s.moq;
  const totalProfit = profitPerUnit * s.moq;

  return { subtotal, profitAmount, fobCost, cifValue, dutyAmount, landedCost, wholesalePrice, retailPrice, grossMargin, totalOrderValue, profitPerUnit, totalProfit };
}

function fmt(value: number, currency: string) {
  return `${currency} ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
