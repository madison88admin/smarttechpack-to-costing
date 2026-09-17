import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { calculateCostingTotals } from "@/lib/costing/totals";

export type CbdDiffEntry = {
  /** Stable machine-readable key used to identify the editable CBD field. */
  fieldKey: string;
  field: string;
  /** CBD wizard section where the editor can find this field. */
  section: "Header Info" | "Yarn" | "Fabric & Trim" | "Knitting & Operations" | "Packaging & Overhead" | "Notes";
  oldValue: string;
  newValue: string;
  changed: boolean;
  changeType: "changed" | "added" | "removed";
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
  /** The clarification that sent the Factory back before each resubmission. */
  clarificationRequests: Array<{
    actorRole: string | null;
    action: string;
    comment: string | null;
    requestedAt: string;
  } | null>;
};

const COMPARE_FIELDS = [
  "laborCost",
  "overheadCost",
  "profitCost",
  "moq",
  "leadTimeDays",
  "materialBufferPercent",
  "standardPackagingCost",
  "specialPackagingCost",
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
  profitCost: "Profit Cost",
  moq: "MOQ",
  leadTimeDays: "Lead Time (days)",
  materialBufferPercent: "Material Buffer %",
  standardPackagingCost: "Standard Packaging Cost",
  specialPackagingCost: "Special Packaging Cost",
  testingCost: "Testing Cost",
  knittingTime: "Knitting Time",
  yarnType: "Yarn Type",
  knitType: "Knit Type",
  machineType: "Machine / Gauge Type",
  construction: "Construction",
  productCategory: "Product Category",
  m88Packaging: "M88 Packaging",
  brandNominatedItems: "Brand-Nominated Items",
  notes: "Factory Notes",
  costingLearning: "Costing Learnings"
};

// Internal alias — the diff builder below still references the short name.
const FIELD_LABELS: Record<string, string> = CBD_DIFF_FIELD_LABELS;

function sectionForField(field: string): CbdDiffEntry["section"] {
  if (["laborCost", "moq", "leadTimeDays", "materialBufferPercent", "yarnType", "knitType", "machineType", "construction", "productCategory", "brandNominatedItems"].includes(field)) return "Header Info";
  if (["overheadCost", "profitCost", "packagingCost", "testingCost", "standardPackagingCost", "specialPackagingCost", "m88Packaging"].includes(field)) return "Packaging & Overhead";
  if (["knittingTime"].includes(field)) return "Knitting & Operations";
  return "Notes";
}

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

  // A revision is much easier to review when the requester’s reason is kept
  // with it.  Actions are append-only audit records, so bind the latest
  // clarification occurring between the previous and current CBD submission.
  const { data: approvalActions } = await supabase
    .from("approval_actions")
    .select("actor_role, action, comment, to_status, created_at")
    .eq("costing_request_id", requestId)
    .eq("to_status", "needs_clarification")
    .order("created_at", { ascending: true });

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
  const clarificationRequests: CbdDiffResult["clarificationRequests"] = [];
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
        fieldKey: field,
        field: FIELD_LABELS[field] ?? field,
        section: sectionForField(field),
        oldValue: oldVal,
        newValue: newVal,
        changed: oldVal !== newVal,
        changeType: oldVal === "—" ? "added" : newVal === "—" ? "removed" : "changed",
        deltaPercent
      };
    });

    // Modern CBDs store the editable rows in the structured payload. Older
    // imports only have cbd_material_lines, so retain a name-matched fallback
    // rather than comparing those rows by position.
    if (hasStructuredLines(prev) || hasStructuredLines(curr)) {
      addStructuredLineDiffs(entries, prev, curr);
    } else {
      addLegacyMaterialLineDiffs(entries, revisions[i - 1].materialLines, revisions[i].materialLines);
    }

    diffs.push(entries);

    const previousSubmittedAt = new Date(revisions[i - 1].submittedAt).getTime();
    const currentSubmittedAt = new Date(revisions[i].submittedAt).getTime();
    const matchingClarification = (approvalActions ?? [])
      .filter((action) => {
        const timestamp = new Date(action.created_at).getTime();
        return timestamp > previousSubmittedAt && timestamp <= currentSubmittedAt;
      })
      .at(-1);
    clarificationRequests.push(matchingClarification ? {
      actorRole: matchingClarification.actor_role,
      action: matchingClarification.action,
      comment: matchingClarification.comment,
      requestedAt: matchingClarification.created_at
    } : null);

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
    costImpacts,
    clarificationRequests
  };
}

type RawLine = Record<string, unknown>;
function structuredLines(payload: Record<string, unknown>, key: string): RawLine[] {
  const value = payload[key];
  return Array.isArray(value) ? value.filter((line): line is RawLine => Boolean(line) && typeof line === "object") : [];
}

