import { badRequest, upstreamJson } from "@/lib/api/response";
import { nextGenPost } from "@/lib/nextgen/client";
import { getCurrentRole } from "@/lib/auth/roles";

export async function GET(_: Request, context: { params: { id: string } }) {
  const role = getCurrentRole();
  if (role === "viewer") {
    return badRequest("Authentication required");
  }

  return upstreamJson(
    await nextGenPost("mpoLines", {
      take: 500,
      skip: 0,
      page: 1,
      pageSize: 500,
      id: context.params.id,
      materialPurchaseOrderId: context.params.id
    })
  );
}
