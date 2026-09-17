import { createSupabaseServiceClient } from "@/lib/supabase/server";

export type RequestCommentType = "comment" | "buyer_comment" | "factory_comment";

export type RequestComment = {
  id: string;
  note_type: RequestCommentType;
  note: string;
  created_by_role: string | null;
  created_at: string;
};

const requestCommentTypes: RequestCommentType[] = ["comment", "buyer_comment", "factory_comment"];

export function isRequestCommentType(value: unknown): value is RequestCommentType {
  return typeof value === "string" && requestCommentTypes.includes(value as RequestCommentType);
}

export async function listRequestComments(requestId: string, role: string) {
  const supabase = createSupabaseServiceClient();
  let query = supabase
    .from("costing_notes")
    .select("id,note_type,note,created_by_role,created_at")
    .eq("costing_request_id", requestId)
    .in("note_type", role === "factory" ? ["comment", "factory_comment"] : requestCommentTypes)
    .order("created_at", { ascending: false });
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as RequestComment[];
}
