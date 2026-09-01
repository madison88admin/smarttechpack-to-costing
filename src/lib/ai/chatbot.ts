import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { calculateCostingTotals } from "@/lib/costing/totals";
import { nextGenPost, kendoSearchPayload, legacyKendoSearchPayload } from "@/lib/nextgen/client";
import { normalizeProductSearch, normalizeBomLines } from "@/lib/nextgen/normalize";
import { askLlm, chatCompletion, isLlmConfigured, type LlmMessage } from "@/lib/ai/llm-client";

/**
 * Sanitize user input before inserting into LLM prompts.
 * Removes potential prompt injection patterns and limits length.
 */
function sanitizePromptInput(input: string, maxLength: number = 2000): string {
  // Truncate to max length
  let sanitized = input.slice(0, maxLength);
  // Remove common prompt injection patterns
  sanitized = sanitized.replace(/```[\s\S]*?```/g, "[code block removed]");
  sanitized = sanitized.replace(/system\s*:/gi, "[system]:");
  sanitized = sanitized.replace(/assistant\s*:/gi, "[assistant]:");
  sanitized = sanitized.replace(/\b(ignore|disregard|forget)\s+(previous|above|all)\s+(instructions?|prompts?)/gi, "[filtered]");
  return sanitized.trim();
}

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type ChatContext = {
  requestId?: string;
  styleNumber?: string;
};

const SYSTEM_PROMPT = `You are the AI assistant for the Smart Tech Pack-to-Costing Approval Tool, an apparel costing system used by Madison88. You help with:

1. **NextGen integration** — Search MPOs (Material Purchase Orders), POs (Purchase Orders), and Products from the NextGen PLM system. Users may ask for brands like "TNF" (The North Face), "North Face", or any brand name.

2. **Costing data** — Cost breakdowns, margins, historical averages, anomaly detection for costing requests.

3. **Workflow status** — Pending approvals, overdue requests, status of specific requests.

4. **Pricing & margin** — Landed cost calculations, wholesale/retail pricing, break-even analysis.

When you receive data from the system (NextGen search results, cost breakdowns, etc.), format it into a clear, readable response for the user. Be concise but informative. Use bullet points for lists.

If the user asks about something you don't have data for, say so honestly and suggest what you CAN help with.

Keep responses focused and practical. This is a business tool for apparel costing professionals.`;

// Main entry point — processes a chat message and returns a response
export async function processChatMessage(
  message: string,
  context: ChatContext = {}
): Promise<string> {
  const lowerMessage = message.toLowerCase().trim();
  const supabase = createSupabaseServiceClient();

  // Gather context data based on what the user is asking about
  const contextData = await gatherContextData(message, context, supabase);

  // If LLM is configured, use it to generate a natural response
  if (isLlmConfigured()) {
    const userPrompt = buildUserPrompt(message, contextData, context);
    const response = await askLlm(SYSTEM_PROMPT, userPrompt, {
      maxTokens: 600,
      temperature: 0.3
    });

    if (response.ok && response.content) {
      return response.content;
    }

    // Fall back to rule-based if LLM fails
    console.error("[chatbot] LLM failed:", response.error);
  }

  // Rule-based fallback (no LLM)
  return ruleBasedResponse(message, contextData, context, supabase);
}

