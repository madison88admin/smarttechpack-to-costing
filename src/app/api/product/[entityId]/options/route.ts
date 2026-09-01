import { badRequest, upstreamJson } from "@/lib/api/response";
import { nextGenPost } from "@/lib/nextgen/client";
import { getCurrentRole } from "@/lib/auth/roles";

export async function GET(_: Request, context: { params: { entityId: string } }) {
  const role = getCurrentRole();
  if (role === "viewer") {
    return badRequest("Authentication required");
  }

  return upstreamJson(
    await nextGenPost("productOptions", {
      take: 100,
      skip: 0,
      page: 1,
      pageSize: 100,
      entityId: context.params.entityId,
      productId: context.params.entityId
    })
  );
}
