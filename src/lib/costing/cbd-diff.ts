import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { calculateCostingTotals } from "@/lib/costing/totals";

export type CbdDiffEntry = {
  field: string;
  oldValue: string;
  newValue: string;
  changed: boolean;
  deltaPercent: number | null; // percentage change for numeric fields
};

export type CbdCostImpact = {
  fobBefore: number;
  fobAfter: number;
  fobDelta: number;
  fobDeltaPercent: number;
  landedBefore: number;
  landedAfter: number;
  landedDelta: number;
  landedDeltaPercent: number;
  currency: string;
};

export type CbdDiffResult = {
  requestId: string;
  requestNumber: string | null;
  revisions: Array<{
    cbdId: string;
    submittedAt: string;
    status: string;
    payload: Record<string, unknown>;
    materialLines: Array<{
      material_name: string | null;
      unit_cost: number | null;
      consumption: number | null;
      total_cost: number | null;
      currency: string | null;
    }>;
    fob: number;
    landedCost: number;
    currency: string;
  }>;
  diffs: CbdDiffEntry[][];
  costImpacts: (CbdCostImpact | null)[];
};

const COMPARE_FIELDS = [
  "laborCost",
  "overheadCost",
  "profitMargin",
  "moq",
  "leadTimeDays",
  "materialBufferPercent",
  "packagingCost",
  "testingCost",
  "knittingTime",
  "yarnType",
  "knitType",
  "machineType",
  "construction",
  "productCategory",
  "m88Packaging",
  "brandNominatedItems",
  "notes",
  "costingLearning"
];

export const CBD_DIFF_FIELD_LABELS: Record<string, string> = {
  laborCost: "Labor Cost",
  overheadCost: "Overhead",
  profitMargin: "Profit Margin %",
  moq: "MOQ",
  leadTimeDays: "Lead Time (days)",
  materialBufferPercent: "Material Buffer %",
  packagingCost: "Packaging Cost",
  testingCost: "Testing Cost",
  knittingTime: "Knitting Time",
  yarnType: "Yarn Type",
  knitType: "Knit Type",
  machineType: "Machine Type",
  construction: "Construction",
  productCategory: "Product Category",
  m88Packaging: "M88 Packaging",
  brandNominatedItems: "Brand-Nominated Items",
  notes: "Factory Notes",
  costingLearning: "Costing Learnings"
};

// Internal alias — the diff builder below still references the short name.
const FIELD_LABELS: Record<string, string> = CBD_DIFF_FIELD_LABELS;