// Gather relevant data from NextGen and Supabase based on the user's message
async function gatherContextData(
  message: string,
  context: ChatContext,
  supabase: ReturnType<typeof createSupabaseServiceClient>
): Promise<ContextData> {
  const lower = message.toLowerCase();
  const data: ContextData = {};

  // === NextGen searches ===
  if (lower.includes("mpo") && (lower.includes("search") || lower.includes("find") || lower.includes("get") || lower.includes("show") || lower.includes("brand") || lower.includes("tnf") || lower.includes("north face"))) {
    const term = extractSearchTerm(message, ["mpo", "search", "find", "get", "show", "brand", "for", "with", "the"]);
    if (term) data.mpoResults = await searchMposData(term);
  }

  if ((lower.includes("po ") || lower.includes("purchase order") || lower.includes("po search")) &&
      (lower.includes("search") || lower.includes("find") || lower.includes("get") || lower.includes("show") || lower.includes("brand"))) {
    const term = extractSearchTerm(message, ["po", "purchase", "order", "search", "find", "get", "show", "brand", "for", "with", "the"]);
    if (term) data.poResults = await searchPosData(term);
  }

  if ((lower.includes("product") || lower.includes("style")) &&
      (lower.includes("search") || lower.includes("find") || lower.includes("get") || lower.includes("show") || lower.includes("brand") || lower.includes("tnf") || lower.includes("north face"))) {
    const term = extractSearchTerm(message, ["product", "products", "style", "search", "find", "get", "show", "brand", "for", "with", "the"]);
    if (term) data.productResults = await searchProductsData(term);
  }

  if ((lower.includes("nextgen") || lower.includes("next gen")) && (lower.includes("search") || lower.includes("find") || lower.includes("lookup"))) {
    const term = extractSearchTerm(message, ["nextgen", "next", "gen", "search", "find", "lookup", "for", "with", "the"]);
    if (term) {
      data.mpoResults = await searchMposData(term);
      data.poResults = await searchPosData(term);
      data.productResults = await searchProductsData(term);
    }
  }

  if (lower.includes("bom") || (lower.includes("materials") && lower.includes("style")) || lower.includes("bill of materials")) {
    const styleOrName = context.styleNumber ?? extractSearchTerm(message, ["bom", "materials", "material", "bill", "of", "show", "for", "style", "what", "are", "the"]);
    if (styleOrName) data.bomData = await getBomData(styleOrName);
  }

  // === Costing system queries ===
  if (context.requestId && (lower.includes("breakdown") || lower.includes("cost detail") || lower.includes("how much"))) {
    data.costBreakdown = await getCostBreakdownData(supabase, context.requestId);
  }

  if (lower.includes("historical") || lower.includes("average") || lower.includes("benchmark")) {
    if (context.styleNumber) {
      data.historicalData = await getHistoricalData(supabase, context.styleNumber);
    }
  }

  if (lower.includes("overdue") || lower.includes("pending") || lower.includes("waiting")) {
    data.pendingRequests = await getPendingRequestsData(supabase);
  }

  if (lower.includes("margin") || lower.includes("profit") || lower.includes("markup")) {
    if (context.requestId) {
      data.marginInfo = await getMarginData(supabase, context.requestId);
    }
  }

  if (lower.includes("anomaly") || lower.includes("alert") || lower.includes("unusual")) {
    data.anomalySummary = await getAnomalyData(supabase);
  }

  if (lower.includes("status") && context.requestId) {
    data.requestStatus = await getRequestStatusData(supabase, context.requestId);
  }

  return data;
}

type ContextData = {
  mpoResults?: { term: string; results: any[]; error?: string };
  poResults?: { term: string; results: any[]; error?: string };
  productResults?: { term: string; results: any[]; error?: string };
  bomData?: { style: string; product: any; lines: any[]; error?: string };
  costBreakdown?: { totals: any; lines: any[]; error?: string };
  historicalData?: { styleNumber: string; records: any[] };
  pendingRequests?: { requests: any[] };
  marginInfo?: { totals: any; error?: string };
  anomalySummary?: { checked: number; anomalies: string[] };
  requestStatus?: { request: any };
};

