import { createSupabaseServiceClient } from "@/lib/supabase/server";

type RateRow = {
  base_currency: string;
  quote_currency: string;
  rate: number;
};

let rateCache: { rates: Map<string, number>; timestamp: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Get all currency rates as a map: "BASE_QUOTE" -> rate
export async function getCurrencyRates(): Promise<Map<string, number>> {
  if (rateCache && Date.now() - rateCache.timestamp < CACHE_TTL_MS) {
    return rateCache.rates;
  }

  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("currency_rates")
    .select("base_currency, quote_currency, rate");

  if (error || !data) {
    // Return fallback rates if DB fails
    return getFallbackRates();
  }

  const rates = new Map<string, number>();
  for (const row of data as RateRow[]) {
    rates.set(`${row.base_currency}_${row.quote_currency}`, row.rate);
    // Also store inverse
    if (row.rate > 0) {
      rates.set(`${row.quote_currency}_${row.base_currency}`, 1 / row.rate);
    }
  }

  // Always include USD_USD = 1
  rates.set("USD_USD", 1);
  rates.set("PHP_PHP", 1);
  rates.set("CNY_CNY", 1);

  rateCache = { rates, timestamp: Date.now() };
  return rates;
}

// Convert an amount from one currency to another
export async function convertCurrency(
  amount: number,
  fromCurrency: string,
  toCurrency: string
): Promise<number> {
  if (fromCurrency === toCurrency) return amount;

  const rates = await getCurrencyRates();
  const directKey = `${fromCurrency}_${toCurrency}`;
  const direct = rates.get(directKey);

  if (direct) return amount * direct;

  // Try via USD as intermediate
  const toUsd = rates.get(`${fromCurrency}_USD`);
  const fromUsd = rates.get(`USD_${toCurrency}`);

  if (toUsd && fromUsd) return amount * toUsd * fromUsd;

  // Fallback: no rate found, return original
  return amount;
}

// Get a simple conversion rate (for display)
export async function getRate(fromCurrency: string, toCurrency: string): Promise<number | null> {
  if (fromCurrency === toCurrency) return 1;
  const rates = await getCurrencyRates();
  return rates.get(`${fromCurrency}_${toCurrency}`) ?? null;
}

// Fallback rates (approximate, should be updated regularly)
function getFallbackRates(): Map<string, number> {
  const rates = new Map<string, number>();
  // USD-based rates (approximate)
  rates.set("USD_PHP", 56);
  rates.set("PHP_USD", 1 / 56);
  rates.set("USD_CNY", 7.2);
  rates.set("CNY_USD", 1 / 7.2);
  rates.set("PHP_CNY", 7.2 / 56);
  rates.set("CNY_PHP", 56 / 7.2);
  rates.set("USD_USD", 1);
  rates.set("PHP_PHP", 1);
  rates.set("CNY_CNY", 1);
  return rates;
}

// Save or update a rate (admin only)
export async function saveCurrencyRate(
  baseCurrency: string,
  quoteCurrency: string,
  rate: number,
  source: string = "manual"
): Promise<{ ok: boolean; error?: string }> {
  const supabase = createSupabaseServiceClient();

  // Upsert: try update first, then insert
  const { error: upsertError } = await supabase
    .from("currency_rates")
    .upsert({
      base_currency: baseCurrency.toUpperCase(),
      quote_currency: quoteCurrency.toUpperCase(),
      rate,
      source,
      updated_at: new Date().toISOString()
    }, { onConflict: "base_currency,quote_currency" });

  if (upsertError) {
    return { ok: false, error: upsertError.message };
  }

  // Invalidate cache
  rateCache = null;

  return { ok: true };
}

// Get all rates for admin display
export async function listCurrencyRates(): Promise<RateRow[]> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("currency_rates")
    .select("base_currency, quote_currency, rate, source, updated_at")
    .order("base_currency", { ascending: true })
    .order("quote_currency", { ascending: true });

  if (error || !data) return [];
  return data as RateRow[];
}

// === Live exchange rate fetching ===

const LIVE_API_URL = "https://open.er-api.com/v6/latest";
const SUPPORTED_CURRENCIES = ["USD", "PHP", "CNY", "EUR", "GBP", "JPY", "KRW", "INR", "BDT", "VND"];

type LiveFetchResult = {
  ok: boolean;
  base: string;
  fetched: number;
  saved: number;
  error?: string;
  rates?: Record<string, number>;
  timestamp?: string;
};

/**
 * Fetch live exchange rates from open.er-api.com (free, no API key required).
 * Fetches rates with USD as base, then saves all cross-pairs for supported currencies.
 */
export async function fetchLiveRates(baseCurrency: string = "USD"): Promise<LiveFetchResult> {
  const base = baseCurrency.toUpperCase();

  try {
    const response = await fetch(`${LIVE_API_URL}/${base}`, {
      headers: { "Accept": "application/json" },
      // Next.js cache bypass
      cache: "no-store",
    });

    if (!response.ok) {
      return { ok: false, base, fetched: 0, saved: 0, error: `Live API returned HTTP ${response.status}` };
    }

    const data = await response.json();

    if (!data?.rates || typeof data.rates !== "object") {
      return { ok: false, base, fetched: 0, saved: 0, error: "Live API returned no rates" };
    }

    const apiRates = data.rates as Record<string, number>;
    const apiTimestamp = data.time_last_update_utc
      ? new Date(data.time_last_update_utc).toISOString()
      : new Date().toISOString();

    // Filter to supported currencies and build cross-pairs
    const relevantRates: Record<string, number> = {};
    for (const currency of SUPPORTED_CURRENCIES) {
      if (currency === base) {
        relevantRates[currency] = 1;
      } else if (apiRates[currency] != null) {
        relevantRates[currency] = apiRates[currency];
      }
    }

    // Save all pairs: base->quote for each supported currency
    const supabase = createSupabaseServiceClient();
    let saved = 0;
    const rows: Array<{ base_currency: string; quote_currency: string; rate: number; source: string; updated_at: string }> = [];

    for (const [quoteCurrency, rate] of Object.entries(relevantRates)) {
      if (quoteCurrency === base) continue;
      if (!Number.isFinite(rate) || rate <= 0) continue;

      rows.push({
        base_currency: base,
        quote_currency: quoteCurrency,
        rate,
        source: `live (${data.provider ?? "er-api"})`,
        updated_at: apiTimestamp,
      });
      saved++;
    }

    if (rows.length > 0) {
      const { error: upsertError } = await supabase
        .from("currency_rates")
        .upsert(rows, { onConflict: "base_currency,quote_currency" });

      if (upsertError) {
        return { ok: false, base, fetched: Object.keys(relevantRates).length, saved: 0, error: upsertError.message };
      }
    }

    // Invalidate cache so new rates are picked up immediately
    rateCache = null;

    return {
      ok: true,
      base,
      fetched: Object.keys(relevantRates).length,
      saved,
      rates: relevantRates,
      timestamp: apiTimestamp,
    };
  } catch (error) {
    return {
      ok: false,
      base,
      fetched: 0,
      saved: 0,
      error: error instanceof Error ? error.message : "Failed to fetch live rates",
    };
  }
}