export async function getCbdDiff(requestId: string): Promise<CbdDiffResult | null> {
  const supabase = createSupabaseServiceClient();

  const { data: request } = await supabase
    .from("costing_requests")
    .select("id, request_number")
    .eq("id", requestId)
    .single();

  if (!request) return null;

  const { data: cbds } = await supabase
    .from("factory_cbds")
    .select(
      `
      id,
      status,
      submitted_at,
      raw_payload,
      cbd_material_lines (
        material_name,
        unit_cost,
        consumption,
        total_cost,
        currency
      )
    `
    )
    .eq("costing_request_id", requestId)
    .order("submitted_at", { ascending: true });

  const typedCbds = (cbds ?? []) as Array<{
    id: string;
    status: string;
    submitted_at: string;
    raw_payload: unknown;
    cbd_material_lines: Array<{
      material_name: string | null;
      unit_cost: number | null;
      consumption: number | null;
      total_cost: number | null;
      currency: string | null;
    }>;
  }>;

  if (typedCbds.length === 0) return null;

  const revisions = typedCbds.map((cbd) => {
    const payload = (cbd.raw_payload ?? {}) as Record<string, unknown>;
    const materialLines = cbd.cbd_material_lines ?? [];
    const totals = calculateCostingTotals({
      rawPayload: payload,
      lines: materialLines.map((m) => ({
        total_cost: m.total_cost,
        currency: m.currency
      })),
      fallbackCurrency: null
    });
    return {
      cbdId: cbd.id,
      submittedAt: cbd.submitted_at,
      status: cbd.status,
      payload,
      materialLines,
      fob: totals.grandTotal,
      landedCost: totals.landedCost,
      currency: totals.currency
    };
  });

  // Compute diffs between consecutive revisions
  const diffs: CbdDiffEntry[][] = [];
  const costImpacts: (CbdCostImpact | null)[] = [];
  for (let i = 1; i < revisions.length; i++) {
    const prev = revisions[i - 1].payload;
    const curr = revisions[i].payload;
    const entries: CbdDiffEntry[] = COMPARE_FIELDS.map((field) => {
      const oldVal = formatValue(prev[field]);
      const newVal = formatValue(curr[field]);
      const oldNum = toNumber(prev[field]);
      const newNum = toNumber(curr[field]);
      const deltaPercent =
        oldNum !== null && newNum !== null && oldNum !== 0
          ? ((newNum - oldNum) / Math.abs(oldNum)) * 100
          : null;
      return {
        field: FIELD_LABELS[field] ?? field,
        oldValue: oldVal,
        newValue: newVal,
        changed: oldVal !== newVal,
        deltaPercent
      };
    });

    // Also compare material lines (unit_cost, consumption, total_cost)
    const prevMaterials = revisions[i - 1].materialLines;
    const currMaterials = revisions[i].materialLines;
    const maxMaterials = Math.max(prevMaterials.length, currMaterials.length);
    for (let m = 0; m < maxMaterials; m++) {
      const prevMat = prevMaterials[m];
      const currMat = currMaterials[m];
      const matName = currMat?.material_name ?? prevMat?.material_name ?? `Line ${m + 1}`;

      // Unit cost
      const oldCost = prevMat?.unit_cost?.toString() ?? "—";
      const newCost = currMat?.unit_cost?.toString() ?? "—";
      entries.push({
        field: `${matName} — Unit Cost`,
        oldValue: oldCost,
        newValue: newCost,
        changed: oldCost !== newCost,
        deltaPercent: computeDeltaPercent(prevMat?.unit_cost, currMat?.unit_cost)
      });

      // Consumption
      const oldCons = prevMat?.consumption?.toString() ?? "—";
      const newCons = currMat?.consumption?.toString() ?? "—";
      entries.push({
        field: `${matName} — Consumption`,
        oldValue: oldCons,
        newValue: newCons,
        changed: oldCons !== newCons,
        deltaPercent: computeDeltaPercent(prevMat?.consumption, currMat?.consumption)
      });

      // Total cost
      const oldTotal = prevMat?.total_cost?.toString() ?? "—";
      const newTotal = currMat?.total_cost?.toString() ?? "—";
      entries.push({
        field: `${matName} — Total Cost`,
        oldValue: oldTotal,
        newValue: newTotal,
        changed: oldTotal !== newTotal,
        deltaPercent: computeDeltaPercent(prevMat?.total_cost, currMat?.total_cost)
      });
    }

    diffs.push(entries);

    // Compute cost impact for this revision pair
    const prevRev = revisions[i - 1];
    const currRev = revisions[i];
    if (prevRev.fob > 0 || currRev.fob > 0) {
      const fobDelta = currRev.fob - prevRev.fob;
      const fobDeltaPercent = prevRev.fob !== 0 ? (fobDelta / Math.abs(prevRev.fob)) * 100 : 0;
      const landedDelta = currRev.landedCost - prevRev.landedCost;
      const landedDeltaPercent =
        prevRev.landedCost !== 0 ? (landedDelta / Math.abs(prevRev.landedCost)) * 100 : 0;
      costImpacts.push({
        fobBefore: prevRev.fob,
        fobAfter: currRev.fob,
        fobDelta,
        fobDeltaPercent,
        landedBefore: prevRev.landedCost,
        landedAfter: currRev.landedCost,
        landedDelta,
        landedDeltaPercent,
        currency: currRev.currency || prevRev.currency || "USD"
      });
    } else {
      costImpacts.push(null);
    }
  }

  return {
    requestId,
    requestNumber: request.request_number,
    revisions,
    diffs,
    costImpacts
  };
}

export async function tryGetCbdDiff(requestId: string) {
  try {
    const result = await getCbdDiff(requestId);
    return { result, error: null };
  } catch (error) {
    return {
      result: null,
      error: error instanceof Error ? error.message : "Unable to load CBD diff"
    };
  }
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value || "—";
  return String(value);
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && !isNaN(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = parseFloat(value);
    return isNaN(n) ? null : n;
  }
  return null;
}

function computeDeltaPercent(
  oldVal: number | null | undefined,
  newVal: number | null | undefined
): number | null {
  const oldNum = typeof oldVal === "number" ? oldVal : null;
  const newNum = typeof newVal === "number" ? newVal : null;
  if (oldNum === null || newNum === null || oldNum === 0) return null;
  return ((newNum - oldNum) / Math.abs(oldNum)) * 100;
}
