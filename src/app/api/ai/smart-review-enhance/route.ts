import { NextResponse } from "next/server";
import { askLlm, isLlmConfigured } from "@/lib/ai/llm-client";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { pgrestValue } from "@/lib/supabase/filters";
import { calculateCostingTotals } from "@/lib/costing/totals";
import { getCurrentRole } from "@/lib/auth/roles";
import { checkRateLimit, getClientIp, RATE_LIMITS } from "@/lib/auth/rate-limit";

// POST /api/ai/smart-review-enhance
// Enhances a smart review with LLM-generated summary and comment
export async function POST(request: Request) {
  const role = getCurrentRole();
  if (role === "viewer") {
    return NextResponse.json({ ok: false, error: "Authentication required" }, { status: 403 });
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
  if (!body?.requestId) {
    return NextResponse.json({ ok: false, error: "requestId is required" }, { status: 400 });
  }

  if (!isLlmConfigured()) {
    return NextResponse.json({ ok: false, error: "LLM not configured" }, { status: 503 });
  }

  const supabase = createSupabaseServiceClient();

  // Fetch request data (status, style, factory)
  const { data: req } = await supabase
    .from("costing_requests")
    .select("id, request_number, status, factory_name, priority, product_id, nextgen_products (style_number, name)")
    .eq("id", pgrestValue(body.requestId))
    .maybeSingle();

  // Fetch CBD data (may not exist yet)
  const { data: cbd } = await supabase
    .from("factory_cbds")
    .select("raw_payload, cbd_material_lines (material_name, unit_cost, total_cost, currency)")
    .eq("costing_request_id", pgrestValue(body.requestId))
    .order("submitted_at", { ascending: false, nullsFirst: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Fetch BOM lines count
  const { count: bomCount } = await supabase
    .from("nextgen_bom_lines")
    .select("id", { count: "exact", head: true })
    .eq("product_id", req?.product_id);

  // Build context for LLM — works with or without CBD
  const dataParts: string[] = [];

  if (req) {
    const product = Array.isArray(req.nextgen_products) ? req.nextgen_products[0] : req.nextgen_products;
    dataParts.push(`Request: ${req.request_number}`);
    dataParts.push(`Status: ${req.status}`);
    dataParts.push(`Style: ${product?.style_number ?? "Unknown"}`);
    dataParts.push(`Factory: ${req.factory_name ?? "Not assigned"}`);
    dataParts.push(`Priority: ${req.priority ?? "normal"}`);
    if (bomCount && bomCount > 0) dataParts.push(`BOM Lines: ${bomCount}`);
  }

  if (cbd) {
    const totals = calculateCostingTotals({
      rawPayload: cbd.raw_payload,
      lines: cbd.cbd_material_lines
    });

    if (totals && totals.grandTotal > 0) {
      const t = totals;
      dataParts.push(``);
      dataParts.push(`Cost Data:`);
      dataParts.push(`- Currency: ${t.currency}`);
      dataParts.push(`- Material Total: ${t.materialTotal.toFixed(2)}`);
      dataParts.push(`- Labor: ${t.laborCost.toFixed(2)}`);
      dataParts.push(`- Overhead: ${t.overheadCost.toFixed(2)}`);
      dataParts.push(`- FOB Grand Total: ${t.grandTotal.toFixed(2)}`);
      if (t.landedCost > 0) dataParts.push(`- Landed Cost: ${t.landedCost.toFixed(2)}`);
      if (t.wholesalePrice > 0) dataParts.push(`- Wholesale Price: ${t.wholesalePrice.toFixed(2)} (${t.wholesaleMarkup}x)`);
      if (t.grossMarginPercent !== 0) dataParts.push(`- Gross Margin: ${t.grossMarginPercent.toFixed(1)}%`);
    }
  } else {
    dataParts.push(``);
    dataParts.push(`CBD Status: Not yet submitted by factory`);
  }

  if (body.variancePercent != null) dataParts.push(`- Historical Variance: ${body.variancePercent.toFixed(1)}%`);
  if (body.riskLevel) dataParts.push(`- Rule-based Risk: ${body.riskLevel}`);
  if (body.highlights) dataParts.push(``);
  // Sanitize user-provided highlights to prevent prompt injection
  const safeHighlights = String(body.highlights ?? "").replace(/```[\s\S]*?```/g, "[filtered]").replace(/system\s*:/gi, "[filtered]:").slice(0, 1000);
  if (body.highlights) dataParts.push(`Key findings: ${safeHighlights}`);

  const dataContext = dataParts.join("\n");

  const systemPrompt = `You are a senior apparel costing analyst. Analyze this costing request and provide:
1. A concise summary (2-3 sentences) of the current status, risk level, and key findings
2. A recommended action for the PBD (Product Business Developer)
3. A suggested comment for the approval/review

Be professional and specific. Reference actual numbers when available. If no CBD has been submitted yet, focus on what needs to happen next. Format as:
SUMMARY: <summary>
ACTION: <action>
COMMENT: <comment>`;

  const response = await askLlm(systemPrompt, `Review this costing request:\n${dataContext}`, {
    maxTokens: 400,
    temperature: 0.3
  });

  if (!response.ok || !response.content) {
    return NextResponse.json({ ok: false, error: response.error ?? "LLM failed" }, { status: 502 });
  }

  // Parse the response
  const parsed: { summary?: string; action?: string; comment?: string } = {};
  for (const line of response.content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.toUpperCase().startsWith("SUMMARY:")) parsed.summary = trimmed.substring(8).trim();
    else if (trimmed.toUpperCase().startsWith("ACTION:")) parsed.action = trimmed.substring(7).trim();
    else if (trimmed.toUpperCase().startsWith("COMMENT:")) parsed.comment = trimmed.substring(8).trim();
  }

  return NextResponse.json({ ok: true, data: parsed });
}
