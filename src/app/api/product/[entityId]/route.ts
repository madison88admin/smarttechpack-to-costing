import { badRequest, upstreamJson } from "@/lib/api/response";
import { nextGenGet } from "@/lib/nextgen/client";
import { getCurrentRole } from "@/lib/auth/roles";

export async function GET(_: Request, context: { params: { entityId: string } }) {
  const role = getCurrentRole();
  if (role === "viewer") {
    return badRequest("Authentication required");
  }

  return upstreamJson(await nextGenGet("productRead", { id: context.params.entityId }));
}
