import { NextResponse } from "next/server";
import { canAccessAdmin, getCurrentRole } from "@/lib/auth/roles";
import { getWorkflowSettings, saveWorkflowSettings } from "@/lib/admin/settings";

export async function GET() {
  if (!canAccessAdmin(getCurrentRole())) {
    return NextResponse.json({ ok: false, error: "Admin role required" }, { status: 403 });
  }

  try {
    return NextResponse.json({ ok: true, data: await getWorkflowSettings() });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unable to load settings" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  if (!canAccessAdmin(getCurrentRole())) {
    return NextResponse.json({ ok: false, error: "Admin role required" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);

  try {
    return NextResponse.json({ ok: true, data: await saveWorkflowSettings(body ?? {}) });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unable to save settings" },
      { status: 500 }
    );
  }
}
