import { NextResponse } from "next/server";
import { findLikeStyles, summarizeLikeStyleMatches } from "@/lib/costing/history";
import { canAccessHistoricalCostData, getCurrentRole } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

// A searchable library of comparative historical styles so Costing/MD/PBD can
// pull comparable examples. Factory is intentionally excluded — like-style
// comparisons are an internal costing decision aid.

// GET /api/historical/like-styles
// Searches the approved-cost library by yarn/knit/machine/construction/
// category and costing notes, scoring every historical row and returning the
// closest matches plus a group benchmark (avg consumption + knitting time
// across the matched styles). Query params: yarnType, knitType, machineType,
// construction, category, notes, minScore, limit.
export async function GET(request: Request) {
  const role = getCurrentRole();
  if (!canAccessHistoricalCostData(role)) {
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
    // "historical avg consumption/knitting time" reference by attribute group,
    // plus the per-machine speed table — see summarizeLikeStyleMatches.
    return NextResponse.json({
      ok: true,
      data: results,
      benchmark: summarizeLikeStyleMatches(results)
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Like-styles search failed" },
      { status: 500 }
    );
  }
}
