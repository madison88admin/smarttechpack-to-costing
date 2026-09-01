import { AppShell } from "@/components/app-shell";
import { LikeStylesSearch } from "@/components/like-styles-search";
import { getCurrentRole, type UserRole } from "@/lib/auth/roles";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// Tyler's ask: a searchable library of comparative historical styles for
// MD, Costing, and PBD. Factory is intentionally excluded from this tool.
const ALLOWED_ROLES: UserRole[] = ["admin", "manager", "pbd", "costing", "md"];

export default function LikeStylesPage() {
  const role = getCurrentRole();
  if (!ALLOWED_ROLES.includes(role)) {
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
