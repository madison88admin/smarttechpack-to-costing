import { NextResponse } from "next/server";
import { findLikeStyles } from "@/lib/costing/history";
import { getCurrentRole, type UserRole } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

// Tyler's ask: a searchable library of comparative historical styles so
// Costing/MD/PBD can pull comparable examples. Factory is intentionally
// excluded — like-style comparisons are an internal costing decision aid.
const ALLOWED_ROLES: UserRole[] = ["admin", "manager", "pbd", "costing", "md"];

// GET /api/historical/like-styles
// Searches the approved-cost library by yarn/knit/machine/construction/
// category and costing notes, scoring every historical row and returning the
// closest matches plus a group benchmark (avg consumption + knitting time
// across the matched styles). Query params: yarnType, knitType, machineType,
// construction, category, notes, minScore, limit.
export async function GET(request: Request) {
  const role = getCurrentRole();
  if (!ALLOWED_ROLES.includes(role)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const p = (name: string) => url.searchParams.get(name) ?? "";

  try {
    const results = await findLikeStyles({
      yarnType: p("yarnType") || null,
      knitType: p("knitType") || null,
      machineType: p("machineType") || null,
      construction: p("construction") || null,
      productCategory: p("category") || null,
      factoryName: p("factory") || null,
      brand: p("brand") || null,
      customer: p("customer") || null,
      season: p("season") || null,
      notesQuery: p("notes") || null,
      minScore: Number(url.searchParams.get("minScore")) || 0,
      limit: Math.min(Number(url.searchParams.get("limit")) || 10, 50)
    });

    // Group benchmark across the matched styles so the search doubles as the
    // "historical avg consumption/knitting time" reference by attribute group.
    const consumptions = results
      .map((row) => row.average_consumption)
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    const knittingTimes = results
      .map((row) => row.knitting_time)
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

    return NextResponse.json({
      ok: true,
      data: results,
      benchmark: {
        averageConsumption: consumptions.length
          ? consumptions.reduce((sum, value) => sum + value, 0) / consumptions.length
          : null,
        averageKnittingTime: knittingTimes.length
          ? knittingTimes.reduce((sum, value) => sum + value, 0) / knittingTimes.length
          : null,
        sampleSize: results.length
      }
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Like-styles search failed" },
      { status: 500 }
    );
  }
}
