import { badRequest, upstreamJson } from "@/lib/api/response";
import { legacyKendoSearchPayload, safeNextGenPost } from "@/lib/nextgen/client";
import { normalizeProductSearch } from "@/lib/nextgen/normalize";
import { getCurrentRole } from "@/lib/auth/roles";

export async function GET(request: Request) {
  const role = getCurrentRole();
  if (role === "viewer") {
    return badRequest("Authentication required");
  }
  const q = new URL(request.url).searchParams.get("q")?.trim();

  if (!q) return badRequest("Missing q query parameter");

  const result = await safeNextGenPost(
    "productSearch",
    legacyKendoSearchPayload(q, "Name")
  );

  if (!result.ok) return upstreamJson(result);

  return upstreamJson({
    ...result,
    data: normalizeProductSearch(result.body)
  });
}