// Build the user prompt for the LLM with gathered context
function buildUserPrompt(message: string, data: ContextData, context: ChatContext): string {
  const safeMessage = sanitizePromptInput(message);
  const parts: string[] = [`User question: "${safeMessage}"`];

  if (context.requestId) parts.push(`\nCurrent request ID: ${context.requestId}`);
  if (context.styleNumber) parts.push(`Current style number: ${context.styleNumber}`);

  if (data.mpoResults) {
    if (data.mpoResults.error) {
      parts.push(`\nMPO search for "${data.mpoResults.term}" failed: ${data.mpoResults.error}`);
    } else if (data.mpoResults.results.length === 0) {
      parts.push(`\nMPO search for "${data.mpoResults.term}": No results found.`);
    } else {
      parts.push(`\nMPO search results for "${data.mpoResults.term}" (${data.mpoResults.results.length} found):`);
      parts.push(data.mpoResults.results.slice(0, 10).map((r: any) =>
        `- ${r.mpoNumber || r.id}${r.brand ? ` | Brand: ${r.brand}` : ""}${r.supplier ? ` | Supplier: ${r.supplier}` : ""}${r.status ? ` | Status: ${r.status}` : ""}${r.total ? ` | ${r.currency || ""} ${r.total}` : ""}`
      ).join("\n"));
    }
  }

  if (data.poResults) {
    if (data.poResults.error) {
      parts.push(`\nPO search for "${data.poResults.term}" failed: ${data.poResults.error}`);
    } else if (data.poResults.results.length === 0) {
      parts.push(`\nPO search for "${data.poResults.term}": No results found.`);
    } else {
      parts.push(`\nPurchase Order results for "${data.poResults.term}" (${data.poResults.results.length} found):`);
      parts.push(data.poResults.results.slice(0, 10).map((r: any) =>
        `- ${r.poNumber}${r.brand ? ` | Brand: ${r.brand}` : ""}${r.supplier ? ` | Supplier: ${r.supplier}` : ""}${r.status ? ` | Status: ${r.status}` : ""}${r.total ? ` | ${r.currency || ""} ${r.total}` : ""}`
      ).join("\n"));
    }
  }

  if (data.productResults) {
    if (data.productResults.error) {
      parts.push(`\nProduct search for "${data.productResults.term}" failed: ${data.productResults.error}`);
    } else if (data.productResults.results.length === 0) {
      parts.push(`\nProduct search for "${data.productResults.term}": No results found.`);
    } else {
      parts.push(`\nProduct search results for "${data.productResults.term}" (${data.productResults.results.length} found):`);
      parts.push(data.productResults.results.slice(0, 10).map((r: any) =>
        `- ${r.styleNumber} — ${r.name}${r.description ? ` (${r.description})` : ""} [Entity ID: ${r.entityId}]`
      ).join("\n"));
    }
  }

  if (data.bomData) {
    if (data.bomData.error) {
      parts.push(`\nBOM lookup for "${data.bomData.style}" failed: ${data.bomData.error}`);
    } else {
      parts.push(`\nBOM for ${data.bomData.product?.styleNumber} — ${data.bomData.product?.name} (${data.bomData.lines.length} lines):`);
      parts.push(data.bomData.lines.slice(0, 15).map((l: any) =>
        `- [${l.category}] ${l.materialName}${l.materialDescription ? ` — ${l.materialDescription}` : ""}${l.usage ? ` | Usage: ${l.usage}` : ""}${l.size ? ` | Size: ${l.size}` : ""}`
      ).join("\n"));
    }
  }

  if (data.costBreakdown) {
    if (data.costBreakdown.error) {
      parts.push(`\nCost breakdown: ${data.costBreakdown.error}`);
    } else {
      const t = data.costBreakdown.totals;
      parts.push(`\nCost Breakdown:`);
      parts.push(`- Materials: ${t.currency} ${t.materialTotal.toFixed(2)}`);
      parts.push(`- Labor: ${t.currency} ${t.laborCost.toFixed(2)}`);
      parts.push(`- Overhead: ${t.currency} ${t.overheadCost.toFixed(2)}`);
      parts.push(`- Packaging: ${t.currency} ${t.packagingCost.toFixed(2)}`);
      parts.push(`- Testing: ${t.currency} ${t.testingCost.toFixed(2)}`);
      parts.push(`- Profit (${t.profitMarginPercent}%): ${t.currency} ${t.profitAmount.toFixed(2)}`);
      parts.push(`- FOB Total: ${t.currency} ${t.grandTotal.toFixed(2)}`);
      parts.push(`- Landed Cost: ${t.currency} ${t.landedCost.toFixed(2)}`);
    }
  }

  if (data.historicalData) {
    const h = data.historicalData;
    if (h.records.length === 0) {
      parts.push(`\nHistorical data for "${h.styleNumber}": No records found.`);
    } else {
      parts.push(`\nHistorical data for "${h.styleNumber}" (${h.records.length} records):`);
      parts.push(h.records.map((r: any) => `- ${r.currency}: avg ${r.avg.toFixed(2)}, min ${r.min.toFixed(2)}, max ${r.max.toFixed(2)} (${r.count} records)`).join("\n"));
    }
  }

  if (data.pendingRequests) {
    if (data.pendingRequests.requests.length === 0) {
      parts.push(`\nPending requests: None. All clear!`);
    } else {
      parts.push(`\nPending requests (${data.pendingRequests.requests.length} shown):`);
      parts.push(data.pendingRequests.requests.map((r: any) =>
        `- ${r.request_number ?? r.id.slice(0, 8)} — ${r.status} (${r.days}d ago) — ${r.factory_name ?? "—"}`
      ).join("\n"));
    }
  }

  if (data.marginInfo) {
    if (data.marginInfo.error) {
      parts.push(`\nMargin info: ${data.marginInfo.error}`);
    } else {
      const t = data.marginInfo.totals;
      parts.push(`\nMargin Analysis:`);
      parts.push(`- Landed Cost: ${t.currency} ${t.landedCost.toFixed(2)}`);
      parts.push(`- Wholesale Price (${t.wholesaleMarkup}x): ${t.currency} ${t.wholesalePrice.toFixed(2)}`);
      parts.push(`- Retail Price (${t.retailMarkup}x): ${t.currency} ${t.retailPrice.toFixed(2)}`);
      parts.push(`- Gross Margin: ${t.grossMarginPercent.toFixed(1)}%`);
      parts.push(`- Profit/Unit: ${t.currency} ${(t.wholesalePrice - t.landedCost).toFixed(2)}`);
    }
  }

  if (data.anomalySummary) {
    if (data.anomalySummary.anomalies.length === 0) {
      parts.push(`\nAnomaly check: Checked ${data.anomalySummary.checked} recent submissions. No anomalies detected.`);
    } else {
      parts.push(`\nAnomaly Summary (${data.anomalySummary.anomalies.length} found):`);
      parts.push(data.anomalySummary.anomalies.join("\n"));
    }
  }

  if (data.requestStatus) {
    const r = data.requestStatus.request;
    parts.push(`\nRequest status: ${r.request_number} — Status: ${r.status} — Factory: ${r.factory_name} — Updated: ${r.days} day(s) ago`);
  }

  parts.push(`\nBased on the data above, answer the user's question clearly and concisely. If no data was gathered for their question, provide a helpful response about what you can help with.`);

  return parts.join("\n");
}

