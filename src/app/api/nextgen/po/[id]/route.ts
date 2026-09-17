import { NextResponse } from "next/server";
import { badRequest, upstreamJson } from "@/lib/api/response";
import { nextGenGet, nextGenPost } from "@/lib/nextgen/client";
import { getCurrentRole } from "@/lib/auth/roles";

export async function GET(_: Request, context: { params: { id: string } }) {
  const role = getCurrentRole();
  if (role === "viewer") {
    return badRequest("Authentication required");
  }

  try {
    const getById = await nextGenGet("poGetById", { id: context.params.id });

    if (getById.ok) return upstreamJson(getById);

    return upstreamJson(await nextGenPost("poRead", { id: context.params.id }));
  } catch {
    // nextGenGet/nextGenPost reject on a transport or session failure (unreachable
    // host, login backoff, timeout). Unhandled, that surfaced as a bodiless 500
    // after ~35s of waiting; answer the same upstream contract the sibling PO
    // routes do, so the caller gets a reason instead of an empty response.
    return NextResponse.json(
      {
        ok: false,
        error: "NextGen PO service is currently unavailable. The purchase order could not be loaded.",
        upstreamStatus: 502
      },
      { status: 502 }
    );
  }
}