function hasStructuredLines(payload: Record<string, unknown>) {
  return ["yarnLines", "fabricLines", "trimLines", "knittingLines", "operationsLines"]
    .some((key) => structuredLines(payload, key).length > 0);
}

type LegacyMaterialLine = {
  material_name: string | null;
  unit_cost: number | null;
  consumption: number | null;
  total_cost: number | null;
};

/**
 * Legacy material lines have no stable row id. Match them by normalized
 * material name so a reordered import is not falsely shown as a price change.
 */
function addLegacyMaterialLineDiffs(
  entries: CbdDiffEntry[],
  previous: LegacyMaterialLine[],
  current: LegacyMaterialLine[]
) {
  const keyFor = (line: LegacyMaterialLine, index: number) =>
    line.material_name?.trim().toLocaleLowerCase() || `row-${index + 1}`;
  const oldByKey = new Map(previous.map((line, index) => [keyFor(line, index), line]));
  const newByKey = new Map(current.map((line, index) => [keyFor(line, index), line]));
  const keys = new Set([...oldByKey.keys(), ...newByKey.keys()]);
  const fields: Array<keyof Pick<LegacyMaterialLine, "unit_cost" | "consumption" | "total_cost">> = ["unit_cost", "consumption", "total_cost"];

  for (const key of keys) {
    const oldLine = oldByKey.get(key);
    const newLine = newByKey.get(key);
    const label = newLine?.material_name ?? oldLine?.material_name ?? key;
    for (const field of fields) {
      const oldValue = formatValue(oldLine?.[field]);
      const newValue = formatValue(newLine?.[field]);
      entries.push({
        fieldKey: `legacyMaterialLines.${key}.${field}`,
        field: `${label} — ${humanizeField(field)}`,
        section: "Fabric & Trim",
        oldValue,
        newValue,
        changed: oldValue !== newValue,
        changeType: oldValue === "—" ? "added" : newValue === "—" ? "removed" : "changed",
        deltaPercent: computeDeltaPercent(oldLine?.[field], newLine?.[field])
      });
    }
  }
}

function addStructuredLineDiffs(entries: CbdDiffEntry[], previous: Record<string, unknown>, current: Record<string, unknown>) {
  const groups: Array<{ key: string; section: CbdDiffEntry["section"]; label: string; fields: string[]; identity: string }> = [
    { key: "yarnLines", section: "Yarn", label: "Yarn", fields: ["name", "consumption", "materialPrice", "materialCost", "fobPrice", "surchargePercent", "freightCost", "markupPercent"], identity: "name" },
    { key: "fabricLines", section: "Fabric & Trim", label: "Fabric", fields: ["name", "consumption", "materialPrice", "materialCost"], identity: "name" },
    { key: "trimLines", section: "Fabric & Trim", label: "Trim", fields: ["name", "consumption", "materialPrice", "materialCost"], identity: "name" },
    // Knitting uses the row position deliberately: changing Flat-7GG to Flat-12GG
    // is a modification of the same operation, not a misleading remove/add pair.
    { key: "knittingLines", section: "Knitting & Operations", label: "Knitting", fields: ["machineType", "knittingTime", "sah", "knittingCost"], identity: "__index" },
    { key: "operationsLines", section: "Knitting & Operations", label: "Operation", fields: ["operation", "operationCost"], identity: "operation" }
  ];
  for (const group of groups) {
    const before = structuredLines(previous, group.key);
    const after = structuredLines(current, group.key);
    const keys = new Set<string>();
    const getKey = (line: RawLine, index: number) => group.identity === "__index" ? String(index) : String(line[group.identity] ?? `row-${index}`);
    before.forEach((line, index) => keys.add(getKey(line, index)));
    after.forEach((line, index) => keys.add(getKey(line, index)));
    for (const key of keys) {
      const oldLine = before.find((line, index) => getKey(line, index) === key);
      const newLine = after.find((line, index) => getKey(line, index) === key);
      const lineLabel = group.identity === "__index" ? `${group.label} row ${Number(key) + 1}` : `${group.label}: ${key}`;
      for (const field of group.fields) {
        const oldValue = formatValue(oldLine?.[field]);
        const newValue = formatValue(newLine?.[field]);
        entries.push({
          fieldKey: `${group.key}.${key}.${field}`,
          field: `${lineLabel} — ${humanizeField(field)}`,
          section: group.section,
          oldValue,
          newValue,
          changed: oldValue !== newValue,
          changeType: oldValue === "—" ? "added" : newValue === "—" ? "removed" : "changed",
          deltaPercent: computeDeltaPercent(toNumber(oldLine?.[field]), toNumber(newLine?.[field]))
        });
      }
    }
  }
}

function humanizeField(field: string) {
  if (field === "machineType") return "Machine / Gauge Type";
  return field.replace(/([A-Z])/g, " $1").replace(/^./, (char) => char.toUpperCase());
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