// === Rule-based fallback (when LLM is not available) ===

async function ruleBasedResponse(
  message: string,
  data: ContextData,
  context: ChatContext,
  supabase: ReturnType<typeof createSupabaseServiceClient>
): Promise<string> {
  const lower = message.toLowerCase().trim();

  if (/^(hi|hello|hey)\b/.test(lower) || lower === "help") {
    return "Hello! I'm your costing assistant. I can help with:\n• NextGen: Search MPOs, POs, products by brand or name\n• Cost breakdowns for a specific request\n• Historical cost averages\n• Status of pending approvals\n• Margin and pricing calculations\n• Anomaly detection\n\nTry: \"Search MPO for TNF\", \"Find products with North Face\", \"Show pending requests\", or \"What's the cost breakdown?\"";
  }

  if (data.mpoResults) {
    if (data.mpoResults.error) return `MPO search failed: ${data.mpoResults.error}`;
    if (data.mpoResults.results.length === 0) return `No MPOs found matching "${data.mpoResults.term}".`;
    const lines = [`MPO Search Results for "${data.mpoResults.term}" (${data.mpoResults.results.length} found):`];
    lines.push(...data.mpoResults.results.slice(0, 10).map((r: any) =>
      `• ${r.mpoNumber || r.id}${r.brand ? ` | Brand: ${r.brand}` : ""}${r.supplier ? ` | Supplier: ${r.supplier}` : ""}${r.status ? ` | Status: ${r.status}` : ""}${r.total ? ` | ${r.currency || ""} ${r.total}` : ""}`
    ));
    return lines.join("\n");
  }

  if (data.poResults) {
    if (data.poResults.error) return `PO search failed: ${data.poResults.error}`;
    if (data.poResults.results.length === 0) return `No Purchase Orders found matching "${data.poResults.term}".`;
    const lines = [`Purchase Order Results for "${data.poResults.term}" (${data.poResults.results.length} found):`];
    lines.push(...data.poResults.results.slice(0, 10).map((r: any) =>
      `• ${r.poNumber}${r.brand ? ` | Brand: ${r.brand}` : ""}${r.supplier ? ` | Supplier: ${r.supplier}` : ""}${r.status ? ` | Status: ${r.status}` : ""}${r.total ? ` | ${r.currency || ""} ${r.total}` : ""}`
    ));
    return lines.join("\n");
  }

  if (data.productResults) {
    if (data.productResults.error) return `Product search failed: ${data.productResults.error}`;
    if (data.productResults.results.length === 0) return `No products found matching "${data.productResults.term}".`;
    const lines = [`Product Search Results for "${data.productResults.term}" (${data.productResults.results.length} found):`];
    lines.push(...data.productResults.results.slice(0, 10).map((r: any) =>
      `• ${r.styleNumber} — ${r.name}${r.description ? ` (${r.description})` : ""} [Entity ID: ${r.entityId}]`
    ));
    return lines.join("\n");
  }

  if (data.bomData) {
    if (data.bomData.error) return `BOM lookup error: ${data.bomData.error}`;
    const lines = [`BOM for ${data.bomData.product?.styleNumber} — ${data.bomData.product?.name} (${data.bomData.lines.length} lines):`];
    lines.push(...data.bomData.lines.slice(0, 15).map((l: any) =>
      `• [${l.category}] ${l.materialName}${l.materialDescription ? ` — ${l.materialDescription}` : ""}${l.usage ? ` | Usage: ${l.usage}` : ""}${l.size ? ` | Size: ${l.size}` : ""}`
    ));
    return lines.join("\n");
  }

  if (data.costBreakdown) {
    if (data.costBreakdown.error) return data.costBreakdown.error;
    const t = data.costBreakdown.totals;
    return `Cost Breakdown:\n• Materials: ${t.currency} ${t.materialTotal.toFixed(2)}\n• Labor: ${t.currency} ${t.laborCost.toFixed(2)}\n• Overhead: ${t.currency} ${t.overheadCost.toFixed(2)}\n• Packaging: ${t.currency} ${t.packagingCost.toFixed(2)}\n• Testing: ${t.currency} ${t.testingCost.toFixed(2)}\n• Profit (${t.profitMarginPercent}%): ${t.currency} ${t.profitAmount.toFixed(2)}\n\nFOB Total: ${t.currency} ${t.grandTotal.toFixed(2)}\nLanded Cost: ${t.currency} ${t.landedCost.toFixed(2)}`;
  }

  if (data.historicalData) {
    const h = data.historicalData;
    if (h.records.length === 0) return `No historical data found for style "${h.styleNumber}".`;
    const lines = [`Historical data for "${h.styleNumber}" (${h.records.length} records):`];
    lines.push(...h.records.map((r: any) => `• ${r.currency}: avg ${r.avg.toFixed(2)}, min ${r.min.toFixed(2)}, max ${r.max.toFixed(2)} (${r.count} records)`));
    return lines.join("\n");
  }

  if (data.pendingRequests) {
    if (data.pendingRequests.requests.length === 0) return "No pending requests. All clear!";
    const lines = [`Pending requests (${data.pendingRequests.requests.length} shown):`];
    lines.push(...data.pendingRequests.requests.map((r: any) =>
      `• ${r.request_number ?? r.id.slice(0, 8)} — ${r.status} (${r.days}d ago) — ${r.factory_name ?? "—"}`
    ));
    return lines.join("\n");
  }

  if (data.marginInfo) {
    if (data.marginInfo.error) return data.marginInfo.error;
    const t = data.marginInfo.totals;
    if (t.landedCost <= 0) return `FOB Cost: ${t.currency} ${t.grandTotal.toFixed(2)}\nNo landed cost data provided. Add freight, duty, and insurance to calculate margins.`;
    return `Margin Analysis:\n• Landed Cost: ${t.currency} ${t.landedCost.toFixed(2)}\n• Wholesale Price (${t.wholesaleMarkup}x): ${t.currency} ${t.wholesalePrice.toFixed(2)}\n• Retail Price (${t.retailMarkup}x): ${t.currency} ${t.retailPrice.toFixed(2)}\n• Gross Margin: ${t.grossMarginPercent.toFixed(1)}%\n• Profit/Unit: ${t.currency} ${(t.wholesalePrice - t.landedCost).toFixed(2)}`;
  }

  if (data.anomalySummary) {
    if (data.anomalySummary.anomalies.length === 0) return `Checked ${data.anomalySummary.checked} recent submissions. No anomalies detected.`;
    return `Anomaly Summary (${data.anomalySummary.anomalies.length} found):\n${data.anomalySummary.anomalies.join("\n")}`;
  }

  if (data.requestStatus) {
    const r = data.requestStatus.request;
    return `Request ${r.request_number}:\n• Status: ${r.status}\n• Factory: ${r.factory_name ?? "—"}\n• Last updated: ${r.days} day(s) ago`;
  }

  return "I'm not sure how to help with that. Try asking about:\n• NextGen: \"Search MPO for TNF\", \"Find products with North Face\"\n• Cost breakdown or margin (from a request page)\n• Historical averages or benchmarks\n• Pending/overdue requests\n• Anomaly alerts\n\nOr type 'help' for more options.";
}

