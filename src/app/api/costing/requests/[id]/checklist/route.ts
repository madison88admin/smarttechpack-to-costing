import { NextResponse } from "next/server";
import { saveChecklistResults } from "@/lib/costing/checklist";
import { validateRequestId } from "@/lib/api/validate";
import { getCurrentRole } from "@/lib/auth/roles";

export async function POST(request: Request, context: { params: { id: string } }) {
  const idError = validateRequestId(context.params.id);
  if (idError) return idError;

  const role = getCurrentRole();
  if (role === "viewer") {
    return NextResponse.json({ ok: false, error: "Authentication required" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);

  if (!Array.isArray(body?.items)) {
    return NextResponse.json({ ok: false, error: "items are required" }, { status: 400 });
  }

  try {
    const data = await saveChecklistResults(context.params.id, body.items, role);
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unable to save checklist" },
      { status: 500 }
    );
  }
}
