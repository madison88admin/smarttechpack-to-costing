import { NextResponse } from "next/server";
import { canAccessAdmin, getCurrentRole, getCurrentUserId } from "@/lib/auth/roles";
import { assignFactoryUser } from "@/lib/admin/assignments";

export async function POST(request: Request) {
  const role = getCurrentRole();
  if (!canAccessAdmin(role)) {
    return NextResponse.json({ ok: false, error: "Admin role required" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const requestId = typeof body?.requestId === "string" ? body.requestId.trim() : "";
  const factoryUserId = body?.factoryUserId === null || body?.factoryUserId === "" ? null : String(body?.factoryUserId ?? "").trim();
  if (!requestId) return NextResponse.json({ ok: false, error: "requestId is required" }, { status: 400 });

  try {
    const data = await assignFactoryUser(requestId, factoryUserId || null, getCurrentUserId(), role);
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Unable to assign factory user" }, { status: 500 });
  }
}