// === Data gathering functions ===

function extractSearchTerm(message: string, stopwords: string[]): string {
  const words = message.split(/\s+/);
  const filtered = words.filter((w) => {
    const lower = w.toLowerCase().replace(/[^\w]/g, "");
    return lower && !stopwords.includes(lower);
  });
  return filtered.join(" ").trim();
}

async function searchMposData(term: string): Promise<{ term: string; results: any[]; error?: string }> {
  try {
    const result = await nextGenPost("mpoSearch", kendoSearchPayload(term, ["MPONumber", "OrderNumber", "Number", "Brand", "BrandName", "CustomerName"]));
    if (!result.ok) return { term, results: [], error: `NextGen error (status ${result.status})` };
    const rows = extractRows(result.body);
    const results = rows.map((row) => ({
      mpoNumber: readField(row, ["MPONumber", "Number", "OrderNumber"]),
      brand: readField(row, ["Brand", "BrandName", "BrandNameId"]),
      supplier: readField(row, ["SupplierName", "Supplier", "VendorName"]),
      status: readField(row, ["Status", "StatusName", "MPOStatus"]),
      total: readField(row, ["TotalAmount", "Total", "GrandTotal", "Amount"]),
      currency: readField(row, ["Currency", "CurrencyCode"]),
      id: readField(row, ["Id", "ID", "EntityId", "MPOId"])
    }));
    return { term, results };
  } catch (error) {
    return { term, results: [], error: error instanceof Error ? error.message : "Unable to connect to NextGen" };
  }
}

