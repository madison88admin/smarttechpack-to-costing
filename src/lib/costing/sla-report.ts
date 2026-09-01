import { bucketKey, type ReportGranularity } from "@/lib/reporting";
import { ownerRoleForStatus, type AgingRow } from "@/lib/costing/aging";
import { statusLabels, type CostingStatus } from "@/lib/workflow/status";

// SLA-compliance breakdown for the Reports dashboard. Pure aggregation over
// the aging rows (the same point-in-time data as the dashboard SLA report),
// grouped by workflow stage and by accountable owner, plus a breach trend
// bucketed by the breach (deadline) date.

export type SlaStatusRow = {
  status: string;
  label: string;
  owner: string | null;
  slaHours: number | null;
  active: number;
  breached: number;
  maxHoursOverdue: number | null;
};

export type SlaOwnerRow = {
  owner: string;
  active: number;
  breached: number;
  avgDaysInStatus: number | null;
};

export type SlaTrendPoint = { bucket: string; breached: number };

export type SlaBreakdown = {
  totalActive: number;
  totalBreached: number;
  byStatus: SlaStatusRow[];
  byOwner: SlaOwnerRow[];
  trend: SlaTrendPoint[];
};

/** Filters the aging rows support (the report's brand/customer/season fields
 * are not carried by the aging query). */
export type SlaScopeFilters = {
  factory?: string | null;
  status?: string | null;
  from?: string | null;
  to?: string | null;
};

/** Stages with an SLA, in workflow order. */
const TRACKED_STATUSES: CostingStatus[] = [
  "draft",
  "sent_to_factory",
  "needs_clarification",
  "for_md_review",
  "for_costing_review",
  "for_pbd_review",
  "pending_manager_approval"
];

export function computeSlaBreakdown(
  rows: AgingRow[],
  granularity: ReportGranularity = "monthly",
  filters: SlaScopeFilters = {}
): SlaBreakdown {
  let scoped = rows.filter((row) => TRACKED_STATUSES.includes(row.status as CostingStatus));

  if (filters.factory) scoped = scoped.filter((row) => row.factory_name === filters.factory);
  if (filters.status) scoped = scoped.filter((row) => row.status === filters.status);
  if (filters.from) scoped = scoped.filter((row) => (row.created_at ?? "") >= filters.from!);
  if (filters.to) scoped = scoped.filter((row) => (row.created_at ?? "").slice(0, 10) <= filters.to!);

  const byStatus = new Map<string, SlaStatusRow>();
  const ownerAccum = new Map<string, { active: number; breached: number; days: number[] }>();
  const trendMap = new Map<string, number>();

  for (const row of scoped) {
    const owner = row.owner_role ?? ownerRoleForStatus(row.status) ?? "unassigned";
    const statusRow = byStatus.get(row.status) ?? {
      status: row.status,
      label: (statusLabels as Record<string, string>)[row.status] ?? row.status.replace(/_/g, " "),
      owner,
      slaHours: row.sla_days !== null ? row.sla_days * 24 : null,
      active: 0,
      breached: 0,
      maxHoursOverdue: null
    };
    statusRow.active++;
    if (row.is_overdue) {
      statusRow.breached++;
      const hoursOverdue = row.sla_days !== null ? Math.max(0, (row.days_in_status - row.sla_days) * 24) : 0;
      statusRow.maxHoursOverdue =
        statusRow.maxHoursOverdue === null ? hoursOverdue : Math.max(statusRow.maxHoursOverdue, hoursOverdue);
    }
    byStatus.set(row.status, statusRow);

    const acc = ownerAccum.get(owner) ?? { active: 0, breached: 0, days: [] };
    acc.active++;
    if (row.is_overdue) acc.breached++;
    acc.days.push(row.days_in_status);
    ownerAccum.set(owner, acc);

    // Trend: bucket each currently-overdue request by when its SLA deadline
    // fell, so the chart shows when the backlog breached.
    const bucket = bucketKey(row.breached_at ?? row.deadline_at, granularity);
    if (bucket) trendMap.set(bucket, (trendMap.get(bucket) ?? 0) + 1);
  }

  return {
    totalActive: scoped.length,
    totalBreached: scoped.filter((row) => row.is_overdue).length,
    byStatus: Array.from(byStatus.values()).sort(
      (a, b) => b.active - a.active || b.breached - a.breached || a.status.localeCompare(b.status)
    ),
    byOwner: Array.from(ownerAccum.entries())
      .map(([owner, acc]) => ({
        owner,
        active: acc.active,
        breached: acc.breached,
        avgDaysInStatus: acc.days.length ? acc.days.reduce((sum, d) => sum + d, 0) / acc.days.length : null
      }))
      .sort((a, b) => b.breached - a.breached || b.active - a.active),
    trend: Array.from(trendMap.entries())
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([bucket, breached]) => ({ bucket, breached }))
  };
}
