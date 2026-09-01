import { NextResponse } from "next/server";
import { canAccessAdmin, getCurrentRole } from "@/lib/auth/roles";
import { listCurrencyRates, saveCurrencyRate } from "@/lib/currency/rates";

// GET /api/admin/currency-rates — list all rates
export async function GET() {
  const rates = await listCurrencyRates();
  return NextResponse.json({ ok: true, data: rates });
}

// POST /api/admin/currency-rates — save/update a rate
export async function POST(request: Request) {
  if (!canAccessAdmin(getCurrentRole())) {
    return NextResponse.json({ ok: false, error: "Admin role required" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!body?.baseCurrency || !body?.quoteCurrency || typeof body.rate !== "number") {
    return NextResponse.json(
      { ok: false, error: "baseCurrency, quoteCurrency, and rate are required" },
      { status: 400 }
    );
  }

  const result = await saveCurrencyRate(
    String(body.baseCurrency),
    String(body.quoteCurrency),
    Number(body.rate),
    body.source ?? "manual"
  );

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