async function searchPosData(term: string): Promise<{ term: string; results: any[]; error?: string }> {
  try {
    const result = await nextGenPost("poSearch", kendoSearchPayload(term, ["OrderNumber", "PONumber", "Number", "Brand", "BrandName", "CustomerName"]));
    if (!result.ok) return { term, results: [], error: `NextGen error (status ${result.status})` };
    const rows = extractRows(result.body);
    const results = rows.map((row) => ({
      poNumber: readField(row, ["OrderNumber", "PONumber", "Number"]),
      brand: readField(row, ["Brand", "BrandName"]),
      supplier: readField(row, ["SupplierName", "Supplier", "VendorName"]),
      status: readField(row, ["Status", "StatusName"]),
      total: readField(row, ["TotalAmount", "Total", "GrandTotal", "Amount"]),
      currency: readField(row, ["Currency", "CurrencyCode"])
    }));
    return { term, results };
  } catch (error) {
    return { term, results: [], error: error instanceof Error ? error.message : "Unable to connect to NextGen" };
  }
}

async function searchProductsData(term: string): Promise<{ term: string; results: any[]; error?: string }> {
  try {
    const result = await nextGenPost("productSearch", legacyKendoSearchPayload(term, "Name"));
    if (!result.ok) return { term, results: [], error: `NextGen error (status ${result.status})` };
    const products = normalizeProductSearch(result.body);
    return { term, results: products };
  } catch (error) {
    return { term, results: [], error: error instanceof Error ? error.message : "Unable to connect to NextGen" };
  }
}

