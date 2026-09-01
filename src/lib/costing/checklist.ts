import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const defaultChecklistItems = [
  { code: "moq_checked", label: "MOQ checked", is_required: true },
  { code: "lead_time_checked", label: "Lead time checked", is_required: true },
  { code: "packaging_checked", label: "Packaging cost checked", is_required: true },
  { code: "comparable_style_reviewed", label: "Comparable style reviewed", is_required: true }
];

export async function listChecklistItems() {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("validation_checklist_items")
    .select("id,code,label,is_required,sort_order,is_active")
    .order("sort_order", { ascending: true })
    .order("label", { ascending: true });

  if (error) throw error;

  if (!data?.length) return defaultChecklistItems.map((item, index) => ({
    id: item.code,
    code: item.code,
    label: item.label,
    is_required: item.is_required,
    sort_order: index,
    is_active: true
  }));

  return data;
}

export async function upsertChecklistItem(input: {
  code: string;
  label: string;
  isRequired: boolean;
  sortOrder: number;
  isActive: boolean;
}) {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("validation_checklist_items")
    .upsert({
      code: input.code.trim(),
      label: input.label.trim(),
      is_required: input.isRequired,
      sort_order: input.sortOrder,
      is_active: input.isActive,
      updated_at: new Date().toISOString()
    }, { onConflict: "code" })
    .select("id")
    .single();

  if (error) throw error;

  return data;
}

export async function getChecklistResults(requestId: string) {
  const supabase = createSupabaseServiceClient();
  const checklistItems = (await listChecklistItems()).filter((item) => item.is_active);
  const { data, error } = await supabase
    .from("request_checklist_results")
    .select("checklist_code,is_checked,comment,checked_by_role,checked_at")
    .eq("costing_request_id", requestId);

  if (error) throw error;

  const byCode = new Map((data ?? []).map((row) => [row.checklist_code, row]));

  return checklistItems.map((item) => ({
    ...item,
    is_checked: byCode.get(item.code)?.is_checked ?? false,
    comment: byCode.get(item.code)?.comment ?? ""
  }));
}

export async function saveChecklistResults(
  requestId: string,
  items: { code: string; isChecked: boolean; comment?: string }[],
  actorRole?: string | null
) {
  const supabase = createSupabaseServiceClient();
  const payload = items.map((item) => ({
    costing_request_id: requestId,
    checklist_code: item.code,
    is_checked: item.isChecked,
    comment: item.comment ?? null,
    checked_by_role: actorRole ?? null,
    checked_at: item.isChecked ? new Date().toISOString() : null
  }));

  const { error } = await supabase
    .from("request_checklist_results")
    .upsert(payload, { onConflict: "costing_request_id,checklist_code" });

  if (error) throw error;

  return { count: payload.length };
}
