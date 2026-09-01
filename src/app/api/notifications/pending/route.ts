import { NextResponse } from "next/server";
import { getCurrentRole, getCurrentUserId } from "@/lib/auth/roles";
import { resolveFactoryProfileId } from "@/lib/admin/assignments";
import { tryListCostingRequests } from "@/lib/costing/requests";
import { tryGetAgingData } from "@/lib/costing/aging";

// GET /api/notifications/pending
// Returns pending notifications for the current user based on their role.
export async function GET() {
  const role = getCurrentRole();

  if (!role || role === "viewer") {
    return NextResponse.json({ ok: true, notifications: [] });
  }

  const notifications: Array<{
    id: string;
    type: "urgent" | "review" | "info";
    title: string;
    description: string;
    href: string;
    createdAt: string;
  }> = [];

  try {
    // Get all active requests for this role
    const { data } = await tryListCostingRequests({
      status: "all",
      limit: 200,
      offset: 0,
      roles: [role]
    });

    const factoryProfileId = role === "factory" ? await resolveFactoryProfileId(getCurrentUserId()).catch(() => null) : null;
    const rows = role === "factory"
      ? (data ?? []).filter((row) => Boolean(factoryProfileId && row.assigned_factory_user_id === factoryProfileId))
      : (data ?? []);

    // Get aging data for overdue detection
    const aging = await tryGetAgingData();
    const overdueIds = new Set(aging.rows.filter((r) => r.is_overdue).map((r) => r.id));

    // Overdue items — urgent (factory gets /factory link when actionable)
    for (const row of rows) {
      if (overdueIds.has(row.id)) {
        const isFactoryActionable = role === "factory" && ["sent_to_factory", "needs_clarification"].includes(row.status);
        notifications.push({
          id: `overdue-${row.id}`,
          type: "urgent",
          title: "SLA Breached",
          description: `${row.request_number ?? row.id.slice(0, 8)} — ${row.status.replace(/_/g, " ")}`,
          href: isFactoryActionable ? `/factory/${row.id}` : `/requests/${row.id}`,
          createdAt: row.created_at
        });
      }
    }

    // Items waiting for action based on role
    const reviewStatuses: Record<string, string[]> = {
      pbd: ["for_pbd_review", "pending_manager_approval"],
      costing: ["for_costing_review"],
      factory: ["sent_to_factory", "needs_clarification"],
      admin: ["for_pbd_review", "for_costing_review", "pending_manager_approval"],
      superadmin: ["for_pbd_review", "for_costing_review", "pending_manager_approval"]
    };

    const watchStatuses = reviewStatuses[role] ?? [];
    for (const row of rows) {
      if (watchStatuses.includes(row.status) && !overdueIds.has(row.id)) {
        const statusLabel = row.status.replace(/_/g, " ");
        const isFactoryActionable = role === "factory" && ["sent_to_factory", "needs_clarification"].includes(row.status);
        notifications.push({
          id: `review-${row.id}`,
          type: "review",
          title: statusLabel.charAt(0).toUpperCase() + statusLabel.slice(1),
          description: `${row.request_number ?? row.id.slice(0, 8)} — ${row.factory_name ?? "Unassigned"}`,
          href: isFactoryActionable ? `/factory/${row.id}` : `/requests/${row.id}`,
          createdAt: row.created_at
        });
      }
    }

    // Sort: urgent first, then by created_at descending
    notifications.sort((a, b) => {
      if (a.type === "urgent" && b.type !== "urgent") return -1;
      if (a.type !== "urgent" && b.type === "urgent") return 1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    return NextResponse.json({ ok: true, notifications: notifications.slice(0, 20) });
  } catch {
    return NextResponse.json({ ok: true, notifications: [] });
  }
}