async function getBomData(styleOrName: string): Promise<{ style: string; product: any; lines: any[]; error?: string }> {
  try {
    const searchResult = await nextGenPost("productSearch", legacyKendoSearchPayload(styleOrName, "Name"));
    if (!searchResult.ok) return { style: styleOrName, product: null, lines: [], error: "Product search failed" };
    const products = normalizeProductSearch(searchResult.body);
    if (products.length === 0) return { style: styleOrName, product: null, lines: [], error: `No product found matching "${styleOrName}"` };
    const product = products[0];
    if (!product.entityId) return { style: styleOrName, product, lines: [], error: "No entity ID available" };

    const { getBomConfig } = await import("@/lib/nextgen/config");
    const bomConfig = getBomConfig();
    const bomResult = await nextGenPost("productBom", {
      EntityType: bomConfig.entityType,
      FilterField: bomConfig.filterField,
      FilterOperator: bomConfig.filterOperator,
      FilterValue: product.entityId,
      PageSize: bomConfig.pageSize,
      UserAreaClaim: bomConfig.userAreaClaim,
      ShowTabs: bomConfig.showTabs,
      ViewCachePath: bomConfig.viewCachePath
    });
    if (!bomResult.ok) return { style: styleOrName, product, lines: [], error: "BOM fetch failed" };
    const lines = normalizeBomLines(bomResult.body);
    return { style: styleOrName, product, lines };
  } catch (error) {
    return { style: styleOrName, product: null, lines: [], error: error instanceof Error ? error.message : "NextGen connection failed" };
  }
}

