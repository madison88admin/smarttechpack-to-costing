import type { createSupabaseServiceClient } from "@/lib/supabase/server";

export async function recordWorkflowEvent(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  input: {
    costingRequestId: string;
    eventType: string;
    actorRole?: string | null;
    actorUserId?: string | null;
    payload?: Record<string, unknown>;
    /**
     * Defaults to "pending", which hands the event to the notification queue's
     * fan-out. Pass "skipped" when the caller notifies the right people itself,
     * so the event is recorded without a second, generic copy being sent.
     */
    notificationStatus?: string;
  }
) {
  const { error } = await supabase.from("workflow_events").insert({
    costing_request_id: input.costingRequestId,
    event_type: input.eventType,
    actor_role: input.actorRole ?? null,
    actor_user_id: input.actorUserId ?? null,
    payload: input.payload ?? {},
    notification_status: input.notificationStatus ?? "pending"
  });

  if (error) throw error;
}
