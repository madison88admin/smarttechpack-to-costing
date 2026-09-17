import { NextResponse } from "next/server";
import {
  canRunCostingAction,
  canRunMdAction,
  canRunPbdAction,
  getCurrentRole,
  getCurrentUserId,
  getCurrentUserName,
  type UserRole
} from "@/lib/auth/roles";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { validateBody, dismissChangeRequestSchema, fieldChangeRequestSchema, validateRequestId } from "@/lib/api/validate";
import { createChangeRequest, dismissChangeRequest, tryListChangeRequests } from "@/lib/costing/change-requests";
import { applyMdReviewDecision } from "@/lib/costing/md-review";
import { runCostingAction } from "@/lib/costing/actions";
import { factoryOwnsRequest } from "@/lib/admin/assignments";

// Structured per-field change requests: a reviewer pins the request to one
// exact CBD field (section + key + current → requested value + reason) instead
// of free text. Posting one also moves the request back to the factory queue
// through the lane's normal transition, so status, routing, audit trail, and
// notifications behave exactly like a manual clarification:
//
//   MD      (from for_md_review)     → md_review needs_clarification
//   Costing (from for_costing_review) → costing_clarify
//   PBD     (from for_pbd_review)     → clarify
//
// The factory resubmit auto-resolves rows whose requested value is now
// present; anything still open is remaining work for the reviewer.

type ReviewLane = "md" | "costing" | "pbd";

const LANE_FROM_STATUS: Record<ReviewLane, string> = {
  md: "for_md_review",
  costing: "for_costing_review",
  pbd: "for_pbd_review"
};

function laneForRole(role: UserRole): ReviewLane | null {
  // Admin tier can act in any lane; everyone else stays in their own.
  if (role === "admin" || role === "superadmin") return null;
  if (role === "md" && canRunMdAction(role)) return "md";
  if (role === "costing" && canRunCostingAction(role)) return "costing";
  if (role === "pbd" && canRunPbdAction(role)) return "pbd";
  return null;
}

export async function PUT(request: Request, context: { params: { id: string } }) {
  const idError = validateRequestId(context.params.id);
  if (idError) return idError;

  const role = getCurrentRole();
  if (
    role !== "admin" &&
    role !== "superadmin" &&
    !canRunMdAction(role) &&
    !canRunCostingAction(role) &&
    !canRunPbdAction(role)
  ) {
    return NextResponse.json(
      { ok: false, error: "MD, Costing, PBD, or admin access required" },
      { status: 403 }
    );
  }

  const validation = validateBody(dismissChangeRequestSchema, await request.json().catch(() => null));
  if (!validation.success) return validation.response;

  try {
    const dismissed = await dismissChangeRequest({
      costingRequestId: context.params.id,
      changeRequestId: validation.data.id
    });
    if (!dismissed) {
      return NextResponse.json(
        { ok: false, error: "Change request not found, already resolved, or belongs to another request" },
        { status: 404 }
      );
    }
    return NextResponse.json({ ok: true, data: { id: validation.data.id, status: "dismissed" } });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unable to dismiss change request" },
      { status: 500 }
    );
  }
}

export async function GET(request: Request, context: { params: { id: string } }) {
  const idError = validateRequestId(context.params.id);
  if (idError) return idError;

  const role = getCurrentRole();
  if (role === "viewer") {
    return NextResponse.json({ ok: false, error: "Authentication required" }, { status: 401 });
  }
  if (role === "factory" && !(await factoryOwnsRequest(getCurrentUserId(), context.params.id))) {
    return NextResponse.json({ ok: false, error: "Request is not assigned to this Factory user" }, { status: 403 });
  }

  const { data, error } = await tryListChangeRequests(context.params.id);
  if (error) return NextResponse.json({ ok: false, error }, { status: 500 });
  return NextResponse.json({ ok: true, data });
}

export async function POST(request: Request, context: { params: { id: string } }) {
  const idError = validateRequestId(context.params.id);
  if (idError) return idError;

  const role = getCurrentRole();
  const explicitLane = laneForRole(role);
  if (!explicitLane && role !== "admin" && role !== "superadmin") {
    return NextResponse.json(
      { ok: false, error: "MD, Costing, PBD, or admin access required" },
      { status: 403 }
    );
  }

  const validation = validateBody(fieldChangeRequestSchema, await request.json().catch(() => null));
  if (!validation.success) return validation.response;
  const change = validation.data;

  const supabase = createSupabaseServiceClient();
  const { data: current, error: currentError } = await supabase
    .from("costing_requests")
    .select("status")
    .eq("id", context.params.id)
    .single();
  if (currentError) {
    const status =
      currentError.message.includes("JSON object requested") ||
      currentError.message.includes("single JSON object")
        ? 404
        : 500;
    return NextResponse.json({ ok: false, error: currentError.message }, { status });
  }

  // Admin tier pins the request to whichever review lane currently holds it.
  const lane: ReviewLane | null =
    explicitLane ??
    (Object.entries(LANE_FROM_STATUS).find(([, from]) => from === current.status)?.[0] as ReviewLane | undefined) ??
    null;
  if (!lane) {
    return NextResponse.json(
      { ok: false, error: `No review lane holds this request (current status: ${current.status})` },
      { status: 409 }
    );
  }
  if (current.status !== LANE_FROM_STATUS[lane]) {
    return NextResponse.json(
      { ok: false, error: `Change requests for the ${lane} lane require status "${LANE_FROM_STATUS[lane]}" (current: "${current.status}")` },
      { status: 409 }
    );
  }

  const userName = getCurrentUserName();
  const userId = getCurrentUserId();
  const auditNote =
    `${change.reason.trim()} [Requested change: ${change.field} ${change.currentValue} → ${change.requestedValue}]`;

  let created: { id: string };
  try {
    created = await createChangeRequest({
      costingRequestId: context.params.id,
      section: change.section,
      fieldKey: change.fieldKey,
      fieldLabel: change.field,
      currentValue: change.currentValue,
      requestedValue: change.requestedValue,
      reason: change.reason,
      priority: change.priority,
      dueDate: change.dueDate,
      requestedByRole: role,
      requestedByName: userName
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unable to record change request" },
      { status: 500 }
    );
  }

  // Roll the structured row back if the status transition fails, so a request
  // can never carry an "open" change while sitting in a review status.
  try {
    let toStatus: string;
    if (lane === "md") {
      ({ targetStatus: toStatus } = await applyMdReviewDecision({
        requestId: context.params.id,
        decision: "needs_clarification",
        notes: auditNote,
        role,
        userId,
        userName,
        changeRequest: { ...change, changeRequestId: created.id }
      }));
    } else {
      const action = lane === "costing" ? "costing_clarify" : "clarify";
      ({ status: toStatus } = await runCostingAction(
        context.params.id,
        action,
        auditNote,
        role,
        userName,
        userId,
        { ...change, changeRequestId: created.id }
      ));
    }
    return NextResponse.json({ ok: true, data: { id: created.id }, status: toStatus }, { status: 201 });
  } catch (error) {
    await supabase.from("cbd_change_requests").delete().eq("id", created.id);
    const message = error instanceof Error ? error.message : "Unable to send change request";
    const status =
      message.includes("not allowed from status") ||
      message.includes("only available after factory CBD submission") ||
      message.includes("changed while MD review") ||
      message.includes("request status changed")
        ? 409
        : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