async function getCostBreakdownData(supabase: ReturnType<typeof createSupabaseServiceClient>, requestId: string) {
  const { data: cbd } = await supabase
    .from("factory_cbds")
    .select("raw_payload, cbd_material_lines (total_cost, currency, material_name)")
    .eq("costing_request_id", requestId)
    .order("submitted_at", { ascending: false, nullsFirst: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!cbd) return { totals: null, lines: [], error: "No CBD found for this request yet." };
  const totals = calculateCostingTotals({ rawPayload: cbd.raw_payload, lines: cbd.cbd_material_lines });
  return { totals, lines: cbd.cbd_material_lines ?? [] };
}

async function getHistoricalData(supabase: ReturnType<typeof createSupabaseServiceClient>, styleNumber: string) {
  const { data } = await supabase
    .from("historical_costings")
    .select("total_cost, currency, factory_name, approved_at")
    .ilike("style_number", `%${styleNumber}%`)
    .order("approved_at", { ascending: false })
    .limit(10);
  const records: any[] = [];
  if (data && data.length > 0) {
    const byCurrency = new Map<string, number[]>();
    for (const row of data as any[]) {
      if (row.total_cost == null) continue;
      const list = byCurrency.get(row.currency ?? "USD") ?? [];
      list.push(row.total_cost);
      byCurrency.set(row.currency ?? "USD", list);
    }
    for (const [currency, costs] of byCurrency.entries()) {
      records.push({
        currency,
        avg: costs.reduce((s, c) => s + c, 0) / costs.length,
        min: Math.min(...costs),
        max: Math.max(...costs),
        count: costs.length
      });
    }
  }
  return { styleNumber, records };
}

async function getPendingRequestsData(supabase: ReturnType<typeof createSupabaseServiceClient>) {
  const { data } = await supabase
    .from("costing_requests")
    .select("id, request_number, status, factory_name, updated_at")
    .in("status", ["for_costing_review", "for_pbd_review", "needs_clarification", "pending_manager_approval", "sent_to_factory"])
    .order("updated_at", { ascending: true })
    .limit(10);
  const requests = (data ?? []).map((r: any) => ({
    ...r,
    days: Math.floor((Date.now() - new Date(r.updated_at).getTime()) / 86400000)
  }));
  return { requests };
}

async function getMarginData(supabase: ReturnType<typeof createSupabaseServiceClient>, requestId: string) {
  const { data: cbd } = await supabase
    .from("factory_cbds")
    .select("raw_payload")
    .eq("costing_request_id", requestId)
    .order("submitted_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  if (!cbd?.raw_payload) return { totals: null, error: "No CBD data available for margin calculation." };
  const totals = calculateCostingTotals({ rawPayload: cbd.raw_payload });
  return { totals };
}

async function getAnomalyData(supabase: ReturnType<typeof createSupabaseServiceClient>) {
  const { data: recentCbds } = await supabase
    .from("factory_cbds")
    .select("id, raw_payload, costing_requests (factory_name, nextgen_products (style_number))")
    .not("submitted_at", "is", null)
    .order("submitted_at", { ascending: false })
    .limit(20);
  const anomalies: string[] = [];
  const checked = recentCbds?.length ?? 0;
  for (const cbd of (recentCbds ?? []) as any[]) {
    const payload = cbd.raw_payload ?? {};
    const grandTotal = payload.grandTotal ?? 0;
    const styleNumber = cbd.costing_requests?.nextgen_products?.[0]?.style_number ?? cbd.costing_requests?.nextgen_products?.style_number;
    if (styleNumber && grandTotal > 0) {
      const { data: hist } = await supabase
        .from("historical_costings")
        .select("total_cost")
        .ilike("style_number", `%${styleNumber}%`)
        .limit(5);
      const histCosts = (hist ?? []).filter((h: any) => h.total_cost != null).map((h: any) => h.total_cost);
      if (histCosts.length >= 2) {
        const avg = histCosts.reduce((s: number, c: number) => s + c, 0) / histCosts.length;
        const variance = ((grandTotal - avg) / avg) * 100;
        if (variance > 15) anomalies.push(`• ${styleNumber}: ${variance.toFixed(1)}% above average (${payload.currency ?? "USD"} ${grandTotal.toFixed(2)} vs ${avg.toFixed(2)})`);
      }
    }
  }
  return { checked, anomalies };
}

async function getRequestStatusData(supabase: ReturnType<typeof createSupabaseServiceClient>, requestId: string) {
  const { data } = await supabase
    .from("costing_requests")
    .select("status, request_number, factory_name, updated_at")
    .eq("id", requestId)
    .single();
  if (!data) return { request: null };
  const days = Math.floor((Date.now() - new Date(data.updated_at).getTime()) / 86400000);
  return { request: { ...data, days } };
}

function extractRows(body: unknown): Record<string, unknown>[] {
  if (Array.isArray(body)) return body.filter((r) => typeof r === "object" && r !== null) as Record<string, unknown>[];
  if (typeof body !== "object" || body === null) return [];
  const record = body as Record<string, unknown>;
  for (const key of ["Data", "data", "Items", "items", "Results", "results", "Rows", "rows", "Records", "records"]) {
    const value = record[key];
    if (Array.isArray(value)) return value.filter((r) => typeof r === "object" && r !== null) as Record<string, unknown>[];
  }
  return [];
}

function readField(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return "";
}
