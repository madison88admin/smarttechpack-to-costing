import { badRequest, upstreamJson } from "@/lib/api/response";
import { nextGenGet } from "@/lib/nextgen/client";
import { getCurrentRole } from "@/lib/auth/roles";

export async function GET(_: Request, context: { params: { id: string } }) {
  const role = getCurrentRole();
  if (role === "viewer") {
    return badRequest("Authentication required");
  }

  return upstreamJson(await nextGenGet("mpoTotals", { id: context.params.id }));
}
