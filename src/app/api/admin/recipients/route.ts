import { NextResponse } from "next/server";
import { canAccessAdmin, getCurrentRole } from "@/lib/auth/roles";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { pgrestValue } from "@/lib/supabase/filters";

// GET /api/admin/recipients — list all notification recipients
export async function GET() {
  if (!canAccessAdmin(getCurrentRole())) {
    return NextResponse.json({ ok: false, error: "Admin role required" }, { status: 403 });
  }

  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("notification_recipients")
    .select("id, event_type, role, email, is_active, created_at")
    .order("event_type", { ascending: true })
    .order("role", { ascending: true });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, data });
}

// POST /api/admin/recipients — add a new recipient
export async function POST(request: Request) {
  if (!canAccessAdmin(getCurrentRole())) {
    return NextResponse.json({ ok: false, error: "Admin role required" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);

  if (!body?.eventType || !body?.role) {
    return NextResponse.json({ ok: false, error: "eventType and role are required" }, { status: 400 });
  }

  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("notification_recipients")
    .insert({
      event_type: String(body.eventType),
      role: String(body.role),
      email: body.email ? String(body.email).trim().toLowerCase() : null,
      is_active: body.isActive !== false
    })
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, data });
}

// PUT /api/admin/recipients — toggle active status or update email
export async function PUT(request: Request) {
  if (!canAccessAdmin(getCurrentRole())) {
    return NextResponse.json({ ok: false, error: "Admin role required" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!body?.id) {
    return NextResponse.json({ ok: false, error: "Recipient id is required" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (typeof body.isActive === "boolean") updates.is_active = body.isActive;
  if (typeof body.email === "string") updates.email = body.email.trim().toLowerCase() || null;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ ok: false, error: "No fields to update" }, { status: 400 });
  }

  const supabase = createSupabaseServiceClient();
  const { error } = await supabase
    .from("notification_recipients")
    .update(updates)
    .eq("id", pgrestValue(String(body.id)));

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

// DELETE /api/admin/recipients — delete a recipient
export async function DELETE(request: Request) {
  if (!canAccessAdmin(getCurrentRole())) {
    return NextResponse.json({ ok: false, error: "Admin role required" }, { status: 403 });
  }

  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ ok: false, error: "Recipient id is required" }, { status: 400 });
  }

  const supabase = createSupabaseServiceClient();
  const { error } = await supabase
    .from("notification_recipients")
    .delete()
    .eq("id", pgrestValue(id));

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
