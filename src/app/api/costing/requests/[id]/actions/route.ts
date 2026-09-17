import { NextResponse } from "next/server";
import { canRunPbdAction, canRunCostingAction, getCurrentRole, getCurrentUserId, getCurrentUserName } from "@/lib/auth/roles";
import { approvalGatedActions, costingGatedActions, runCostingAction } from "@/lib/costing/actions";
import { badRequest } from "@/lib/api/response";
import { validateBody, actionSchema, validateRequestId } from "@/lib/api/validate";

// POST /api/costing/requests/[id]/actions
// Handles Costing validation, the combined PBD decision, and factory clarification.
export async function POST(request: Request, context: { params: { id: string } }) {
  const idError = validateRequestId(context.params.id);
  if (idError) return idError;

  const role = getCurrentRole();
  const userName = getCurrentUserName();
  const userId = getCurrentUserId();

  const body = await request.json().catch(() => null);
  const validation = validateBody(actionSchema, body);
  if (!validation.success) return validation.response;
  const { action, comment, changeRequest } = validation.data;

  // Determine which role is required based on the action. The action groups
  // come from the canonical action module, not a local copy.
  const pbdActions = ["clarify"];

  if (costingGatedActions.includes(action)) {
    // Costing actions require Costing Team or Admin
    if (!canRunCostingAction(role)) {
      return NextResponse.json(
        { ok: false, error: "Costing Team or Admin role required for this action" },
        { status: 403 }
      );
    }
  } else if (approvalGatedActions.includes(action)) {
    // Internal approval is one combined PBD-owned decision.
    if (!canRunPbdAction(role)) {
      return NextResponse.json(
        { ok: false, error: "PBD or Admin role required for this action" },
        { status: 403 }
      );
    }
  } else if (pbdActions.includes(action)) {
    // PBD can clarify (send back to factory for correction/revision)
    if (!canRunPbdAction(role)) {
      return NextResponse.json(
        { ok: false, error: "PBD or Admin role required for this action" },
        { status: 403 }
      );
    }
  } else if (action === "send_to_factory") {
    // send_to_factory requires PBD or Admin (they create and send)
    if (!canRunPbdAction(role)) {
      return NextResponse.json(
        { ok: false, error: "PBD or Admin role required for this action" },
        { status: 403 }
      );
    }
  } else {
    return badRequest(`Unknown action: ${action}`);
  }

  try {
    const data = await runCostingAction(context.params.id, action, comment ?? null, role, userName, userId, changeRequest ?? null);
    return NextResponse.json({ ok: true, ...data });
  } catch (error) {
    const message = error instanceof Error ? error.message : (error as { message?: string; code?: string })?.message || (error as { code?: string })?.code || "Action failed";
    let status = 500;
    if (message.includes("Database migration 002")) status = 503;
    if (message.includes("not allowed from status")) status = 409;
    if (message.includes("request status changed")) status = 409; // optimistic-lock race
    if (message.includes("requires Costing Team") || message.includes("requires PBD")) status = 403;
    if (message.includes("required checklist") || message.includes("selling price review") || message.includes("compliance is") || message.includes("MD technical review")) status = 409;
    // High-risk outlier gate: resolvable by Costing acknowledgement, not a server error.
    if (message.includes("outlier")) status = 409;
    // Request id is well-formed but no such request exists (PostgREST PGRST116
    // from .single(); message differs between supabase-js and the live proxy).
    if (message.includes("JSON object requested") || message.includes("single JSON object")) status = 404;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
