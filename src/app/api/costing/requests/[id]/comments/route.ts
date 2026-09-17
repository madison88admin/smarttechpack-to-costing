import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getCurrentRole, getCurrentUserId, canRunPbdAction, isAdminTier } from "@/lib/auth/roles";
import { isRequestCommentType, listRequestComments } from "@/lib/costing/request-comments";
import { validateRequestId } from "@/lib/api/validate";
import { recordWorkflowEvent } from "@/lib/workflow/events";

export async function GET(_request: Request, context: { params: { id: string } }) {
  const error = validateRequestId(context.params.id);
  if (error) return error;
  const role = getCurrentRole();
  if (role === "viewer") return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 403 });
  try {
    return NextResponse.json({ ok: true, data: await listRequestComments(context.params.id, role) });
  } catch (cause) {
    return NextResponse.json({ ok: false, error: cause instanceof Error ? cause.message : "Unable to load comments" }, { status: 500 });
  }
}

export async function POST(request: Request, context: { params: { id: string } }) {
  const idError = validateRequestId(context.params.id);
  if (idError) return idError;
  const role = getCurrentRole();
  const body = await request.json().catch(() => null);
  const type = body?.type;
  const note = typeof body?.note === "string" ? body.note.trim() : "";
  if (role === "viewer" || !isRequestCommentType(type)) return NextResponse.json({ ok: false, error: "Unauthorized or invalid comment type" }, { status: 403 });
  if (!note || note.length > 2000) return NextResponse.json({ ok: false, error: "Comment must contain 1–2,000 characters" }, { status: 400 });
  if (type === "buyer_comment" && !canRunPbdAction(role)) return NextResponse.json({ ok: false, error: "Only PBD or Admin can add buyer comments" }, { status: 403 });
  if (type === "factory_comment" && role !== "factory" && !isAdminTier(role)) return NextResponse.json({ ok: false, error: "Only Factory or Admin can add factory comments" }, { status: 403 });

  const supabase = createSupabaseServiceClient();
  if (role === "factory") {
    const { data: row, error } = await supabase.from("costing_requests").select("assigned_factory_user_id").eq("id", context.params.id).single();
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    if (!getCurrentUserId() || row.assigned_factory_user_id !== getCurrentUserId()) return NextResponse.json({ ok: false, error: "Request is not assigned to this factory user" }, { status: 403 });
  }
  const { data, error } = await supabase.from("costing_notes").insert({ costing_request_id: context.params.id, note_type: type, note, created_by_role: role, tags: [] }).select("id,note_type,note,created_by_role,created_at").single();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  await recordWorkflowEvent(supabase, { costingRequestId: context.params.id, eventType: "request_comment_added", actorRole: role, actorUserId: getCurrentUserId(), payload: { type, note } });
  return NextResponse.json({ ok: true, data });
}
