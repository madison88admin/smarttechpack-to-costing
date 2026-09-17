import { createSupabaseServiceClient } from "@/lib/supabase/server";

// Structured per-field change requests (reviewer asks factory to change one
// exact CBD field). Mirrors the fieldKey grammar built by cbd-diff.ts:
//   - top-level raw_payload keys:      "machineType", "laborCost", ...
//   - structured rows:                 "{group}.{rowKey}.{field}"
//     (yarn/fabric/trim identity = row name, knitting = row index,
//      operations identity = operation name)
//   - legacy material rows:            "legacyMaterialLines.{name}.{field}"
// Resolution compares the LATEST factory CBD value against the requested
// value, so "requested vs actual vs remaining" always reflects the newest
// revision without any manual bookkeeping.

export type ChangeRequestStatus = "open" | "addressed" | "dismissed";

export type ChangeRequestRow = {
  id: string;
  costing_request_id: string;
  cbd_section: string;
  field_key: string;
  field_label: string;
  current_value: string;
  requested_value: string;
  reason: string;
  priority: string;
  due_date: string | null;
  status: string;
  requested_by_role: string | null;
  requested_by_name: string | null;
  resolved_cbd_id: string | null;
  created_at: string;
  resolved_at: string | null;
};

export type CreateChangeRequestInput = {
  costingRequestId: string;
  section: string;
  fieldKey: string;
  fieldLabel?: string | null;
  currentValue?: string | null;
  requestedValue: string;
  reason: string;
  priority?: string | null;
  dueDate?: string | null;
  requestedByRole?: string | null;
  requestedByName?: string | null;
};

export const CHANGE_REQUEST_PRIORITIES = ["low", "normal", "high", "urgent"] as const;

const STRUCTURED_GROUPS: Record<string, { linesKey: string; identity: "name" | "index" | "operation" }> = {
  yarnLines: { linesKey: "yarnLines", identity: "name" },
  fabricLines: { linesKey: "fabricLines", identity: "name" },
  trimLines: { linesKey: "trimLines", identity: "name" },
  knittingLines: { linesKey: "knittingLines", identity: "index" },
  operationsLines: { linesKey: "operationsLines", identity: "operation" }
};

/** Loose equality so "0.80" matches 0.8 and "Flat 7G" matches "flat 7g". */
export function changeValuesMatch(actual: unknown, requested: unknown): boolean {
  const left = String(actual ?? "").trim();
  const right = String(requested ?? "").trim();
  if (!left || !right) return false;
  const leftNum = Number(left.replace(/,/g, ""));
  const rightNum = Number(right.replace(/,/g, ""));
  if (Number.isFinite(leftNum) && Number.isFinite(rightNum)) return leftNum === rightNum;
  return left.toLowerCase() === right.toLowerCase();
}

type RawLine = Record<string, unknown>;

function asLines(value: unknown): RawLine[] {
  return Array.isArray(value)
    ? value.filter((line): line is RawLine => Boolean(line) && typeof line === "object")
    : [];
}

/**
 * Reads one field out of a stored CBD raw_payload (+ legacy material lines),
 * using the same identity rules as the diff builder so a requested fieldKey
 * always resolves to the same logical field the reviewer saw.
 */
export function readCbdFieldValue(
  rawPayload: unknown,
  legacyLines: Array<{ material_name?: unknown; unit_cost?: unknown; consumption?: unknown; total_cost?: unknown }> | null | undefined,
  fieldKey: string
): string | null {
  const payload = (rawPayload ?? {}) as Record<string, unknown>;
  const parts = fieldKey.split(".");

  // legacyMaterialLines.{material-name}.{unit_cost|consumption|total_cost}
  if (parts[0] === "legacyMaterialLines" && parts.length === 3) {
    const [, name, field] = parts;
    const line = (legacyLines ?? []).find(
      (row) => String(row.material_name ?? "").trim().toLowerCase() === name.trim().toLowerCase()
    );
    if (!line) return null;
    if (field === "unit_cost" || field === "consumption" || field === "total_cost") {
      const value = line[field];
      return value === null || value === undefined ? null : String(value);
    }
    return null;
  }

  // {group}.{rowKey}.{field} for structured rows
  if (parts.length === 3 && STRUCTURED_GROUPS[parts[0]]) {
    const [, rowKey, field] = parts;
    const group = STRUCTURED_GROUPS[parts[0]];
    const lines = asLines(payload[group.linesKey]);
    const line = lines.find((candidate, index) => {
      if (group.identity === "index") return String(index) === rowKey;
      const identityKey = group.identity === "operation" ? "operation" : "name";
      return String(candidate[identityKey] ?? `row-${index}`) === rowKey;
    });
    if (!line) return null;
    const value = line[field];
    return value === null || value === undefined || value === "" ? null : String(value);
  }

  // Plain top-level raw_payload key (also tolerates a "header." prefix).
  const key = parts.length === 2 && parts[0] === "header" ? parts[1] : parts[0];
  if (parts.length > 2) return null;
  const value = payload[key];
  return value === null || value === undefined || value === "" ? null : String(value);
}

