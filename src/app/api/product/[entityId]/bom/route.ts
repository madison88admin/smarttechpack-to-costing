import { badRequest, upstreamJson } from "@/lib/api/response";
import { fetchBom } from "@/lib/nextgen/bom";
import { getCurrentRole } from "@/lib/auth/roles";

export async function GET(_: Request, context: { params: { entityId: string } }) {
  const role = getCurrentRole();
  if (role === "viewer") {
    return badRequest("Authentication required");
  }

  const result = await fetchBom({ entityId: context.params.entityId });

  if (!result.ok) {
    return upstreamJson({
      ok: false,
      status: result.status,
      upstreamContentType: result.upstreamContentType,
      body: result.rawBody
    });
  }

  return upstreamJson({
    ok: true,
    status: result.status,
    upstreamContentType: result.upstreamContentType,
    body: result.rawBody,
    data: result.data,
    total: result.total,
    warning: result.warning
  });
}
