import { NextResponse } from "next/server";
import { getCurrentRole, getCurrentUserId, getCurrentUserName, canRunPbdAction, canRunCostingAction } from "@/lib/auth/roles";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { recordWorkflowEvent } from "@/lib/workflow/events";
import { runCostingAction } from "@/lib/costing/actions";

// POST /api/costing/requests/bulk-actions
// Perform the same action on multiple requests at once
export async function POST(request: Request) {
  const role = getCurrentRole();
  const userId = getCurrentUserId();
  const userName = getCurrentUserName();
  const body = await request.json().catch(() => ({}));
  const { action, requestIds, comment } = body as {
    action: string;
    requestIds: string[];
    comment?: string;
  };

  if (!Array.isArray(requestIds) || requestIds.length === 0) {
    return NextResponse.json({ ok: false, error: "requestIds must be a non-empty array" }, { status: 400 });
  }

  if (requestIds.length > 50) {
    return NextResponse.json({ ok: false, error: "Maximum 50 requests per bulk action" }, { status: 400 });
  }

  const supabase = createSupabaseServiceClient();

  // Fetch all target requests with their current status
  const { data: requests, error: fetchError } = await supabase
    .from("costing_requests")
    .select("id, status, request_number")
    .in("id", requestIds);

  if (fetchError) {
    return NextResponse.json({ ok: false, error: fetchError.message }, { status: 500 });
  }

  if (!requests || requests.length === 0) {
    return NextResponse.json({ ok: false, error: "No matching requests found" }, { status: 404 });
  }

  const results: Array<{ id: string; requestNumber: string | null; ok: boolean; error?: string; note?: string }> = [];
  let successCount = 0;
  let failCount = 0;

  for (const req of requests) {
    try {
      if (action === "approve") {
        const outcome = await runCostingAction(req.id, "approve", comment ?? null, role, userName, userId);
        results.push({ id: req.id, requestNumber: req.request_number, ok: true, note: outcome.status === "approved" ? "Internally approved" : "Action completed" });
        successCount++;
      } else if (action === "cost_sheet_ready") {
        if (!canRunCostingAction(role)) {
          results.push({ id: req.id, requestNumber: req.request_number, ok: false, error: "403: Only Costing/admin can mark cost sheet ready" });
          failCount++;
          continue;
        }
        if (req.status !== "approved") {
          results.push({ id: req.id, requestNumber: req.request_number, ok: false, error: `Status is ${req.status}, must be approved` });
          failCount++;
          continue;
        }

        const { error: updateError } = await supabase
          .from("costing_requests")
          .update({
            cost_sheet_ready: true,
            cost_sheet_ready_at: new Date().toISOString(),
            cost_sheet_ready_by: role
          })
          .eq("id", req.id);

        if (updateError) throw updateError;

        await recordWorkflowEvent(supabase, {
          costingRequestId: req.id,
          eventType: "cost_sheet_ready",
          actorRole: role ?? "costing",
          payload: { ready: true, bulkAction: true }
        });

        results.push({ id: req.id, requestNumber: req.request_number, ok: true });
        successCount++;
      } else if (action === "send_to_factory") {
        if (!canRunPbdAction(role)) {
          results.push({ id: req.id, requestNumber: req.request_number, ok: false, error: "403: Only PBD/admin can send to factory" });
          failCount++;
          continue;
        }
        if (req.status !== "draft") {
          results.push({ id: req.id, requestNumber: req.request_number, ok: false, error: `Status is ${req.status}, must be draft` });
          failCount++;
          continue;
        }

        const { error: updateError } = await supabase
          .from("costing_requests")
          .update({ status: "sent_to_factory", updated_at: new Date().toISOString() })
          .eq("id", req.id);

        if (updateError) throw updateError;

        await supabase.from("approval_actions").insert({
          costing_request_id: req.id,
          actor_role: role ?? "pbd",
          actor_name: userName ?? null,
          action: "send_to_factory",
          from_status: "draft",
          to_status: "sent_to_factory",
          comment: comment ?? "Bulk sent to factory"
        });

        await recordWorkflowEvent(supabase, {
          costingRequestId: req.id,
          eventType: "send_to_factory",
          actorRole: role ?? "pbd",
          payload: { fromStatus: "draft", toStatus: "sent_to_factory", bulkAction: true }
        });

        results.push({ id: req.id, requestNumber: req.request_number, ok: true });
        successCount++;
      } else {
        results.push({ id: req.id, requestNumber: req.request_number, ok: false, error: `Unknown action: ${action}` });
        failCount++;
      }
    } catch (err) {
      results.push({
        id: req.id,
        requestNumber: req.request_number,
        ok: false,
        error: err instanceof Error ? err.message : "Unknown error"
      });
      failCount++;
    }
  }

  return NextResponse.json({
    ok: true,
    action,
    total: requestIds.length,
    succeeded: successCount,
    failed: failCount,
    results
  });
}
