import { NextResponse } from "next/server";
import { canAccessAdmin, getCurrentRole } from "@/lib/auth/roles";
import { listChecklistItems, upsertChecklistItem } from "@/lib/costing/checklist";

export async function GET() {
  try {
    return NextResponse.json({ ok: true, data: await listChecklistItems() });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unable to load checklist" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  if (!canAccessAdmin(getCurrentRole())) {
    return NextResponse.json({ ok: false, error: "Admin role required" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);

  if (!body?.code || !body?.label) {
    return NextResponse.json({ ok: false, error: "code and label are required" }, { status: 400 });
  }

  try {
    return NextResponse.json({
      ok: true,
      data: await upsertChecklistItem({
        code: String(body.code).toLowerCase().replace(/[^a-z0-9_]/g, "_"),
        label: String(body.label),
        isRequired: body.isRequired !== false,
        sortOrder: Number(body.sortOrder ?? 0),
        isActive: body.isActive !== false
      })
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unable to save checklist item" },
      { status: 500 }
    );
  }
}
