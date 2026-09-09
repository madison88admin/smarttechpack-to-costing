import { badRequest, upstreamJson } from "@/lib/api/response";
import { legacyKendoSearchPayload, safeNextGenPost } from "@/lib/nextgen/client";
import { getCurrentRole } from "@/lib/auth/roles";

export async function GET(request: Request) {
  const role = getCurrentRole();
  if (role === "viewer") {
    return badRequest("Authentication required");
  }

  const q = new URL(request.url).searchParams.get("q")?.trim();

  if (!q) return badRequest("Missing q query parameter");

  return upstreamJson(
    await safeNextGenPost("poSearch", legacyKendoSearchPayload(q, "Name"))
  );
}
