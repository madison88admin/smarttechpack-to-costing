import { NextResponse } from "next/server";
import {
  canRunCostingAction,
  canRunMdAction,
  canRunPbdAction,
  getCurrentRole,
  getCurrentUserName
} from "@/lib/auth/roles";
import { createSavedComparisonSet, listSavedComparisonSetsForRequest } from "@/lib/comparison-sets";
import { validateRequestId } from "@/lib/api/validate";

function canReviewComparisonSets(role: string) {
  return (
    role === "admin" ||
    canRunCostingAction(role as never) ||
    canRunPbdAction(role as never) ||
    canRunMdAction(role as never)
  );
}

const NAME_MAX = 120;

// POST /api/comparison-sets — save a named Like Styles comparison set.
// The results are snapshotted (with the filters that produced them) so the
// shared link is a stable review target for Costing and PBD.
export async function POST(request: Request) {
  const role = getCurrentRole();
  if (!canReviewComparisonSets(role)) {
    return NextResponse.json({ ok: false, error: "Costing, PBD, MD, or Admin access required" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ ok: false, error: "A name is required" }, { status: 400 });
  if (name.length > NAME_MAX) {
    return NextResponse.json({ ok: false, error: `Name must be ${NAME_MAX} characters or fewer` }, { status: 400 });
  }

  const requestId = typeof body?.requestId === "string" ? body.requestId.trim() : "";
  if (requestId && validateRequestId(requestId)) {
    return NextResponse.json({ ok: false, error: "Invalid request id" }, { status: 400 });
  }

  const filters = body?.filters && typeof body?.filters === "object" && !Array.isArray(body.filters) ? body.filters : {};
  const results = Array.isArray(body?.results) ? body.results.slice(0, 500) : [];
  const benchmark = body?.benchmark && typeof body?.benchmark === "object" && !Array.isArray(body.benchmark) ? body.benchmark : null;

  try {
    const set = await createSavedComparisonSet({
      name,
      requestId: requestId || null,
      filters,
      results,
      benchmark,
      createdBy: getCurrentUserName() === "Guest" ? null : getCurrentUserName(),
      createdByRole: role
    });
    return NextResponse.json({ ok: true, set }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save comparison set";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

// GET /api/comparison-sets?requestId=... — list saved sets for a request.
export async function GET(request: Request) {
  const role = getCurrentRole();
  if (!canReviewComparisonSets(role)) {
    return NextResponse.json({ ok: false, error: "Costing, PBD, MD, or Admin access required" }, { status: 403 });
  }

  const requestId = new URL(request.url).searchParams.get("requestId")?.trim() ?? "";
  if (requestId && validateRequestId(requestId)) {
    return NextResponse.json({ ok: false, error: "Invalid request id" }, { status: 400 });
  }

  try {
    const sets = requestId ? await listSavedComparisonSetsForRequest(requestId) : [];
    return NextResponse.json({ ok: true, sets });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load comparison sets";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
