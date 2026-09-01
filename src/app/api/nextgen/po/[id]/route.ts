import { badRequest, upstreamJson } from "@/lib/api/response";
import { nextGenGet, nextGenPost } from "@/lib/nextgen/client";
import { getCurrentRole } from "@/lib/auth/roles";

export async function GET(_: Request, context: { params: { id: string } }) {
  const role = getCurrentRole();
  if (role === "viewer") {
    return badRequest("Authentication required");
  }

  const getById = await nextGenGet("poGetById", { id: context.params.id });

  if (getById.ok) return upstreamJson(getById);

  return upstreamJson(await nextGenPost("poRead", { id: context.params.id }));
}
