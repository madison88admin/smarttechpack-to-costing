import { afterEach, describe, expect, it, vi } from "vitest";
import { buildReportBenchmark, buildReportForecast, compareLatestTrendPeriods, countByBucket, getReportData, mergeRegisterPrefsIntoQuery, normalizeRegisterSort, parseRegisterPrefs, percentChange, serializeRegisterPrefs, sortReportRows } from "../src/lib/reporting";

const { mocks } = vi.hoisted(() => ({ mocks: { client: null as unknown } }));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: () => mocks.client
}));

import { createMockSupabase, type Responder } from "./helpers/supabase-mock";

afterEach(() => {
  mocks.client = null;
});

function reportResponder(overrides: Partial<Responder> = {}): Responder {
  return {
    costing_requests: {
      select: () => ({
        data: [
          {
            id: "req-1",
            request_number: "CR-100001",
            factory_name: "Hangzhou U-Jump",
            status: "approved",
            brand: "Mens",
            customer: "Prana",
            season: "FH:2018",
            product_category: "Hats",
            created_at: "2026-01-15T10:00:00Z",
            updated_at: "2026-01-20T10:00:00Z",
            nextgen_products: [{ style_number: "M88-1", name: "Beanie" }]
          },
          {
            id: "req-2",
            request_number: "CR-100002",
            factory_name: "Hangzhou U-Jump",
            status: "for_md_review",
            brand: "Mens",
            customer: "Prana",
            season: null,
            product_category: "Hats",
            created_at: "2026-02-01T10:00:00Z",
            updated_at: "2026-02-01T10:00:00Z",
            nextgen_products: null
          },
          {
            id: "req-3",
            request_number: "CR-100003",
            factory_name: "Other Factory",
            status: "rejected",
            brand: null,
            customer: null,
            season: null,
            product_category: null,
            created_at: "2026-02-10T10:00:00Z",
            updated_at: "2026-02-11T10:00:00Z",
            nextgen_products: [{ style_number: "M88-3", name: "Scarf" }]
          }
        ],
        error: null
      })
    },
    historical_costings: {
      select: () => ({
        data: [
          { costing_request_id: "req-1", total_cost: 10, currency: "USD", approved_at: "2026-01-20T10:00:00Z" },
          { costing_request_id: "req-2", total_cost: 25, currency: "USD", approved_at: "2026-02-05T10:00:00Z" }
        ],
        error: null
      })
    },
    ...overrides
  };
}

describe("getReportData", () => {
  it("computes pipeline aggregates from costing_requests", async () => {
    const { client } = createMockSupabase(reportResponder());
    mocks.client = client;

    const report = await getReportData();

    expect(report.totalRequests).toBe(3);
    expect(report.activeRequests).toBe(1); // only for_md_review is non-terminal
    expect(report.approvedCount).toBe(1);
    expect(report.rejectedCount).toBe(1);
    expect(report.inReviewCount).toBe(1); // for_md_review
    expect(report.approvalRate).toBe(50); // 1 approved ÷ 2 decided
    expect(report.averageApprovedCost).toBe(17.5); // avg of historical total_cost (10 + 25)
  });

  it("groups by factory, brand, customer, season and status", async () => {
    const { client } = createMockSupabase(reportResponder());
    mocks.client = client;

    const report = await getReportData();

    const factory = report.byFactory.find((row) => row.key === "Hangzhou U-Jump");
    expect(factory).toMatchObject({ count: 2, approved: 1 });

    const brand = report.byBrand.find((row) => row.key === "Mens");
    expect(brand).toMatchObject({ count: 2, approved: 1 });

    const customer = report.byCustomer.find((row) => row.key === "Prana");
    expect(customer).toMatchObject({ count: 2, approved: 1 });

    const season = report.bySeason.find((row) => row.key === "No season");
    expect(season).toMatchObject({ count: 2 });

    const approved = report.byStatus.find((row) => row.status === "approved");
    expect(approved).toMatchObject({ label: "Approved", count: 1 });
  });

  it("builds a monthly trend from created_at and approved_at", async () => {
    const { client } = createMockSupabase(reportResponder());
    mocks.client = client;

    const report = await getReportData();

    const jan = report.trend.find((row) => row.bucket === "2026-01");
    expect(jan).toMatchObject({ created: 1, approved: 1, avgCost: 10 });

    const feb = report.trend.find((row) => row.bucket === "2026-02");
    expect(feb).toMatchObject({ created: 2, approved: 1, avgCost: 25 });
  });

  it("leaves unattributed history out of the cost-driver charts", async () => {
    const { client } = createMockSupabase(
      reportResponder({
        historical_costings: {
          select: () => ({
            data: [
              {
                costing_request_id: "req-1",
                total_cost: 10,
                approved_at: "2026-01-20T10:00:00Z",
                yarn_type: "100%Acrylic",
                knit_type: null,
                machine_type: null,
                construction: "Hats",
                factory_name: null,
                customer: "Prana"
              },
              {
                costing_request_id: "req-2",
                total_cost: 30,
                approved_at: "2026-02-05T10:00:00Z",
                yarn_type: null,
                knit_type: null,
                machine_type: null,
                construction: null,
                factory_name: null,
                customer: null
              }
            ],
            error: null
          })
        }
      })
    );
    mocks.client = client;

    const report = await getReportData();

    // A blank field is missing data, not a category — charting it as
    // "Unassigned factory"/"No machine" made unresolved imports the biggest bar.
    expect(report.byFactoryCost).toEqual([]);
    expect(report.byMachine).toEqual([]);
    expect(report.byKnit).toEqual([]);
    expect(report.byCustomerCost).toEqual([{ key: "Prana", count: 1, avgCost: 10 }]);
    expect(report.byYarn).toEqual([{ key: "100%Acrylic", count: 1, avgCost: 10 }]);
    expect(report.byConstruction).toEqual([{ key: "Hats", count: 1, avgCost: 10 }]);
  });

  it("includes the flattened request register rows", async () => {
    const { client } = createMockSupabase(reportResponder());
    mocks.client = client;

    const report = await getReportData();

    expect(report.rows).toHaveLength(3);
    expect(report.rows[0]).toMatchObject({
      request_number: "CR-100001",
      style_number: "M88-1",
      factory_name: "Hangzhou U-Jump",
      status: "approved"
    });
  });
});

