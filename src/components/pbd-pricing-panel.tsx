"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Pricing = {
  currency?: string | null;
  wholesalePrice?: number | null;
  retailPrice?: number | null;
  wholesaleMarkup?: number | null;
  retailMarkup?: number | null;
  notes?: string | null;
};

export function PbdPricingPanel({
  requestId,
  status,
  pricing,
  pricingStatus,
  canEdit,
  nextgenSellingPrice = null,
  nextgenLandedCost = null,
  nextgenMargin = null,
  nextgenPurchasePrice = null,
  nextgenCurrency = null
}: {
  requestId: string;
  status: string;
  pricing?: Pricing | null;
  pricingStatus?: string | null;
  canEdit: boolean;
  /** NextGen-ported figures — satisfy the review without manual entry. */
  nextgenSellingPrice?: number | null;
  /** Costing-sheet landed cost (FOB + allowances), when the ERP carries one. */
  nextgenLandedCost?: number | null;
  /** The ERP's own margin for the costing (selling − landed). */
  nextgenMargin?: number | null;
  nextgenPurchasePrice?: number | null;
  nextgenCurrency?: string | null;
}) {
  const router = useRouter();
  const hasNextgenPrice = nextgenSellingPrice !== null && nextgenSellingPrice > 0;
  const money = (value: number | null, currency?: string | null) =>
    value === null ? "—" : `${currency?.trim() || "USD"} ${value.toFixed(2)}`;
  const [form, setForm] = useState({
    wholesalePrice: pricing?.wholesalePrice == null ? "" : String(pricing.wholesalePrice),
    retailPrice: pricing?.retailPrice == null ? "" : String(pricing.retailPrice),
    wholesaleMarkup: pricing?.wholesaleMarkup == null ? "" : String(pricing.wholesaleMarkup),
    retailMarkup: pricing?.retailMarkup == null ? "" : String(pricing.retailMarkup),
    notes: pricing?.notes ?? ""
  });
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    fetch(`/api/costing/requests/${requestId}/pricing`)
      .then((response) => response.json())
      .then((result) => {
        if (!active || !result.ok) return;
        const saved = (result.data?.pbd_pricing ?? {}) as Pricing;
        setForm({
          wholesalePrice: saved.wholesalePrice == null ? "" : String(saved.wholesalePrice),
          retailPrice: saved.retailPrice == null ? "" : String(saved.retailPrice),
          wholesaleMarkup: saved.wholesaleMarkup == null ? "" : String(saved.wholesaleMarkup),
          retailMarkup: saved.retailMarkup == null ? "" : String(saved.retailMarkup),
          notes: saved.notes ?? ""
        });
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [requestId]);
  const editable = canEdit && status === "for_pbd_review";

  async function save() {
    setBusy(true);
    setMessage("Saving PBD pricing...");
    const response = await fetch(`/api/costing/requests/${requestId}/pricing`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, currency: "USD" })
    });
    const result = await response.json().catch(() => ({}));
    const saved = response.ok && result.ok;
    setMessage(saved ? "PBD pricing saved." : result.error ?? "Unable to save PBD pricing");
    setBusy(false);
    if (saved) router.refresh();
  }

  return (
    <section className="panel" id="pbd-pricing-review">
      <div className="section-heading">
        <div>
          <p className="eyebrow">PBD-owned review input</p>
          <h2>Selling Price & Landed-Cost Pricing</h2>
        </div>
        <span className={`status ${pricingStatus === "entered" || hasNextgenPrice ? "green" : "amber"}`}>
          {pricingStatus === "entered" ? "Entered" : hasNextgenPrice ? "NextGen" : "Pending"}
        </span>
      </div>
      <p className="eyebrow">Factory CBD supplies the cost basis. PBD records the customer-facing selling price during internal review.</p>
      {hasNextgenPrice ? (
        <div className="notice" style={{ borderColor: "#b8d7cc", background: "#ecf8f3", color: "var(--text)" }}>
          <strong>NextGen already carries this style&apos;s prices — no manual entry needed.</strong>
          <br />
          <span>
            Selling: {money(nextgenSellingPrice, nextgenCurrency)}
            {nextgenLandedCost !== null ? (
              <> · Landed cost: {money(nextgenLandedCost, nextgenCurrency)}</>
            ) : nextgenPurchasePrice !== null ? (
              <> · Landed-cost basis: {money(nextgenPurchasePrice, nextgenCurrency)}</>
            ) : null}
            {nextgenMargin !== null ? <> · Margin: {money(nextgenMargin, nextgenCurrency)}</> : null}
          </span>
          <br />
          <span className="eyebrow">
            Ported from the NextGen costing sheet. Approval and margin use these figures — the fields below are an optional override.
          </span>
        </div>
      ) : null}
      <div className="form-grid">
        <div className="field">
          <label htmlFor="pbd-wholesale-price">Wholesale price (USD)</label>
          <input id="pbd-wholesale-price" className="input" type="number" min="0" step="0.0001" value={form.wholesalePrice} disabled={!editable || busy} onChange={(event) => setForm({ ...form, wholesalePrice: event.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="pbd-retail-price">Retail price (USD)</label>
          <input id="pbd-retail-price" className="input" type="number" min="0" step="0.0001" value={form.retailPrice} disabled={!editable || busy} onChange={(event) => setForm({ ...form, retailPrice: event.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="pbd-wholesale-markup">Wholesale markup (×)</label>
          <input id="pbd-wholesale-markup" className="input" type="number" min="0" step="0.01" value={form.wholesaleMarkup} disabled={!editable || busy} onChange={(event) => setForm({ ...form, wholesaleMarkup: event.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="pbd-retail-markup">Retail markup (×)</label>
          <input id="pbd-retail-markup" className="input" type="number" min="0" step="0.01" value={form.retailMarkup} disabled={!editable || busy} onChange={(event) => setForm({ ...form, retailMarkup: event.target.value })} />
        </div>
        <div className="field full">
          <label htmlFor="pbd-pricing-notes">PBD pricing notes</label>
          <textarea id="pbd-pricing-notes" className="input textarea" value={form.notes} disabled={!editable || busy} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
        </div>
      </div>
      {editable ? <button className="button" type="button" disabled={busy} onClick={save}>{busy ? "Saving..." : "Save PBD Pricing"}</button> : <p className="eyebrow">Pricing is read-only outside the internal review stage.</p>}
      {message ? <p className={`form-message ${message.includes("saved") ? "saved" : "error"}`}>{message}</p> : null}
    </section>
  );
}
