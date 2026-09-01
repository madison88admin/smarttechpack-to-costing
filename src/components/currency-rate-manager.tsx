"use client";

import { useState, useEffect, type FormEvent } from "react";

type Rate = {
  base_currency: string;
  quote_currency: string;
  rate: number;
  source: string;
  updated_at: string;
};

const CURRENCIES = ["USD", "PHP", "CNY", "EUR", "GBP", "JPY", "KRW", "INR", "BDT", "VND"];

export function CurrencyRateManager() {
  const [rates, setRates] = useState<Rate[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [fetchingLive, setFetchingLive] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    loadRates();
  }, []);

  async function loadRates() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/currency-rates");
      const data = await res.json();
      if (data.ok) setRates(data.data ?? []);
    } catch {
      setMessage("Failed to load rates");
    } finally {
      setLoading(false);
    }
  }

  async function saveRate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    const base = String(form.get("baseCurrency") ?? "");
    const quote = String(form.get("quoteCurrency") ?? "");
    const rate = parseFloat(String(form.get("rate") ?? ""));

    if (base === quote) {
      setMessage("Base and quote currencies must be different");
      setBusy(false);
      return;
    }

    if (!Number.isFinite(rate) || rate <= 0) {
      setMessage("Rate must be a positive number");
      setBusy(false);
      return;
    }

    const res = await fetch("/api/admin/currency-rates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ baseCurrency: base, quoteCurrency: quote, rate })
    });
    const data = await res.json();
    if (data.ok) {
      setMessage(`${base}/${quote} rate saved`);
      loadRates();
    } else {
      setMessage(data.error ?? "Failed to save rate");
    }
    setBusy(false);
  }

  async function fetchLiveRates() {
    setFetchingLive(true);
    setMessage("Fetching live exchange rates...");
    try {
      const res = await fetch("/api/admin/currency-rates/fetch-live", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseCurrency: "USD" })
      });
      const data = await res.json();
      if (data.ok) {
        setMessage(`Live rates fetched — ${data.saved} pairs updated from ${data.base} (as of ${new Date(data.timestamp).toLocaleString()})`);
        loadRates();
      } else {
        setMessage(data.error ?? "Failed to fetch live rates");
      }
    } catch {
      setMessage("Failed to fetch live rates — check network connection");
    } finally {
      setFetchingLive(false);
    }
  }

  return (
    <div>
      <div className="form-actions" style={{ marginBottom: 12 }}>
        <button className="button" type="button" onClick={fetchLiveRates} disabled={fetchingLive}>
          {fetchingLive ? "Fetching live rates..." : "Fetch Live Rates (Real-time)"}
        </button>
        <span className="eyebrow">Source: open.er-api.com (free, no API key)</span>
      </div>

      <form className="form-grid" onSubmit={saveRate}>
        <div className="field">
          <label htmlFor="baseCurrency">Base Currency</label>
          <select id="baseCurrency" name="baseCurrency" className="input" defaultValue="USD">
            {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="quoteCurrency">Quote Currency</label>
          <select id="quoteCurrency" name="quoteCurrency" className="input" defaultValue="PHP">
            {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="rate">Rate (1 Base = ? Quote)</label>
          <input id="rate" name="rate" className="input" type="number" step="0.0001" placeholder="e.g. 56.00" />
        </div>
        <div className="form-actions">
          <button className="button" type="submit" disabled={busy}>
            {busy ? "Saving..." : "Save Rate Manually"}
          </button>
        </div>
      </form>

      {loading ? (
        <p className="eyebrow">Loading rates...</p>
      ) : rates.length === 0 ? (
        <p className="notice">No currency rates configured. Click &quot;Fetch Live Rates&quot; to pull real-time rates, or use fallback rates (USD/PHP=56, USD/CNY=7.2).</p>
      ) : (
        <table className="table compact" style={{ marginTop: 12 }}>
          <thead>
            <tr>
              <th>Base</th>
              <th>Quote</th>
              <th>Rate</th>
              <th>Source</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {rates.map((r, i) => (
              <tr key={i}>
                <td><strong>{r.base_currency}</strong></td>
                <td><strong>{r.quote_currency}</strong></td>
                <td>{r.rate}</td>
                <td>{r.source}</td>
                <td>{new Date(r.updated_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {message ? <p className="form-message saved">{message}</p> : null}
    </div>
  );
}
