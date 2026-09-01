import { NextResponse } from "next/server";
import { canAccessAdmin, getCurrentRole } from "@/lib/auth/roles";
import { checkBomVersions, previewBomVersionCheck } from "@/lib/nextgen/bom-versions";

function isCronAuthorized(request: Request): boolean {
  const cronSecret = request.headers.get("x-cron-secret");
  const expected = process.env.CRON_SECRET;
  return Boolean(cronSecret && expected && cronSecret === expected);
}

// GET /api/admin/check-bom-versions — preview how many styles/requests a check would touch.
export async function GET() {
  const role = getCurrentRole();
  if (!canAccessAdmin(role)) {
    return NextResponse.json({ ok: false, error: "Only admins can preview the BOM version check" }, { status: 403 });
  }

  const preview = await previewBomVersionCheck();
  return NextResponse.json({ ok: !preview.error, ...preview }, { status: preview.error ? 500 : 200 });
}

// POST /api/admin/check-bom-versions — compare stored BOM versions against
// live NextGen BOMs and alert the costing team on changes. Admin or cron.
// Body: { limit?: number }
export async function POST(request: Request) {
  if (!isCronAuthorized(request)) {
    const role = getCurrentRole();
    if (!canAccessAdmin(role)) {
      return NextResponse.json(
        { ok: false, error: "Only admins can trigger the BOM version check" },
        { status: 403 }
      );
    }
  }

  const body = await request.json().catch(() => null);
  const limit = typeof body?.limit === "number" && Number.isFinite(body.limit) && body.limit > 0
    ? Math.min(body.limit, 1000)
    : 300;

  const result = await checkBomVersions(limit);

  return NextResponse.json({ ok: true, ...result }, { status: 200 });
}
