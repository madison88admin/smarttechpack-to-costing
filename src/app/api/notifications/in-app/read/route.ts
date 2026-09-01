import { NextResponse } from "next/server";
import { getCurrentRole } from "@/lib/auth/roles";
import { markInAppAlertsRead } from "@/lib/notifications/in-app";

// POST /api/notifications/in-app/read
// Marks in-app alerts read for the current user's role. Body:
//   { "requestIds": ["uuid", ...] }  — mark only these requests (optional;
//                                      omit for "mark all read")
export async function POST(request: Request) {
  const role = getCurrentRole();
  if (!role || role === "viewer") {
    return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
  }

  let requestIds: string[] | undefined;
  try {
    const body = (await request.json()) as { requestIds?: unknown };
    if (body.requestIds !== undefined) {
      if (!Array.isArray(body.requestIds)) {
        return NextResponse.json({ ok: false, error: "requestIds must be an array" }, { status: 400 });
      }
      requestIds = body.requestIds.filter((id): id is string => typeof id === "string");
    }
  } catch {
    // No body — treat as "mark all read".
  }

  try {
    const updated = await markInAppAlertsRead(role, { requestIds });
    return NextResponse.json({ ok: true, updated });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to mark alerts read" },
      { status: 500 }
    );
  }
}
