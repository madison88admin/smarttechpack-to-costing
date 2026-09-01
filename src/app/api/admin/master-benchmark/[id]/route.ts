import { NextResponse } from "next/server";
import { canCurateMasterBenchmarks, getCurrentRole } from "@/lib/auth/roles";
import { deleteCuratedBenchmark } from "@/lib/costing/master-benchmark";
import { validateRequestId } from "@/lib/api/validate";

export async function DELETE(_request: Request, context: { params: { id: string } }) {
  if (!canCurateMasterBenchmarks(getCurrentRole())) {
    return NextResponse.json({ ok: false, error: "MD, Costing, PBD, or admin access required" }, { status: 403 });
  }

  const idError = validateRequestId(context.params.id);
  if (idError) return idError;

  const result = await deleteCuratedBenchmark(context.params.id);
  if (result.error) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
