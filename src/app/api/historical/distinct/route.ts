import { NextResponse } from "next/server";
import { createStaleWhileRevalidateCache } from "@/lib/cache/stale-while-revalidate";
import { canAccessHistoricalCostData, getCurrentRole } from "@/lib/auth/roles";
import { listHistoricalFacetValues, type HistoricalFacetOptions } from "@/lib/costing/history";

export const dynamic = "force-dynamic";

/**
 * Facet values for the historical search dropdowns.
 *
 * Reads historical_costings through its owner (lib/costing/history), behind the
 * same shared cache as every other expensive derived read, so a list screen
 * never pays the full-pool scan twice.
 */
const facets = createStaleWhileRevalidateCache<HistoricalFacetOptions>({
  ttlMs: 5 * 60 * 1000,
  build: listHistoricalFacetValues
});

export async function GET() {
  const role = getCurrentRole();
  // Only the Like Styles search calls this, so it is a historical surface: the
  // rule that owns those (internal minus Viewer), not a hand-rolled copy of it.
  if (!canAccessHistoricalCostData(role)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    return NextResponse.json({ ok: true, data: await facets.get() });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unable to load filter values" },
      { status: 500 }
    );
  }
}
