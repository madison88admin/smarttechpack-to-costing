import { NextResponse } from "next/server";
import { canManageUsers, getCurrentRole } from "@/lib/auth/roles";
import { setUserActive, upsertUserProfile } from "@/lib/auth/users";

const roles = new Set(["superadmin", "admin", "manager", "pbd", "costing", "factory", "md", "viewer"]);

export async function POST(request: Request) {
  if (!canManageUsers(getCurrentRole())) {
    return NextResponse.json({ ok: false, error: "Super Admin role required" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const action = String(body?.action ?? "upsert");

  try {
    if (action === "set_active") {
      if (!body?.id) return NextResponse.json({ ok: false, error: "id is required" }, { status: 400 });
      return NextResponse.json({ ok: true, data: await setUserActive(String(body.id), body.isActive === true) });
    }

    const role = String(body?.role ?? "viewer").toLowerCase();

    if (!roles.has(role)) {
      return NextResponse.json({ ok: false, error: "Invalid role" }, { status: 400 });
    }

    if (!body?.displayName || !body?.email) {
      return NextResponse.json({ ok: false, error: "displayName and email are required" }, { status: 400 });
    }

    const data = await upsertUserProfile({
      id: body.id ? String(body.id) : null,
      displayName: String(body.displayName),
      email: String(body.email),
      role: role as "superadmin" | "admin" | "manager" | "pbd" | "costing" | "factory" | "md" | "viewer",
      isActive: body.isActive !== false,
      password: body.password ? String(body.password) : null
    });

    return NextResponse.json({ ok: true, data });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unable to save user" },
      { status: 500 }
    );
  }
}
