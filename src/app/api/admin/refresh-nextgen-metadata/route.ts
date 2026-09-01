import { NextResponse } from "next/server";
import { canAccessAdmin, getCurrentRole } from "@/lib/auth/roles";
import { refreshActiveProductMetadata } from "@/lib/nextgen/metadata-refresh";

function isCronAuthorized(request: Request): boolean {
  const cronSecret = request.headers.get("x-cron-secret");
  const expected = process.env.CRON_SECRET;
  return Boolean(cronSecret && expected && cronSecret === expected);
}

// GET /api/admin/refresh-nextgen-metadata — admin-only availability probe.
export async function GET() {
  const role = getCurrentRole();
  if (!canAccessAdmin(role)) {
    return NextResponse.json({ ok: false, error: "Only admins can preview the NextGen metadata refresh" }, { status: 403 });
  }
  return NextResponse.json({ ok: true, note: "POST runs the refresh (admin or cron)" });
}

// POST /api/admin/refresh-nextgen-metadata — re-fetch the NextGen product row
// for every style linked to an active request, alert the costing team when
// status/composition/labor metadata changed, and stamp metadata_checked_at.
// Admin or cron (x-cron-secret). Suggested cron: hourly.
// Body: { limit?: number }
export async function POST(request: Request) {
  if (!isCronAuthorized(request)) {
    const role = getCurrentRole();
    if (!canAccessAdmin(role)) {
      return NextResponse.json(
        { ok: false, error: "Only admins can trigger the NextGen metadata refresh" },
        { status: 403 }
      );
    }
  }

  const body = await request.json().catch(() => null);
  const limit = typeof body?.limit === "number" && Number.isFinite(body.limit) && body.limit > 0
    ? Math.min(body.limit, 1000)
    : 300;

  const result = await refreshActiveProductMetadata(limit);

  return NextResponse.json({ ok: true, ...result }, { status: 200 });
}
