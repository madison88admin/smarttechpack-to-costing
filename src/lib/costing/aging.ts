import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getWorkflowSettings, type WorkflowSettings } from "@/lib/admin/settings";
import { calendarDaysSince, getSlaDays } from "@/lib/workflow/sla";
import { activeStatuses, type CostingStatus } from "@/lib/workflow/status";

export type AgingBucket = "fresh" | "aging" | "overdue";

export type AgingRow = {
  id: string;
  request_number: string | null;
  status: string;
  factory_name: string | null;
  created_at: string;
  days_in_status: number;
  days_since_created: number;
  bucket: AgingBucket;
  is_overdue: boolean;
  sla_days: number | null;
  style_number: string | null;
  /** Who is accountable for the current status (role). */
  owner_role: string | null;
  /** When the request entered its current status (updated_at). */
  started_at: string;
  /** SLA deadline (started_at + sla_days). */
  deadline_at: string | null;
  /** When the SLA was breached (deadline_at, only when overdue). */
  breached_at: string | null;
};

export type AgingSummary = {
  total: number;
  fresh: number;
  aging: number;
  overdue: number;
  byStatus: Record<string, { count: number; overdue: number }>;
  averageDaysInStatus: number | null;
};

// Draft has no SLA (PBD hasn't sent it yet) but still counts as an active
// request in the aging summary; the rest are all tracked statuses. The active
// set is owned by src/lib/workflow/status.ts.


export async function getAgingData(): Promise<{ rows: AgingRow[]; settings: WorkflowSettings }> {
  const supabase = createSupabaseServiceClient();
  const settings = await getWorkflowSettings();

  const { data: requests, error } = await supabase
    .from("costing_requests")
    .select(
      `
      id,
      request_number,
      status,
      factory_name,
      created_at,
      updated_at,
      nextgen_products (style_number)
    `
    )
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) throw error;

  const rows: AgingRow[] = (requests ?? []).map((row: any) => {
    const daysInStatus = calendarDaysSince(row.updated_at);
    const daysSinceCreated = calendarDaysSince(row.created_at);
    const slaDays = getSlaDays(row.status, settings);
    const isOverdue = slaDays !== null && daysInStatus > slaDays;
    const bucket: AgingBucket = isOverdue ? "overdue" : daysInStatus >= 3 ? "aging" : "fresh";

    const product = Array.isArray(row.nextgen_products) ? row.nextgen_products[0] : row.nextgen_products;
    const startedAt = row.updated_at ?? row.created_at;
    const deadlineAt = slaDays !== null ? addDays(startedAt, slaDays) : null;

    return {
      id: row.id,
      request_number: row.request_number,
      status: row.status,
      factory_name: row.factory_name,
      created_at: row.created_at,
      days_in_status: daysInStatus,
      days_since_created: daysSinceCreated,
      bucket,
      is_overdue: isOverdue,
      sla_days: slaDays,
      style_number: product?.style_number ?? null,
      owner_role: ownerRoleForStatus(row.status),
      started_at: startedAt,
      deadline_at: deadlineAt,
      breached_at: isOverdue && deadlineAt ? deadlineAt : null
    };
  });

  return { rows, settings };
}

export function getAgingSummary(rows: AgingRow[]): AgingSummary {
  const active = rows.filter((row) => activeStatuses.includes(row.status as CostingStatus));
  const byStatus: Record<string, { count: number; overdue: number }> = {};

  for (const row of active) {
    if (!byStatus[row.status]) {
      byStatus[row.status] = { count: 0, overdue: 0 };
    }
    byStatus[row.status].count++;
    if (row.is_overdue) byStatus[row.status].overdue++;
  }

  const daysInStatus = active.map((row) => row.days_in_status);
  const averageDaysInStatus = daysInStatus.length
    ? daysInStatus.reduce((sum, d) => sum + d, 0) / daysInStatus.length
    : null;

  return {
    total: active.length,
    fresh: active.filter((r) => r.bucket === "fresh").length,
    aging: active.filter((r) => r.bucket === "aging").length,
    overdue: active.filter((r) => r.bucket === "overdue").length,
    byStatus,
    averageDaysInStatus
  };
}

export async function tryGetAgingData() {
  try {
    const { rows, settings } = await getAgingData();
    return { rows, settings, summary: getAgingSummary(rows), error: null };
  } catch (error) {
    return {
      rows: [] as AgingRow[],
      settings: null,
      summary: null,
      error: error instanceof Error ? error.message : "Unable to load aging data"
    };
  }
}

// Business-day helper kept for backward compatibility; the aging REPORT uses
// calendar days (matching the hours-based SLAs) via calendarDaysSince.
export function businessDaysSince(iso: string, now = new Date()): number {
  try {
    const start = new Date(iso);
    start.setHours(0, 0, 0, 0);
    const end = new Date(now);
    end.setHours(0, 0, 0, 0);
    if (start >= end) return 0;
    let days = 0;
    for (const cursor = new Date(start); cursor < end; cursor.setDate(cursor.getDate() + 1)) {
      const day = cursor.getDay();
      if (day !== 0 && day !== 6) days++;
    }
    return days;
  } catch {
    return 0;
  }
}

function addDays(iso: string, days: number): string {
  const date = new Date(iso);
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

/** Maps a request status to the role accountable for moving it forward. */
export function ownerRoleForStatus(status: string): string | null {
  switch (status) {
    case "draft":
    case "for_pbd_review":
      return "pbd";
    case "sent_to_factory":
    case "needs_clarification":
      return "factory";
    case "for_md_review":
      return "md";
    case "for_costing_review":
      return "costing";
    default:
      return null;
  }
}
