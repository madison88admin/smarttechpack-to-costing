import { describe, expect, it } from "vitest";
import { computeSlaBreakdown } from "../src/lib/costing/sla-report";
import type { AgingRow } from "../src/lib/costing/aging";

// SLA-breakdown aggregation for the Reports page: grouping by workflow stage
// and accountable owner, plus a breach trend and scope filters.

function agingRow(overrides: Partial<AgingRow> = {}): AgingRow {
  return {
    id: "r1",
    request_number: "CR-1",
    status: "draft",
    factory_name: "Cebu Factory",
    created_at: "2026-08-01T00:00:00Z",
    days_in_status: 1,
    days_since_created: 1,
    bucket: "fresh",
    is_overdue: false,
    sla_days: 2,
    style_number: "M88-1",
    owner_role: "pbd",
    started_at: "2026-08-01T00:00:00Z",
    deadline_at: "2026-08-03T00:00:00Z",
    breached_at: null,
    ...overrides
  };
}

describe("computeSlaBreakdown — by stage", () => {
  it("groups active requests by status with SLA hours and labels", () => {
    const rows = [
      agingRow({ id: "r1", status: "draft", sla_days: 2, owner_role: "pbd" }),
      agingRow({ id: "r2", status: "draft", sla_days: 2, owner_role: "pbd" }),
      agingRow({ id: "r3", status: "for_md_review", sla_days: 1, owner_role: "md" }),
      agingRow({ id: "r4", status: "approved", sla_days: null, owner_role: null }) // not tracked
    ];
    const sla = computeSlaBreakdown(rows, "monthly");

    expect(sla.totalActive).toBe(3);
    const draft = sla.byStatus.find((row) => row.status === "draft")!;
    expect(draft).toMatchObject({ label: "Draft", owner: "pbd", active: 2, breached: 0, slaHours: 48 });
    const md = sla.byStatus.find((row) => row.status === "for_md_review")!;
    expect(md).toMatchObject({ label: "For MD Review", owner: "md", active: 1, slaHours: 24 });
    expect(sla.byStatus.some((row) => row.status === "approved")).toBe(false);
  });

  it("counts breaches and the worst overdue per stage", () => {
    const rows = [
      agingRow({ id: "r1", status: "for_pbd_review", sla_days: 1, days_in_status: 3, is_overdue: true, breached_at: "2026-08-04T00:00:00Z", owner_role: "pbd" }),
      agingRow({ id: "r2", status: "for_pbd_review", sla_days: 1, days_in_status: 5, is_overdue: true, breached_at: "2026-08-06T00:00:00Z", owner_role: "pbd" }),
      agingRow({ id: "r3", status: "for_pbd_review", sla_days: 1, days_in_status: 0.5, is_overdue: false, owner_role: "pbd" })
    ];
    const sla = computeSlaBreakdown(rows, "monthly");

    expect(sla.totalBreached).toBe(2);
    const pbd = sla.byStatus.find((row) => row.status === "for_pbd_review")!;
    expect(pbd).toMatchObject({ active: 3, breached: 2 });
    // Worst: 5d in a 1d SLA = 4d = 96h overdue.
    expect(pbd.maxHoursOverdue).toBe(96);
  });
});

describe("computeSlaBreakdown — by owner", () => {
  it("aggregates active/breached and average days per owner", () => {
    const rows = [
      agingRow({ id: "r1", owner_role: "pbd", status: "draft", days_in_status: 2 }),
      agingRow({ id: "r2", owner_role: "pbd", status: "draft", days_in_status: 4, is_overdue: true, sla_days: 2, breached_at: "2026-08-03T00:00:00Z" }),
      agingRow({ id: "r3", owner_role: "factory", status: "sent_to_factory", days_in_status: 1 })
    ];
    const sla = computeSlaBreakdown(rows, "monthly");

    const pbd = sla.byOwner.find((row) => row.owner === "pbd")!;
    expect(pbd).toMatchObject({ active: 2, breached: 1 });
    expect(pbd.avgDaysInStatus).toBeCloseTo(3, 5);
    const factory = sla.byOwner.find((row) => row.owner === "factory")!;
    expect(factory).toMatchObject({ active: 1, breached: 0, avgDaysInStatus: 1 });
  });
});

describe("computeSlaBreakdown — breach trend and granularity", () => {
  it("buckets breaches by the deadline date (monthly, sorted)", () => {
    const rows = [
      agingRow({ id: "r1", status: "draft", sla_days: 2, days_in_status: 5, is_overdue: true, breached_at: "2026-07-25T00:00:00Z" }),
      agingRow({ id: "r2", status: "draft", sla_days: 2, days_in_status: 5, is_overdue: true, breached_at: "2026-08-03T00:00:00Z" }),
      agingRow({ id: "r3", status: "draft", sla_days: 2, days_in_status: 5, is_overdue: true, breached_at: "2026-08-10T00:00:00Z" })
    ];
    const sla = computeSlaBreakdown(rows, "monthly");

    expect(sla.trend).toEqual([
      { bucket: "2026-07", breached: 1 },
      { bucket: "2026-08", breached: 2 }
    ]);
  });

  it("honors the daily and weekly granularities", () => {
    const rows = [
      agingRow({ id: "r1", status: "draft", sla_days: 2, days_in_status: 5, is_overdue: true, breached_at: "2026-08-03T00:00:00Z" })
    ];
    expect(computeSlaBreakdown(rows, "daily").trend[0].bucket).toBe("2026-08-03");
    expect(computeSlaBreakdown(rows, "weekly").trend[0].bucket).toMatch(/^2026-W\d{2}$/);
  });
});

describe("computeSlaBreakdown — scope filters", () => {
  const rows = [
    agingRow({ id: "r1", factory_name: "Cebu Factory", status: "draft", created_at: "2026-08-01T00:00:00Z" }),
    agingRow({ id: "r2", factory_name: "Manila Factory", status: "draft", created_at: "2026-08-05T00:00:00Z" }),
    agingRow({ id: "r3", factory_name: "Cebu Factory", status: "for_md_review", created_at: "2026-08-10T00:00:00Z" })
  ];

  it("filters by factory", () => {
    const sla = computeSlaBreakdown(rows, "monthly", { factory: "Cebu Factory" });
    expect(sla.totalActive).toBe(2);
  });

  it("filters by status", () => {
    const sla = computeSlaBreakdown(rows, "monthly", { status: "draft" });
    expect(sla.totalActive).toBe(2);
    expect(sla.byStatus).toHaveLength(1);
  });

  it("filters by created date range", () => {
    const sla = computeSlaBreakdown(rows, "monthly", { from: "2026-08-04", to: "2026-08-09" });
    expect(sla.totalActive).toBe(1);
    expect(sla.byStatus[0].status).toBe("draft");
  });
});
