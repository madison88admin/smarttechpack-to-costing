import { NextResponse } from "next/server";
import { getCurrentRole, getCurrentUserId } from "@/lib/auth/roles";
import { resolveFactoryProfileId } from "@/lib/admin/assignments";
import { tryListCostingRequests } from "@/lib/costing/requests";
import { tryGetAgingData } from "@/lib/costing/aging";
import { getReadNotificationKeys } from "@/lib/notifications/read-state";
import { overdueNotificationKey, reviewNotificationKey } from "@/lib/notifications/keys";

// GET /api/notifications/pending
// Returns pending notifications for the current user based on their role.
// Notifications are derived from live request state and carry a stable `key`
// (per role + request + situation). Keys the user has already viewed or
// dismissed are recorded in notification_reads and filtered out here, so the
// bell only nags about genuinely new items.

type PendingNotification = {
  id: string;
  key: string;
  type: "urgent" | "review" | "info";
  title: string;
  description: string;
  href: string;
  createdAt: string;
  requestId: string;
  requestNumber: string | null;
  status: string | null;
};

export async function GET() {
  const role = getCurrentRole();

  if (!role || role === "viewer") {
    return NextResponse.json({ ok: true, notifications: [], totalUnread: 0 });
  }

  // Load read markers once — a read-state failure must never block the feed.
  let readKeys: Set<string> = new Set();
  try {
    readKeys = await getReadNotificationKeys(role);
  } catch {
    readKeys = new Set();
  }

  const notifications: PendingNotification[] = [];

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
        const key = overdueNotificationKey(row);
        notifications.push({
          id: key,
          key,
          type: "urgent",
          title: "SLA Breached",
          description: `${row.request_number ?? row.id.slice(0, 8)} — ${row.status.replace(/_/g, " ")}`,
          href: isFactoryActionable ? `/factory/${row.id}` : `/requests/${row.id}`,
          createdAt: row.created_at,
          requestId: row.id,
          requestNumber: row.request_number ?? null,
          status: row.status
        });
      }
    }

    // Items waiting for action based on role
    const reviewStatuses: Record<string, string[]> = {
      pbd: ["for_pbd_review"],
      costing: ["for_costing_review"],
      factory: ["sent_to_factory", "needs_clarification"],
      admin: ["for_pbd_review", "for_costing_review"],
      superadmin: ["for_pbd_review", "for_costing_review"]
    };

    const watchStatuses = reviewStatuses[role] ?? [];
    for (const row of rows) {
      if (watchStatuses.includes(row.status) && !overdueIds.has(row.id)) {
        const statusLabel = row.status.replace(/_/g, " ");
        const isFactoryActionable = role === "factory" && ["sent_to_factory", "needs_clarification"].includes(row.status);
        const key = reviewNotificationKey(row);
        notifications.push({
          id: key,
          key,
          type: "review",
          title: statusLabel.charAt(0).toUpperCase() + statusLabel.slice(1),
          description: `${row.request_number ?? row.id.slice(0, 8)} — ${row.factory_name ?? "Unassigned"}`,
          href: isFactoryActionable ? `/factory/${row.id}` : `/requests/${row.id}`,
          createdAt: row.created_at,
          requestId: row.id,
          requestNumber: row.request_number ?? null,
          status: row.status
        });
      }
    }

    // Sort: urgent first, then by created_at descending
    notifications.sort((a, b) => {
      if (a.type === "urgent" && b.type !== "urgent") return -1;
      if (a.type !== "urgent" && b.type === "urgent") return 1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    const unread = notifications.filter((n) => !readKeys.has(n.key));

    return NextResponse.json({
      ok: true,
      notifications: unread.slice(0, 20),
      totalUnread: unread.length
    });
  } catch {
    return NextResponse.json({ ok: true, notifications: [], totalUnread: 0 });
  }
}
