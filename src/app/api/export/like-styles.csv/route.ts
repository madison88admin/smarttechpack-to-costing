import { getCurrentRole, type UserRole } from "@/lib/auth/roles";
import { csvResponse } from "@/lib/export/csv";
import { likeStylesCsv, parseLikeStylesExportParams } from "@/lib/export/like-styles";
import { findLikeStyles } from "@/lib/costing/history";

export const dynamic = "force-dynamic";

// Like-style comparison sets are for MD, Costing, and PBD (internal costing
// decision aid) — the same roles as the search page/API.
const ALLOWED_ROLES: UserRole[] = ["superadmin", "admin", "manager", "pbd", "costing", "md"];

// GET /api/export/like-styles.csv
// Exports the current Like Styles comparison set (full result list, scored)
// honoring the same filters as the search: yarnType, knitType, machineType,
// construction, category, notes, minScore.
export async function GET(request: Request) {
  const role = getCurrentRole();
  if (!ALLOWED_ROLES.includes(role)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const url = new URL(request.url);
  const params = parseLikeStylesExportParams(url);
  const results = await findLikeStyles({
    yarnType: params.yarnType || null,
    knitType: params.knitType || null,
    machineType: params.machineType || null,
    construction: params.construction || null,
    productCategory: params.category || null,
    factoryName: params.factory || null,
    brand: params.brand || null,
    customer: params.customer || null,
    season: params.season || null,
    notesQuery: params.notes || null,
    minScore: params.minScore,
    limit: params.limit
  });

  const stamp = new Date().toISOString().slice(0, 10);
  return csvResponse(`tp-costing-like-styles-${stamp}.csv`, likeStylesCsv(results));
}
