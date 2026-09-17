import * as XLSX from "xlsx";
import { canRunCostingAction, canRunPbdAction, getCurrentRole, getRoleLabel, type UserRole } from "@/lib/auth/roles";
import { getReportData, type ReportFilters, type ReportGranularity } from "@/lib/reporting";
import { tryGetAgingData } from "@/lib/costing/aging";
import { computeSlaBreakdown } from "@/lib/costing/sla-report";
import { injectNativeCharts, type NativeChartSheet } from "@/lib/export/inject-charts";

export async function GET(request: Request) {
  const role = getCurrentRole();
  const allowed = canRunPbdAction(role) || canRunCostingAction(role) || role === "manager";
  if (!allowed) {
    return new Response("Unauthorized", { status: 401 });
  }

  const filters = readFilters(new URL(request.url));
  const data = await getReportData(filters);

  const wb = XLSX.utils.book_new();

  const summary = [
    ["Smart TP Costing — Dashboard Report"],
    ["Generated", data.generatedAt],
    ["", ""],
    ["Metric", "Value"],
    ["Total Requests", data.totalRequests],
    ["Active Requests", data.activeRequests],
    ["In Internal Review (MD / Costing / PBD)", data.inReviewCount],
    ["Needs Clarification", data.needsClarificationCount],
    ["Approved", data.approvedCount],
    ["Rejected", data.rejectedCount],
    ["Approval Rate (%)", data.approvalRate === null ? "" : Number(data.approvalRate.toFixed(1))],
    ["Average Approved Cost", data.averageApprovedCost ?? ""],
    ["Benchmark Target Cost", data.benchmark.targetCost ?? ""],
    ["Latest Cost Variance (%)", data.benchmark.variancePct ?? ""],
    ["Benchmark Band", data.benchmark.band],
    ["Forecast Next Period", data.forecast.nextBucket ?? ""],
    ["Forecast Requests", data.forecast.projectedCreated ?? ""],
    ["Forecast Approvals", data.forecast.projectedApproved ?? ""],
    ["Forecast Avg Cost", data.forecast.projectedAvgCost ?? ""],
    ["Forecast Cost Low", data.forecast.projectedAvgCostLow ?? ""],
    ["Forecast Cost High", data.forecast.projectedAvgCostHigh ?? ""],
    ["Forecast Confidence", data.forecast.confidence],
    ["Data Freshness", data.freshness.status],
    ["Last Source Update", data.freshness.lastUpdatedAt ?? ""]
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), "Summary");

  const byStatus = [["Status", "Requests"], ...data.byStatus.map((row) => [row.label, row.count])];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(byStatus), "By Status");

  const byFactory = [["Factory", "Requests", "Approved"], ...data.byFactory.map((row) => [row.key, row.count, row.approved])];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(byFactory), "By Factory");

  const byBrand = [["Brand", "Requests", "Approved"], ...data.byBrand.map((row) => [row.key, row.count, row.approved])];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(byBrand), "By Brand");

  const byCustomer = [["Customer", "Requests", "Approved"], ...data.byCustomer.map((row) => [row.key, row.count, row.approved])];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(byCustomer), "By Customer");

  const bySeason = [["Season", "Requests", "Approved"], ...data.bySeason.map((row) => [row.key, row.count, row.approved])];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(bySeason), "By Season");

  const monthly = [["Bucket", "Created", "Approved", "Avg Cost", "Benchmark Target"], ...data.trend.map((row) => [row.bucket, row.created, row.approved, row.avgCost !== null ? row.avgCost : "", data.benchmark.targetCost ?? ""])];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(monthly), "Trend");

  const forecast = [
    ["Forecast metric", "Value"],
    ["Next period", data.forecast.nextBucket ?? ""],
    ["Expected requests", data.forecast.projectedCreated ?? ""],
    ["Expected approvals", data.forecast.projectedApproved ?? ""],
    ["Expected average cost", data.forecast.projectedAvgCost ?? ""],
    ["Lower cost range", data.forecast.projectedAvgCostLow ?? ""],
    ["Upper cost range", data.forecast.projectedAvgCostHigh ?? ""],
    ["Confidence", data.forecast.confidence],
    ["Observed periods", data.forecast.observedBuckets]
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(forecast), "Forecast");

  const aging = await tryGetAgingData();
  const sla = computeSlaBreakdown(aging.rows, "monthly", {
    factory: filters.factory,
    status: filters.status,
    from: filters.from,
    to: filters.to
  });
  const ownerLabel = (owner: string) => (owner === "unassigned" ? "Unassigned" : getRoleLabel(owner as UserRole));
  const slaSheet = [
    ["SLA Compliance — Active Pipeline"],
    ["Total Active", sla.totalActive],
    ["Total Breached", sla.totalBreached],
    ["", ""],
    ["Stage", "Owner", "SLA Hours", "Active", "Breached", "Worst Overdue (h)"],
    ...sla.byStatus.map((row) => [
      row.label,
      row.owner ? ownerLabel(row.owner) : "",
      row.slaHours ?? "",
      row.active,
      row.breached,
      row.maxHoursOverdue ?? ""
    ]),
    ["", ""],
    ["Owner", "Active", "Breached", "Avg Days in Status"],
    ...sla.byOwner.map((row) => [
      ownerLabel(row.owner),
      row.active,
      row.breached,
      row.avgDaysInStatus === null ? "" : Number(row.avgDaysInStatus.toFixed(1))
    ]),
    ["", ""],
    ["Period", "Breached"],
    ...sla.trend.map((row) => [row.bucket, row.breached])
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(slaSheet), "SLA");

  const register = [
    ["Request", "Style", "Product", "Factory", "Brand", "Customer", "Season", "Status", "Created"],
    ...data.rows.map((row) => [
      row.request_number ?? "",
      row.style_number ?? "",
      row.product_name ?? "",
      row.factory_name ?? "",
      row.brand ?? "",
      row.customer ?? "",
      row.season ?? "",
      row.status,
      row.created_at
    ])
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(register), "Request Register");

  // Mirror the web charts as native Excel chart parts anchored on each sheet.
  const charts: NativeChartSheet[] = [
    {
      sheetName: "By Status",
      spec: {
        sheetName: "By Status",
        title: "Pipeline by Status",
        kind: "bar",
        categories: data.byStatus.map((row) => row.label),
        series: [{ name: "Requests", values: data.byStatus.map((row) => row.count) }]
      }
    },
    {
      sheetName: "By Factory",
      spec: {
        sheetName: "By Factory",
        title: "Requests by Factory",
        kind: "bar",
        categories: data.byFactory.map((row) => row.key),
        series: [
          { name: "Requests", values: data.byFactory.map((row) => row.count) },
          { name: "Approved", values: data.byFactory.map((row) => row.approved) }
        ]
      }
    },
    {
      sheetName: "By Brand",
      spec: {
        sheetName: "By Brand",
        title: "Requests by Brand",
        kind: "bar",
        categories: data.byBrand.map((row) => row.key),
        series: [
          { name: "Requests", values: data.byBrand.map((row) => row.count) },
          { name: "Approved", values: data.byBrand.map((row) => row.approved) }
        ]
      }
    },
    {
      sheetName: "By Customer",
      spec: {
        sheetName: "By Customer",
        title: "Requests by Customer",
        kind: "bar",
        categories: data.byCustomer.map((row) => row.key),
        series: [
          { name: "Requests", values: data.byCustomer.map((row) => row.count) },
          { name: "Approved", values: data.byCustomer.map((row) => row.approved) }
        ]
      }
    },
    {
      sheetName: "By Season",
      spec: {
        sheetName: "By Season",
        title: "Requests by Season",
        kind: "bar",
        categories: data.bySeason.map((row) => row.key),
        series: [
          { name: "Requests", values: data.bySeason.map((row) => row.count) },
          { name: "Approved", values: data.bySeason.map((row) => row.approved) }
        ]
      }
    },
    {
      sheetName: "Trend",
      spec: {
        sheetName: "Trend",
        title: "Monthly Trend",
        kind: "line",
        categories: data.trend.map((row) => row.bucket),
        series: [
          { name: "Created", values: data.trend.map((row) => row.created) },
          { name: "Approved", values: data.trend.map((row) => row.approved) },
          { name: "Avg Cost", values: data.trend.map((row) => row.avgCost ?? 0), axis: "right" },
          ...(data.benchmark.targetCost !== null ? [{ name: "Benchmark Target", values: data.trend.map(() => data.benchmark.targetCost ?? 0), axis: "right" as const }] : [])
        ]
      }
    }
  ];

  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  const finalBuffer = await injectNativeCharts(buffer, charts);
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(new Uint8Array(finalBuffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="tp-costing-dashboard-${stamp}.xlsx"`
    }
  });
}

function readFilters(url: URL): ReportFilters {
  const pick = (key: string) => {
    const value = url.searchParams.get(key)?.trim();
    return value ? value : null;
  };
  return {
    factory: pick("factory"),
    brand: pick("brand"),
    customer: pick("customer"),
    season: pick("season"),
    status: pick("status"),
    granularity: pick("granularity") as ReportGranularity | null,
    from: pick("from"),
    to: pick("to")
  };
}
