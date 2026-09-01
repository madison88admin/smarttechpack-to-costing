import { NextResponse } from "next/server";
import { tryListHistoricalCostings } from "@/lib/costing/history";
import { getCurrentRole, type UserRole } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

// Free-text search over the approved-cost library, used by the baseline
// picker inside the Create Request form (and anything that needs to find a
// historical costing by style / factory / yarn / notes keyword). Factory is
// excluded, matching the Like Styles search.
const ALLOWED_ROLES: UserRole[] = ["admin", "manager", "pbd", "costing", "md"];

// GET /api/historical/search?q=...&factory=...&limit=...
export async function GET(request: Request) {
  const role = getCurrentRole();
  if (!ALLOWED_ROLES.includes(role)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const factory = url.searchParams.get("factory")?.trim() ?? "";
  const brand = url.searchParams.get("brand")?.trim() ?? "";
  const customer = url.searchParams.get("customer")?.trim() ?? "";
  const season = url.searchParams.get("season")?.trim() ?? "";
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 20, 1), 50);

  try {
    const { data, error } = await tryListHistoricalCostings({ query: q, factory, brand, customer, season });
    if (error) {
      return NextResponse.json({ ok: false, error }, { status: 500 });
    }
    return NextResponse.json({ ok: true, data: (data ?? []).slice(0, limit) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to search historical costings";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
