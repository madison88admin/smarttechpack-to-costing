import type { createSupabaseServiceClient } from "@/lib/supabase/server";

export async function recordWorkflowEvent(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  input: {
    costingRequestId: string;
    eventType: string;
    actorRole?: string | null;
    actorUserId?: string | null;
    payload?: Record<string, unknown>;
  }
) {
  const { error } = await supabase.from("workflow_events").insert({
    costing_request_id: input.costingRequestId,
    event_type: input.eventType,
    actor_role: input.actorRole ?? null,
    actor_user_id: input.actorUserId ?? null,
    payload: input.payload ?? {},
    notification_status: "pending"
  });

  if (error) throw error;
}
