import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { recordWorkflowEvent } from "@/lib/workflow/events";
import { canRunPbdAction, getCurrentRole, getCurrentUserId } from "@/lib/auth/roles";
import { validateRequestId } from "@/lib/api/validate";
import {
  assertCustomerReviewEditable,
  assertCustomerStatusKnown,
  assertCustomerStatusTransition,
  computeRevisionNumber,
  customerStatusDerivedUpdates,
  type CustomerStatus
} from "@/lib/costing/customer-status";

export async function POST(request: Request, context: { params: { id: string } }) {
  const idError = validateRequestId(context.params.id);
  if (idError) return idError;

  const role = getCurrentRole();

  if (!canRunPbdAction(role)) {
    return NextResponse.json(
      { ok: false, error: "Current role cannot update customer status" },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => null);
  const status = String(body?.status ?? "");
  const now = new Date().toISOString();
  const notes = typeof body?.notes === "string" ? body.notes.trim() : null;
  const referenceUrl = typeof body?.referenceUrl === "string" ? body.referenceUrl.trim() : "";

  const statusError = assertCustomerStatusKnown(status);
  if (statusError) {
    return NextResponse.json({ ok: false, error: statusError }, { status: 400 });
  }

  if (referenceUrl) {
    try {
      const parsed = new URL(referenceUrl);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error("unsupported protocol");
    } catch {
      return NextResponse.json({ ok: false, error: "Reference must be a valid HTTP or HTTPS URL" }, { status: 400 });
    }
  }

  const supabase = createSupabaseServiceClient();
  const { data: current, error: currentError } = await supabase
    .from("costing_requests")
    .select("status,customer_status,customer_revision_number")
    .eq("id", context.params.id)
    .single();
  if (currentError) return NextResponse.json({ ok: false, error: currentError.message }, { status: 500 });

  // The external review may only be driven after the internal approval. This
  // server-side gate mirrors the UI, which hides the action buttons until the
  // request is approved (a rejected-for-revision request reopens after its new
  // approval, never while it sits in the factory correction queue).
  const approvalGateError = assertCustomerReviewEditable(String(current.status ?? ""));
  if (approvalGateError) {
    return NextResponse.json({ ok: false, error: approvalGateError }, { status: 409 });
  }

  const currentStatus = String(current.customer_status ?? "not_submitted");
  const transitionError = assertCustomerStatusTransition(currentStatus, status);
  if (transitionError) {
    return NextResponse.json({ ok: false, error: transitionError }, { status: 409 });
  }
  const revisionNumber = computeRevisionNumber(current.customer_revision_number, status);
  const updates: Record<string, unknown> = {
    customer_status: status,
    customer_status_updated_at: now,
    customer_notes: notes,
    ...customerStatusDerivedUpdates(status as CustomerStatus, now, revisionNumber)
  };

  const { error } = await supabase
    .from("costing_requests")
    .update(updates)
    .eq("id", context.params.id);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  if (status === "customer_rejected_revised") {
    const { error: revisionError } = await supabase.from("customer_revision_history").insert({
      costing_request_id: context.params.id,
      revision_number: revisionNumber,
      from_status: currentStatus,
      to_status: status,
      notes,
      reference_url: referenceUrl || null,
      created_by: getCurrentUserId()
    });
    if (revisionError) return NextResponse.json({ ok: false, error: revisionError.message }, { status: 500 });
  }

  if (referenceUrl) {
    const { error: attachmentError } = await supabase.from("customer_approval_attachments").insert({
      costing_request_id: context.params.id,
      file_name: "Customer reference link",
      storage_path: referenceUrl,
      mime_type: "text/uri-list",
      uploaded_by: getCurrentUserId()
    });
    if (attachmentError) return NextResponse.json({ ok: false, error: attachmentError.message }, { status: 500 });
  }

  await recordWorkflowEvent(supabase, {
    costingRequestId: context.params.id,
    eventType: "customer_status_changed",
    actorRole: role,
    actorUserId: getCurrentUserId(),
    payload: { fromStatus: currentStatus, status, notes, referenceUrl: referenceUrl || null, revisionNumber: status === "customer_rejected_revised" ? revisionNumber : null }
  });

  return NextResponse.json({ ok: true, status, revisionNumber });
}