describe("getReportData — filters", () => {
  it("filters rows by factory", async () => {
    const { client } = createMockSupabase(reportResponder());
    mocks.client = client;

    const report = await getReportData({ factory: "Hangzhou" });
    expect(report.totalRequests).toBe(2);
    expect(report.approvedCount).toBe(1);
    expect(report.rows.every((row) => row.factory_name === "Hangzhou U-Jump")).toBe(true);
  });

  it("filters rows by exact status", async () => {
    const { client } = createMockSupabase(reportResponder());
    mocks.client = client;

    const report = await getReportData({ status: "approved" });
    expect(report.totalRequests).toBe(1);
    expect(report.rows[0].request_number).toBe("CR-100001");
    expect(report.approvedCount).toBe(1);

    const none = await getReportData({ status: "for_pbd_review" });
    expect(none.totalRequests).toBe(0);
  });

  it("drills into unassigned fallback labels", async () => {
    const { client } = createMockSupabase(reportResponder());
    mocks.client = client;

    // req-3 has no brand/customer/season -> matches the fallback labels
    const report = await getReportData({ brand: "No brand", customer: "No customer", season: "No season" });
    expect(report.totalRequests).toBe(1);
    expect(report.rows[0].request_number).toBe("CR-100003");

    // req-1/req-2 (Hangzhou) have empty factory? No — the mock rows all have
    // a factory, so "Unassigned" matches nothing and never matches real names.
    const noFactory = await getReportData({ factory: "Unassigned" });
    expect(noFactory.totalRequests).toBe(0);
  });

  it("filters rows by brand and season", async () => {
    const { client } = createMockSupabase(reportResponder());
    mocks.client = client;

    const report = await getReportData({ brand: "Mens", season: "FH:2018" });
    expect(report.totalRequests).toBe(1);
    expect(report.rows[0].request_number).toBe("CR-100001");
  });

  it("filters by created_at date range", async () => {
    const { client } = createMockSupabase(reportResponder());
    mocks.client = client;

    const report = await getReportData({ from: "2026-02-01", to: "2026-02-28" });
    expect(report.totalRequests).toBe(2);
    expect(report.rows.every((row) => row.created_at >= "2026-02-01" && row.created_at <= "2026-02-28")).toBe(true);
  });

  it("scopes monthly approval counts to the filtered requests", async () => {
    const { client } = createMockSupabase(reportResponder());
    mocks.client = client;

    const report = await getReportData({ factory: "Hangzhou" });
    const jan = report.trend.find((row) => row.bucket === "2026-01");
    expect(jan).toMatchObject({ created: 1, approved: 1 });
    // req-2's historical approval (2026-02) belongs to a Hangzhou request too,
    // so it remains; only req-3 (Other Factory) is excluded.
    const feb = report.trend.find((row) => row.bucket === "2026-02");
    expect(feb).toMatchObject({ created: 1, approved: 1 });
  });
});

