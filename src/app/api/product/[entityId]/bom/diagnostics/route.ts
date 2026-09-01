import { NextResponse } from "next/server";
import { badRequest } from "@/lib/api/response";
import { fetchBomDiagnostics } from "@/lib/nextgen/bom";
import { getCurrentRole } from "@/lib/auth/roles";

export async function GET(_: Request, context: { params: { entityId: string } }) {
  const role = getCurrentRole();
  if (role === "viewer") {
    return badRequest("Authentication required");
  }

  const result = await fetchBomDiagnostics({ entityId: context.params.entityId });

  if (!result.ok) {
    return NextResponse.json({
      ok: false,
      status: result.status,
      upstreamContentType: result.upstreamContentType,
      message: "NextGen BOM endpoint did not return JSON data for diagnostics."
    }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    diagnostics: result.diagnostics,
    total: result.total,
    warning: result.warning
  });
}
