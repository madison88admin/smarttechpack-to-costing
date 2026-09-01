import { NextResponse } from "next/server";
import {
  canRunCostingAction,
  canRunManagerAction,
  canRunMdAction,
  canRunPbdAction,
  getCurrentRole
} from "@/lib/auth/roles";
import { getSavedComparisonSetByToken } from "@/lib/comparison-sets";

function canReviewComparisonSets(role: string) {
  return (
    role === "admin" ||
    canRunCostingAction(role as never) ||
    canRunPbdAction(role as never) ||
    canRunMdAction(role as never) ||
    canRunManagerAction(role as never)
  );
}

// GET /api/comparison-sets/[token] — fetch one saved set by its share token.
export async function GET(_request: Request, context: { params: { token: string } }) {
  const role = getCurrentRole();
  if (!canReviewComparisonSets(role)) {
    return NextResponse.json({ ok: false, error: "Costing, PBD, MD, Manager, or Admin access required" }, { status: 403 });
  }

  const token = (context.params.token ?? "").trim();
  if (!token || !/^[a-f0-9]{32}$/.test(token)) {
    return NextResponse.json({ ok: false, error: "Invalid share token" }, { status: 400 });
  }

  try {
    const set = await getSavedComparisonSetByToken(token);
    if (!set) return NextResponse.json({ ok: false, error: "Comparison set not found" }, { status: 404 });
    return NextResponse.json({ ok: true, set });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load comparison set";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
