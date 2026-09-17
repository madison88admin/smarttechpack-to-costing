import { AppShell } from "@/components/app-shell";
import { LikeStylesSearch } from "@/components/like-styles-search";
import { canAccessHistoricalCostData, getCurrentRole } from "@/lib/auth/roles";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// A searchable library of comparative historical styles for MD, Costing, and
// PBD. Factory is intentionally excluded from this tool.
export default function LikeStylesPage() {
  const role = getCurrentRole();
  if (!canAccessHistoricalCostData(role)) {
    redirect("/");
  }

  return (
    <AppShell>
      <div className="topbar">
        <div>
          <p className="eyebrow">Historical Costing</p>
          <h1>Like Styles Search</h1>
        </div>
      </div>

      <LikeStylesSearch />
    </AppShell>
  );
}
