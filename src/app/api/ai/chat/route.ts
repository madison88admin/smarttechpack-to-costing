import { NextResponse } from "next/server";
import { getCurrentRole } from "@/lib/auth/roles";
import { processChatMessage } from "@/lib/ai/chatbot";
import { validateBody, chatSchema } from "@/lib/api/validate";
import { checkRateLimit, getClientIp, RATE_LIMITS } from "@/lib/auth/rate-limit";

// POST /api/ai/chat — process a chat message
export async function POST(request: Request) {
  const role = getCurrentRole();
  if (!role || role === "factory") {
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
  const validation = validateBody(chatSchema, body);
  if (!validation.success) return validation.response;
  const { message, requestId, styleNumber } = validation.data;

  try {
    const response = await processChatMessage(message, { requestId, styleNumber });
    return NextResponse.json({ ok: true, response });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Chat failed"
    }, { status: 500 });
  }
}
