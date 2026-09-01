import { NextResponse } from "next/server";
import { canAccessAdmin, getCurrentRole } from "@/lib/auth/roles";
import { fetchLiveRates } from "@/lib/currency/rates";

// POST /api/admin/currency-rates/fetch-live
// Fetches real-time exchange rates from open.er-api.com and saves them to the DB.
// Body: { baseCurrency?: string } — defaults to "USD"
export async function POST(request: Request) {
  if (!canAccessAdmin(getCurrentRole())) {
    return NextResponse.json({ ok: false, error: "Admin role required" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const baseCurrency = String(body?.baseCurrency ?? "USD").toUpperCase().trim() || "USD";

  const result = await fetchLiveRates(baseCurrency);

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    base: result.base,
    fetched: result.fetched,
    saved: result.saved,
    timestamp: result.timestamp,
    rates: result.rates,
  });
}