describe("getReportData — trend granularity", () => {
  it("buckets by day when granularity is daily", async () => {
    const { client } = createMockSupabase(reportResponder());
    mocks.client = client;

    const report = await getReportData({ granularity: "daily" });

    const jan15 = report.trend.find((row) => row.bucket === "2026-01-15");
    expect(jan15).toMatchObject({ created: 1, approved: 0 });
    const jan20 = report.trend.find((row) => row.bucket === "2026-01-20");
    expect(jan20).toMatchObject({ created: 0, approved: 1, avgCost: 10 });
  });

  it("buckets by ISO week when granularity is weekly", async () => {
    const { client } = createMockSupabase(reportResponder());
    mocks.client = client;

    const report = await getReportData({ granularity: "weekly" });

    // 2026-01-15 (Thu) -> W03, 2026-01-20 (Tue) -> W04, 2026-02-01 (Sun) -> W05,
    // 2026-02-05 (Thu) -> W06, 2026-02-10 (Tue) -> W07 (verified against ISO 8601)
    const week3 = report.trend.find((row) => row.bucket === "2026-W03");
    expect(week3).toMatchObject({ created: 1, approved: 0 });
    const week4 = report.trend.find((row) => row.bucket === "2026-W04");
    expect(week4).toMatchObject({ created: 0, approved: 1, avgCost: 10 });
    const week5 = report.trend.find((row) => row.bucket === "2026-W05");
    expect(week5).toMatchObject({ created: 1, approved: 0 });
    const week6 = report.trend.find((row) => row.bucket === "2026-W06");
    expect(week6).toMatchObject({ created: 0, approved: 1, avgCost: 25 });
    const week7 = report.trend.find((row) => row.bucket === "2026-W07");
    expect(week7).toMatchObject({ created: 1, approved: 0 });
  });

  it("granularity does not change row filtering", async () => {
    const { client } = createMockSupabase(reportResponder());
    mocks.client = client;

    const report = await getReportData({ granularity: "weekly", status: "approved" });
    expect(report.totalRequests).toBe(1);
    expect(report.rows[0].request_number).toBe("CR-100001");
  });
});

describe("report history and forecast helpers", () => {
  const trend = [
    { bucket: "2026-01", created: 4, approved: 2, avgCost: 10 },
    { bucket: "2026-02", created: 6, approved: 3, avgCost: 12 },
    { bucket: "2026-03", created: 8, approved: 4, avgCost: 14 }
  ];

  it("builds a transparent next-period forecast from recent periods", () => {
    expect(buildReportForecast(trend, "monthly")).toMatchObject({
      nextBucket: "2026-04",
      projectedCreated: 6,
      projectedApproved: 3,
      projectedAvgCost: 12,
      observedBuckets: 3,
      costSampleBuckets: 3,
      confidence: "low",
      costDirection: "up"
    });
  });

  it("uses one observed period as a low-confidence baseline", () => {
    const result = buildReportForecast([trend[0]], "monthly");
    expect(result).toMatchObject({
      projectedCreated: 4,
      projectedApproved: 2,
      projectedAvgCost: 10,
      confidence: "low"
    });
  });

  it("compares the latest period against the previous period", () => {
    expect(compareLatestTrendPeriods(trend)).toMatchObject({
      createdChangePct: 33.3,
      approvedChangePct: 33.3,
      avgCostChangePct: 16.7
    });
  });

  it("classifies the latest cost against the historical benchmark", () => {
    expect(buildReportBenchmark([10, 10, 10], trend)).toMatchObject({
      targetCost: 10,
      latestCost: 14,
      variancePct: 40,
      band: "above",
      sampleCount: 3
    });
  });
});

describe("register sort helpers", () => {
  it("normalizes sort params and falls back to created_at", () => {
    expect(normalizeRegisterSort("factory_name")).toBe("factory_name");
    expect(normalizeRegisterSort("  status ")).toBe("status");
    expect(normalizeRegisterSort("bogus")).toBe("created_at");
    expect(normalizeRegisterSort(undefined)).toBe("created_at");
  });

  it("sorts rows by key and direction with nulls last", () => {
    const rows = [
      { id: "a", request_number: "CR-3", style_number: "Z", product_name: "Beanie", factory_name: null, status: "approved", created_at: "2026-03-01", brand: null, customer: null, season: null, product_category: null, updated_at: "2026-03-01" },
      { id: "b", request_number: "CR-1", style_number: "M", product_name: "Scarf", factory_name: "Hangzhou", status: "for_md_review", created_at: "2026-01-01", brand: null, customer: null, season: null, product_category: null, updated_at: "2026-01-01" },
      { id: "c", request_number: "CR-2", style_number: "A", product_name: "Glove", factory_name: "Wuxi", status: "approved", created_at: "2026-02-01", brand: null, customer: null, season: null, product_category: null, updated_at: "2026-02-01" }
    ];
    const asc = sortReportRows(rows, "request_number", "asc");
    expect(asc.map((r) => r.id)).toEqual(["b", "c", "a"]);
    const desc = sortReportRows(rows, "created_at", "desc");
    expect(desc.map((r) => r.id)).toEqual(["a", "c", "b"]);
    // Null factory sorts last in both directions.
    const byFactoryAsc = sortReportRows(rows, "factory_name", "asc");
    expect(byFactoryAsc.map((r) => r.id)).toEqual(["b", "c", "a"]);
    const byFactoryDesc = sortReportRows(rows, "factory_name", "desc");
    expect(byFactoryDesc.map((r) => r.id)).toEqual(["c", "b", "a"]);
  });

  it("computes percentChange with safe zero handling", () => {
    expect(percentChange(110, 100)).toBe(10);
    expect(percentChange(90, 100)).toBe(-10);
    expect(percentChange(0, 100)).toBe(-100);
    expect(percentChange(5, 0)).toBeNull();
    expect(percentChange(0, 0)).toBe(0);
  });
});

