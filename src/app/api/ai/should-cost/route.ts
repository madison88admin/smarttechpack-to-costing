import { NextResponse } from "next/server";
import { canRunCostingAction, getCurrentRole } from "@/lib/auth/roles";
import { estimateShouldCost } from "@/lib/ai/should-cost";
import { validateBody, shouldCostSchema } from "@/lib/api/validate";
import { checkRateLimit, getClientIp, RATE_LIMITS } from "@/lib/auth/rate-limit";

// POST /api/ai/should-cost — estimate should-cost based on attributes
export async function POST(request: Request) {
  if (!canRunCostingAction(getCurrentRole())) {
    return NextResponse.json({ ok: false, error: "Costing or admin access required" }, { status: 403 });
  }

  // Rate limit: 20 AI requests per minute per IP
  const clientIp = getClientIp(request);
  const rateLimit = checkRateLimit(`ai:${clientIp}`, RATE_LIMITS.ai.maxRequests, RATE_LIMITS.ai.windowMs);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { ok: false, error: "Rate limit exceeded. Please wait a moment before trying again." },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }

  const body = await request.json().catch(() => null);
  const validation = validateBody(shouldCostSchema, body);
  if (!validation.success) return validation.response;
  const v = validation.data;

  try {
    const estimate = await estimateShouldCost({
      yarnType: v.yarnType,
      knitType: v.knitType,
      machineType: v.machineType,
      construction: v.construction,
      productCategory: v.productCategory,
      factoryName: v.factoryName,
      actualQuoteTotal: v.actualQuoteTotal,
      currency: v.currency
    });

    if (!estimate) {
      return NextResponse.json({
        ok: true,
        estimate: null,
        message: "Insufficient historical data to generate should-cost estimate"
      });
    }

    return NextResponse.json({ ok: true, estimate });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Should-cost estimation failed"
    }, { status: 500 });
  }
}