export async function createChangeRequest(input: CreateChangeRequestInput) {
  if (!input.requestedValue?.trim()) throw new Error("Requested value is required");
  if (!input.reason?.trim()) throw new Error("Reason is required");
  if (!input.fieldKey?.trim()) throw new Error("Field is required");

  const supabase = createSupabaseServiceClient();
  const priority = (input.priority ?? "normal").trim().toLowerCase();
  const { data, error } = await supabase
    .from("cbd_change_requests")
    .insert({
      costing_request_id: input.costingRequestId,
      cbd_section: input.section?.trim() || "",
      field_key: input.fieldKey.trim(),
      field_label: input.fieldLabel?.trim() || input.fieldKey.trim(),
      current_value: input.currentValue ?? "",
      requested_value: input.requestedValue.trim(),
      reason: input.reason.trim(),
      priority: (CHANGE_REQUEST_PRIORITIES as readonly string[]).includes(priority) ? priority : "normal",
      due_date: input.dueDate?.trim() || null,
      status: "open",
      requested_by_role: input.requestedByRole ?? null,
      requested_by_name: input.requestedByName ?? null
    })
    .select("id")
    .single();

  if (error) throw error;
  return data as { id: string };
}

export async function listChangeRequests(costingRequestId: string): Promise<ChangeRequestRow[]> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("cbd_change_requests")
    .select(
      "id, costing_request_id, cbd_section, field_key, field_label, current_value, requested_value, reason, priority, due_date, status, requested_by_role, requested_by_name, resolved_cbd_id, created_at, resolved_at"
    )
    .eq("costing_request_id", costingRequestId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as ChangeRequestRow[];
}

/**
 * Resolves open change requests against a freshly submitted CBD revision:
 * fetches the CBD payload + legacy lines, then marks rows addressed when the
 * requested value is now present. Best-effort wrapper for the submit path.
 */
export async function resolveChangeRequestsForCbd(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  costingRequestId: string,
  cbdId: string
): Promise<{ addressed: number; remaining: number }> {
  const { data, error } = await supabase
    .from("factory_cbds")
    .select("raw_payload, cbd_material_lines (material_name, unit_cost, consumption, total_cost)")
    .eq("id", cbdId)
    .maybeSingle();

  if (error || !data) return { addressed: 0, remaining: 0 };
  const row = data as {
    raw_payload: unknown;
    cbd_material_lines: Array<{
      material_name?: unknown;
      unit_cost?: unknown;
      consumption?: unknown;
      total_cost?: unknown;
    }> | null;
  };
  return resolveOpenChangeRequests({
    costingRequestId,
    cbdId,
    rawPayload: row.raw_payload,
    legacyLines: row.cbd_material_lines ?? []
  });
}

/**
 * Dismisses one open change request (reviewer changed their mind, or accepts
 * the factory's deviation as-is). Only open rows can be dismissed; addressed
 * rows are history. Returns true when a row actually flipped.
 */
export async function dismissChangeRequest(input: {
  costingRequestId: string;
  changeRequestId: string;
}): Promise<boolean> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("cbd_change_requests")
    .update({ status: "dismissed", resolved_at: new Date().toISOString() })
    .eq("id", input.changeRequestId)
    .eq("costing_request_id", input.costingRequestId)
    .eq("status", "open")
    .select("id");

  if (error) throw error;
  return (data ?? []).length > 0;
}

export async function tryListChangeRequests(costingRequestId: string) {
  try {
    return { data: await listChangeRequests(costingRequestId), error: null };
  } catch (error) {
    return {
      data: [] as ChangeRequestRow[],
      error: error instanceof Error ? error.message : "Unable to load change requests"
    };
  }
}

/**
 * Marks open change requests addressed when the newest factory CBD already
 * carries the requested value. Runs after every factory submit — new requests
 * stay open (remaining work), matched ones resolve with the resolving CBD id.
 */
export async function resolveOpenChangeRequests(input: {
  costingRequestId: string;
  cbdId: string;
  rawPayload: unknown;
  legacyLines?: Array<{ material_name?: unknown; unit_cost?: unknown; consumption?: unknown; total_cost?: unknown }> | null;
}): Promise<{ addressed: number; remaining: number }> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("cbd_change_requests")
    .select("id, field_key, requested_value")
    .eq("costing_request_id", input.costingRequestId)
    .eq("status", "open");

  if (error) throw error;
  const open = (data ?? []) as Array<{ id: string; field_key: string; requested_value: string }>;
  let addressed = 0;

  for (const row of open) {
    const actual = readCbdFieldValue(input.rawPayload, input.legacyLines ?? null, row.field_key);
    if (!changeValuesMatch(actual, row.requested_value)) continue;
    const { error: updateError } = await supabase
      .from("cbd_change_requests")
      .update({ status: "addressed", resolved_cbd_id: input.cbdId, resolved_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("status", "open");
    if (updateError) throw updateError;
    addressed++;
  }

  return { addressed, remaining: open.length - addressed };
}