describe("register prefs persistence helpers", () => {
  it("serializes and parses prefs round-trip with sane fallbacks", () => {
    expect(serializeRegisterPrefs({ sort: "factory_name", dir: "asc", page: 2 }))
      .toBe('{"sort":"factory_name","dir":"asc","page":2}');
    expect(parseRegisterPrefs('{"sort":"factory_name","dir":"asc","page":2}'))
      .toEqual({ sort: "factory_name", dir: "asc", page: 2 });
    expect(parseRegisterPrefs(null)).toBeNull();
    expect(parseRegisterPrefs("not-json")).toBeNull();
    // Bad values clamp to defaults.
    expect(parseRegisterPrefs('{"sort":"bogus","dir":"sideways","page":0}'))
      .toEqual({ sort: "created_at", dir: "desc", page: 1 });
  });

  it("merges saved prefs into a query, dropping defaults", () => {
    expect(mergeRegisterPrefsIntoQuery("", { sort: "factory_name", dir: "asc", page: 2 }))
      .toBe("sort=factory_name&dir=asc&page=2");
    // Defaults (created_at desc page 1) produce no change.
    expect(mergeRegisterPrefsIntoQuery("", { sort: "created_at", dir: "desc", page: 1 }))
      .toBeNull();
    // Existing filters are preserved.
    expect(mergeRegisterPrefsIntoQuery("factory=F1&brand=Mens", { sort: "status", dir: "desc", page: 3 }))
      .toBe("factory=F1&brand=Mens&sort=status&page=3");
    // Prefs override any pre-existing sort/dir/page in the query, other filters stay.
    expect(mergeRegisterPrefsIntoQuery("sort=brand&dir=asc&factory=F1", { sort: "factory_name", dir: "asc", page: 2 }))
      .toBe("factory=F1&sort=factory_name&dir=asc&page=2");
  });
});

describe("countByBucket", () => {
  const row = (overrides: Partial<{ id: string; status: string; created_at: string }> = {}) => ({
    id: overrides.id ?? "r1",
    request_number: null,
    style_number: null,
    product_name: null,
    factory_name: null,
    status: overrides.status ?? "draft",
    created_at: overrides.created_at ?? "2026-01-15T10:00:00Z",
    updated_at: "2026-01-15T10:00:00Z",
    brand: null,
    customer: null,
    season: null,
    product_category: null
  });

  it("groups by creation period in ascending bucket order", () => {
    const rows = [
      row({ id: "a", created_at: "2026-02-10T08:00:00Z" }),
      row({ id: "b", created_at: "2026-01-05T08:00:00Z" }),
      row({ id: "c", created_at: "2026-02-20T08:00:00Z" })
    ];
    expect(countByBucket(rows, "monthly")).toEqual([1, 2]);
  });

  it("applies the predicate before bucketing", () => {
    const rows = [
      row({ id: "a", status: "rejected", created_at: "2026-01-05T08:00:00Z" }),
      row({ id: "b", status: "approved", created_at: "2026-01-10T08:00:00Z" }),
      row({ id: "c", status: "for_pbd_review", created_at: "2026-02-01T08:00:00Z" })
    ];
    const rejected = countByBucket(rows, "monthly", (item) => item.status === "rejected");
    expect(rejected).toEqual([1]);
  });

  it("returns an empty series when nothing matches or dates are invalid", () => {
    const rows = [row({ id: "a", status: "approved", created_at: "2026-01-05T08:00:00Z" })];
    expect(countByBucket(rows, "monthly", (item) => item.status === "rejected")).toEqual([]);
    expect(countByBucket([{ ...row(), created_at: "nope" }], "monthly")).toEqual([]);
  });

  it("honors the granularity key format", () => {
    const rows = [row({ created_at: "2026-02-10T08:00:00Z" })];
    expect(countByBucket(rows, "daily")).toEqual([1]);
    expect(countByBucket(rows, "weekly")).toEqual([1]);
  });
});
